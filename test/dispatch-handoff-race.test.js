/* test/dispatch-handoff-race.test.js — a COMPLETED worker's handoff must be on disk before anything
   downstream can stall or be cancelled.

   THE LIVE FAILURE THIS PINS (cron run c1bce71a, 2026-11-02). The Etsy chain routine dispatched SCOUT, SCOUT
   finished in 39s, booked $0.0091 and saved its research file — then team.dispatch sat silent until the cron
   driver's stale-lease sweep reclaimed the whole run ('stale-lock-reclaimed', sidecar/cron-driver.js:636)
   ~480s later. The tool came back 'cancelled - unconfirmed' and NO handoff file was written, so a completed,
   paid-for worker left no record and the lead reported Stage 1 stalled.

   The cause was ORDERING, not the store: recordHandoff ran only in the outer withHandoff wrapper, i.e. AFTER
   the whole post-worker phase. That phase has no wall clock (runWorker clears the per-worker timer the instant
   runOnce settles) and emits no events, so a stall there is invisible and unbounded.

   So the test stalls the post-worker phase FOREVER (station.deliver never answers) and asserts the handoff is
   already durable with the worker's real text. Against the pre-fix module this fails: no file is ever written.
   Run standalone: node test/dispatch-handoff-race.test.js */
'use strict';

const A = require('./_assert.js');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { makeHandoffStore } = require('../sidecar/handoff-store.js');
const { makeOrchestrationTools } = require('../sidecar/tools/builtin/orchestration.js');

const AT = Date.UTC(2026, 10, 2, 15, 42, 17);   // fixed clock -> deterministic handoff filename

function outboxOf(tmp, leadId) { return path.join(tmp, leadId, 'outbox'); }
function listOutbox(tmp, leadId) {
  const dir = outboxOf(tmp, leadId);
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.md')).sort() : [];
}

function build(tmp, opts) {
  opts = opts || {};
  const handoffs = makeHandoffStore({ fs, path, now: () => AT, dir: (id) => outboxOf(tmp, id) });
  const recorded = [];
  const roster = new Map([
    ['scout', { name: 'SCOUT', system: 'You research.', model: 'test-model', provider: 'test' }],
    ['agent', { name: 'NIGHT4CHRIST', system: 'You command.', model: 'test-model', provider: 'test' }]
  ]);
  const tools = {};
  makeOrchestrationTools({
    runOnce: opts.runOnce, roster: () => roster, key: 'k', model: 'test-model', provider: 'test',
    newId: () => 'W-1', perWorker: 0.05, now: () => Date.now(),
    dispatchTimeoutMs: opts.dispatchTimeoutMs,
    slowPhaseMs: opts.slowPhaseMs,
    station: opts.station || null,
    recordHandoff: (h) => { recorded.push(h); return handoffs.record(h); }
  }).register({ register: d => { tools[d.name] = d; } });
  return { tools, recorded };
}

/* ---------- 1. THE RACE: worker done, post-worker phase hangs forever, handoff still durable ---------- */
async function testCompletedWorkerSurvivesAStalledPostPhase() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'starnet-handoff-race-'));

  const runOnce = async () => ({
    reason: 'done', usd: 0.0091, model: 'test-model',
    artifacts: [{ path: 'etsy-scout/verses-for-hard-days-stage1.md' }],
    messages: [{ role: 'assistant', content: 'SCOUT REPORT: KJV encouragement cards, price band UNVERIFIED.' }]
  });

  // The post-worker stall, exactly as the live run behaved: the worker is finished, and the NEXT await never
  // answers. Session resolution must succeed first, or deliverToSession early-returns and nothing stalls.
  let deliverCalls = 0;
  const station = {
    request: (verb) => {
      if (verb === 'station.sessions') return Promise.resolve({ ok: true, result: { sessions: [{ id: 'S1', title: 'research' }] } });
      if (verb === 'station.deliver') { deliverCalls++; return new Promise(() => {}); }   // never settles
      return Promise.resolve({ ok: true, result: {} });
    }
  };

  const { tools, recorded } = build(tmp, { runOnce, station });

  let settled = false;
  const pending = tools['team.dispatch'].run(
    { workers: [{ agentId: 'scout', prompt: 'Price-check scripture printables.', context: 'No Apify.', session: 'research' }] },
    { agentId: 'agent', runId: 'LEAD-1', cronJobId: 'job-etsy-night', streamId: 'cron-LEAD-1', emit: () => {} }
  );
  pending.then(() => { settled = true; }, () => { settled = true; });
  await new Promise(r => setTimeout(r, 80));   // long enough for the worker + the handoff write

  A.eq(settled, false, 'the dispatch is still pending — this is the live shape: the tool never got to return');
  A.eq(deliverCalls, 1, 'and it is wedged in the post-worker phase (session delivery never answered)');

  const files = listOutbox(tmp, 'agent');
  A.eq(files.length, 1, 'the completed worker IS recorded even though the dispatch never returned');
  if (files.length !== 1) {
    // the pre-fix shape, stated plainly instead of crashing on files[0] two lines down
    A.ok(false, 'REGRESSION: nothing was filed for a worker that finished and was paid for — '
      + 'recordHandoff is running after the post-worker phase again, so a cancel discards the result');
    fs.rmSync(tmp, { recursive: true, force: true });
    return;
  }

  const filed = fs.readFileSync(path.join(outboxOf(tmp, 'agent'), files[0]), 'utf8');
  A.ok(/KJV encouragement cards/.test(filed), 'the file holds the worker\'s REAL result text, not a placeholder');
  A.ok(/outcome: \*\*done\*\*/.test(filed), 'and its real terminal reason');
  A.ok(/job-etsy-night/.test(filed), 'and ties back to the routine that started the chain');
  A.ok(/verses-for-hard-days-stage1\.md/.test(filed),
    'the artifact list is attached BEFORE filing — a handoff that omits the saved file understates the work');

  const meta = JSON.parse(/<!-- starnet-handoff (\{.*\}) -->/.exec(filed)[1]);
  A.eq(meta.complete, true, 'a worker that finished is marked complete');
  A.eq(meta.usd, 0.0091, 'with its real cost, so the owner can audit what was paid for');
  A.eq(meta.workerRunId, 'W-1', 'and the worker runId, so the record joins up with the run store');
  A.eq(recorded.length, 1, 'exactly ONE write for one exchange — filing early must not double-record');

  fs.rmSync(tmp, { recursive: true, force: true });
}

/* ---------- 2. IDEMPOTENCY: the outer wrapper must not re-file what runWorker already filed ---------- */
async function testHandoffIsWrittenOnceOnTheHappyPath() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'starnet-handoff-once-'));
  const runOnce = async () => ({
    reason: 'done', usd: 0.002, model: 'test-model',
    messages: [{ role: 'assistant', content: 'done boss' }]
  });
  const { tools, recorded } = build(tmp, { runOnce });

  const res = await tools['team.dispatch'].run(
    { workers: [{ agentId: 'scout', prompt: 'quick look' }] },
    { agentId: 'agent', runId: 'LEAD-2', emit: () => {} }
  );
  const rows = JSON.parse(res.content);
  A.eq(rows.length, 1, 'one worker, one row');
  A.eq(rows[0].reason, 'done', 'the worker completed');
  A.ok(rows[0].handoffFile, 'and the row still names the filed handoff for the lead to quote');
  A.eq(recorded.length, 1, 'ONE file, not two — runWorker files it and withHandoff must see it already done');
  A.eq(listOutbox(tmp, 'agent').length, 1, 'and exactly one file reached the outbox');

  fs.rmSync(tmp, { recursive: true, force: true });
}

/* ---------- 3. AN UNFINISHED WORKER IS STILL RECORDED AS UNFINISHED (no silent upgrade) ---------- */
async function testTimedOutWorkerIsRecordedAsNotComplete() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'starnet-handoff-timeout-'));
  // honors the abort signal, like the real runOnce — the wall clock is what ends it
  const runOnce = (o) => new Promise((_resolve, reject) => {
    if (o.signal) o.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
  const { tools, recorded } = build(tmp, { runOnce, dispatchTimeoutMs: 60 });

  const res = await tools['team.dispatch'].run(
    { workers: [{ agentId: 'scout', prompt: 'something slow' }] },
    { agentId: 'agent', runId: 'LEAD-3', emit: () => {} }
  );
  const rows = JSON.parse(res.content);
  A.eq(rows[0].reason, 'timeout', 'a worker that ran out of wall clock reports timeout');

  const files = listOutbox(tmp, 'agent');
  A.eq(files.length, 1, 'a FAILED handoff is filed too — a missing file for a worker that ran would be the lie');
  const filed = fs.readFileSync(path.join(outboxOf(tmp, 'agent'), files[0]), 'utf8');
  const meta = JSON.parse(/<!-- starnet-handoff (\{.*\}) -->/.exec(filed)[1]);
  A.eq(meta.complete, false, 'and it is NOT marked complete — filing early must never upgrade an unfinished run');
  A.ok(/NOT a completed subtask/.test(filed), 'the prose says so too, for the owner reading it on a phone');
  A.eq(recorded.length, 1, 'still exactly one record for the exchange');

  fs.rmSync(tmp, { recursive: true, force: true });
}

/* ---------- 4. THE REAL RECLAIM SHAPE: abort mid-stall must not void what already completed ---------- */
async function testAbortDuringStallKeepsTheCompletedResult() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'starnet-handoff-abort-'));
  const runOnce = async () => ({
    reason: 'done', usd: 0.0091, model: 'test-model',
    messages: [{ role: 'assistant', content: 'SCOUT REPORT: price band UNVERIFIED, 4 listings seen.' }]
  });
  const station = {
    request: (verb) => {
      if (verb === 'station.sessions') return Promise.resolve({ ok: true, result: { sessions: [{ id: 'S1', title: 'research' }] } });
      if (verb === 'station.deliver') return new Promise(() => {});   // the stall
      return Promise.resolve({ ok: true, result: {} });
    }
  };
  const { tools, recorded } = build(tmp, { runOnce, station });

  // cron-driver.js:626 does exactly this on a stale lease: lease.ac.abort()
  const ac = new AbortController();
  const pending = tools['team.dispatch'].run(
    { workers: [{ agentId: 'scout', prompt: 'Price-check.', session: 'research' }] },
    { agentId: 'agent', runId: 'LEAD-4', cronJobId: 'job-etsy-night', streamId: 'cron-LEAD-4', signal: ac.signal, emit: () => {} }
  );
  pending.catch(() => {});                      // the registry is what surfaces the cancel; don't crash the test
  await new Promise(r => setTimeout(r, 80));    // worker completes, handoff files, post-phase wedges
  ac.abort();                                   // the lease reclaim
  await new Promise(r => setTimeout(r, 40));

  const files = listOutbox(tmp, 'agent');
  A.eq(files.length, 1, 'the reclaim does NOT discard a worker that already finished and was paid for');
  if (files.length === 1) {
    const filed = fs.readFileSync(path.join(outboxOf(tmp, 'agent'), files[0]), 'utf8');
    A.ok(/4 listings seen/.test(filed), 'and the filed record still holds the real result text');
    const meta = JSON.parse(/<!-- starnet-handoff (\{.*\}) -->/.exec(filed)[1]);
    A.eq(meta.complete, true, 'marked complete, because the worker genuinely completed before the cancel');
    A.eq(meta.usd, 0.0091, 'with the real cost the owner was charged');
  }
  A.eq(recorded.length, 1, 'and the cancel does not cause a duplicate record');

  fs.rmSync(tmp, { recursive: true, force: true });
}

/* ---------- 5. THE INSTRUMENTATION MUST NAME A WEDGED PHASE WHILE IT IS STILL WEDGED ---------- */
async function testStalledPhaseIsNamedOnStdout() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'starnet-handoff-probe-'));
  const runOnce = async () => ({
    reason: 'done', usd: 0.001, model: 'test-model',
    messages: [{ role: 'assistant', content: 'worker text' }]
  });
  const station = {
    request: (verb) => {
      if (verb === 'station.sessions') return Promise.resolve({ ok: true, result: { sessions: [{ id: 'S1', title: 'research' }] } });
      if (verb === 'station.deliver') return new Promise(() => {});   // wedged forever, like the live stall
      return Promise.resolve({ ok: true, result: {} });
    }
  };
  const { tools } = build(tmp, { runOnce, station, slowPhaseMs: 30 });

  const lines = [];
  const realWarn = console.warn;
  console.warn = (...a) => { lines.push(a.join(' ')); };
  try {
    const pending = tools['team.dispatch'].run(
      { workers: [{ agentId: 'scout', prompt: 'go', session: 'research' }] },
      { agentId: 'agent', runId: 'LEAD-5', emit: () => {} }
    );
    pending.catch(() => {});
    await new Promise(r => setTimeout(r, 150));   // past slowPhaseMs, while the phase is STILL pending
  } finally { console.warn = realWarn; }

  const stalled = lines.filter(l => /still pending after/.test(l));
  A.eq(stalled.length, 1, 'a wedged phase reports itself WHILE pending — an end()-only log would never fire');
  A.ok(/"session-deliver"/.test(stalled[0]), 'and it names the exact blocking phase, not just "something was slow"');
  A.ok(/worker=scout/.test(stalled[0]), 'with the worker it was dispatching');
  A.ok(/leadRun=LEAD-5/.test(stalled[0]), 'and the lead run id, so it joins up with the run store');
  A.ok(/anomalous/.test(stalled[0]),
    'a post-worker phase is labelled anomalous (it should be instant), which a worker-loop line must NOT be');
  // TRUTHFUL TELEMETRY: the line must not assert a conclusion it cannot know. The first version hardcoded
  // "THIS is the operation that discarded a completed worker in run c1bce71a" and fired it on healthy runs.
  A.ok(!/c1bce71a/.test(stalled[0]),
    'the log states what was observed, never a pre-baked diagnosis of which incident caused it');

  fs.rmSync(tmp, { recursive: true, force: true });
}

/* ---------- 6. A HEALTHY DISPATCH MUST STAY SILENT (the 20s-threshold false positive) ---------- */
async function testHealthyDispatchLogsNothing() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'starnet-handoff-quiet-'));
  // No slowPhaseMs injection: the REAL thresholds apply (worker 90s, post-worker 10s). A worker loop that
  // takes a moment is normal work and must not be reported as a stall — the first threshold fired on every
  // healthy SCOUT run (~26s) and called a working dispatch broken.
  const runOnce = () => new Promise(r => setTimeout(() => r({
    reason: 'done', usd: 0.001, model: 'test-model',
    messages: [{ role: 'assistant', content: 'normal result' }]
  }), 120));
  const { tools } = build(tmp, { runOnce });

  const lines = [];
  const realWarn = console.warn;
  console.warn = (...a) => { lines.push(a.join(' ')); };
  let rows;
  try {
    const res = await tools['team.dispatch'].run(
      { workers: [{ agentId: 'scout', prompt: 'go' }] },
      { agentId: 'agent', runId: 'LEAD-6', emit: () => {} }
    );
    rows = JSON.parse(res.content);
  } finally { console.warn = realWarn; }

  A.eq(rows[0].reason, 'done', 'the dispatch completed normally');
  A.eq(lines.filter(l => /still pending after/.test(l)).length, 0,
    'a healthy dispatch emits NO stall line — the instrumentation must not cry wolf on working runs');
  A.eq(lines.filter(l => /finished after/.test(l)).length, 0,
    'and no recovery line either, since nothing was ever reported as pending');

  fs.rmSync(tmp, { recursive: true, force: true });
}

(async function main() {
  await testCompletedWorkerSurvivesAStalledPostPhase();
  await testHandoffIsWrittenOnceOnTheHappyPath();
  await testTimedOutWorkerIsRecordedAsNotComplete();
  await testAbortDuringStallKeepsTheCompletedResult();
  await testStalledPhaseIsNamedOnStdout();
  await testHealthyDispatchLogsNothing();
  A.report('dispatch handoff race');
})().catch(e => { console.error(e); process.exit(1); });

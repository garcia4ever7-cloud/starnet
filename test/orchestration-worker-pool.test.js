/* test/orchestration-worker-pool.test.js — the POOLED per-lead-run worker budget.

   THE DEFECT. `perWorker` (BUDGET_PER_WORKER) is a PER-WORKER ceiling: every dispatched worker
   independently gets up to that much, so a lead that fans out N workers multiplies the run's exposure by
   N. On this station a cron lead's own ceiling is forwarded as callerMaxCostUsd, but a WORKER's was not
   bounded in aggregate at all — so "the lead is capped" was never true of the chain it starts.

   `deps.workerPool` (BUDGET_WORKER_POOL) is ONE shared USD pool for the whole lead run. What is pinned
   here is as much the REFUSALS and the BACKWARD-COMPATIBLE case as the new arithmetic:

     - the pool only ever LOWERS a grant; the per-worker ceiling stays the upper bound,
     - a grant is NEVER 0 while the pool is active — 0 means "no cap" to the run host, so an exhausted
       pool must REFUSE rather than compute its way to an uncapped worker,
     - exhaustion fails CLOSED with a legible row and starts no worker (no hang, no empty result),
     - perWorker:0 (ungoverned) and workerPool:0 (disabled) are byte-identical to the pre-pool behaviour,
     - the accumulator is per-LEAD-RUN: makeOrchestrationTools is called once per run inside runOnceCore,
       so two factories must not share a pool.

   Mocks only — a fake runOnce, no network, no provider, no live state.
   Plain node, no framework: node test/orchestration-worker-pool.test.js */
'use strict';

const A = require('./_assert.js');
const { makeOrchestrationTools } = require('../sidecar/tools/builtin/orchestration.js');

const AT = Date.UTC(2026, 10, 17, 9, 0, 0);

/* A lead run: one factory, one pool. `costs` is the usd each successive runOnce call reports (the stub does
   NOT self-enforce maxCostUsd — the real run host does that; here we are asserting what the pool GRANTS). */
function leadRun(opts) {
  const o = opts || {};
  const costs = o.costs || [];
  const calls = [];
  const roster = new Map([
    ['agent', { name: 'LEAD', system: 'You command.', model: 'test-model', provider: 'test' }],
    ['scout', { name: 'SCOUT', system: 'You research.', model: 'test-model', provider: 'test' }],
    ['publisher', { name: 'PUBLISHER', system: 'You draft.', model: 'test-model', provider: 'test' }]
  ]);
  const runOnce = async (ro) => {
    calls.push({ agentId: ro.agentId, maxCostUsd: ro.maxCostUsd, outputOnly: !!ro.outputOnly });
    const usd = calls.length <= costs.length ? costs[calls.length - 1] : 0;
    return { reason: 'done', usd, model: 'test-model',
      messages: [{ role: 'assistant', content: o.reply || 'WORKER REPORT: done.' }] };
  };
  const tools = {};
  makeOrchestrationTools({
    runOnce, roster: () => roster, key: 'k', model: 'test-model', provider: 'test',
    newId: (() => { let n = 0; return () => 'W-' + (++n); })(),
    perWorker: o.perWorker, workerPool: o.workerPool,
    now: () => AT
  }).register({ register: d => { tools[d.name] = d; } });
  return { tools, calls, grants: () => calls.map(c => c.maxCostUsd) };
}

async function dispatch(run, workers, runId) {
  const res = await run.tools['team.dispatch'].run(
    { workers },
    { agentId: 'agent', runId: runId || 'LEAD-1', emit: () => {} }
  );
  return JSON.parse(res.content);
}

// Distinct prompts: the tool rejects a duplicate task prompt within one dispatch ("duplicate of task N"),
// which has nothing to do with the pool but would otherwise swallow the workers under test.
let pn = 0;
const w = (agentId, prompt, extra) => Object.assign({ agentId, prompt: prompt || ('subtask ' + (++pn)) }, extra || {});

/* ---------- 1. THE POOL LOWERS A GRANT, and only ever downward ---------- */
async function testPoolLowersGrant() {
  // perWorker 1.00, pool 1.50. Three workers at $0.40 each: the first two clear the per-worker ceiling
  // untouched, the third is cut to what the pool has left.
  const run = leadRun({ perWorker: 1.00, workerPool: 1.50, costs: [0.40, 0.40, 0.40] });
  const rows = await dispatch(run, [w('scout'), w('publisher'), w('scout')]);
  A.eq(rows.length, 3, 'three workers, three rows');
  A.eq(rows.map(r => r.reason), ['done', 'done', 'done'], 'all three ran — the pool had room for all of them');
  A.eq(run.grants(), [1.00, 1.00, 0.70],
    'grant = min(perWorker, poolRemaining): untouched twice, then lowered to the $0.70 the pool had left');
  A.ok(run.grants().every(g => g <= 1.00), 'the pool NEVER raises a grant above the per-worker ceiling');
}

/* ---------- 2. EXHAUSTION FAILS CLOSED, with a legible row and no worker started ---------- */
async function testExhaustionFailsClosed() {
  // pool 0.50, workers cost 0.30 each: the third dispatch finds the pool dry.
  const run = leadRun({ perWorker: 1.00, workerPool: 0.50, costs: [0.30, 0.30, 0.30] });
  const rows = await dispatch(run, [w('scout'), w('publisher'), w('scout')]);
  A.eq(rows.length, 3, 'the refused worker still gets a row — never a silently dropped subtask');
  A.eq(rows[0].reason, 'done', 'worker 1 ran');
  A.eq(rows[1].reason, 'done', 'worker 2 ran');
  A.eq(rows[2].reason, 'refused', 'worker 3 is REFUSED once the pool is spent — fail closed');
  A.eq(rows[2].usd, 0, 'and it cost nothing, because it never started');
  A.eq(run.calls.length, 2, 'the run host was called exactly TWICE — the third worker never reached a provider');

  const msg = String(rows[2].result || '');
  A.ok(msg.length > 40, 'the refusal is a real message, not an empty result');
  A.ok(/POOLED/.test(msg), 'it names the mechanism (POOLED budget), so the lead can tell this apart from a cap race');
  A.ok(/BUDGET_WORKER_POOL/.test(msg), 'it names the knob the owner would have to raise');
  A.ok(/0\.5000/.test(msg), 'it states the actual pool cap');
  A.ok(/unfinished/.test(msg), 'and tells the lead to report the subtask as unfinished rather than done');

  // A grant of 0 would read as "uncapped" to the run host — the whole point of refusing instead.
  A.ok(run.grants().every(g => typeof g === 'number' && g > 0),
    'no worker was ever handed maxCostUsd:0 (which the run host reads as UNCAPPED) while the pool was active');
}

/* ---------- 3. BACKWARD COMPATIBILITY: perWorker 0, and workerPool 0 ---------- */
async function testUngovernedUnchanged() {
  // perWorker 0 = ungoverned. A pool must be INERT here: no lowering (there is no ceiling to lower) and,
  // critically, no new refusals — expensive workers keep running exactly as they do today.
  const run = leadRun({ perWorker: 0, workerPool: 2.00, costs: [5.00, 5.00, 5.00] });
  const rows = await dispatch(run, [w('scout'), w('publisher'), w('scout')]);
  A.eq(rows.map(r => r.reason), ['done', 'done', 'done'],
    'perWorker:0 -> the pool is forced off -> NO new refusals, exactly as today');
  A.eq(run.grants(), [0, 0, 0], 'and every worker is still granted maxCostUsd:0 (ungoverned), byte-identical');

  // workerPool 0 = disabled. Per-worker ceiling applies, unchanged, to every worker.
  const off = leadRun({ perWorker: 0.25, workerPool: 0, costs: [0.25, 0.25, 0.25] });
  const offRows = await dispatch(off, [w('scout'), w('publisher'), w('scout')]);
  A.eq(offRows.map(r => r.reason), ['done', 'done', 'done'], 'workerPool:0 -> no pool, no refusals');
  A.eq(off.grants(), [0.25, 0.25, 0.25],
    'and each worker independently gets the FULL per-worker ceiling — the pre-pool behaviour this change preserves');

  // Omitting the dep entirely (every caller that has not been updated) must behave like 0.
  const absent = leadRun({ perWorker: 0.25, costs: [0.25, 0.25] });
  const absentRows = await dispatch(absent, [w('scout'), w('publisher')]);
  A.eq(absentRows.map(r => r.reason), ['done', 'done'], 'an absent workerPool dep is not a pool');
  A.eq(absent.grants(), [0.25, 0.25], 'and leaves the per-worker ceiling untouched');

  // Junk values must not accidentally arm a pool.
  for (const bad of [-1, NaN, Infinity, '1.00', null, {}]) {
    const j = leadRun({ perWorker: 0.25, workerPool: bad, costs: [0.25, 0.25] });
    const jr = await dispatch(j, [w('scout'), w('publisher')]);
    A.eq(j.grants(), [0.25, 0.25], 'a non-finite/non-number workerPool (' + String(bad) + ') arms nothing');
    A.eq(jr.map(r => r.reason), ['done', 'done'], 'and refuses nothing (' + String(bad) + ')');
  }
}

/* ---------- 4. THE POOL IS PER-LEAD-RUN and does NOT leak between runs ----------
   makeOrchestrationTools is called once per run (sidecar/index.js, inside runOnceCore), so the closure
   accumulator is per-run by construction. A pool that leaked would starve every later run on the station. */
async function testNoLeakBetweenRuns() {
  const first = leadRun({ perWorker: 1.00, workerPool: 0.50, costs: [0.60] });
  const firstRows = await dispatch(first, [w('scout'), w('publisher')], 'LEAD-1');
  A.eq(firstRows[0].reason, 'done', 'run 1 worker 1 ran');
  A.eq(firstRows[1].reason, 'refused', 'run 1 worker 2 is refused — that run\'s pool is spent');

  const second = leadRun({ perWorker: 1.00, workerPool: 0.50, costs: [0.10, 0.10] });
  const secondRows = await dispatch(second, [w('scout'), w('publisher')], 'LEAD-2');
  A.eq(secondRows.map(r => r.reason), ['done', 'done'],
    'a SEPARATE lead run starts with a full pool — exhaustion never leaks across runs');
  A.eq(second.grants(), [0.50, 0.40], 'and its own arithmetic starts from the full $0.50, not from run 1\'s spend');
}

/* ---------- 5. AN UNDERSPENDING WORKER LEAVES ITS REMAINDER TO THE NEXT ---------- */
async function testRemainderCarries() {
  // pool 0.25 under a 1.00 per-worker ceiling: worker 1 is granted the whole pool but only uses $0.05,
  // so worker 2 must see $0.20 — the pool tracks ACTUAL spend, not grants.
  const run = leadRun({ perWorker: 1.00, workerPool: 0.25, costs: [0.05, 0.05] });
  const rows = await dispatch(run, [w('scout'), w('publisher')]);
  A.eq(rows.map(r => r.reason), ['done', 'done'], 'both workers ran — a cheap worker does not starve its sibling');
  A.eq(run.grants(), [0.25, 0.20],
    'the unspent $0.20 of worker 1\'s grant is still available to worker 2 (actual spend is charged, not the grant)');
}

/* ---------- 6. THE STRUCTURED-RESULT REPAIR TURN SPENDS FROM THE SAME POOL ----------
   The repair is a second real provider call per worker. Before the pool it was bounded only by
   perWorker - spent; a dry pool must skip it rather than compute maxCostUsd:0, which is UNCAPPED. */
async function testRepairTurnIsPooled() {
  const schema = { type: 'object', required: ['n'], properties: { n: { type: 'number' } } };

  // Room in the pool -> the repair runs, with a grant lowered by what the worker already spent.
  const room = leadRun({ perWorker: 1.00, workerPool: 2.00, costs: [0.50, 0.10], reply: 'not json at all' });
  const roomRows = await dispatch(room, [w('scout', 'give me json', { resultSchema: schema })]);
  A.eq(room.calls.length, 2, 'with pool room the bounded repair turn is attempted');
  A.eq(room.calls[1].outputOnly, true, 'and the second call is the repair turn');
  A.eq(room.calls[1].maxCostUsd, 0.50,
    'the repair is granted min(perWorker - spent, poolRemaining) = $0.50, not the full per-worker ceiling again');
  A.eq(roomRows.length, 1, 'one worker, one row');

  // Dry pool -> the repair is skipped. It must NOT be granted a 0 (uncapped) budget.
  const dry = leadRun({ perWorker: 1.00, workerPool: 0.20, costs: [0.50, 0.10], reply: 'not json at all' });
  const dryRows = await dispatch(dry, [w('scout', 'give me json', { resultSchema: schema })]);
  A.eq(dry.calls.length, 1, 'a dry pool SKIPS the repair turn — no second provider call');
  A.eq(dryRows[0].reason, 'invalid-result',
    'and the row says the contract was not met, instead of quietly accepting unvalidated output');
  A.ok(dry.calls.every(c => c.maxCostUsd > 0), 'nothing was handed an uncapped 0 on the way there');
}

/* ---------- 7. SOURCE LOCK: the exhaustion check must stay AHEAD of the grant arithmetic ----------
   min(ceiling, 0) is 0, and 0 means "no cap" to the run host. A future "simplification" that drops the
   poolDry() guard and relies on the arithmetic alone would hand an EXHAUSTED pool an UNCAPPED worker while
   every behavioural test above still passed on the happy paths. Pin the invariant where it is stated. */
function testGrantNeverMeansUncapped() {
  const src = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'sidecar', 'tools', 'builtin', 'orchestration.js'), 'utf8');
  A.ok(/const pooled = \(ceiling\) => \{/.test(src), 'the grant helper is still named pooled()');
  A.ok(/poolDry\s*=\s*\(\)\s*=>\s*workerPool > 0 && poolLeft\(\) <= 0/.test(src),
    'poolDry() still means "the pool is armed AND has nothing left"');
  // Every maxCostUsd handed to a worker goes through pooled(); none may pass perWorker raw.
  A.eq((src.match(/maxCostUsd: pooled\(/g) || []).length, 6,
    'all six worker/repair grants (three dispatch sites x run+repair) go through pooled()');
  A.eq((src.match(/maxCostUsd: perWorker[,\s]/g) || []).length, 0,
    'no dispatch site still passes the raw per-worker ceiling, bypassing the pool');
  // Three fail-closed guards: one per dispatch site.
  A.eq((src.match(/if \(poolDry\(\)\)/g) || []).length, 6,
    'three dispatch refusals + three repair skips — every path that would otherwise grant an uncapped 0');
}

(async () => {
  await testPoolLowersGrant();
  await testExhaustionFailsClosed();
  await testUngovernedUnchanged();
  await testNoLeakBetweenRuns();
  await testRemainderCarries();
  await testRepairTurnIsPooled();
  testGrantNeverMeansUncapped();
  A.report('orchestration worker pool');
})();

/* test/headless-dispatch.test.js — a CRON-STARTED lead must be able to delegate, and the handoff must land
   as a file.

   THE DEFECT THIS LOCKS DOWN. team.dispatch existed only for a browser-commanded run. Two independent gates
   closed on every scheduled or headless lead:
     1. CAPABILITY — capability/office.js adds the `orchestrator` object only when `lead` is true, and `lead` is
        true only on POST /api/run from a tab. No orchestrator object -> resolveTools never produces the tool,
        so the model is not even told delegation exists.
     2. CONSENT — team.dispatch is scope 'execute', so permissions.js tier 2.5 (the autonomous exec lockout)
        refused it with "silence is not consent" even when the tool WAS present.
   Fixing only one leaves the chain dead, which is why both halves are asserted here, and why they are fed from
   the SAME per-routine record (an offered tool that consent then refuses is the incoherent state the terminal
   lane already hit once).

   AND THE THIRD THING: a handoff nobody can read is not a handoff. The worker's text comes back as a tool
   result inside the lead's messages and dies with the run, and an ASK-mode worker cannot fs.write on an
   unattended run at all (cabinet:write default-denies). So the HOST writes the file.

   Plain node, no framework: node test/headless-dispatch.test.js */
'use strict';

const A = require('./_assert.js');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { composeOffice, stationWithObject } = require('../sidecar/capability/office.js');
const { resolveTools } = require('../sidecar/capability/resolve.js');
const { CAP_REGISTRY } = require('../sidecar/capability/registry.js');
const { makeConsentBroker } = require('../sidecar/permissions.js');
const { makeRunAuthority, enforceRunAuthority, normalizeUnattendedGrants, GRANTABLE_UNATTENDED } = require('../sidecar/inputpolicy.js');
const { makeHandoffStore } = require('../sidecar/handoff-store.js');
const { makeHostQuota } = require('../sidecar/hostquota.js');
const { makeOrchestrationTools } = require('../sidecar/tools/builtin/orchestration.js');

// tool defs exactly as the live registry stamps them, built from the real CAP_REGISTRY (never hand-made:
// a fixture that drifts from the registry would test the fixture).
const DEFS = {};
for (const ot of Object.keys(CAP_REGISTRY)) for (const g of CAP_REGISTRY[ot]) {
  DEFS[g.tool] = { name: g.tool, capability: g.capId, scope: g.scope, network: !!g.network, requiresConsent: !!g.requiresConsent };
}
const registryStub = { get: n => DEFS[n] || null };
const call = n => ({ name: n, args: {} });

/* ---------- 1. THE CAPABILITY HALF: the orchestrator object reaches a cron room ---------- */
function testCapabilityHalf() {
  // the cron shape: surface 'autonomous', lead FALSE (no browser), the full default office.
  const roomOf = (grants) => {
    let station = {
      agents: { boss: { id: 'boss', room: 'office' } },
      rooms: { office: { id: 'office', objects: composeOffice({ surface: 'autonomous', lead: false, connectorIds: [] }) } }
    };
    // index.js, runOnce: the UNATTENDED GRANT object half (gated on !o.parentRunId — see test 4).
    if (grants.indexOf('orchestrator') >= 0) station = stationWithObject(station, 'boss', 'orchestrator');
    return station;
  };

  const ungranted = resolveTools('boss', roomOf([]), undefined, {});
  A.ok(ungranted.tools.indexOf('team.dispatch') < 0,
    'an UNGRANTED cron lead still has no team.dispatch — the grant is opt-in per routine, not a blanket change');

  const granted = resolveTools('boss', roomOf(['orchestrator']), undefined, {});
  A.ok(granted.tools.indexOf('team.dispatch') >= 0,
    'a routine granted "orchestrator" resolves team.dispatch on an autonomous, non-lead run');
  A.ok(granted.tools.indexOf('team.subagents') >= 0, 'and team.subagents, so the lead can see its crew');

  // the authority gate must not then strip it back out (orchestrator is impact 'none').
  const authority = makeRunAuthority({ surface: 'autonomous', isTask: true, unattendedGrants: ['orchestrator'] });
  const after = enforceRunAuthority(granted, registryStub, authority);
  A.ok(after.tools.indexOf('team.dispatch') >= 0,
    'enforceRunAuthority keeps team.dispatch on an ASK-mode autonomous run (orchestrator is a local capability)');

  // the whitelist is the authority, and it re-filters a hand-edited job record.
  A.ok(GRANTABLE_UNATTENDED.has('orchestrator'), 'orchestrator is a grantable unattended capability');
  A.eq(Array.from(normalizeUnattendedGrants(['orchestrator', 'desktop', 'everything'])).sort(), ['orchestrator'],
    'a widened/corrupted job record is filtered down to the modelled grants only');
}

/* ---------- 2. THE CONSENT HALF: the exec lockout opens for dispatch, and ONLY for dispatch ---------- */
function testConsentHalf() {
  const broker = (grantOn) => makeConsentBroker({
    surface: 'autonomous', sessionKey: 'r1',
    networkOf: (c) => !!(DEFS[c.name] && DEFS[c.name].network),
    dispatchGrant: () => grantOn
  });

  const ungranted = broker(false)(call('team.dispatch'), DEFS['team.dispatch']);
  A.eq(ungranted.allow, false, 'without the grant, an autonomous team.dispatch is still refused (exec lockout holds)');
  A.ok(/silence is not consent/.test(ungranted.reason), 'and it is refused by the exec lockout, with the same reason as before');

  const ok = broker(true)(call('team.dispatch'), DEFS['team.dispatch']);
  A.eq(ok.allow, true, 'with the per-routine grant, an autonomous team.dispatch is allowed');
  A.eq(ok.reason, 'per-routine unattended delegation grant', 'and the reason names the grant that opened it');

  A.eq(broker(true)(call('team.resume'), DEFS['team.resume']).allow, true, 'team.resume rides the same grant');
  A.eq(broker(true)(call('team.steer'), DEFS['team.steer']).allow, true, 'team.steer rides the same grant');

  /* THE NAME FENCE. Everything else on the orchestrator capability mutates standing station config or needs a
     live browser. A capability-level yes would have handed all of it over at once. */
  for (const n of ['routine.create', 'routine.manage', 'loop.create', 'loop.manage', 'team.configure', 'task.manage', 'team.summon', 'team.spawn']) {
    A.eq(broker(true)(call(n), DEFS[n]).allow, false, n + ' is NOT unlocked by the delegation grant — it stays human-gated');
  }
  // the read-only orchestrator verbs were always fine and must stay fine (tier 4, not the new tier).
  A.eq(broker(false)(call('team.subagents'), DEFS['team.subagents']).reason, 'read-only, non-network',
    'team.subagents still auto-allows as a local read, with or without the grant');

  // an INTERACTIVE run is untouched: the grant is autonomous-only, so a human is still asked.
  const live = makeConsentBroker({ surface: 'interactive', sessionKey: 'r2', dispatchGrant: () => true,
    networkOf: () => true, prompt: () => 'deny' });
  const d = live(call('team.dispatch'), DEFS['team.dispatch']);
  A.ok(d && typeof d.then === 'function', 'on the interactive surface the grant does not pre-approve — a human is still asked');
}

/* ---------- 3. THE HANDOFF FILE: the host writes it, for every outcome ---------- */
function testHandoffFile() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'starnet-handoff-'));
  let t = Date.UTC(2026, 9, 26, 18, 13, 20);
  const store = makeHandoffStore({ fs, path, now: () => t, dir: (id) => path.join(tmp, id, 'outbox') });

  const done = store.record({
    leadId: 'agent', workerId: 'scout',
    prompt: 'Name one KJV verse that fits a hard-days printable.',
    context: 'We already shipped Psalm 46:10.',
    result: 'Isaiah 41:10 — "Fear thou not; for I am with thee".',
    reason: 'done', usd: 0.0012, leadRunId: 'L1', workerRunId: 'W1', cronJobId: 'job-etsy-night',
    artifacts: ['research/verse.md']
  });
  A.eq(done.ok, true, 'a completed handoff writes a file');
  A.eq(done.relPath, 'outbox/20261026-181320-agent-to-scout.md',
    'named <utc-stamp>-<lead>-to-<worker>.md so an outbox listing sorts by time');
  const text = fs.readFileSync(done.file, 'utf8');
  A.ok(/^<!-- starnet-handoff \{/.test(text), 'it opens with a machine-readable JSON block so the next routine can parse it');
  const meta = JSON.parse(/^<!-- starnet-handoff (\{.*\}) -->$/m.exec(text)[1]);
  A.eq(meta.from, 'agent', 'the record names who delegated');
  A.eq(meta.to, 'scout', 'and who did the work');
  A.eq(meta.complete, true, '"done" is recorded as complete');
  A.eq(meta.usd, 0.0012, 'the real cost is recorded, not a guess');
  A.eq(meta.cronJobId, 'job-etsy-night', 'the routine that started the chain is on the record');
  A.eq(meta.artifacts, ['research/verse.md'], 'the files the worker provably saved are listed');
  A.ok(/Isaiah 41:10/.test(text), 'the result the worker actually returned is in the file');
  A.ok(/Name one KJV verse/.test(text), 'so is the task that was sent — a handoff is both halves');
  A.ok(/Psalm 46:10/.test(text), 'and the context the lead handed over');

  /* A FAILED HANDOFF IS STILL WRITTEN. A missing file for a worker that ran would be the lie — the owner
     must be able to see that the chain stalled, and on what. */
  t += 1000;
  const bad = store.record({ leadId: 'agent', workerId: 'scout', prompt: 'x', result: 'partial…', reason: 'timeout', usd: 0.002 });
  A.eq(bad.ok, true, 'a TIMED-OUT handoff is written too');
  const badText = fs.readFileSync(bad.file, 'utf8');
  A.eq(JSON.parse(/^<!-- starnet-handoff (\{.*\}) -->$/m.exec(badText)[1]).complete, false, 'and is marked NOT complete');
  A.ok(/NOT a completed subtask/.test(badText), 'with prose saying so, so the result is not read as finished work');

  // identity is sanitised, never trusted into a path.
  t += 1000;
  const esc = store.record({ leadId: '../../etc', workerId: 'a/b', prompt: '', result: '', reason: 'done' });
  A.ok(esc.ok && esc.file.indexOf(tmp) === 0, 'a path-escaping agentId cannot write outside the outbox root');

  fs.rmSync(tmp, { recursive: true, force: true });
  // mkdirSync would re-create the tree, so point the store at a path that CANNOT be a directory (a file).
  const blocked = fs.mkdtempSync(path.join(os.tmpdir(), 'starnet-handoff-ro-'));
  fs.writeFileSync(path.join(blocked, 'agent'), 'not a directory');
  const blockedStore = makeHandoffStore({ fs, path, now: () => t, dir: (id) => path.join(blocked, id, 'outbox') });
  const failed = blockedStore.record({ leadId: 'agent', workerId: 'scout', prompt: '', result: '', reason: 'done' });
  A.eq(failed.ok, false, 'an unwritable outbox reports the failure instead of pretending the handoff was filed');
  A.ok(/could not write handoff|outbox unavailable/.test(failed.error), 'and says so in the error the lead receives');
  fs.rmSync(blocked, { recursive: true, force: true });
}

/* ---------- 4+5. END TO END: a cron NIGHT4CHRIST dispatches to SCOUT and gets a result back ----------
   The real tool, the real consent broker, the real handoff store. runOnce is a stub — this asserts the
   HARNESS carries the handoff, not that a model is clever. */
async function testEndToEnd() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'starnet-dispatch-'));
  const at = Date.UTC(2026, 9, 26, 18, 21, 40);
  const handoffs = makeHandoffStore({ fs, path, now: () => at, dir: (id) => path.join(tmp, id, 'outbox') });

  // the crew as the sidecar holds it in memory (pushed via POST /api/roster; available headlessly).
  const roster = new Map([
    ['scout', { name: 'SCOUT', system: 'You research.', model: 'test-model', provider: 'test' }],
    ['agent', { name: 'NIGHT4CHRIST', system: 'You command.', model: 'test-model', provider: 'test' }]
  ]);

  const seen = [];
  const runOnce = async (o) => {
    seen.push({ agentId: o.agentId, surface: o.surface, lead: o.lead, parentRunId: o.parentRunId });
    return { reason: 'done', usd: 0.0007, model: 'test-model', messages: [{ role: 'assistant', content: 'SCOUT REPORT: 3 competitors, $4.50 median.' }] };
  };

  const tools = {};
  makeOrchestrationTools({
    runOnce, roster: () => roster, key: 'k', model: 'test-model', provider: 'test',
    newId: () => 'W-' + (seen.length + 1), perWorker: 0.05,
    recordHandoff: (h) => handoffs.record(h),
    now: () => at
  }).register({ register: d => { tools[d.name] = d; } });
  A.ok(tools['team.dispatch'], 'the orchestration factory registers team.dispatch');

  // the cron lead's own consent broker: autonomous, ASK mode, carrying the routine's 'orchestrator' grant.
  const consent = makeConsentBroker({
    surface: 'autonomous', sessionKey: 'cronrun',
    networkOf: (c) => !!(DEFS[c.name] && DEFS[c.name].network),
    dispatchGrant: () => true
  });
  A.eq(consent(call('team.dispatch'), DEFS['team.dispatch']).allow, true,
    'the cron lead clears consent for the dispatch it is about to make');

  const res = await tools['team.dispatch'].run(
    { workers: [{ agentId: 'scout', prompt: 'Price-check scripture printables on Etsy.', context: 'Do NOT use Apify for this.' }] },
    { agentId: 'agent', runId: 'LEAD-1', cronJobId: 'job-etsy-night', consent, emit: () => {}, streamId: 'cron-LEAD-1' }
  );
  const rows = JSON.parse(res.content);
  A.eq(rows.length, 1, 'one worker, one row');
  A.eq(rows[0].agentId, 'scout', 'the row names the worker that ran');
  A.eq(rows[0].reason, 'done', 'and its real terminal reason');
  A.ok(/3 competitors/.test(rows[0].result), 'the lead gets the worker RESULT back — the handoff completes the round trip');
  A.eq(rows[0].handoffFile, 'outbox/20261026-182140-agent-to-scout.md', 'and the row names the file the host filed');

  const filed = fs.readFileSync(path.join(tmp, 'agent', 'outbox', '20261026-182140-agent-to-scout.md'), 'utf8');
  A.ok(/3 competitors/.test(filed), 'the handoff file on disk holds the result, readable with no browser');
  A.ok(/job-etsy-night/.test(filed), 'and ties back to the routine that started the chain');

  /* THE DEPTH / LOOP FENCE. The worker runOnce actually received must be autonomous with NO lead flag, so it
     resolves no orchestrator object and cannot delegate onward. Depth is 1 structurally, not by a counter. */
  const worker = seen.find(s => s.agentId === 'scout');
  A.ok(worker, 'the worker really ran');
  A.eq(worker.surface, 'autonomous', 'the worker runs autonomous');
  A.ok(!worker.lead, 'the worker is NOT a lead -> no orchestrator object -> it cannot re-delegate (max depth 1)');
  A.eq(worker.parentRunId, 'LEAD-1', 'and it carries its parent runId, which is also the depth fence in index.js');

  // SELF-DISPATCH / UNKNOWN TARGET: the one cycle depth-1 allows is refused, and a name is never guessed.
  const res2 = await tools['team.dispatch'].run(
    { workers: [{ agentId: 'agent', prompt: 'do it yourself' }, { agentId: 'nobody', prompt: 'x' }] },
    { agentId: 'agent', runId: 'LEAD-2', consent, emit: () => {} }
  );
  const rows2 = JSON.parse(res2.content);
  A.ok(/cannot delegate to yourself/.test(rows2[0].result), 'a lead cannot dispatch to itself — the one cycle depth-1 allows is refused');
  A.ok(/no such live worker/.test(rows2[1].result), 'and an unknown agentId is refused, never guessed at');

  fs.rmSync(tmp, { recursive: true, force: true });
}

/* ---------- 6. THE APIFY RAIL: 8/day, team-wide, counting failures ---------- */
function testHostQuota() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'starnet-quota-'));
  const file = path.join(tmp, 'q.json');
  let t = Date.parse('2026-10-27T10:00:00');
  const q = makeHostQuota({ fs, file, now: () => t, limits: { 'apify.com': 8 } });

  for (let i = 1; i <= 8; i++) {
    const r = q.consume('api.apify.com');
    A.eq(r.ok, true, 'apify request ' + i + ' of 8 is allowed');
    A.eq(r.used, i, 'and the counter is at ' + i);
  }
  const ninth = q.consume('api.apify.com');
  A.eq(ninth.ok, false, 'the 9th apify request in a day is REFUSED — the owner\'s cap is enforced in code now, not prose');
  A.ok(/whole team/i.test(ninth.error), 'and the error says the cap is team-wide, so the model does not try another agent');

  // TEAM-WIDE, not per-agent: one counter file, and a sibling host shares the domain budget.
  A.eq(q.consume('console.apify.com').ok, false, 'a different apify host shares the same daily budget (the cap is on RUNS)');
  // an uncapped host is untouched and uncounted.
  A.eq(q.consume('api.openrouter.ai').limit, 0, 'a host with no configured limit is not metered at all');

  // a new local day resets it.
  t = Date.parse('2026-10-28T00:05:00');
  A.eq(q.consume('api.apify.com').used, 1, 'the next local day starts a fresh count');

  // FAIL CLOSED: a corrupt counter refuses rather than spending blind.
  fs.writeFileSync(file, '{not json');
  A.eq(q.consume('api.apify.com').ok, false,
    'an unreadable counter file FAILS CLOSED — a money rail must not fail open the way a hook does');

  /* THE DOOR THAT ACTUALLY BILLS. This station reaches Apify through its MCP CONNECTOR, not through
     web_request (GET /api/connectors, 2026-10-27: connector `apify`, tools good-apis--etsy-search-scraper /
     good-apis--etsy-shop-scraper). Capping only outbound HTTP would have been a rail in front of an unused
     door. Both routes share ONE counter, so eight means eight however the agent gets there. */
  fs.rmSync(file, { force: true });
  const q2 = makeHostQuota({ fs, file, now: () => Date.parse('2026-10-29T09:00:00') });
  A.eq(q2.consumeTool('apify', 'good-apis--etsy-search-scraper').used, 1,
    'an Apify ACTOR-RUN connector tool is metered (this is the path the station really uses)');
  A.eq(q2.consumeTool('apify', 'good-apis--etsy-shop-scraper').used, 2,
    'the sibling scraper draws on the SAME counter — the cap is on RUNS, not per tool');
  A.eq(q2.consume('api.apify.com').used, 3,
    'and a direct web_request to Apify decrements the same counter, so the cap cannot be doubled by changing route');

  for (const readOnly of ['get-dataset-items', 'get-actor-run', 'fetch-actor-details', 'abort-actor-run', 'get-key-value-store-record']) {
    A.eq(q2.consumeTool('apify', readOnly).limit, 0,
      readOnly + ' is NOT metered — collecting work already paid for must stay free, or the cap would strand a finished run');
  }
  A.eq(q2.consumeTool('airtable', 'create_records_for_table').limit, 0, 'an unmetered connector is untouched');
  for (let i = 4; i <= 8; i++) A.eq(q2.consumeTool('apify', 'good-apis--etsy-search-scraper').used, i, 'run ' + i + ' of 8 allowed');
  const over = q2.consumeTool('apify', 'good-apis--etsy-search-scraper');
  A.eq(over.ok, false, 'the 9th Apify actor run of the day is REFUSED at the connector');
  A.ok(/do not retry/i.test(over.error), 'and the error tells the model not to retry or route around it');

  fs.rmSync(tmp, { recursive: true, force: true });
}

/* ---------- 7. PART B: the local bookkeeping tools an ASK-mode cron agent used to lose ---------- */
function testLocalBookkeepingTools() {
  const station = {
    agents: { scout: { id: 'scout', room: 'office' } },
    rooms: { office: { id: 'office', objects: composeOffice({ surface: 'autonomous', lead: false, connectorIds: [] }) } }
  };
  const resolved = resolveTools('scout', station, undefined, {});
  const authority = makeRunAuthority({ surface: 'autonomous', isTask: true, unattendedGrants: [] });
  const after = enforceRunAuthority(resolved, registryStub, authority);
  for (const n of ['deliverable_note', 'todo', 'routine.notepad']) {
    A.ok(resolved.tools.indexOf(n) >= 0, n + ' is granted by the station object');
    A.ok(after.tools.indexOf(n) >= 0,
      n + ' SURVIVES the authority gate on an ASK-mode unattended run — it is host-local bookkeeping '
      + '(requiresConsent:false, network:false) and used to be stripped as EXTERNAL_UNKNOWN before the model saw it');
  }
  // the genuinely external families must STILL be stripped — this widening is narrow on purpose.
  for (const n of ['channel.send', 'spotify_play', 'shell.exec']) {
    A.ok(after.tools.indexOf(n) < 0, n + ' is still refused to an ASK-mode unattended run');
  }
}

(async () => {
  testCapabilityHalf();
  testConsentHalf();
  testHandoffFile();
  await testEndToEnd();
  testHostQuota();
  testLocalBookkeepingTools();
  A.report('headless dispatch');
})();

/* test/readiness.test.js — the readiness report must be impossible to talk into saying green.

   This station has been comprehensively non-functional while every surface said fine: `/api/health` returned
   `ok` through eight days with ZERO autonomous runs, `/api/lifecycle/armed` reported `armed:true, 3 routines`
   through those same days, and `test/fast.list` was green while a 1,056-byte placeholder shipped as a
   finished video. So the single most important property of sidecar/readiness.js is not that it reports — it
   is that it CANNOT be coaxed into a false green.

   What this file pins:
     A. the historical 8-day failure is caught, and caught EARLY (the work check fires at 48h, not 8 days)
     B. a missing input is `blocked`, never a pass — fail-closed in every direction
     C. the three permanent UNKNOWNS are always present and can never become `ok`
     D. `ready` is false whenever anything is blocked, and the unknowns are always surfaced
     E. the specific live regressions each have a dedicated assertion (one-entry chain, single-vendor
        roster, dark tools, orphan receipt + strict day rail, uncapped worker, approved-but-unverified)
     F. a genuinely healthy station DOES reach ready:true — a check that can never pass is useless

   Plain node, no framework (test/_assert.js). */
'use strict';
const A = require('./_assert.js');
const { assess, STATES } = require('../sidecar/readiness.js');

const healthy = () => ({
  cron: {
    production: { armed: true },
    jobs: [{ id: 'j1', name: 'daily', enabled: true, gateBlocked: false }]
  },
  recentWork: { lastAutonomousDoneAgeHours: 2, lastAutonomousToolsOk: 3, maxAgeHours: 48 },
  fallback: { chain: ['anthropic/claude-haiku-5.5', 'google/gemini-3.1-flash-lite', 'openai/gpt-5-nano'] },
  primaryProviders: ['anthropic'],
  roster: [{ provider: 'anthropic' }, { provider: 'anthropic' }, { provider: 'openai' }, { provider: 'gemini' }],
  tools: { granted: ['fs.read', 'video.inspect'], registered: ['fs.read', 'video.inspect', 'fs.write'] },
  outbox: { total: 10, unverified: 0, approvedUnverified: 0 },
  budget: { accounting: { complete: true, durable: true }, pendingReceipts: 0, savedKeys: [] },
  caps: { perWorker: 0.5, perRun: 0 },
  lastProviderError: '',
  unaccountedSpendFlag: false
});
const idOf = (r) => r.checks.reduce((m, c) => { m[c.id] = c; return m; }, {});

/* ---------- F. A HEALTHY STATION MUST ACTUALLY PASS ---------- */
{
  const r = assess(healthy());
  const c = idOf(r);
  A.eq(c.gate.state, STATES.OK, 'a healthy station passes the gate check');
  A.eq(c.work.state, STATES.OK, 'and the recent-work check');
  A.eq(c.fallback.state, STATES.OK, 'and the fallback check');
  A.eq(c.spread.state, STATES.OK, 'and the concentration check');
  A.eq(c.darktools.state, STATES.OK, 'and the dark-tool check');
  A.eq(c.deliverables.state, STATES.OK, 'and the deliverable check');
  A.eq(c.ledger.state, STATES.OK, 'and the ledger check');
  A.eq(c.workercap.state, STATES.OK, 'and the worker-cap check');
  A.eq(r.verdict.ready, true, 'so ready is TRUE — a check that can never pass would be useless');
  A.eq(r.verdict.blockedCount, 0, 'with zero blocked');
}

/* ---------- A. THE EIGHT SILENT DAYS, CAUGHT — AND CAUGHT EARLY ---------- */
{
  // The real state 2026-11-03..11: production disarmed, routines armed, nothing running, empty chain.
  const r = assess({
    cron: {
      production: { armed: false },
      jobs: [
        { id: 'a', name: 'Etsy Scout daily', enabled: true, gateBlocked: true, gateCode: 'PRODUCTION_DISARMED' },
        { id: 'b', name: 'Etsy chain', enabled: true, gateBlocked: true, gateCode: 'PRODUCTION_DISARMED' }
      ]
    },
    recentWork: { lastAutonomousDoneAgeHours: 192, lastAutonomousToolsOk: 3, maxAgeHours: 48 },
    fallback: { chain: [] },
    roster: Array.from({ length: 10 }, () => ({ provider: 'gemini' })),
    tools: { granted: ['video.inspect', 'video.process'], registered: ['video.inspect'] },
    outbox: { total: 53, unverified: 35, approvedUnverified: 0 },
    budget: { accounting: { complete: true, durable: true }, pendingReceipts: 0, savedKeys: ['perDay'] },
    caps: { perWorker: 0, perRun: 0 },
    unaccountedSpendFlag: false
  });
  const c = idOf(r);
  A.eq(r.verdict.ready, false, 'the idle station is NOT ready');
  A.eq(c.gate.state, STATES.BLOCKED, 'the gate check catches armed-but-refused routines');
  A.ok(/REFUSED before any provider call/.test(c.gate.detail), 'and says they are refused before any provider call');
  A.eq(c.work.state, STATES.BLOCKED, 'and the work check catches the idleness independently');
  A.ok(/idle/.test(c.work.detail), 'naming it idle: ' + c.work.detail.slice(0, 60));
  A.eq(c.fallback.state, STATES.BLOCKED, 'and the empty chain is blocked');
  A.eq(c.spread.state, STATES.BLOCKED, 'and all-agents-on-one-provider is blocked');
  A.eq(c.darktools.state, STATES.BLOCKED, 'and the dark tool is blocked');

  /* CAUGHT EARLY is the point. The gate check alone would have fired on day one; the work check is the
     independent witness that fires even if the gate verdict is wrong or absent. At 49h it is already
     blocked — the real failure ran for 192h. */
  const earlyC = idOf(assess(Object.assign(healthy(), {
    recentWork: { lastAutonomousDoneAgeHours: 49, lastAutonomousToolsOk: 3, maxAgeHours: 48 }
  })));
  A.eq(earlyC.work.state, STATES.BLOCKED, 'the work check fires at 49h — two days, not eight');
  const okC = idOf(assess(Object.assign(healthy(), {
    recentWork: { lastAutonomousDoneAgeHours: 47, lastAutonomousToolsOk: 3, maxAgeHours: 48 }
  })));
  A.eq(okC.work.state, STATES.OK, 'and not before the threshold');
}

/* ---------- B. A MISSING INPUT IS BLOCKED, NEVER A PASS ---------- */
{
  const empty = assess({});
  const c = idOf(empty);
  A.eq(empty.verdict.ready, false, 'an empty fact set is NOT ready');
  for (const id of ['gate', 'work', 'fallback', 'spread', 'ledger']) {
    A.eq(c[id].state, STATES.BLOCKED, 'a missing input blocks "' + id + '" rather than passing it');
  }
  // These two legitimately cannot be judged from outside the sidecar, so unknown is the honest answer.
  A.eq(c.darktools.state, STATES.UNKNOWN, 'dark-tool diff is UNKNOWN without both lists, not a pass');
  A.eq(c.deliverables.state, STATES.UNKNOWN, 'and deliverables is unknown with no snapshot');
  A.eq(c.workercap.state, STATES.UNKNOWN, 'and the worker cap is unknown with no cap snapshot');
  A.eq(assess(null).verdict.ready, false, 'assess(null) does not throw and is not ready');
  A.eq(assess(undefined).verdict.ready, false, 'nor assess(undefined)');
}

/* ---------- C. THE PERMANENT UNKNOWNS CAN NEVER BECOME OK ---------- */
{
  /* These three require money or human judgement. Asserting them would be the exact lie this module exists
     to prevent, so no input may flip them. Brute-forced over a spread of fact shapes. */
  const shapes = [healthy(), {}, Object.assign(healthy(), { lastProviderError: 'gemini 429' }),
    Object.assign(healthy(), { unaccountedSpendFlag: true })];
  for (const s of shapes) {
    const c = idOf(assess(s));
    A.eq(c.credit.state, STATES.UNKNOWN, 'provider credit is ALWAYS unknown — presence is not funding');
    A.eq(c.visual.state, STATES.UNKNOWN, 'visual correctness is ALWAYS unknown — no mechanical check judges it');
    A.eq(c.toolcalling.state, STATES.UNKNOWN, 'tool-calling under the full prompt is ALWAYS unknown without a paid run');
  }
  const c = idOf(assess(healthy()));
  A.ok(/solid black/.test(c.visual.detail), 'the visual row names the solid-black film, so nobody re-learns it');
  A.ok(/reason: done` with non-zero usd proves nothing|proves nothing/.test(c.toolcalling.detail),
    'and the tool-calling row says `done` proves nothing');
  A.ok(c.credit.evidence && c.credit.evidence.proxy, 'each unknown names a free PROXY so the row is still useful');

  // The unauditable-spend lane is the one "unknown-adjacent" row that CAN be blocked, when it is open.
  A.eq(idOf(assess(Object.assign(healthy(), { unaccountedSpendFlag: true }))).unaccounted.state, STATES.BLOCKED,
    'an ENABLED unauditable spend channel is blocked, not merely noted');
  A.eq(idOf(assess(healthy())).unaccounted.state, STATES.OK, 'and closed when the flag is absent');
}

/* ---------- D. GREEN REQUIRES ZERO BLOCKED, AND UNKNOWNS ARE ALWAYS SURFACED ---------- */
{
  const r = assess(healthy());
  A.eq(r.verdict.ready, true, 'healthy is ready');
  A.ok(r.verdict.unknownCount >= 3, 'yet it still reports at least the three permanent unknowns');
  A.ok(r.summary.unknown.length >= 3, 'and lists them in the summary so a caller cannot render ready alone');
  A.ok(/UNKNOWABLE without spend or human judgement/.test(r.verdict.headline),
    'the headline itself says what remains unknowable: ' + r.verdict.headline);

  // One blocked row is enough to deny green, however many pass.
  const oneBad = assess(Object.assign(healthy(), { fallback: { chain: ['only/one'] } }));
  A.eq(oneBad.verdict.ready, false, 'a single blocked row denies green');
  A.eq(oneBad.verdict.blockedCount, 1, 'and is counted');
}

/* ---------- E. EACH LIVE REGRESSION HAS ITS OWN ASSERTION ---------- */
{
  const c = (over) => idOf(assess(Object.assign(healthy(), over)));

  // the live one-entry chain pointing at a dead key
  A.eq(c({ fallback: { chain: ['anthropic/claude-sonnet-4.5'] } }).fallback.state, STATES.BLOCKED,
    'a ONE-entry chain is not a chain');
  // chain shapes the field notes record as unusable
  for (const bad of ['anthropic/claude-haiku-5.5:batch', '~latest/model', 'openrouter/auto']) {
    const row = c({ fallback: { chain: [bad, 'openai/gpt-5-nano'] } }).fallback;
    A.eq(row.state, STATES.BLOCKED, 'refuses an unusable chain entry: ' + bad);
  }
  // single-vendor chain
  A.eq(c({ fallback: { chain: ['anthropic/a', 'anthropic/b'] } }).fallback.state, STATES.BLOCKED,
    'a chain of one vendor is blocked — one empty wallet kills all of it');

  // concentration: total is blocked, a strong majority is a question not a verdict
  A.eq(c({ roster: Array.from({ length: 8 }, () => ({ provider: 'openai' })) }).spread.state, STATES.BLOCKED,
    'all agents on one provider is blocked');
  const majority = c({ roster: Array.from({ length: 10 }, (_, i) => ({ provider: i < 8 ? 'openai' : (i === 8 ? 'codex' : 'gemini') })) }).spread;
  A.eq(majority.state, STATES.UNKNOWN, '80% on one provider is UNKNOWN — it may be a deliberate choice');
  A.ok(/deliberate, or drift/.test(majority.detail), 'and asks rather than asserts');

  // orphan receipt + the strict day rail: one failure, and the second half explains why it is fatal
  const orphan = c({ budget: { accounting: { complete: true, durable: true }, pendingReceipts: 1, savedKeys: ['perDay'] } });
  A.eq(orphan.ledger.state, STATES.BLOCKED, 'an orphan receipt blocks');
  A.ok(/STRICT/.test(orphan.ledger.detail), 'and names the strict day rail as the reason it bricks: ' + orphan.ledger.detail.slice(0, 80));
  const orphanSoft = c({ budget: { accounting: { complete: true, durable: true }, pendingReceipts: 1, savedKeys: [] } });
  A.eq(orphanSoft.ledger.state, STATES.BLOCKED, 'an orphan still blocks without the strict rail');
  A.eq(/STRICT/.test(orphanSoft.ledger.detail), false, 'but the strict explanation is not claimed when perDay is unsaved');
  // a healthy ledger with a saved perDay still WARNS, without blocking
  A.ok(/STRICT/.test(c({ budget: { accounting: { complete: true, durable: true }, pendingReceipts: 0, savedKeys: ['perDay'] } }).ledger.detail),
    'a healthy ledger still warns that perDay being saved makes the rail strict');

  // uncapped worker: either knob satisfies it, neither does not
  A.eq(c({ caps: { perWorker: 0, perRun: 0 } }).workercap.state, STATES.BLOCKED, 'both knobs 0 is blocked');
  A.eq(c({ caps: { perWorker: 0, perRun: 1 } }).workercap.state, STATES.OK, 'perRun alone bounds it');
  A.eq(c({ caps: { perWorker: 0.5, perRun: 0 } }).workercap.state, STATES.OK, 'perWorker alone bounds it');

  // approved-but-unverified is the one deliverable condition that is a real failure, not a gap
  const au = c({ outbox: { total: 10, unverified: 5, approvedUnverified: 2 } });
  A.eq(au.deliverables.state, STATES.BLOCKED, 'an APPROVED artifact the host never verified is blocked');
  A.ok(/never verified their bytes/.test(au.deliverables.detail), 'and says exactly why');
  // whereas plain unverified rows are a capability gap
  const gap = c({ outbox: { total: 55, unverified: 38, approvedUnverified: 0 } });
  A.eq(gap.deliverables.state, STATES.UNKNOWN, 'plain unverified rows are UNKNOWN, not blocked');
  A.ok(/capability gap, not a failed artifact/.test(gap.deliverables.detail),
    'and are explicitly called a capability gap rather than blaming the artifact');

  // an unjudgeable routine must not read as runnable
  A.eq(c({ cron: { production: { armed: true }, jobs: [{ id: 'x', enabled: true, gateBlocked: null }] } }).gate.state,
    STATES.UNKNOWN, 'a routine the host could not judge is UNKNOWN, never ok');
  // an absent gateBlocked field (older payload) must NOT be treated as blocked
  A.eq(c({ cron: { production: { armed: true }, jobs: [{ id: 'x', enabled: true }] } }).gate.state,
    STATES.OK, 'an ABSENT gateBlocked field behaves as before — no false alarm on an older payload');
  // no armed routine at all is itself a blocker: nothing is scheduled to run unattended
  A.eq(c({ cron: { production: { armed: true }, jobs: [{ id: 'x', enabled: false }] } }).gate.state,
    STATES.BLOCKED, 'zero armed routines is blocked — nothing would run unattended');

  // a completed run with no successful tool call is not evidence of work
  A.eq(c({ recentWork: { lastAutonomousDoneAgeHours: 1, lastAutonomousToolsOk: 0, maxAgeHours: 48 } }).work.state,
    STATES.BLOCKED, 'reason:done with zero tool calls is not work');
  A.eq(c({ recentWork: { maxAgeHours: 48 } }).work.state, STATES.BLOCKED,
    'never having completed an autonomous run is blocked');
}

/* ---------- PURITY: no IO, no clock, no live require ---------- */
{
  const fs = require('fs');
  const src = fs.readFileSync(require('path').join(__dirname, '..', 'sidecar', 'readiness.js'), 'utf8');
  for (const forbidden of ['require(\'node:fs\')', 'require("node:fs")', 'Date.now(', 'fetch(', 'execFile', 'readFileSync']) {
    A.eq(src.indexOf(forbidden) >= 0, false, 'readiness.js performs no ' + forbidden + ' — it is a pure judge');
  }
  A.eq(/require\(/.test(src.replace(/require\(\s*'\.\/events\.js'\s*\)/g, '')), false,
    'and requires no live subsystem, so it is testable without a station');
}

A.report('readiness');

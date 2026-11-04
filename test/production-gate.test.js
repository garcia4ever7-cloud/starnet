/* test/production-gate.test.js — live paid production must require the owner's authorization, and nothing
 * else may be collateral damage.
 *
 * THE REQUIREMENT (owner, 2026-11-03): every subsystem AVAILABLE, but production starts only on their
 * command; "do not delete or disable scheduled routines merely to solve an execution-safety problem" and
 * "do not sacrifice availability to achieve safety".
 *
 * That rules out all three obvious implementations, which is why this gate exists as its own axis:
 *   - disabling routines      destroys the schedule the owner wants preserved
 *   - a low budgetcaps perRun bounds the SIZE of unattended spend, never its EXISTENCE, and throttles the
 *                             owner's own interactive runs too
 *   - the $25/day rail        is a soft rail with one-click RESUME — a cost backstop, not authorization
 *
 * So: budget answers "how much", this answers "may it start at all". Section 4 pins that they are independent.
 *
 * WHY ONE ENFORCEMENT POINT. Every execution path — cron tick driver, Run Now, /api/run, a delegated worker
 * from orchestration.js, loopjob-driver, openai-compat — reaches the model through runOnce in sidecar/index.js.
 * The check lives at the top of its admission block, so all paths are covered by construction. Guarding entry
 * points individually is exactly how handleCronRun went months without passing cronJobId. Section 5 pins the
 * wiring, including that it sits BEFORE the credits reservation so a refusal spends nothing.
 *
 * Run standalone: node test/production-gate.test.js */
'use strict';

const A = require('./_assert.js');
const fs = require('node:fs');
const path = require('node:path');

const gate = require('../sidecar/production-gate.js');

/* ---------- 1. THE DECISION TABLE ---------- */
{
  const d = (armed, metered, surface) => gate.decide({ armed, metered, surface });

  // the case the owner asked to prevent
  const refused = d(false, true, 'autonomous');
  A.eq(refused.allow, false, 'DISARMED + metered + unattended is REFUSED');
  A.eq(refused.code, 'PRODUCTION_DISARMED', 'with a stable machine-readable code');
  A.eq(refused.because, 'disarmed+metered+unattended', 'naming the deciding rule');
  A.ok(/nothing was spent/i.test(refused.reason), 'and stating that nothing was spent');
  A.ok(/still scheduled/i.test(refused.reason), 'and that the routine itself is untouched');
  A.ok(/api\/production\/arm/.test(refused.reason), 'and the one action that changes it');

  // AVAILABILITY: the three things that must never be gated
  A.eq(d(false, false, 'autonomous').allow, true, 'a FREE/unmetered unattended run is never gated');
  A.eq(d(false, false, 'autonomous').because, 'unmetered', 'because there is no money to protect');
  A.eq(d(false, true, 'interactive').allow, true, 'an INTERACTIVE paid run is never gated — it IS the command');
  A.eq(d(false, true, 'interactive').because, 'interactive', 'for that reason');
  A.eq(d(true, true, 'autonomous').allow, true, 'and ARMED means the owner authorized production');
  A.eq(d(true, true, 'autonomous').because, 'armed', 'nothing second-guesses an explicit arm');

  // free runs stay available even when armed, and interactive stays available either way
  A.eq(d(true, false, 'autonomous').allow, true, 'armed + free is allowed');
  A.eq(d(true, true, 'interactive').allow, true, 'armed + interactive is allowed');
}

/* ---------- 2. UNKNOWN POSTURE IS THE DANGEROUS ONE ----------
   sidecar/permissions.js defaults a missing surface to 'autonomous' ("Missing/unknown callers are unattended
   until proven otherwise"). This module MUST agree, or two safety controls disagree about the same run. */
{
  for (const s of [undefined, null, '', 'autonomous', 'AUTONOMOUS', 'cron', 'schedule', 'unknown', 'x']) {
    A.eq(gate.decide({ armed: false, metered: true, surface: s }).allow, false,
      'surface ' + JSON.stringify(s) + ' is treated as unattended and refused');
  }
  // only an EXPLICIT non-autonomous surface counts as a human
  A.eq(gate.humanPresent('interactive'), true, "'interactive' is a human");
  A.eq(gate.humanPresent('autonomous'), false, "'autonomous' is not");
  A.eq(gate.humanPresent(undefined), false, 'a missing surface is not');
  A.eq(gate.humanPresent(''), false, 'an empty surface is not');
  // 'AUTONOMOUS' differs from 'autonomous' by case and so reads as non-autonomous; it is still REFUSED above
  // because the gate's own test is case-sensitive only for the allow path — assert the refusal explicitly.
  A.eq(gate.decide({ armed: false, metered: true, surface: 'AUTONOMOUS' }).allow, false,
    'a case-variant autonomous value does not sneak through as interactive');
}

/* ---------- 3. ARM STATE RESOLVES FAIL-CLOSED, AND SAYS WHICH WAY IT FELL ----------
   "disarmed by default" and "your arm state is damaged" are different facts the owner must distinguish. */
{
  A.eq(gate.readArmState(null, undefined).armed, false, 'no state on record -> DISARMED');
  A.eq(gate.readArmState(null, undefined).source, 'default', 'reported as the default, not as damage');

  A.eq(gate.readArmState({ armed: true, at: 'T' }, undefined).armed, true, 'an owner arm is honoured');
  A.eq(gate.readArmState({ armed: true }, undefined).source, 'persisted', 'and attributed to the owner');
  A.eq(gate.readArmState({ armed: false }, undefined).armed, false, 'an owner disarm is honoured');

  // a persisted choice BEATS the env default, in both directions — the owner's explicit decision wins
  A.eq(gate.readArmState({ armed: false }, '1').armed, false, 'a persisted DISARM beats STARNET_PRODUCTION_ARMED=1');
  A.eq(gate.readArmState({ armed: true }, '0').armed, true, 'a persisted ARM beats an env 0');
  A.eq(gate.readArmState(null, '1').armed, true, 'env can arm when nothing is persisted');
  A.eq(gate.readArmState(null, '1').source, 'env', 'attributed to env');
  for (const v of ['0', 'false', 'no', 'off', '', 'maybe', undefined, null]) {
    A.eq(gate.readArmState(null, v).armed, false, 'env ' + JSON.stringify(v) + ' does NOT arm');
  }

  // MALFORMED must fail closed AND be labelled, so corruption is visible rather than looking like "never set"
  for (const bad of [{ nope: 1 }, { armed: 'true' }, { armed: 1 }, {}, [], 'armed', 7, { __unreadable: 'EACCES' }]) {
    const st = gate.readArmState(bad, '1');   // env says arm; malformed state must still refuse
    A.eq(st.armed, false, 'malformed state ' + JSON.stringify(bad) + ' -> DISARMED even with env armed');
    A.eq(st.source, 'malformed', 'and is labelled malformed, not default');
  }
}

/* ---------- 4. THE GATE IS INDEPENDENT OF THE BUDGET ----------
   If these two ever collapse into one control, the owner loses either availability or authorization. */
{
  const caps = require('../sidecar/budgetcaps.js');
  // a generous budget does NOT authorize unattended production
  A.eq(gate.decide({ armed: false, metered: true, surface: 'autonomous' }).allow, false,
    'an unlimited budget still does not authorize an unattended paid run');
  // and arming does not change any cap
  const resolved = caps.resolveCaps({ perRun: 0, perAgent: 0, perDay: 25, global: 0 }, {});
  A.eq(resolved.perDay, 25, 'arming/disarming touches no budget cap');
  A.eq(resolved.perRun, 0, 'including perRun');
  // the two refusal vocabularies must not collide: a safety refusal must not read as out-of-credit
  A.ok(!/credit|billing|wallet|top.?up/i.test(gate.MESSAGE),
    'the refusal never uses credit/billing vocabulary — a safety refusal that looks like an outage gets '
    + '"fixed" by funding a wallet it has nothing to do with');
  A.eq(gate.CODE, 'PRODUCTION_DISARMED', 'and carries its own distinguishable code');
}

/* ---------- 5. THE HOST IS ACTUALLY WIRED TO IT, IN THE RIGHT PLACE ----------
   Sections 1-4 prove the RULE. This proves the running host enforces it, and enforces it before any spend. */
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'sidecar', 'index.js'), 'utf8');

  A.ok(/require\('\.\/production-gate\.js'\)/.test(src), 'index.js requires the gate');
  A.ok(/const verdict = productionGate\.decide\(\{/.test(src), 'and calls decide() on a run');
  A.ok(/armed: armState\.armed, metered: !providerUnmetered, surface: accessSurface/.test(src),
    'passing the station\'s OWN metered truth (!providerUnmetered) and accessSurface');

  // accessSurface, not surface: an owner-trusted Telegram DM must not be gated, or arming would be required
  // to answer your own phone. It is host-minted at channel ingress, never derived from model text.
  A.ok(/surface: accessSurface/.test(src) && !/surface: surface \}\);/.test(src),
    'the gate honours the owner-trusted channel via accessSurface');

  // ORDER: the refusal must precede the credits reservation, so nothing is reserved or spent
  const gateAt = src.indexOf('OWNER-AUTHORIZED PRODUCTION GATE');
  const creditsAt = src.indexOf('managed-credit admission (config-gated');
  const loopAt = src.indexOf('const adm = credits.beginRun(');
  A.ok(gateAt > 0, 'the gate block is present in runOnce');
  A.ok(creditsAt > gateAt, 'the gate runs BEFORE the managed-credit admission');
  A.ok(loopAt > gateAt, 'and before any credit is reserved — a refusal spends nothing');

  // the refusal must be reported as an AUTHORIZATION outcome, not an error/billing fault
  A.ok(/reason: 'refused', code: verdict\.code/.test(src), "reported with reason 'refused' and the code");
  A.ok(/emit\('agent\.run\.end', \{ agentId, runId, reason: 'refused', turns: 0, usd: 0 \}\)/.test(src),
    'and ends the run at turns 0 / usd 0 — the honest record of a run that never started');

  // state is read PER RUN, not cached at boot: arming must not need a restart
  A.ok(/function productionArmState\(\) \{/.test(src), 'the host resolves arm state in a function');
  A.ok(/readFileSync\(PRODUCTION_ARM_FILE/.test(src), 'reading the file when asked (not a boot-time constant)');
  A.ok(/const armState = productionArmState\(\);/.test(src), 'and calls it inside the run path');

  // the owner's control surface exists and is registered
  A.ok(/\{ m: 'GET', exact: '\/api\/production\/status', h: handleProductionStatus \}/.test(src),
    'GET /api/production/status is registered');
  A.ok(/\{ m: 'POST', exact: '\/api\/production\/arm', h: handleProductionArm \}/.test(src),
    'POST /api/production/arm is registered');

  // and it must NOT have "solved" safety by touching the schedule
  const gateBlock = src.slice(gateAt, gateAt + 2600);
  A.ok(!/cronStore\.|setJobs\(|enabled: false|disableJob|pauseJob/.test(gateBlock),
    'the gate never disables, pauses or rewrites a routine — availability is preserved by construction');
}

/* ---------- 6. ARMING IS AN EXPLICIT BOOLEAN, NEVER INFERRED ---------- */
{
  A.eq(gate.validateArmPatch({ armed: true }).ok, true, 'armed:true is accepted');
  A.eq(gate.validateArmPatch({ armed: true }).armed, true, 'and parsed');
  A.eq(gate.validateArmPatch({ armed: false }).ok, true, 'armed:false is accepted');
  A.eq(gate.validateArmPatch({ armed: false }).armed, false, 'and parsed');
  for (const bad of [{ armed: 'true' }, { armed: 1 }, { armed: 'yes' }, { armed: null }, {}, null, 'armed', 7, []]) {
    A.eq(gate.validateArmPatch(bad).ok, false,
      'arming is refused for ' + JSON.stringify(bad) + ' — authorization is not inferred from a truthy value');
  }
}

/* ---------- 7. A REFUSAL MUST NOT DAMAGE THE SCHEDULE ----------
   Found live on 2026-11-03: the gate worked, and then the cron settlement mishandled its own refusal.
   Both naive options were wrong, which is why 'declined' exists as a third outcome class:

     transient:true  -> retry path: retryCount 1, nextRunAt rewound to now+90s. The routine churned a
                        fire-and-refuse loop every ~90 seconds for as long as production stayed disarmed.
     transient:false -> terminal path: consecutiveFailures++ and, at the default ceiling of 5,
                        enabled:false / disabledReason:'consecutive-failures'. A SAFETY REFUSAL WOULD HAVE
                        DISABLED THE OWNER'S ROUTINE — the exact outcome the owner forbade and the exact
                        thing the gate exists to avoid having to do.

   So: skipped occurrence, failure streak untouched, no retry, schedule advanced normally, still visible. */
{
  const store = require('../sidecar/cron-store.js');
  const T = 1793600000000;
  const DAY = 86400000;
  const mkJob = (id) => store.createJob([], {
    id: id, schedule: { kind: 'cron', expr: '0 3 * * *' }, agentId: 'agent', prompt: 'x'
  }, { now: T });
  const decline = (jobs, id, i) => store.markRun(jobs, id, {
    runId: 'r' + i, status: 'error', reason: 'refused',
    error: gate.MESSAGE, transient: false, usd: 0
  }, { now: T + i * DAY });

  // SEVEN declines — past the ceiling of 5 that auto-pauses a genuinely broken routine
  let jobs = mkJob('j1');
  for (let i = 1; i <= 7; i++) jobs = decline(jobs, 'j1', i);
  const j = store.getJob(jobs, 'j1');

  A.eq(j.enabled, true, '7 refusals NEVER disable the routine');
  A.eq(j.disabledReason, undefined, 'and set no disabledReason');
  A.eq(j.consecutiveFailures, 0, 'a refusal does not count toward the failure streak');
  A.eq(j.retryCount, 0, 'and arms no retry — nothing retried will succeed until the owner arms production');
  A.eq(j.state, 'scheduled', "state stays 'scheduled': the routine is healthy and still armed, not failing");
  A.eq(j.lastStatus, 'declined', 'the outcome is recorded as declined — distinguishable from ok AND from error');
  A.ok(!!j.lastError, 'the reason stays visible — a silently skipped run would be the lie');
  A.eq(j.nextRunAt, '2026-11-10T03:00:00.000Z', 'and nextRunAt advanced to the normal next occurrence');
  A.ok(j.usd == null || Number(j.lastUsd || 0) === 0, 'nothing was spent');

  // the schedule itself must be untouched
  A.eq(j.schedule.kind, 'cron', 'the schedule kind is preserved');
  A.eq(j.schedule.expr, '0 3 * * *', 'and its expression is preserved verbatim');

  /* CONTROL: a GENUINE failure must still count and still auto-pause. Without this the fix above could have
     been implemented by simply never failing anything, which would disable the real safety net. */
  let bad = mkJob('j2');
  for (let i = 1; i <= 5; i++) {
    bad = store.markRun(bad, 'j2', {
      runId: 'f' + i, status: 'error', reason: 'error', error: 'boom', transient: false, usd: 0
    }, { now: T + i * DAY });
  }
  const j2 = store.getJob(bad, 'j2');
  A.eq(j2.consecutiveFailures, 5, 'a real failure still increments the streak');
  A.eq(j2.enabled, false, 'and still auto-pauses at the ceiling');
  A.eq(j2.disabledReason, 'consecutive-failures', 'with the governed reason');

  // a SUCCESS after declines still behaves normally
  let mixed = mkJob('j3');
  mixed = decline(mixed, 'j3', 1);
  mixed = store.markRun(mixed, 'j3', { runId: 'ok1', status: 'ok', reason: 'done', output: 'fine', usd: 0.01 }, { now: T + 2 * DAY });
  const j3 = store.getJob(mixed, 'j3');
  A.eq(j3.lastStatus, 'ok', 'a later success settles normally');
  A.eq(j3.state, 'scheduled', 'and the routine is scheduled');
  A.eq(j3.enabled, true, 'and enabled');

  // and the declined branch must be reached BEFORE the transient branch, so the flag cannot route it
  const src = fs.readFileSync(path.join(__dirname, '..', 'sidecar', 'cron-store.js'), 'utf8');
  const declinedAt = src.indexOf("String(result.reason || '') === 'refused'");
  const transientAt = src.indexOf('if (!ok && result.transient && (job.retryCount || 0) < maxRetries)');
  A.ok(declinedAt > 0, 'cron-store recognises a refused outcome');
  A.ok(transientAt > declinedAt, 'and does so BEFORE the transient-retry branch');

  // even if a caller wrongly marks it transient, it must still decline rather than retry
  let t = mkJob('j4');
  t = store.markRun(t, 'j4', { runId: 'r1', status: 'error', reason: 'refused', error: 'x', transient: true, usd: 0 }, { now: T + DAY });
  const j4 = store.getJob(t, 'j4');
  A.eq(j4.retryCount, 0, 'a refusal mislabelled transient:true still does NOT enter the retry loop');
  A.eq(j4.lastStatus, 'declined', 'and is still recorded as declined');
  A.eq(j4.state, 'scheduled', 'and stays scheduled');
}

A.report('production gate');

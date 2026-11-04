/* test/cron-cost-cap.test.js — an unattended routine must be able to carry its OWN spend ceiling.
 *
 * THE GAP THIS CLOSES (measured on the live station, 2026-11-03).
 *
 *   GET /api/cron        -> 3 routines ENABLED and scheduled to fire that day
 *                           Etsy pipeline chain 11:00Z, Etsy Scout 17:00Z, Weekly Income Scan 18:00Z
 *                           every one of them: maxCostUsd undefined, no cost-bearing field of any kind
 *   GET /api/budget/status -> caps { perRun: 0, perAgent: 0, perDay: 25, global: 0 }
 *
 * perRun 0 means UNGOVERNED per run (sidecar/index.js: `effectiveCaps.perRun > 0 ? ... : Infinity`). So the
 * only governor on a scheduled fire was the $25/day rail, with $4.84 already spent — roughly $20 of headroom
 * available to a single unattended routine. cron-store.js stored no per-routine cap because the field did
 * not exist.
 *
 * WHY perRun IS NOT THE ANSWER. It is ONE number for every agent, and the legitimate per-run costs on this
 * station differ by ~20x (measured, STATION_FIELD_NOTES §18): a Commander-led chain is ~$0.11 and dispatches
 * a crew on top; a SCOUT research fire is ~$0.005. Any single perRun is therefore either too tight for the
 * chain or ~20x too loose for SCOUT. The ceiling belongs on the routine.
 *
 * WHY IT IS THE `callerMaxCostUsd` LANE AND NOT `maxCostUsd`. index.js treats them as different authorities:
 * `maxCostUsd` REPLACES the station ceiling (right for a trusted in-process caller like a delegated worker's
 * perWorker), while `callerMaxCostUsd` is applied with Math.min and can therefore only TIGHTEN it. A stored
 * cron field is edited over HTTP, so it is untrusted by exactly that definition: a hand-edited or migrated
 * cron.jobs.json claiming maxCostUsd:999 must buy nothing. Section 4 pins that.
 *
 * SIBLING ADAPTERS. Two separate code paths fire a routine, and qa/bugs/README.md requires both be covered:
 *   sidecar/cron-driver.js  — the SCHEDULED fire
 *   sidecar/index.js        — handleCronRun, the "Run Now" button
 * The Run Now path has ALREADY drifted from the scheduled one once (its own comment records cronJobId being
 * passed by the schedule for months and never by Run Now). A Run Now that ignored the routine's ceiling
 * would spend more than the schedule ever could while calling itself "test it now" — the most misleading
 * possible shape for a cost control. Section 5 pins both.
 *
 * NOT CLAIMED HERE: this bounds a run, it does not make the bound exact. The ceiling is still evaluated
 * BETWEEN turns, so a capped run can overshoot by up to one worst-case turn unless sidecar/loop.js's
 * pre-flight reservation is also loaded (test/budget-reservation.test.js). Section 6 states that honestly
 * rather than letting a green file imply a guarantee it cannot make.
 *
 * Run standalone: node test/cron-cost-cap.test.js */
'use strict';

const A = require('./_assert.js');
const fs = require('node:fs');
const path = require('node:path');

const store = require('../sidecar/cron-store.js');

const T0 = 1793600000000;
const SCHED = { kind: 'interval', everyMs: 3600000 };
const mk = (spec) => store.createJob([], Object.assign({ id: 'j1', schedule: SCHED }, spec), { now: T0 })[0];

/* ---------- 1. THE FIELD EXISTS AND ROUND-TRIPS ---------- */
{
  const job = mk({ maxCostUsd: 0.25 });
  A.eq(job.maxCostUsd, 0.25, 'a routine stores its own spend ceiling');

  // the whole point: this is additive. An existing job that never heard of the field loads as null.
  A.eq(mk({}).maxCostUsd, null, 'a routine created without a cap has null, not 0 and not undefined');
  A.eq(store.loadEnvelope({ version: 1, jobs: [{ id: 'old' }] }).jobs[0].maxCostUsd, undefined,
    'and a pre-existing stored job is not rewritten by merely loading it');
}

/* ---------- 2. NORMALIZATION: JUNK CAN NEVER GRANT HEADROOM ----------
   Every one of these is a value a hand-edited cron.jobs.json or a sloppy API call can produce. The rule
   mirrors budgetcaps.js so there is a single mental model: null = not set, 0 = an explicit "no cap". */
{
  const cases = [
    [0.25, 0.25, 'a normal cap'],
    [0.005, 0.005, 'a small cap (SCOUT-sized)'],
    ['0.5', 0.5, 'a numeric string is coerced'],
    [0, 0, 'zero is a REAL choice meaning "no cap", like the budget panel dialling one off'],
    [null, null, 'null = not set'],
    [undefined, null, 'undefined = not set'],
    ['', null, 'empty string = not set'],
    [-5, null, 'a negative cap is junk, not a licence'],
    ['abc', null, 'a non-numeric string is junk'],
    [NaN, null, 'NaN is junk'],
    [Infinity, null, 'Infinity is junk and must NOT become an unbounded ceiling'],
    [-Infinity, null, '-Infinity is junk'],
    [1e9, 1000, 'an absurd value is clamped to the fat-finger ceiling, not honoured'],
    [1000, 1000, 'the ceiling itself is allowed'],
    [1001, 1000, 'just above the ceiling clamps down']
  ];
  for (const [input, want, why] of cases) {
    A.eq(mk({ maxCostUsd: input }).maxCostUsd, want, why + ' (' + JSON.stringify(input) + ' -> ' + JSON.stringify(want) + ')');
  }
}

/* ---------- 3. EDITING RE-NORMALIZES ----------
   A cap that could be loosened by a later sloppy patch would be no cap at all. */
{
  let jobs = store.createJob([], { id: 'j1', schedule: SCHED, maxCostUsd: 0.25 }, { now: T0 });
  A.eq(jobs[0].maxCostUsd, 0.25, 'starts capped');

  jobs = store.updateJob(jobs, 'j1', { maxCostUsd: 0.10 }, { now: T0 });
  A.eq(jobs[0].maxCostUsd, 0.10, 'the Commander can tighten it');

  jobs = store.updateJob(jobs, 'j1', { maxCostUsd: 'abc' }, { now: T0 });
  A.eq(jobs[0].maxCostUsd, null, 'a junk edit clears it to the station default rather than persisting junk');

  jobs = store.updateJob(jobs, 'j1', { maxCostUsd: 1e9 }, { now: T0 });
  A.eq(jobs[0].maxCostUsd, 1000, 'an absurd edit is clamped');

  // an UNRELATED edit must not disturb the cap — the classic patch-drops-a-field bug
  jobs = store.updateJob(jobs, 'j1', { maxCostUsd: 0.30 }, { now: T0 });
  jobs = store.updateJob(jobs, 'j1', { name: 'renamed' }, { now: T0 });
  A.eq(jobs[0].maxCostUsd, 0.30, 'renaming the routine leaves its ceiling intact');
  A.eq(jobs[0].name, 'renamed', 'and the rename landed');

  // and it is genuinely editable (present in EDITABLE), not silently ignored
  jobs = store.updateJob(jobs, 'j1', { maxCostUsd: 0.07 }, { now: T0 });
  A.eq(jobs[0].maxCostUsd, 0.07, 'maxCostUsd is in the EDITABLE whitelist');
}

/* ---------- 4. STORAGE IS NOT AUTHORITY: THE LANE IS LOWER-ONLY ----------
   Replays index.js's own rule over the forwarded value. A routine may tighten the station ceiling and may
   never raise it, so a tampered store buys nothing. */
{
  const applyLane = (stationCap, callerCap) => {
    let runCap = (stationCap > 0 && isFinite(stationCap)) ? stationCap : Infinity;
    if (Number.isFinite(Number(callerCap)) && Number(callerCap) > 0) runCap = Math.min(runCap, Number(callerCap));
    return runCap;
  };

  A.eq(applyLane(0, 0.25), 0.25, 'with perRun ungoverned (0), a routine cap becomes the real ceiling');
  A.eq(applyLane(5, 0.25), 0.25, 'a routine may TIGHTEN a station ceiling');
  A.eq(applyLane(0.25, 5), 0.25, 'a routine may NOT raise one — the tampered 999 case');
  A.eq(applyLane(0.25, 999), 0.25, 'explicitly: maxCostUsd 999 against perRun 0.25 stays 0.25');
  A.eq(applyLane(0, 0), Infinity, 'cap 0 = no cap, so the station default (ungoverned) stands');
  A.eq(applyLane(5, 0), 5, 'cap 0 does not override a real station perRun either');
  A.eq(applyLane(5, null), 5, 'an unset cap leaves the station ceiling alone');

  // the forward itself must OMIT the key when unset, so an uncapped routine's opts are byte-identical
  const fwd = (job) => (Number(job.maxCostUsd) > 0 && isFinite(Number(job.maxCostUsd))
    ? { callerMaxCostUsd: Number(job.maxCostUsd) } : {});
  A.eq(fwd({ maxCostUsd: 0.25 }), { callerMaxCostUsd: 0.25 }, 'a capped routine forwards the lane');
  A.eq(fwd({ maxCostUsd: 0 }), {}, 'cap 0 forwards NOTHING');
  A.eq(fwd({ maxCostUsd: null }), {}, 'an unset cap forwards NOTHING');
  A.eq(fwd({}), {}, 'a routine without the field forwards NOTHING');
  A.eq(fwd({ maxCostUsd: Infinity }), {}, 'Infinity forwards NOTHING (isFinite guard)');
}

/* ---------- 5. BOTH FIRE PATHS FORWARD IT ----------
   Source-pinned because these are two separate adapters in two separate files and the Run Now one has
   drifted from the scheduled one before. If either stops forwarding, this fails. */
{
  const driver = fs.readFileSync(path.join(__dirname, '..', 'sidecar', 'cron-driver.js'), 'utf8');
  const index = fs.readFileSync(path.join(__dirname, '..', 'sidecar', 'index.js'), 'utf8');

  const FORWARD = /\.\.\.\(Number\(job\.maxCostUsd\) > 0 && isFinite\(Number\(job\.maxCostUsd\)\)\s*\n?\s*\? \{ callerMaxCostUsd: Number\(job\.maxCostUsd\) \} : \{\}\)/;

  A.ok(FORWARD.test(driver.replace(/\r/g, '')), 'the SCHEDULED fire (cron-driver.js) forwards the ceiling');

  const runNow = index.slice(index.indexOf('function handleCronRun'));
  A.ok(runNow.length > 1000, 'handleCronRun was located in index.js');
  A.ok(FORWARD.test(runNow.replace(/\r/g, '')), 'RUN NOW (index.js handleCronRun) forwards it too');

  // and NEITHER may use the ceiling-REPLACING authority for a stored, HTTP-editable field
  A.ok(!/maxCostUsd: Number\(job\.maxCostUsd\)/.test(driver),
    'the scheduled fire does not pass the ceiling-REPLACING maxCostUsd lane');
  A.ok(!/maxCostUsd: Number\(job\.maxCostUsd\)/.test(runNow),
    'and neither does Run Now');

  // the store must expose the field as editable
  A.ok(/'dockId', 'maxCostUsd'\]/.test(fs.readFileSync(path.join(__dirname, '..', 'sidecar', 'cron-store.js'), 'utf8')),
    'cron-store lists maxCostUsd as editable');
}

/* ---------- 6. WHAT THIS DOES *NOT* GUARANTEE ----------
   Stated as assertions so the limitation travels with the feature instead of living in a report nobody
   re-reads. The ceiling is checked BETWEEN turns, so without loop.js's pre-flight reservation a capped run
   can still overshoot by one worst-case turn — the measured QC_EDITOR incident was $0.50 -> $0.6057. */
{
  const trailingStop = (turnCosts, cap) => { let s = 0; for (const c of turnCosts) { if (s >= cap) break; s += c; } return Number(s.toFixed(6)); };
  const QC = [0.25005374999999996, 0.07865475, 0.08338224999999999, 0.06982674999999999, 0.12374774999999999];

  A.ok(trailingStop(QC, 0.50) > 0.50,
    'a per-routine cap alone is a trailing stop: it can still overshoot by one worst-case turn');
  A.eq(trailingStop(QC, 0.50), 0.605665,
    'quantified on the real incident: a $0.50 ceiling permitted $0.605665 (+21.1%)');
  A.ok(trailingStop(QC, 0.50) < 25,
    'but it is still bounded FAR below the $25/day rail that was previously the only governor');

  const loopSrc = fs.readFileSync(path.join(__dirname, '..', 'sidecar', 'loop.js'), 'utf8');
  A.ok(/\(spentUsd \+ maxTurnUsd\) > maxCostUsd/.test(loopSrc),
    'the pre-flight reservation that makes the ceiling exact is present in loop.js on disk '
    + '(it is a RUNNING-PROCESS question whether it is loaded — see test/budget-reservation.test.js)');
}

A.report('cron cost cap');

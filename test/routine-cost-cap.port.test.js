/* PHONE PORT (2026-11-26): the per-routine spend ceiling. v0.15.4 stored no maxCostUsd and forwarded none, so with the
   station PER RUN at 0 a scheduled fire had NO per-run cap. Ported: stored + normalized (cron-store), forwarded as the
   run's lower-only ceilingUsd by the scheduled fire AND Run Now, and that ceiling bounds the lead plus its workers. */
'use strict';
const A = require('./_assert.js');
const store = require('../sidecar/cron-store.js');
const src = require('./helpers/source.js').readSidecarIndex();
const driver = require('fs').readFileSync(require('path').join(__dirname, '..', 'sidecar', 'cron-driver.js'), 'utf8');
const T = 1793600000000;
const mk = (extra) => store.createJob([], Object.assign({ id: 'j', schedule: { kind: 'cron', expr: '0 3 * * 1' }, agentId: 'agent', prompt: 'x' }, extra), { now: T });
A.eq(mk({ maxCostUsd: 2 })[0].maxCostUsd, 2, 'a routine keeps its $2 ceiling');
A.eq(mk({})[0].maxCostUsd, null, 'no ceiling set -> null (the station default applies)');
A.eq(mk({ maxCostUsd: -5 })[0].maxCostUsd, null, 'a negative value never grants headroom');
A.eq(mk({ maxCostUsd: 'lots' })[0].maxCostUsd, null, 'junk never grants headroom');
A.eq(mk({ maxCostUsd: 99999 })[0].maxCostUsd, 1000, 'a fat-finger value is clamped');
const upd = store.updateJob(mk({ maxCostUsd: 2 }), 'j', { maxCostUsd: 4 }, { now: T + 1 });
A.eq(store.getJob(upd, 'j').maxCostUsd, 4, 'the ceiling is editable (POST /api/cron/update {patch:{maxCostUsd}})');
A.eq(store.getJob(store.updateJob(upd, 'j', { maxCostUsd: 'x' }, { now: T + 2 }), 'j').maxCostUsd, null, 'and re-normalized on every edit');
A.ok(/\.\.\.\(\(Number\(job\.maxCostUsd\) > 0 && isFinite\(Number\(job\.maxCostUsd\)\)\) \? \{ routineCapUsd: Number\(job\.maxCostUsd\) \} : \{\}\)/.test(driver), 'the scheduled fire forwards it as routineCapUsd');
A.ok(/\.\.\.\(\(Number\(job\.maxCostUsd\) > 0 && isFinite\(Number\(job\.maxCostUsd\)\)\) \? \{ routineCapUsd: Number\(job\.maxCostUsd\) \} : \{\}\)/.test(src), 'and so does Run Now');
const B = require('../sidecar/billing-class.js').makeBilling({ profileOf: id => ({ id, unmetered: false }), creditsConfigured: () => false });
const r = B.runBillingFor({ providerId: 'anthropic', perRunUsd: 0, ceilingUsd: 2 });
A.eq(r.runCapUsd, 2, 'with PER RUN ungoverned (0) the routine ceiling becomes the run cap');
A.eq(B.spendPoolCapFor({ runCapUsd: r.runCapUsd, policy: r.policy, perRunUsd: 0 }), 2, 'and the cap of the pool its workers join');
A.eq(B.runBillingFor({ providerId: 'anthropic', perRunUsd: 1, ceilingUsd: 2 }).runCapUsd, 1, 'it never raises a lower station PER RUN');
A.ok(/const runCeilingUsd = \(routineCapUsd != null && lineCeiling != null\) \? Math\.min\(routineCapUsd, lineCeiling\)/.test(src) && /ceilingUsd: runCeilingUsd, perRunUsd: effectiveCaps\.perRun/.test(src), 'runOnceCore folds it into the lower-only ceiling (and never loosens a line hop\'s)');
A.report('routine cost cap port');

/* PHONE PORT (v0.15.4): what 2f5f3486c and c0a1d0096 guarantee, pinned on this build's source and pure modules.
   2f5f3486c — the arm/disarm LOG LINE prints the RECORDED label, marked unverified, never "by owner".
   c0a1d0096 — a script-only routine is EXEMPT from the gate (the run path returns before the gate), and the routines
               snapshot says so, checked FIRST; it CALLS the gate rather than re-deriving its rule. */
'use strict';
const A = require('./_assert.js');
const fs = require('node:fs');
const path = require('node:path');
const gate = require('../sidecar/production-gate.js');
const src = require('./helpers/source.js').readSidecarIndex()   /* PORT: through the source helper (source-helper H5) */;

{ // 2f5f3486c
  A.ok(!/ by owner at /.test(src), 'no log line says "by owner at"');
  A.ok(/'\[production-gate\] ' \+ \(v\.armed \? 'ARMED' : 'DISARMED'\)\s*\+ ' at ' \+ saved\.rec\.at \+ ' \(recorded by: ' \+ saved\.rec\.by \+ ' — unverified\)'/.test(src),
    'the ARM/DISARM line prints saved.rec.by and marks it unverified');
  A.ok(/by: claimed \|\| 'unattributed'/.test(src), 'nothing claimed is recorded as unattributed, never owner');
  const st = gate.readArmState({ armed: true, at: '2026-11-21T00:00:00Z', by: 'owner' }, '');
  A.ok(/recorded by: owner — the station cannot verify who acted/.test(st.note), 'even by:"owner" reads as a claim');
}
{ // c0a1d0096: run path order — the noAgent exit comes BEFORE the gate
  const core = src.indexOf('async function runOnceCore(o)');
  const noAgentExit = src.indexOf("if (o.noAgent || checked.wakeAgent === false)", core);
  const gateAt = src.indexOf('---- OWNER-AUTHORIZED PRODUCTION GATE', core);
  A.ok(core > 0 && noAgentExit > core, 'runOnceCore has the script-only early exit');
  A.ok(gateAt > noAgentExit, 'and it returns BEFORE the production gate is consulted');
  // snapshot: script-only first, then the gate verdict; failure to judge is unknown
  const snap = src.indexOf('function cronStateSnapshot(now)');
  const scriptFirst = src.indexOf("if (job.noAgent === true) return { blocked: false", snap);
  const decideAt = src.indexOf("productionGate.decide({ armed: arm.armed, metered: metered, surface: 'autonomous' })", snap);
  A.ok(scriptFirst > snap && decideAt > scriptFirst, 'the snapshot exempts script-only routines BEFORE calling the gate');
  A.ok(/billing\.policyOf\(provider\)\.ledgerMetered/.test(src.slice(snap, snap + 6000)), 'metered from the same billing policy the run path uses');
  A.ok(/return \{ blocked: null, code: '', because: 'unknown' \}/.test(src.slice(snap, snap + 6000)), 'a failure to judge reports unknown, never runnable');
  A.ok(/production: \{ armed: arm\.armed, source: arm\.source/.test(src), 'the snapshot reports the arm state beside the schedule');
}
{ // e5c8da4ab: only the Commander's buttons pass gateAsInteractive; the scheduled shift does not
  A.ok(/runWorkshopShift\(agentId, \{ emit: emit, broadcast: true, gateAsInteractive: true \}\)/.test(src), 'SHIFT NOW passes the gate as the Commander');
  A.ok(/runImplementBuild\(agentId, runId, \{ emit: emit, broadcast: true, note: body\.note, gateAsInteractive: true \}\)/.test(src), 'IMPLEMENT passes the gate as the Commander');
  A.eq((src.match(/gateAsInteractive: true/g) || []).length, 2, 'and nothing else hardcodes it');
}
{ // route-authority law: ARMING asks the desk, DISARMING never does
  const h = src.slice(src.indexOf('async function handleProductionArm('), src.indexOf('async function handleProductionArm(') + 2500);
  A.ok(/if \(v\.armed === true && productionArmState\(\)\.armed !== true\) \{\s*if \(!deskGate\(req, res, 'production-arm', 'production:arm'\)\) return;/.test(h), 'arming (from disarmed) requires the desk proof');
  A.ok(h.indexOf("deskGate(") > h.indexOf('validateArmPatch') && h.indexOf("deskGate(") < h.indexOf('saveProductionArm('), 'the proof is checked before anything is saved');
}
A.report('production gate port (2f5f3486c, c0a1d0096, e5c8da4ab)');

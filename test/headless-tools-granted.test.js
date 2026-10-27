/* test/headless-tools-granted.test.js — a headless run must actually be GIVEN tools.

   Regression for the defect that made every unattended agent useless while looking healthy:
   savedPlacement() read `save.station`, but the save envelope keeps the station at
   `save.doc.station`. The guard therefore returned [] on every call, so cron runs, the studio
   pipeline and POST /api/run were all handed ZERO capability objects — hence zero tools. The
   models then emitted tool syntax as PROSE (`<invoke name="web_search">…`), the run ended
   "done", and it read as a model-quality problem on every provider, free and paid alike.

   The lesson this encodes: a run ending "done" with a non-zero cost is NOT evidence that any
   work happened. Assert the tools were granted. */

'use strict';

const A = require('./_assert.js');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { savedPlacement } = require('../sidecar/capability/saved-placement.js');

/* ---- the envelope shape is the one the loader really returns ----
   Built from the REAL station doc rather than a hand-made one: validateStationDoc() is strict,
   and a synthetic fixture that fails validation would test the fixture, not the fix. */
{
  const WS0 = process.env.WORKSPACES
    || path.join(os.homedir(), '.local', 'share', 'StarNet', 'workspaces');
  const p0 = path.join(WS0, 'agent.save.json');
  let real = null;
  try { real = JSON.parse(fs.readFileSync(p0, 'utf8')); } catch (_) { real = null; }

  if (!real || !real.doc || !real.doc.station) {
    console.log('SKIP: no live station doc to build the shape fixture from');
  } else {
    const station = real.doc.station;
    const who = (real.doc.agents || []).map(a => a && a.id).filter(Boolean)[0] || 'agent';

    // THE REGRESSION: saveStore.load() returns the envelope, station under .doc.
    const envelope = { version: 1, agentId: who, updatedAt: Date.now(), doc: { station } };
    const got = savedPlacement(envelope, who).map(o => o.objectType);
    A.ok(got.length > 0,
      'the ENVELOPE shape {doc:{station}} yields capability objects — this is what saveStore.load() ' +
      'returns, and reading save.station instead silently granted nothing to every headless run');

    // the older flat shape must keep working
    A.ok(savedPlacement({ station }, who).length > 0, 'the flat {station} shape still resolves');

    A.ok(!got.includes('computer'), 'computer is not projected as a capability grant');
    A.ok(!got.includes('connector'), 'connector is not projected as a capability grant');
  }

  // Genuinely absent station -> no grant (must never invent gear).
  A.eq(savedPlacement({}, 'scout').length, 0, 'an empty save grants nothing');
  A.eq(savedPlacement(null, 'scout').length, 0, 'a null save grants nothing');
  A.eq(savedPlacement({ doc: {} }, 'scout').length, 0, 'a save with no station grants nothing');
}

/* ---- isTask default MUST be true for /api/run ----
   The toolDefs construction at runOnceCore:18106 is:
     const toolDefs = isTask ? registry.wireFormat(...) : [];
   With isTask=false (the old default), headless /api/run calls produced zero tool definitions,
   leaving the model unable to invoke any tools. The fix: /api/run destructures with isTask=true.
   This test encodes why the default exists. */
{
  const msg = 'isTask default in /api/run must be true so headless runs receive tool schemas';
  const sourceFile = require('path').join(__dirname, '..', 'sidecar', 'index.js');
  let source = '';
  try { source = require('fs').readFileSync(sourceFile, 'utf8'); } catch (_) { source = ''; }
  if (source) {
    const hasHandleRun = source.includes('function handleRun');
    const hasIstaskTrue = source.includes('isTask = true');
    const checkBoth = source.includes("isTask = true, provider, fallbackModels");
    A.ok(hasHandleRun && hasIstaskTrue && checkBoth, msg);
  } else {
    console.log('SKIP: could not read sidecar/index.js');
  }
}

/* ---- the LIVE station must grant tools to every real agent ---- */
{
  const WS = process.env.WORKSPACES
    || path.join(os.homedir(), '.local', 'share', 'StarNet', 'workspaces');
  const savePath = path.join(WS, 'agent.save.json');

  if (!fs.existsSync(savePath)) {
    console.log('SKIP: no live agent.save.json (hermetic run)');
  } else {
    let save = null;
    try { save = JSON.parse(fs.readFileSync(savePath, 'utf8')); } catch (_) { save = null; }
    if (!save) {
      console.log('SKIP: agent.save.json unreadable');
    } else {
      const agents = (save.doc && Array.isArray(save.doc.agents) ? save.doc.agents : [])
        .map(a => a && a.id).filter(Boolean);
      const checkList = agents.length ? agents : ['agent', 'scout'];
      let granted = 0;
      for (const id of checkList) {
        const objs = savedPlacement(save, id).map(o => o.objectType);
        if (objs.length) granted++;
      }
      A.ok(granted > 0,
        'at least one live agent is granted capability objects — zero across the board is the ' +
        'exact signature of the savedPlacement path bug, and it leaves every unattended run toolless');
      A.eq(granted, checkList.length,
        'EVERY live agent gets capability objects (' + granted + '/' + checkList.length + ')');
    }
  }
}

A.report('headless-tools-granted');

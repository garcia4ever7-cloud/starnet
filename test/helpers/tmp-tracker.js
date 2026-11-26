'use strict';
/* Temp-dir tracker for tests that boot their own sidecar (qa/bugs/2c50b150).

   Wrap each `fs.mkdtempSync(...)` in `track(...)`. Every tracked directory is removed when the test process
   exits — on a pass, on `A.report()`'s `process.exit()`, and after an uncaught failure, so a red test no
   longer strands its workspace — together with the two siblings a booted sidecar writes NEXT TO its workspace:
   `<dir>.recovery-owner.json` and `<dir>.recovery-owner.json.generations` (sidecar/workspace-recovery.js
   elects recovery ownership in the parent directory and sidecar/workspace-owner.js never deletes
   generations, by design). A test's own earlier cleanup is unaffected; removing an already-removed path is a
   no-op. SIGKILL of the test process still skips this. */
const fs = require('node:fs');

const tracked = new Set();
let hooked = false;

function rmWorkspace(dir) {
  if (!dir) return;
  for (const p of [dir, dir + '.recovery-owner.json', dir + '.recovery-owner.json.generations']) {
    try { fs.rmSync(p, { recursive: true, force: true }); } catch (_) {}
  }
}

function track(dir) {
  if (typeof dir !== 'string' || !dir) return dir;
  tracked.add(dir);
  if (!hooked) {
    hooked = true;
    process.on('exit', () => { for (const d of tracked) rmWorkspace(d); });
  }
  return dir;
}

module.exports = { track, rmWorkspace };

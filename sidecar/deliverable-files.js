/* sidecar/deliverable-files.js — which of a run's recorded files are actually a deliverable.

   sidecar/artifacts.js records every real write a run made — that is correct for it (it is a ledger of what
   happened, not a judgment about what matters), but a run also legitimately writes scratch/calibration
   helpers it never meant to ship (a one-off cal.py to work out crop geometry, a grid.py to sanity-check pixel
   math) alongside its real output. Those helpers are frequently deleted once they've served their purpose, and
   even when they aren't, they are never a finished output on this station (watercolor prints, print kits,
   listing photos, listing text — never a .py/.sh/.ipynb). deliverableRows() in sidecar/index.js is the only
   caller; this module exists purely so the extension rule has ONE place to live and a direct unit test,
   matching the sidecar/deliverable-provenance.js precedent for logic pulled out of the ~17k-line index.js so
   it can be tested without booting the server.

   isScratchHelperPath(path) -> true for an extension this station's real deliverables never ship in.
   PURE: a string in, a boolean out. No ambient IO/time. The separate "does this file still exist on disk"
   check stays in sidecar/index.js's deliverableFile() because it is inherently a filesystem read, not logic
   worth a fake-fs unit test to prove. */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).deliverableFiles = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Deliberately an extension denylist, not an allowlist: this station's real outputs vary (png/jpg/pdf/svg/
  // md/txt/csv/json/...) but its scratch helpers are reliably one of these few script/notebook shapes. An
  // allowlist would risk hiding a real output in a format nobody anticipated; a denylist only ever hides the
  // shapes that are never a shop deliverable here.
  const SCRATCH_EXTENSIONS = new Set(['.py', '.pyc', '.sh', '.ipynb']);

  function extOf(p) {
    const s = String(p == null ? '' : p);
    const slash = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
    const base = slash >= 0 ? s.slice(slash + 1) : s;
    const dot = base.lastIndexOf('.');
    return dot > 0 ? base.slice(dot).toLowerCase() : '';
  }

  function isScratchHelperPath(p) {
    return SCRATCH_EXTENSIONS.has(extOf(p));
  }

  return { isScratchHelperPath, _internals: { extOf, SCRATCH_EXTENSIONS } };
});

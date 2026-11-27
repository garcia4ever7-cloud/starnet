/* node test/deliverable-files.test.js — the scratch/helper-script extension denylist used by
   deliverableRows() (sidecar/index.js) to keep a run's throwaway calibration scripts out of the
   Deliverables panel. See sidecar/deliverable-files.js for why this is a denylist, not an allowlist. */
'use strict';
const A = require('./_assert.js');
const { isScratchHelperPath, _internals } = require('../sidecar/deliverable-files.js');

// ---- A. the reported case: calibration/helper scripts from the "Mockup room template 2" run ----
{
  for (const p of ['cal.py', 'cal2.py', 'grid.py', 'grid4.py', 'edges.py', 'detect.py', 'corners.py', 'overview.py', 'minline.py', 'measure.py']) {
    A.ok(isScratchHelperPath(p), p + ' (bare workspace-root calibration script) is scratch');
  }
}

// ---- B. real finished outputs are never flagged, whatever directory they live in ----
{
  for (const p of [
    'outbox/isaiah-40-31-4k-kit/isaiah-40-31-ratio-4x5-4800x6000.jpg',
    'outbox/isaiah-40-31-4k-kit/listing-photos/isaiah-40-31-ratio-4x5-4800x6000-hero-mockup.jpg',
    'outbox/mockup-templates/room-2-living-room.png',
    'outbox/mockup-templates/room-2-living-room.json',
    'listing-text.txt',
    'listing-text.md',
    'report.csv',
    'kit.pdf',
    'logo.svg',
    'README'
  ]) A.ok(!isScratchHelperPath(p), p + ' is a real output, never scratch');
}

// ---- C. extension match is case-insensitive and anchored to the LAST extension ----
{
  A.ok(isScratchHelperPath('CAL.PY'), 'uppercase extension still matches');
  A.ok(isScratchHelperPath('notebook.ipynb'), '.ipynb matches');
  A.ok(isScratchHelperPath('build.sh'), '.sh matches');
  A.ok(isScratchHelperPath('module.pyc'), '.pyc matches');
  A.ok(!isScratchHelperPath('my.py.txt'), 'a real .txt output named *.py.txt is not scratch (last extension wins)');
  A.ok(!isScratchHelperPath('pyproject.toml'), 'a filename merely CONTAINING "py" is not scratch');
}

// ---- D. path separators, dotfiles and empty input never throw or misclassify ----
{
  A.ok(isScratchHelperPath('scripts/sub/dir/cal.py'), 'nested path still matches on the basename extension');
  A.ok(isScratchHelperPath('scripts\\sub\\cal.py'), 'backslash path separators are handled too');
  A.ok(!isScratchHelperPath('.gitignore'), 'a dotfile with no real extension is not scratch');
  A.ok(!isScratchHelperPath(''), 'empty path is not scratch');
  A.ok(!isScratchHelperPath(null), 'null path is not scratch');
  A.ok(!isScratchHelperPath(undefined), 'undefined path is not scratch');
}

// ---- E. extOf internal ----
{
  A.eq(_internals.extOf('a/b/c.PY'), '.py', 'extOf lowercases');
  A.eq(_internals.extOf('noext'), '', 'extOf is empty when there is no extension');
}

A.report('deliverable-files.test');

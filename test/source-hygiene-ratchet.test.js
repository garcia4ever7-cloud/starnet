/* test/source-hygiene-ratchet.test.js — a tracked source file must not carry RAW control bytes.
 *
 * WHY THIS EXISTS (2026-11-03, found the hard way twice).
 *
 * `sidecar/deliverable-manifest.js` carried four raw control bytes (0x00 0x08 0x0e 0x1f) inside the
 * detectType() control-char character class. The code WORKED and its 126 assertions passed — but the NUL
 * made every text tool classify the file as binary:
 *
 *     $ file sidecar/deliverable-manifest.js
 *     sidecar/deliverable-manifest.js: data
 *     $ grep -n "symlink\|realpathSync\|O_NOFOLLOW" sidecar/deliverable-manifest.js
 *     (no output)
 *
 * That is the real harm, and it is a SECURITY harm, not a cosmetic one: this module holds the
 * symlink-escape floor (realpath both ends + lstat + O_NOFOLLOW). A reviewer grepping for that floor got
 * ZERO matches and would reasonably conclude the protection was absent. Silent-empty-grep is the worst
 * failure mode a safety control can have, because it reads as proof of a missing control.
 *
 * The same corruption class already hit `scripts/station-models.mjs` on this station. It keeps coming back,
 * so this is a RATCHET, not a cleanup:
 *
 *   - the files listed in GRANDFATHERED are allowed their CURRENT counts and no more
 *   - any NEW file with raw control bytes fails
 *   - any grandfathered file that gains MORE of them fails
 *   - deliverable-manifest.js must stay at zero, forever
 *
 * The grandfathered entries are deliberately NOT fixed: 0x1b in the shell tooling is ANSI-escape handling
 * with its own tests, and rewriting it to chase tidiness risks a live-execution regression for no
 * reliability gain. Escaping them (\x1b, \x01, \x08) is always behaviour-preserving when someone next
 * touches those files — lower the number here when they do.
 *
 * TAB (0x09), LF (0x0a) and CR (0x0d) are legal source bytes and are never counted.
 *
 * Run standalone: node test/source-hygiene-ratchet.test.js */
'use strict';

const A = require('./_assert.js');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.join(__dirname, '..');
const ROOTS = ['sidecar', 'frontend', 'shared', 'test', 'scripts'];
const SOURCE_EXT = /\.(js|mjs|cjs|json|md|html|css)$/;

/* A backup is a deliberate snapshot of whatever it captured, including corruption — the working tree's
   *.bak / *.bak-<tag> files are intentional on this station and are not source. Skipping them is why this
   ratchet can be strict about everything else. */
const IS_BACKUP = /\.bak(-|\.|$)/;

/* file -> the number of raw control bytes it is permitted to keep. Lower these; never raise them. */
const GRANDFATHERED = Object.freeze({
  'sidecar/tools/builtin/shell.js': 1,      // 0x1b — ANSI escape handling
  'test/shell.test.js': 1,                  // 0x1b — asserts the above
  'frontend/app/chat.js': 4,                // 0x01
  'frontend/app/friendlyerror.js': 4,       // 0x08
  'frontend/app/modeldock.js': 1,           // 0x01
  'test/deliverable-manifest.test.js': 1    // 0x00 — exercises binary detection
});

/* The file whose grep-invisibility prompted all of this. Non-negotiable. */
const MUST_BE_CLEAN = ['sidecar/deliverable-manifest.js'];

function rawControlCount(buf) {
  let n = 0;
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i];
    if (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) n++;
  }
  return n;
}

function walk(dir, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (/node_modules|\.git$/.test(p)) continue;
      walk(p, out);
      continue;
    }
    if (!SOURCE_EXT.test(e.name) || IS_BACKUP.test(e.name)) continue;
    out.push(p);
  }
  return out;
}

const files = walk(path.join(REPO, 'sidecar'), [])
  .concat(...ROOTS.slice(1).map((r) => walk(path.join(REPO, r), [])));

A.ok(files.length > 500, 'the scan actually found the source tree (' + files.length + ' files)');

/* ---------- 1. THE SECURITY-CRITICAL FILE IS CLEAN, AND GREPPABLE ---------- */
for (const rel of MUST_BE_CLEAN) {
  const abs = path.join(REPO, rel);
  const buf = fs.readFileSync(abs);
  A.eq(rawControlCount(buf), 0, rel + ' carries no raw control bytes');

  // The point of the fix: the protections in it are findable by text search.
  const src = buf.toString('utf8');
  A.ok(/O_NOFOLLOW/.test(src), rel + ': the O_NOFOLLOW read floor is present and greppable');
  A.ok(/realpathSync/.test(src), rel + ': the realpath comparison is present and greppable');
  A.ok(/isSymbolicLink/.test(src), rel + ': the lstat symlink refusal is present and greppable');

  // And the escaped class still means what it meant: binary control bytes flagged, text whitespace not.
  const m = src.match(/if \(!\/\[([^\]]*)\]\/\.test\(head\)\) return 'text';/);
  A.ok(m, rel + ': the detectType control-char class is still there');
  const cls = new RegExp('[' + m[1] + ']');
  A.ok(/^[\x20-\x7e]*$/.test(m[1]), 'and is written with printable escapes, not raw bytes');
  for (const [code, want] of [[0x09, false], [0x0a, false], [0x0d, false], [0x0b, false], [0x0c, false],
                              [0x00, true], [0x01, true], [0x08, true], [0x0e, true], [0x1f, true],
                              [0x20, false], [0x41, false]]) {
    A.eq(cls.test(String.fromCharCode(code)), want,
      'class semantics unchanged for 0x' + code.toString(16) + ' (want ' + want + ')');
  }
}

/* ---------- 2. THE RATCHET: NO NEW OFFENDERS, NO GROWTH ---------- */
{
  const offenders = {};
  for (const abs of files) {
    const n = rawControlCount(fs.readFileSync(abs));
    if (n > 0) offenders[path.relative(REPO, abs).split(path.sep).join('/')] = n;
  }

  const unexpected = Object.keys(offenders).filter((f) => !(f in GRANDFATHERED));
  A.eq(unexpected.length, 0,
    'no NEW source file carries raw control bytes' + (unexpected.length
      ? ' — found: ' + unexpected.map((f) => f + '(' + offenders[f] + ')').join(', ')
        + '. Raw control bytes make `file` report the source as binary and make grep silently return NOTHING,'
        + ' which reads as proof a safety control is missing. Write them as \\xNN escapes instead.'
      : ''));

  for (const f of Object.keys(GRANDFATHERED)) {
    const have = offenders[f] || 0;
    A.ok(have <= GRANDFATHERED[f],
      f + ' did not gain raw control bytes (allowed ' + GRANDFATHERED[f] + ', has ' + have + ')');
  }
}

/* ---------- 3. THE RATCHET CANNOT BE SATISFIED BY AN EMPTY SCAN ----------
   A broken walk() would make section 2 pass vacuously, which is the way ratchets rot. */
{
  A.ok(files.some((f) => /sidecar[\\/]index\.js$/.test(f)), 'the scan reaches sidecar/index.js');
  A.ok(files.some((f) => /frontend[\\/]app[\\/]/.test(f)), 'the scan reaches frontend/app/');
  A.ok(files.some((f) => /test[\\/]/.test(f)), 'the scan reaches test/');
  A.eq(files.filter((f) => IS_BACKUP.test(path.basename(f))).length, 0,
    'and excludes the intentional *.bak-* snapshots');
  // the detector itself must actually detect
  A.eq(rawControlCount(Buffer.from('ok\tline\r\n')), 0, 'tab/CR/LF are legal source bytes');
  A.eq(rawControlCount(Buffer.from([0x61, 0x00, 0x62])), 1, 'a NUL is counted');
  A.eq(rawControlCount(Buffer.from([0x1b, 0x1b])), 2, 'ESC bytes are counted');
}

A.report('source hygiene ratchet');

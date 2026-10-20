/* node test/image-qc.test.js — the STUDIO quality-check skill: image_quality_check. Offline + deterministic.
   Builds its own synthetic PNG fixtures (real @napi-rs/canvas-encoded bytes, not fakes) so it never depends
   on live product artwork. Verifies: real dimension/DPI reporting from the file's own bytes, the exact
   claimed-vs-actual mismatch this tool exists to catch (the real 2026-10-19 Philippians 4:6-7 defect —
   a filename promising 4800x6000 that was actually 928x1152), file-integrity failure on a truncated/corrupt
   PNG, print-suitability grading, jail safety, a clean error on a missing file, and tool metadata
   (read-only, no consent gate, so it is callable from an unattended validation run). */
'use strict';
const A = require('./_assert.js');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { makeImageQcTools } = require('../sidecar/tools/builtin/image-qc.js');
const { makePrintPrepTools } = require('../sidecar/tools/builtin/print-prep.js');

const ROOT = path.join(os.tmpdir(), 'starnet-image-qc-test-' + process.pid);
const AID = 'webdesigner';

let canvasLib;
try { canvasLib = require('@napi-rs/canvas'); } catch (_) { canvasLib = null; }

async function writePng(relPath, w, h) {
  const canvas = canvasLib.createCanvas(w, h);
  const c = canvas.getContext('2d');
  c.fillStyle = '#223344'; c.fillRect(0, 0, w, h);
  const buf = await canvas.encode('png');
  const abs = path.join(ROOT, AID, relPath);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, buf);
  return buf;
}

function ctx() { return { agentId: AID }; }

(async () => {
  try { await fsp.rm(ROOT, { recursive: true, force: true }); } catch (_) {}
  await fsp.mkdir(ROOT, { recursive: true });

  const { qcTool } = makeImageQcTools({ fsp, pathMod: path, root: ROOT });

  // tool metadata: read-only, no consent gate — must be callable from an unattended/autonomous run
  A.eq(qcTool.scope, 'read', 'image_quality_check is read-scoped');
  A.eq(qcTool.requiresConsent, false, 'image_quality_check is consent-free (unlike image_generate/image_print_prep)');
  A.eq(qcTool.network, false, 'image_quality_check makes no network call');

  if (!canvasLib) {
    console.log('image-qc.test: SKIP (no @napi-rs/canvas on this platform) — 0 assertions beyond metadata');
    A.report('image-qc.test');
    return;
  }

  // A. real dimensions + DPI metadata read back correctly (round-tripped through print-prep's own pHYs writer)
  {
    const { prepTool } = makePrintPrepTools({ fsp, pathMod: path, root: ROOT });
    await writePng('outbox/source.png', 928, 1152);
    const prep = await prepTool.run({ image: 'outbox/source.png', sizes: ['8x10'] }, { agentId: AID, emit: () => {} });
    A.ok(/8x10/.test(prep.summary), 'print-prep produced an 8x10 file to QC');
    const r = await qcTool.run({ images: [{ path: 'outbox/source-8x10-300ppi.png', targetInchesWidth: 8, targetInchesHeight: 10 }] }, ctx());
    A.ok(/PASS/.test(r.content) && /2400x3000/.test(r.content), 'real 300-DPI print file reports correct dimensions: ' + r.content.slice(0, 300));
    A.ok(/300 DPI \(from file metadata\)/.test(r.content), 'DPI is read from the file\'s own pHYs metadata, not assumed');
    A.ok(/print-shop quality/.test(r.content), 'a true 300 DPI file at its claimed size grades as print-shop quality');
  }

  // B. THE REAL DEFECT THIS TOOL EXISTS TO CATCH: a file whose name/claim says one size but whose actual
  // bytes are a different, much smaller size (exactly the Philippians 4:6-7 WINNER-print-master mislabel).
  {
    await writePng('outbox/mislabeled-4800x6000.png', 928, 1152);
    const r = await qcTool.run({ images: [{ path: 'outbox/mislabeled-4800x6000.png', claimedWidth: 4800, claimedHeight: 6000 }] }, ctx());
    A.ok(/FAIL/.test(r.content), 'a mislabeled file is reported as FAIL, not silently passed');
    A.ok(/claimed 4800x6000 but the file is ACTUALLY 928x1152/.test(r.content), 'the exact actual-vs-claimed mismatch is named: ' + r.content.slice(0, 400));
    A.ok(/do not ship under the claimed label/.test(r.content), 'the tool tells the caller not to ship it');
    A.eq(r.summary, 'image_quality_check -> 0/1 passed', 'summary reflects the failure');
  }

  // C. claim matches reality -> PASS
  {
    await writePng('outbox/honest-small.png', 600, 800);
    const r = await qcTool.run({ images: [{ path: 'outbox/honest-small.png', claimedWidth: 600, claimedHeight: 800 }] }, ctx());
    A.ok(/PASS/.test(r.content) && !/FAIL/.test(r.content), 'a file whose claim matches reality passes cleanly: ' + r.content.slice(0, 200));
  }

  // D. print-suitability grading at low DPI (a small file claimed for a large print)
  {
    const r = await qcTool.run({ images: [{ path: 'outbox/honest-small.png', targetInchesWidth: 16, targetInchesHeight: 20 }] }, ctx());
    A.ok(/screen\/preview quality only/.test(r.content), 'a 600x800 file at 16x20in correctly grades as unsuitable to print: ' + r.content.slice(0, 300));
  }

  // E. file integrity — a truncated/corrupt PNG fails the integrity layer, not a dimension mismatch
  {
    const goodBuf = await writePng('outbox/will-corrupt.png', 400, 400);
    const truncated = goodBuf.slice(0, Math.floor(goodBuf.length / 2));
    await fsp.writeFile(path.join(ROOT, AID, 'outbox/corrupt.png'), truncated);
    const r = await qcTool.run({ images: [{ path: 'outbox/corrupt.png' }] }, ctx());
    A.ok(/FAIL — truncated\/corrupt PNG|FAIL — no IEND/.test(r.content), 'a truncated PNG fails integrity with a specific reason: ' + r.content.slice(0, 300));
  }

  // F. a file that is not a PNG at all (wrong signature)
  {
    await fsp.writeFile(path.join(ROOT, AID, 'outbox/not-a-png.png'), Buffer.from('this is plain text, not a PNG'));
    const r = await qcTool.run({ images: [{ path: 'outbox/not-a-png.png' }] }, ctx());
    A.ok(/FAIL — not a PNG/.test(r.content), 'a non-PNG file is rejected with a clear reason: ' + r.content.slice(0, 200));
  }

  // G. missing file -> a named error, not a crash or a false pass
  {
    const r = await qcTool.run({ images: [{ path: 'outbox/does-not-exist.png' }] }, ctx());
    A.ok(/ERROR — no such file in workspace/.test(r.content), 'a missing file reports a clean error: ' + r.content);
  }

  // H. multiple files in one call, mixed pass/fail, correct aggregate summary
  {
    const r = await qcTool.run({ images: [
      { path: 'outbox/honest-small.png', claimedWidth: 600, claimedHeight: 800 },
      { path: 'outbox/mislabeled-4800x6000.png', claimedWidth: 4800, claimedHeight: 6000 }
    ] }, ctx());
    A.eq(r.summary, 'image_quality_check -> 1/2 passed', 'aggregate summary correctly counts pass/fail across a batch');
  }

  // I2. real-world provider quirk (live-caught 2026-10-19, webdesigner/claude-sonnet-5 via OpenRouter):
  // `images` arrives as a JSON-ENCODED STRING, not a real array. Must still work, not fail with
  // "images is required" (the exact failure that run produced before this defensive parse was added).
  {
    const r = await qcTool.run({ images: JSON.stringify([{ path: 'outbox/honest-small.png', claimedWidth: 600, claimedHeight: 800 }]) }, ctx());
    A.ok(/PASS/.test(r.content) && !/ERROR/.test(r.content), 'a JSON-stringified images array is parsed and works, not rejected: ' + r.content.slice(0, 200));
  }
  // I3. CONTRACT CHANGE 2026-10-20: a non-JSON string used to throw "images is required". It is now
  // read as a PATH, because that is what a model means when it sends one (seen live, minimax). A
  // nonsense string therefore surfaces as a clean per-file "no such file" row — still never a silent
  // pass and still never a crash, but the error now names the real problem instead of the shape.
  {
    const r = await qcTool.run({ images: 'not json' }, ctx());
    A.ok(/ERROR/.test(r.content) && /no such file/.test(r.content), 'a nonsense string is reported as a missing file, naming it: ' + r.content.slice(0, 140));
    A.ok(!/PASS/.test(r.content), 'and it certainly does not pass');
  }

  // I4. ARGUMENT SHAPES seen live on 2026-10-20 (minimax-m3.1-flash via OpenRouter). All three were
  // REJECTED by the old strict parse, which cost a real run three wasted turns before the agent gave
  // up on this tool and shelled out to read the PNG header by hand. Each states an unambiguous intent.
  {
    const { _internals } = makeImageQcTools({ fsp, pathMod: path, root: ROOT });
    const C = _internals.coerceImages;
    A.eq(C('outbox/honest-small.png').length, 1, 'a bare path STRING is accepted as one file');
    A.eq(C('outbox/honest-small.png')[0].path, 'outbox/honest-small.png', 'the bare string becomes {path}');
    A.eq(C({ item: { path: 'a.png' } })[0].path, 'a.png', 'an {item:{…}} wrapper object is unwrapped');
    A.eq(C({ images: [{ path: 'b.png' }] })[0].path, 'b.png', 'a nested {images:[…]} wrapper is unwrapped');
    A.eq(C({ path: 'c.png' })[0].path, 'c.png', 'a single unwrapped {path} entry is accepted');
    A.eq(C({ 0: { path: 'd.png' }, 1: { path: 'e.png' } }).length, 2, 'a numeric-keyed pseudo-array is accepted');
    A.eq(C(['f.png', { path: 'g.png' }]).length, 2, 'an array may mix plain strings and objects');
    A.eq(C('[{"path":"h.png"}]')[0].path, 'h.png', 'the JSON-encoded array string still works (2026-10-19 regression)');
    // Still fails closed on genuine nonsense — the point is to honour clear intent, not to guess.
    A.eq(C(null).length, 0, 'null yields nothing');
    A.eq(C('').length, 0, 'an empty string yields nothing');
    A.eq(C({}).length, 0, 'an empty object yields nothing');
    A.eq(C({ nope: 1 }).length, 0, 'an object with no recognisable entry yields nothing');
  }
  // I5. the same shapes end-to-end through run(), not just the pure helper
  {
    const r1 = await qcTool.run({ images: 'outbox/honest-small.png' }, ctx());
    A.ok(/PASS/.test(r1.content) && !/ERROR/.test(r1.content), 'a bare path string works end to end: ' + r1.content.slice(0, 120));
    const r2 = await qcTool.run({ images: { item: { path: 'outbox/honest-small.png' } } }, ctx());
    A.ok(/PASS/.test(r2.content) && !/ERROR/.test(r2.content), 'an {item:{…}} wrapper works end to end: ' + r2.content.slice(0, 120));
    const r3 = await qcTool.run({ path: 'outbox/honest-small.png' }, ctx());
    A.ok(/PASS/.test(r3.content) && !/ERROR/.test(r3.content), 'a bare {path} with no images key works end to end: ' + r3.content.slice(0, 120));
    // SINGULAR key — the exact shape a live minimax run reached for first on 2026-10-20, after the
    // value-shape fix had already landed. Models go for `image` as readily as the declared `images`.
    const r4 = await qcTool.run({ image: 'outbox/honest-small.png' }, ctx());
    A.ok(/PASS/.test(r4.content) && !/ERROR/.test(r4.content), 'the singular "image" key works end to end: ' + r4.content.slice(0, 120));
    const r5 = await qcTool.run({ file: { path: 'outbox/honest-small.png' } }, ctx());
    A.ok(/PASS/.test(r5.content) && !/ERROR/.test(r5.content), 'the "file" alias works end to end: ' + r5.content.slice(0, 120));
    // The declared name still wins when a model sends both.
    const r6 = await qcTool.run({ images: [{ path: 'outbox/honest-small.png' }], image: 'outbox/nope.png' }, ctx());
    A.ok(/PASS/.test(r6.content) && !/ERROR/.test(r6.content), 'when both are present the declared "images" wins: ' + r6.content.slice(0, 120));
  }
  // I6. an empty call still fails, with an error that SHOWS the accepted shape
  {
    let threw = false;
    try { await qcTool.run({}, ctx()); }
    catch (e) { threw = true; A.ok(/images is required/.test(e.message) && /path/.test(e.message), 'the empty-call error demonstrates the shape: ' + e.message); }
    A.ok(threw, 'an empty argument object still throws rather than silently passing');
  }

  // J. jail safety — cannot escape the agent's own workspace
  {
    const r = await qcTool.run({ images: [{ path: '../../etc/passwd' }] }, ctx());
    A.ok(/ERROR/.test(r.content) && !/root:/.test(r.content), 'a path-escape attempt is refused, not resolved outside the jail: ' + r.content.slice(0, 200));
  }

  console.log('image-qc.test: all checks passed');
  A.report('image-qc.test');
})().catch(e => { console.error(e); process.exitCode = 1; });

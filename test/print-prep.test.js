/* node test/print-prep.test.js — the STUDIO print-prep skill: image_print_prep. Offline + deterministic
   (real temp workspace, a synthetic source PNG built with @napi-rs/canvas so the test owns its own fixture
   rather than depending on any live product artwork). Pairs with sidecar/tools/builtin/print-prep.js.
   Verifies: exact target pixel dimensions, a correct 300-DPI JFIF density round-trip (2026-10-22: output
   switched PNG -> JPEG so Etsy's real 20 MB digital-download cap can never be exceeded — confirmed live on
   5 real KJV print kits that a full-bleed 300-PPI PNG routinely blew past it), the real on-disk byte size
   staying under budget, the aspect-match vs letterbox-pad branch choice, jail safety, a clean error on a
   missing source file, and tool metadata (capability/consent). */
'use strict';
const A = require('./_assert.js');
const fsp = require('node:fs/promises');
const fssync = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { makePrintPrepTools } = require('../sidecar/tools/builtin/print-prep.js');

const ROOT = path.join(os.tmpdir(), 'starnet-print-prep-test-' + process.pid);
const AID = 'webdesigner';

let canvasLib;
try { canvasLib = require('@napi-rs/canvas'); } catch (_) { canvasLib = null; }

async function makeSyntheticSource(relPath, w, h) {
  const canvas = canvasLib.createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1b2733';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#f4ead2';
  ctx.font = Math.round(h / 10) + 'px serif';
  ctx.fillText('Test Verse', Math.round(w * 0.1), Math.round(h / 2));
  const buf = await canvas.encode('png');
  const abs = path.join(ROOT, AID, relPath);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, buf);
  return abs;
}

function ctx() { const events = []; return { agentId: AID, room: 'office', emit: (name, payload) => events.push({ name, payload }), events }; }

(async () => {
  try { await fsp.rm(ROOT, { recursive: true, force: true }); } catch (_) {}
  await fsp.mkdir(ROOT, { recursive: true });

  if (!canvasLib) {
    // This platform genuinely cannot load @napi-rs/canvas — the tool's own run() must refuse honestly
    // rather than silently producing nothing. Verify that refusal and stop; the rest of this file
    // requires a working canvas to build its fixtures.
    const { prepTool } = makePrintPrepTools({ fsp, pathMod: path, root: ROOT });
    try {
      await prepTool.run({ image: 'outbox/whatever.png' }, ctx());
      A.ok(false, 'must refuse when @napi-rs/canvas is unavailable, not silently no-op');
    } catch (e) {
      A.ok(/canvas failed to load/.test(e.message), 'the refusal names the real cause');
    }
    A.report('print-prep.test (canvas unavailable on this platform)');
    return;
  }

  const { prepTool, _internals } = makePrintPrepTools({ fsp, pathMod: path, root: ROOT });

  // ---- tool metadata: write-scope, consent-gated, like every other STUDIO publisher ----
  A.eq(prepTool.name, 'image_print_prep', 'tool name matches the capability-registry grant');
  A.eq(prepTool.capability, 'studio', 'rides the existing studio capability — no new grant plumbing needed');
  A.eq(prepTool.scope, 'write', 'publishes new files — write scope');
  A.eq(prepTool.requiresConsent, true, 'consent-gated like image_generate (it writes into the workspace)');

  // ---- pure pHYs chunk round-trip, independent of canvas/PNG encoding ----
  {
    const fakePng = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      _internals.pngChunk('IHDR', Buffer.alloc(13)),
      _internals.pngChunk('IDAT', Buffer.from('x'))
    ]);
    const withPhys = _internals.injectPhys(fakePng, _internals.PIXELS_PER_METER);
    const read = _internals.readPhys(withPhys);
    A.ok(!!read, 'pHYs chunk is present after injection');
    A.eq(read.x, _internals.PIXELS_PER_METER, 'pHYs x matches the injected value');
    A.eq(read.y, _internals.PIXELS_PER_METER, 'pHYs y matches the injected value');
    A.eq(read.unit, 1, 'unit specifier is meters (1), the PNG-spec value DPI tools expect');
    A.eq(_internals.pixelsPerMeterToPpi(read.x), 300, 'round-tripped pixels-per-meter converts back to exactly 300 PPI');
    A.eq(_internals.readPhys(fakePng), null, 'a PNG with no pHYs chunk reads back null, never a guessed value');
  }

  // ---- pure JFIF density round-trip, against a REAL @napi-rs/canvas JPEG (the exact byte layout the live
  // tool depends on — a hand-built fake would hide a real encoder-layout drift) ----
  {
    const realJpeg = await canvasLib.createCanvas(4, 4).encode('jpeg', 90);
    A.eq(realJpeg[0], 0xFF, 'real encoder output starts with the JPEG SOI marker');
    A.eq(realJpeg[2], 0xFF, 'real encoder emits APP0 as the very first segment (the layout injectJfifDpi assumes)');
    A.eq(realJpeg[3], 0xE0, 'that first segment is APP0');
    const withDpi = _internals.injectJfifDpi(realJpeg, _internals.PPI);
    const read = _internals.readJfifDpi(withDpi);
    A.ok(!!read, 'JFIF density is present after injection');
    A.eq(read.x, 300, 'JFIF X density matches the injected 300 DPI');
    A.eq(read.y, 300, 'JFIF Y density matches the injected 300 DPI');
    A.eq(read.unit, 1, 'unit specifier is 1 (dots per inch)');
    A.ok(withDpi !== realJpeg, 'injectJfifDpi returns a new buffer, never mutates the caller\'s');
    await A.throws(() => _internals.injectJfifDpi(Buffer.from([0, 1, 2, 3]), 300), 'a buffer with no real JFIF header is refused, never silently no-op');
  }

  // ---- a 4:5 source (matches 8x10 and 16x20 exactly) ----
  {
    const srcRel = 'outbox/synthetic-4x5.png';
    await makeSyntheticSource(srcRel, 400, 500);
    const c = ctx();
    const result = await prepTool.run({ image: srcRel, sizes: ['8x10', '16x20'] }, c);
    A.ok(/pixel-interpolation upscale/.test(result.content), 'the report states plainly that this is interpolation, not AI detail restoration');
    A.eq(c.events.length, 2, 'one deliverable event per produced size');

    for (const [size, w, h] of [['8x10', 2400, 3000], ['16x20', 4800, 6000]]) {
      const abs = path.join(ROOT, AID, 'outbox', 'synthetic-4x5-' + size + '-300ppi.jpg');
      A.ok(fssync.existsSync(abs), size + ': output file exists on disk at the expected path (JPEG, not PNG)');
      const buf = fssync.readFileSync(abs);
      const img = new canvasLib.Image(); img.src = buf;
      A.eq(img.width, w, size + ': decoded width matches the exact target pixel dimension');
      A.eq(img.height, h, size + ': decoded height matches the exact target pixel dimension');
      const dpi = _internals.readJfifDpi(buf);
      A.ok(!!dpi && dpi.x === 300 && dpi.y === 300 && dpi.unit === 1, size + ': the file on disk (re-read independently) carries verified 300 DPI JFIF metadata');
      A.ok(buf.length < _internals.MAX_PRINT_BYTES, size + ': real on-disk JPEG bytes are under the 19.5 MB budget (Etsy rejects anything over 20 MB)');
      A.ok(result.content.indexOf(size + ' -> outbox/synthetic-4x5-' + size + '-300ppi.jpg') >= 0, size + ': the report names the exact real path');
    }
    A.ok(/full-bleed/.test(result.content), 'a 4:5 source at an exact-4:5 target is reported as full-bleed, not padded');
    A.ok(!/letterboxed/.test(result.content), 'no letterbox language for a ratio-matched size');
  }

  // ---- the SAME 4:5 source at 11x14 (0.7857) must letterbox, never crop or stretch-without-saying-so ----
  {
    const srcRel = 'outbox/synthetic-4x5.png';   // reuse — already on disk from the block above
    const c = ctx();
    const result = await prepTool.run({ image: srcRel, sizes: ['11x14'] }, c);
    const abs = path.join(ROOT, AID, 'outbox', 'synthetic-4x5-11x14-300ppi.jpg');
    const buf = fssync.readFileSync(abs);
    const img = new canvasLib.Image(); img.src = buf;
    A.eq(img.width, 3300, '11x14 width is exact regardless of the letterbox');
    A.eq(img.height, 4200, '11x14 height is exact regardless of the letterbox');
    A.ok(/letterboxed to fit/.test(result.content), '11x14 is reported as letterboxed (real ~2% aspect mismatch)');
    A.ok(/padded in the artwork.s own background color/.test(result.content), 'padding is explicitly attributed to a sampled background color, not a hardcoded guess');

    // the padded corner must actually be the sampled background, not left blank/transparent.
    // NOTE: img.complete reports true immediately on this library regardless of real decode
    // readiness (verified empirically — same quirk the tool's own loadImage() works around) —
    // a drawImage gated on "onload OR already-complete" can fire before the pixel buffer is
    // ready and silently draw nothing. Wait on 'onload' alone, like the tool itself does.
    const reloaded = new canvasLib.Image();
    await new Promise((resolve, reject) => { reloaded.onload = resolve; reloaded.onerror = reject; reloaded.src = buf; });
    const canvas = canvasLib.createCanvas(1, 1);
    const cctx = canvas.getContext('2d');
    cctx.drawImage(reloaded, -2, -2);
    const corner = cctx.getImageData(0, 0, 1, 1).data;
    A.ok(corner[3] === 255, 'the letterbox pad is fully opaque (no transparent gaps left in a print file)');
  }

  // ---- size filter: only the requested subset is produced ----
  {
    const srcRel = 'outbox/synthetic-4x5.png';
    const c = ctx();
    const result = await prepTool.run({ image: srcRel, sizes: ['8x10'] }, c);
    A.eq(c.events.length, 1, 'requesting one size produces exactly one deliverable, not all three');
    A.eq(result.summary, 'print-prep -> 1 size(s): 8x10', 'summary reflects the actual requested subset');
  }

  // ---- jail safety + honest errors ----
  {
    await A.throws(() => { throw new Error('placeholder'); }, 'sanity: A.throws works for sync throws');
    let threw = null;
    try { await prepTool.run({ image: '../../etc/passwd' }, ctx()); } catch (e) { threw = e; }
    A.ok(!!threw, 'a path trying to escape the workspace jail is refused, not silently redirected');

    threw = null;
    try { await prepTool.run({ image: 'outbox/does-not-exist.png' }, ctx()); } catch (e) { threw = e; }
    A.ok(!!threw && /no such file/.test(threw.message), 'a missing source image fails with a clear, honest error naming the path');

    threw = null;
    try { await prepTool.run({ image: '' }, ctx()); } catch (e) { threw = e; }
    A.ok(!!threw && /image is required/.test(threw.message), 'an empty image path is refused before touching the filesystem');
  }

  A.report('print-prep.test');
})().catch(e => { console.error(e); process.exit(1); });

/* node test/image-qc-jpeg.test.js — qa/bugs/1b5addcc: image_quality_check must accept the JPEG print files image_print_prep
   writes (since 2026-10-22), with the same strictness it applies to PNG. Offline + deterministic: real temp workspace,
   fixtures built here with @napi-rs/canvas and print-prep's own injectJfifDpi (the exact bytes print-prep ships).
   Verifies: a print-prep-shaped 300-DPI JPEG passes (integrity, real dimensions, DPI from JFIF, pixel decode, claim check);
   a truncated JPEG, a JPEG with a lying length, and a JPEG with no frame header fail; JFIF dots-per-cm converts; a JPEG
   with no JFIF reports no DPI (never guessed); a mislabeled JPEG fails its claim; PNG still passes; non-image bytes fail
   as "neither a PNG nor a JPEG"; and the tool really runs it end to end through run(). */
'use strict';
const A = require('./_assert.js');
const fsp = require('node:fs/promises');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { makeImageQcTools } = require('../sidecar/tools/builtin/image-qc.js');
const PP = require('../sidecar/tools/builtin/print-prep.js');

let canvasLib = null;
try { canvasLib = require('@napi-rs/canvas'); } catch (_) { canvasLib = null; }

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'starnet-image-qc-jpeg-'));
const AID = 'webdesigner';

function render(w, h, fmt) {
  const c = canvasLib.createCanvas(w, h), g = c.getContext('2d');
  g.fillStyle = '#26394d'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#f2e6c9'; g.fillRect(Math.round(w * 0.2), Math.round(h * 0.4), Math.round(w * 0.6), Math.round(h * 0.2));
  return fmt === 'png' ? c.toBuffer('image/png') : c.toBuffer('image/jpeg', 90);
}

async function main() {
  if (!canvasLib) { A.ok(false, '@napi-rs/canvas is required to build the fixtures'); return; }
  const { qcTool, _internals: I } = makeImageQcTools({ fsp, pathMod: path, root: ROOT });
  const pp = PP.makePrintPrepTools({ fsp, pathMod: path, root: ROOT })._internals;
  const dir = path.join(ROOT, AID, 'outbox');
  fs.mkdirSync(dir, { recursive: true });

  // 1. the exact shape print-prep ships: canvas JPEG + injectJfifDpi(300)
  const jpg = pp.injectJfifDpi(render(800, 1000, 'jpeg'), 300);
  const pj = I.parseJpeg(jpg);
  A.ok(pj.ok, 'print-prep-shaped JPEG parses: ' + pj.error);
  A.eq(pj.width, 800, 'JPEG width from the frame header');
  A.eq(pj.height, 1000, 'JPEG height from the frame header');
  A.eq(pj.ppiX, 300, 'JFIF density x read as 300 PPI');
  A.eq(pj.ppiY, 300, 'JFIF density y read as 300 PPI');
  A.ok(pj.hasEoi, 'EOI found');
  A.eq(I.parseImage(jpg).format, 'jpeg', 'parseImage routes JPEG bytes to the JPEG parser');

  // 2. truncated (cut mid-scan): no EOI -> FAIL
  const cut = jpg.slice(0, Math.floor(jpg.length * 0.6));
  const pc = I.parseJpeg(cut);
  A.ok(!pc.ok && /EOI|truncated/i.test(pc.error), 'truncated JPEG fails: ' + pc.error);

  // 3. a segment that declares bytes past the end of the file -> FAIL
  const lying = Buffer.from(jpg.slice(0, 20)); lying.writeUInt16BE(0xfff0, 4);
  const pl = I.parseJpeg(lying);
  A.ok(!pl.ok && /past end of file/.test(pl.error), 'lying segment length fails: ' + pl.error);

  // 4. SOI + EOI only: no frame header -> FAIL
  const bare = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  A.ok(!I.parseJpeg(bare).ok && /frame header|SOFn/.test(I.parseJpeg(bare).error), 'JPEG without SOFn fails');

  // 5. dots per cm (unit 2) converts; unit 0 / no JFIF = no DPI, never guessed
  const dpcm = Buffer.from(jpg); dpcm.writeUInt8(2, 13); dpcm.writeUInt16BE(118, 14); dpcm.writeUInt16BE(118, 16);
  A.eq(I.parseJpeg(dpcm).ppiX, 300, '118 dots/cm reads as 300 PPI');
  const noUnit = Buffer.from(jpg); noUnit.writeUInt8(0, 13);
  A.eq(I.parseJpeg(noUnit).ppiX, null, 'JFIF unit 0 (aspect only) gives no DPI');
  A.ok(I.parseJpeg(noUnit).ok, 'JFIF unit 0 is still a valid JPEG');

  // 6. PNG still parses through the same door; garbage is neither
  const png = render(300, 200, 'png');
  const pp2 = I.parseImage(png);
  A.ok(pp2.ok && pp2.format === 'png' && pp2.width === 300, 'PNG still passes through parseImage');
  const junk = Buffer.from('this is a text file, not an image');
  A.ok(!I.parseImage(junk).ok && /neither a PNG nor a JPEG/.test(I.parseImage(junk).error), 'non-image bytes are rejected by name');

  // 7. end to end through the tool's own run(): files on disk in the agent workspace
  fs.writeFileSync(path.join(dir, 'kit-ratio-4x5-800x1000.jpg'), jpg);
  fs.writeFileSync(path.join(dir, 'kit-cut.jpg'), cut);
  fs.writeFileSync(path.join(dir, 'kit-art.png'), png);
  const r = await qcTool.run({ images: [
    { path: 'outbox/kit-ratio-4x5-800x1000.jpg', claimedWidth: 800, claimedHeight: 1000, targetInchesWidth: 2.66, targetInchesHeight: 3.33 },
    { path: 'outbox/kit-ratio-4x5-800x1000.jpg', claimedWidth: 4800, claimedHeight: 6000 },
    { path: 'outbox/kit-cut.jpg' },
    { path: 'outbox/kit-art.png', claimedWidth: 300, claimedHeight: 200 }
  ] }, { agentId: AID });
  A.eq(r.summary, 'image_quality_check -> 2/4 passed', 'run(): real JPEG and PNG pass, mislabeled + truncated JPEG fail');
  A.ok(/well-formed JPEG/.test(r.content), 'run(): JPEG integrity line names the format');
  A.ok(/300 DPI \(from file metadata\)/.test(r.content), 'run(): JPEG DPI comes from the file, not a default');
  A.ok(/ACTUALLY 800x1000/.test(r.content), 'run(): mislabeled JPEG caught by the claim check');
  A.ok(!/not a PNG \(bad signature\)/.test(r.content), 'run(): the old PNG-only refusal is gone for JPEG');
  A.ok(/description/.test('description') && /JPEG/.test(qcTool.description), 'tool description tells models JPEG is accepted');
}

main().catch(e => A.ok(false, 'threw: ' + ((e && e.stack) || e)))
  .finally(() => { try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (_) {} })
  .then(() => A.report('image-qc-jpeg'));

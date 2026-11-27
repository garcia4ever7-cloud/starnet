/* node test/mockup-compose.test.js — the STUDIO mockup skill: mockup_compose. Offline + deterministic
   (real temp workspace, synthetic room template + print file built with @napi-rs/canvas, no live product
   art, no network). Pairs with sidecar/tools/builtin/mockup-compose.js. Verifies: all 5 listing photos
   produced at the right pixel size and under the ~1MB budget, the hero mockup actually places the art
   pixels inside the calibrated frame (not just a room photo with nothing pasted on it), a ratio-mismatch
   between the print file and the template is REFUSED rather than silently distorted, jail safety, a clean
   error on a missing template, and tool metadata (capability/consent). */
'use strict';
const A = require('./_assert.js');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { makeMockupComposeTools } = require('../sidecar/tools/builtin/mockup-compose.js');

const ROOT = path.join(os.tmpdir(), 'starnet-mockup-compose-test-' + process.pid);
const AID = 'webdesigner';

let canvasLib;
try { canvasLib = require('@napi-rs/canvas'); } catch (_) { canvasLib = null; }

function ctx() { const events = []; return { agentId: AID, room: 'office', emit: (name, payload) => events.push({ name, payload }), events }; }

async function writeFile(relPath, buf) {
  const abs = path.join(ROOT, AID, relPath);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, buf);
  return abs;
}

// a plain-colored source so a pixel sample can prove "did the art actually get drawn here"
async function makeFlatPng(w, h, hex) {
  const canvas = canvasLib.createCanvas(w, h);
  const c = canvas.getContext('2d');
  c.fillStyle = hex; c.fillRect(0, 0, w, h);
  return canvas.encode('png');
}

(async () => {
  try { await fsp.rm(ROOT, { recursive: true, force: true }); } catch (_) {}
  await fsp.mkdir(ROOT, { recursive: true });

  if (!canvasLib) {
    const { composeTool } = makeMockupComposeTools({ fsp, pathMod: path, root: ROOT });
    try {
      await composeTool.run({ print_file: 'outbox/x.png', product_name: 'X' }, ctx());
      A.ok(false, 'must refuse when @napi-rs/canvas is unavailable, not silently no-op');
    } catch (e) { A.ok(/canvas failed to load/.test(e.message), 'the refusal names the real cause'); }
    A.report('mockup-compose.test (canvas unavailable on this platform)');
    return;
  }

  const { composeTool } = makeMockupComposeTools({ fsp, pathMod: path, root: ROOT });

  // ---- tool metadata ----
  A.eq(composeTool.name, 'mockup_compose', 'tool name matches the capability-registry grant');
  A.eq(composeTool.capability, 'studio', 'rides the existing studio capability');
  A.eq(composeTool.scope, 'write', 'publishes new files — write scope');
  A.eq(composeTool.requiresConsent, true, 'consent-gated like its sibling studio write tools');

  // ---- fixtures: a 1000x1200 room (room-blue #204060) with a WHITE frame rectangle at known corners,
  //      and a 4:5 solid-red print file (so "is the art visible at the frame location" is a pixel check) ----
  const ROOM_W = 1000, ROOM_H = 1200;
  const roomCanvas = canvasLib.createCanvas(ROOM_W, ROOM_H);
  const rc = roomCanvas.getContext('2d');
  rc.fillStyle = '#204060'; rc.fillRect(0, 0, ROOM_W, ROOM_H);
  const TL = [300, 300], TR = [700, 300], BL = [300, 900];   // a perfectly axis-aligned 400x600 (2:3-ish) rect — simple to verify
  rc.fillStyle = '#ffffff'; rc.fillRect(TL[0], TL[1], TR[0] - TL[0], BL[1] - TL[1]);
  const roomBuf = await roomCanvas.encode('png');
  await writeFile('outbox/mockup-templates/test-room.png', roomBuf);
  await writeFile('outbox/mockup-templates/test-room.json', Buffer.from(JSON.stringify({
    room: 'test-room.png', ratio: '2:3', topLeft: TL, topRight: TR, bottomLeft: BL
  })));

  const printBuf = await makeFlatPng(800, 1200, '#cc2222');   // true 2:3
  await writeFile('outbox/kit/print-ratio-2x3-800x1200.png', printBuf);

  // ---- 1. a correct call produces all 5 outputs, each at the requested size and under the ~1MB budget ----
  const r = await composeTool.run({ print_file: 'outbox/kit/print-ratio-2x3-800x1200.png', product_name: 'Test Verse 1:1' }, ctx());
  A.ok(/mockup_compose -> 5 listing photo/.test(r.summary), 'reports exactly 5 listing photos made');
  const keys = ['hero-mockup', 'print-alone', 'sizes-chart', 'lettering-closeup', 'what-you-get'];
  for (const key of keys) {
    const rel = 'outbox/kit/listing-photos/print-ratio-2x3-800x1200-' + key + '.jpg';
    const abs = path.join(ROOT, AID, rel);
    const st = await fsp.stat(abs);
    A.ok(st.size > 0 && st.size <= 1024 * 1024, key + ': file exists and is under the ~1MB budget (' + st.size + ' bytes)');
    const buf = await fsp.readFile(abs);
    const img = new canvasLib.Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = buf; });
    A.eq([img.width, img.height], [2000, 2000], key + ': default shape is square 2000x2000');
  }
  // ---- 2. the hero mockup ACTUALLY pastes the art at the calibrated frame — not just a bare room photo ----
  {
    const heroAbs = path.join(ROOT, AID, 'outbox/kit/listing-photos/print-ratio-2x3-800x1200-hero-mockup.jpg');
    const img = new canvasLib.Image(); img.src = await fsp.readFile(heroAbs);
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
    const probe = canvasLib.createCanvas(img.width, img.height);
    const pctx = probe.getContext('2d');
    pctx.drawImage(img, 0, 0);
    // center of the calibrated frame, in ROOM-native pixels: (500, 600) of 1000x1200 -> scale to the
    // 2000x2000 output the same cover-fit renderHero used (room is taller than square -> width-fit).
    const scale = 2000 / ROOM_W, offY = (2000 - ROOM_H * scale) / 2;
    const px = Math.round(500 * scale), py = Math.round(600 * scale + offY);
    const [pr, pg, pb] = pctx.getImageData(px, py, 1, 1).data;
    A.ok(pr > 150 && pg < 100 && pb < 100, 'the frame center reads as the RED art (' + [pr, pg, pb].join(',') + '), not the blue room or white blank frame');
    // a point OUTSIDE the frame (room corner) must still read as the untouched room blue
    const [or_, og, ob] = pctx.getImageData(10, 10, 1, 1).data;
    A.ok(or_ < 100 && og < 100 && ob > 60, 'outside the frame the room photo is untouched (' + [or_, og, ob].join(',') + ')');
  }

  // ---- 3. a ratio mismatch is REFUSED, not silently distorted ----
  {
    const squarePrintBuf = await makeFlatPng(900, 900, '#22cc22');   // 1:1, template wants 2:3
    await writeFile('outbox/kit/print-square-900x900.png', squarePrintBuf);
    let refused = false;
    try { await composeTool.run({ print_file: 'outbox/kit/print-square-900x900.png', product_name: 'X' }, ctx()); }
    catch (e) { refused = /does not match/.test(e.message) && /no distortion applied/.test(e.message); }
    A.ok(refused, 'a print file whose ratio does not match the template is refused with an honest reason, not stretched');
  }

  // ---- 4. a missing template gives a clear, actionable error ----
  {
    const emptyRoot = path.join(os.tmpdir(), 'starnet-mockup-compose-notemplate-' + process.pid);
    await fsp.rm(emptyRoot, { recursive: true, force: true }).catch(() => {});
    const { composeTool: compose2 } = makeMockupComposeTools({ fsp, pathMod: path, root: emptyRoot });
    const abs2 = path.join(emptyRoot, AID, 'outbox/x.png');
    await fsp.mkdir(path.dirname(abs2), { recursive: true });
    await fsp.writeFile(abs2, await makeFlatPng(100, 100, '#000000'));
    let threw = false;
    try { await compose2.run({ print_file: 'outbox/x.png', product_name: 'X' }, ctx()); }
    catch (e) { threw = /generate at least one room template first/.test(e.message); }
    A.ok(threw, 'no templates in the workspace -> a clear, actionable error naming the fix');
    await fsp.rm(emptyRoot, { recursive: true, force: true }).catch(() => {});
  }

  // ---- 5. jail escape on print_file is refused ----
  {
    let escaped = false;
    try { await composeTool.run({ print_file: '../../etc/passwd', product_name: 'X' }, ctx()); }
    catch (e) { escaped = true; }
    A.ok(escaped, 'a path-escaping print_file is refused by the fs jail');
  }

  // ---- 6. "4x3" shape produces 2700x2025 outputs instead of the square default ----
  {
    const r2 = await composeTool.run({ print_file: 'outbox/kit/print-ratio-2x3-800x1200.png', product_name: 'Test Verse 1:1', shape: '4x3', out_dir: 'outbox/kit/listing-photos-4x3' }, ctx());
    A.ok(/mockup_compose -> 5 listing photo/.test(r2.summary), '4x3 shape also produces all 5 photos');
    const abs = path.join(ROOT, AID, 'outbox/kit/listing-photos-4x3/print-ratio-2x3-800x1200-print-alone.jpg');
    const img = new canvasLib.Image(); img.src = await fsp.readFile(abs);
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
    A.eq([img.width, img.height], [2700, 2025], 'shape:"4x3" -> 2700x2025, per etsy-rules §5');
  }

  A.report('mockup-compose.test');
})().catch(e => { console.error(e); process.exit(1); });

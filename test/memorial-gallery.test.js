/* test/memorial-gallery.test.js — the gallery engine end to end, on a film small enough for the gate.
 *
 * WHY IT EXISTS (2026-11-24). memorial/gallery.mjs is the path a paying order takes: prep →
 * faces → scenes → plates → audit → segments → join → music → QC. Each stage below is checked
 * on what it PRODUCED, not on what it was asked to do:
 *
 *  - a phone photo stored sideways (EXIF Orientation 6) is seen as the portrait it is, and is
 *    therefore not cropped. ffprobe reports such a file's STORED size; the classic engine took
 *    its crop decision from that and would have cut the head off.
 *  - the face detector finds the faces in a real picture, and finds none in a picture of nothing
 *  - "detector found nothing" stays UNKNOWN (no crop); only the operator can declare a photo empty
 *  - a film whose plan would cut a face is refused before anything is rendered
 *  - a second render reuses every segment; changing one caption re-renders exactly one
 *  - the finished file passes the quality gate, and a file with a planted defect does not
 *  - the music bed is exactly as long as the film and lands on the loudness target
 *
 * Renders at 320x180 with no oversampling, so the live part takes well under a minute.
 * Run standalone: node test/memorial-gallery.test.js */
'use strict';
const A = require('./_assert.js');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

process.env.MEMORIAL_OVERSAMPLE = '1';
const M = f => pathToFileURL(path.join(__dirname, '..', 'memorial', f)).href;
const FIX = path.join(__dirname, 'fixtures', 'memorial');

function have(bin) { try { execFileSync(bin, ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } }
const ff = (args) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'ignore', timeout: 120000 });

/* A minimal JPEG APP1/EXIF segment carrying only Orientation. Spliced in after SOI so the test
 * needs no image library to make a "phone photo held upright, stored sideways". */
function withOrientation(jpeg, orientation) {
  const tiff = Buffer.from([
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08,             // big-endian TIFF, IFD0 at 8
    0x00, 0x01,                                                 // one entry
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation, 0x00, 0x00,   // Orientation SHORT
    0x00, 0x00, 0x00, 0x00,                                     // no next IFD
  ]);
  const body = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const head = Buffer.alloc(4);
  head.writeUInt16BE(0xffe1, 0); head.writeUInt16BE(body.length + 2, 2);
  return Buffer.concat([jpeg.subarray(0, 2), head, body, jpeg.subarray(2)]);
}

(async () => {
  const G = await import(M('gallery.mjs'));
  const F = await import(M('faces.mjs'));
  const L = await import(M('layouts.mjs'));
  const Au = await import(M('audio.mjs'));

  /* ---------- 1. order validation: wrong orders fail loudly, before any file is opened ---------- */
  const base = () => ({ orderId: 'v', style: 'gallery', subject: { name: 'A B' }, photos: [{ file: 'a.jpg' }, { file: 'b.jpg' }], cards: [{ at: 'open', type: 'title' }] });
  A.notThrows(() => G.validateGalleryOrder(base()), 'a minimal gallery order is valid');
  const bad = (edit, msg) => A.throws(() => { const o = base(); edit(o); G.validateGalleryOrder(o); }, msg);
  bad(o => { o.photos = []; }, 'no photos is refused');
  bad(o => { o.photos[0].layout = 'mosaic'; }, 'an unknown layout is refused');
  bad(o => { o.photos[0].actBreak = 'yes'; }, 'actBreak: "yes" is refused');
  bad(o => { o.photos[0].faces = [[10, 10, 200, 200]]; }, 'faces in pixels are refused');
  bad(o => { o.cards.push({ type: 'verse', after: 1 }); }, 'a verse with no text is refused');
  bad(o => { o.cards.push({ type: 'verse', text: 'x', after: 7 }); }, 'a card after a photo that does not exist is refused (it used to vanish silently)');
  bad(o => { o.cards.push({ type: 'verse', text: 'x' }); }, 'a card with no position is refused');
  bad(o => { o.cards.push({ type: 'chapter', after: 1 }); }, 'a chapter with no title is refused');
  bad(o => { delete o.subject; }, 'a title card with no name is refused');
  bad(o => { o.background = 'no-such-background'; }, 'an unknown background is refused');
  bad(o => { o.cards[0].portrait = 3; }, 'a portrait card naming a photo that does not exist is refused');
  bad(o => { o.cards.push({ type: 'chapter', title: 'X', after: 1, portrait: 1 }); }, 'portrait on a chapter card is refused');
  A.notThrows(() => { const o = base(); o.cards[0].portrait = 2; G.validateGalleryOrder(o); }, 'portrait: <photo number> on a title card is valid');

  /* ---------- 1b. portrait card: faces must sit in the solid centre of the faded photo ---------- */
  {
    const P = await import(M('plates.mjs'));
    A.eq(P.portraitAlpha(0.5, 0.5), 1, 'portrait centre is fully opaque');
    A.eq(P.portraitAlpha(0, 0.5), 0, 'portrait side edge is fully faded');
    A.ok(P.portraitAlpha(0.5, 0.06) < 0.5, 'near the top edge the photo is mostly faded');
    const face = { x0: 0.40, y0: 0.30, x1: 0.60, y1: 0.50 };
    const whole = { x: 0, y: 0, w: 1, h: 1 };
    A.ok(G.faceOpacity(face, whole) >= 0.98, 'a centred face is fully opaque');
    A.ok(G.faceOpacity({ x0: 0.40, y0: 0.0, x1: 0.60, y1: 0.12 }, whole) < 0.5, 'a face at the top edge would be faded — measured, not assumed');
    A.eq(G.portraitCrop({ w: 1000, h: 1250, faces: null }).ok, false, 'unknown faces: no portrait crop (the fade could hide an unmarked face)');
    const topFace = { w: 1792, h: 2240, faces: [{ x0: 0.295, y0: 0.095, x1: 0.563, y1: 0.309 }] };
    const pc = G.portraitCrop(topFace);
    A.ok(pc.ok, 'a face near the top of a tall photo gets a crop that zooms in: ' + pc.reason);
    A.ok(pc.ok && G.faceOpacity(topFace.faces[0], pc) >= 0.98, 'and in that crop the face is fully opaque');
    A.ok(pc.ok && pc.w * topFace.w >= G.PORTRAIT_MIN_PX - 1e-6, 'the crop never narrows below PORTRAIT_MIN_PX of the original');
    const apart = { w: 3000, h: 2000, faces: [{ x0: 0.02, y0: 0.4, x1: 0.12, y1: 0.55 }, { x0: 0.88, y0: 0.4, x1: 0.98, y1: 0.55 }] };
    A.eq(G.portraitCrop(apart).ok, false, 'two faces at opposite edges cannot both be in the solid centre — refused, not faded');
    /* the write-on: a layer with `wipe` gets a sliding mask; a plain layer keeps its fade */
    const plan = { w: 1920, h: 1080, fps: 30 };
    const item = { hold: 7, motion: { kind: 'still', amp: 0 }, layers: [{ at: 0.6, fade: 1 }, { at: 1.3, fade: 0, wipe: { dur: 2.3, x0: 900, x1: 1700 } }] };
    const g = G.segmentGraph(item, plan, 1);
    A.ok(/\[1:v\][^;]*fade=t=in:st=0\.600/.test(g), 'a plain layer still fades in');
    A.ok(/alphamerge\[l1\]/.test(g) && /crop=1920:1080:x='1182-962\*clip\(\(t-1\.300\)\/2\.300,0,1\)'/.test(g), 'a wipe layer is written on by a mask sliding from x0 to x1');
    const plain = G.segmentGraph({ hold: 5, motion: { kind: 'still', amp: 0 }, layers: [{ at: 0.45, fade: 1.2 }] }, plan, 1);
    A.ok(!/alphamerge|geq/.test(plain), 'a card without a wipe layer has the same graph shape as before (no mask chain)');

    /* ---------- 1c. per-card backgrounds, the dawn set, light cards, the portrait's edge (2026-11-25) ---------- */
    bad(o => { o.cards[0].background = 'no-such-background'; }, 'a card naming an unknown background is refused');
    A.notThrows(() => { const o = base(); o.cards[0].background = 'lead-the-way-sunrise'; G.validateGalleryOrder(o); }, 'a card may name its own background');
    A.ok(P.BACKGROUND_SETS.dawn.length === 4 && P.BACKGROUND_SETS.dawn.every(n => P.backgroundPath(n)), 'the dawn set: four backgrounds, every file present');
    const { createCanvas } = require('@napi-rs/canvas');
    const ptmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-portrait-'));
    try {
      /* A uniformly dark photo: any brightening is the edge light, so it is measurable. */
      const pc0 = createCanvas(400, 500); const px0 = pc0.getContext('2d');
      px0.fillStyle = 'rgb(20,20,20)'; px0.fillRect(0, 0, 400, 500);
      const pf = path.join(ptmp, 'dark.png'); fs.writeFileSync(pf, pc0.toBuffer('image/png'));
      const w = 640, h = 360;
      const r = await P.renderCardPlates({ type: 'title' }, { name: 'A B', born: '1950', died: '2020' },
        { w, h, theme: 'dawn', background: P.backgroundPath('lead-the-way-sunrise'), portrait: { file: pf, crop: { x: 0, y: 0, w: 1, h: 1 } } });
      A.eq([r.layers[0].at, r.layers[0].fade], [P.PORTRAIT_IN.at, P.PORTRAIT_IN.fade], 'the portrait is its own layer and rises after the landscape is seen alone');
      const { loadImage } = require('@napi-rs/canvas');
      const li = await loadImage(r.layers[0].png); const lc = createCanvas(w, h); const lx = lc.getContext('2d'); lx.drawImage(li, 0, 0);
      const at = (u, v) => { const X = Math.floor((P.PORTRAIT.x + u * P.PORTRAIT.w) * w), Y = Math.floor((P.PORTRAIT.y + v * P.PORTRAIT.h) * h); return [...lx.getImageData(X, Y, 1, 1).data]; };
      A.eq(at(0.5, 0.45), [20, 20, 20, 255], 'the opaque core (where faces are proven to sit) is untouched by the edge light');
      let edge = null; for (let u = 0.5; u < 1; u += 0.002) { const a = P.portraitAlpha(u, 0.5); if (a < 1 && a >= 0.98) { edge = at(u, 0.5); break; } }
      A.eq(edge && edge.slice(0, 3), [20, 20, 20], 'where opacity is 0.98–1 (a face edge may sit there) the colour is untouched too — the first version lightened it ~12%');
      let lit = null; for (let u = 0.5; u < 1; u += 0.005) { if (P.portraitAlpha(u, 0.5) < 0.6 && P.portraitAlpha(u, 0.5) > 0.3) { lit = at(u, 0.5); break; } }
      A.ok(lit && lit[0] > 120, 'in the fade zone a dark photo brightens toward the light instead of leaving a smudge: ' + JSON.stringify(lit));
      const lum = async (buf) => { const im = await loadImage(buf); const c = createCanvas(64, 36); const x = c.getContext('2d'); x.drawImage(im, 0, 0, 64, 36); const d = x.getImageData(0, 0, 64, 36).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2]; return s / (d.length / 4) / 3; };
      const chap = { type: 'chapter', title: 'Family' };
      const bgRiver = P.backgroundPath('lead-the-way-river');
      const dark = await lum((await P.renderCardPlates(chap, {}, { w, h, theme: 'warm', background: bgRiver })).base);
      const light = await lum((await P.renderCardPlates(chap, {}, { w, h, theme: 'dawn', background: bgRiver })).base);
      A.ok(light > dark + 40, `dawn cards are light cards (mean luma ${light.toFixed(0)} vs warm ${dark.toFixed(0)} on the same background)`);
    } finally { fs.rmSync(ptmp, { recursive: true, force: true }); }
  }

  /* ---------- 2. resolveFaces: unknown is not "none" ---------- */
  A.eq(F.resolveFaces(undefined, []).faces, null, 'detector found nothing → faces are UNKNOWN (null), never "none"');
  A.eq(F.resolveFaces(undefined, []).source, 'unknown', 'and the source says so');
  A.eq(F.resolveFaces([], [{ x0: 0.1, y0: 0.1, x1: 0.2, y1: 0.2 }]).faces, [], 'operator [] overrides the detector: the photo is declared face-free');
  A.eq(F.resolveFaces(undefined, [{ x0: 0.1, y0: 0.1, x1: 0.2, y1: 0.2, score: 50, angle: 0 }]).source, 'detector', 'detected faces are labelled as detector output');

  /* ---------- 2b. screenshot bars: trimmed only when unmistakable ---------- */
  {
    const Pr = await import(M('prep.mjs'));
    const mk = (w, h, fn) => { const pixels = Buffer.alloc(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) pixels[y * w + x] = fn(x, y); return { pixels, width: w, height: h }; };
    const noise = (x, y) => 60 + ((x * 37 + y * 91) % 140);
    const bars = Pr.solidBands(mk(200, 300, (x, y) => (y < 30 || y >= 270) ? 0 : noise(x, y)));
    A.ok(bars && Math.abs(bars.y - 31 / 300) < 1e-9 && Math.abs(bars.h - (300 - 62) / 300) < 1e-9 && bars.x === 0 && bars.w === 1, 'solid black bars above and below a picture are trimmed, and only them');
    A.eq(Pr.solidBands(mk(200, 300, noise)), null, 'a picture with no bars is left alone');
    A.eq(Pr.solidBands(mk(200, 300, (x, y) => y < 30 ? (x % 50 === 0 ? 200 : 4) : noise(x, y))), null, 'a dark band with real detail in it is NOT a bar (2% of its pixels are bright)');
    A.eq(Pr.solidBands(mk(200, 300, (x, y) => y < 5 ? 0 : noise(x, y))), null, 'a band thinner than 3% of the side is left alone');
    const eleven = Pr.solidBands(mk(200, 300, (x, y) => y < 20 ? 11 : noise(x, y)));
    A.ok(eleven && Math.abs(eleven.y - 21 / 300) < 1e-9, 'a flat band of value 11 — a real screenshot bar seen 2026-11-24 — is trimmed (a fixed "<= 10" threshold missed it)');
    A.eq(Pr.solidBands(mk(200, 300, (x, y) => y < 40 ? ((x * 7 + y * 13) % 23) : noise(x, y))), null, 'a dark but NOISY region (a night sky) is not a bar');
    A.eq(Pr.solidBands(mk(200, 300, (x, y) => Math.min(255, Math.floor(y * 0.9)))), null, 'a smooth dark-to-light gradient has no hard edge and is not trimmed');
    /* A studio portrait: flat black backdrop at both sides, a "subject" widening down the middle. */
    const studio = mk(300, 300, (x, y) => (Math.abs(x - 150) < 20 + y * 0.25) ? noise(x, y) : 3);
    A.eq(Pr.solidBands(studio), null, 'a subject on a flat black backdrop is NOT trimmed — the black is part of the photograph');
    A.eq(Pr.solidBands(mk(200, 300, (x, y) => (y < 100 || y >= 200) ? 0 : noise(x, y))), null, 'bars that would remove more than 45% of the file are left alone — that is a dark photo, not a screenshot');
    const white = Pr.solidBands(mk(300, 200, (x, y) => (x < 40) ? 255 : noise(x, y)));
    A.ok(white && white.x > 0.13 && white.y === 0, 'a solid white side band is trimmed too');
  }

  if (!have('ffmpeg') || !have('ffprobe')) {
    console.log('SKIP: ffmpeg/ffprobe unavailable — live gallery render not run');
    A.report('memorial-gallery');
    return;
  }

  /* ---------- 3. the detector, on real pictures ---------- */
  {
    const one = await F.detectFaces(path.join(FIX, 'face-portrait.jpg'));
    A.eq(one.length, 1, 'one face found in the single-portrait fixture');
    if (one.length) A.ok(one[0].x0 > 0.25 && one[0].x1 < 0.75 && one[0].y0 > 0.2 && one[0].y1 < 0.7, `and it is where the face is (${[one[0].x0, one[0].y0, one[0].x1, one[0].y1].map(v => v.toFixed(2)).join(', ')})`);
    const four = await F.detectFaces(path.join(FIX, 'faces-group.jpg'));
    A.eq(four.length, 4, 'four faces found in the group fixture');
    A.ok(four.every((f, i) => i === 0 || f.x0 >= four[i - 1].x0), 'faces are reported left to right (stable order)');
  }

  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-gallery-'));
  const BIZ = path.join(TMP, 'biz');
  process.env.MEMORIAL_BUSINESS_ROOT = BIZ;
  try {
    /* ---------- fixtures: pictures with nobody in them, a sideways phone photo, a music bed ---------- */
    /* Deterministic pictures: a fixed diagonal gradient with fixed-seed grain. (ffmpeg's
     * `gradients` source picks random geometry unless every parameter is pinned, which made
     * an earlier version of this test pass or fail by chance.) */
    const grad = (size, c0, c1 = '0x505860') => { const [w, h] = size.split('x'); return `gradients=s=${size}:c0=${c0}:c1=${c1}:x0=0:y0=0:x1=${w}:y1=${h}:nb_colors=2:seed=7:type=linear,noise=alls=6:all_seed=11`; };
    const pic = (name, size, colour) => { const f = path.join(TMP, name); ff(['-f', 'lavfi', '-i', grad(size, colour), '-frames:v', '1', f]); return f; };
    const land = pic('land.png', '1500x1000', '0xc8b090');
    const wide = pic('wide.png', '1600x900', '0x90b0c8');
    const tall = pic('tall.png', '900x1400', '0xb0c890');
    /* Stored 1200x800 (landscape), displayed 800x1200 (portrait). */
    const storedLandscape = path.join(TMP, 'stored.jpg');
    ff(['-f', 'lavfi', '-i', grad('1200x800', '0xd0a0a0'), '-frames:v', '1', '-q:v', '3', storedLandscape]);
    const sideways = path.join(TMP, 'sideways.jpg');
    fs.writeFileSync(sideways, withOrientation(fs.readFileSync(storedLandscape), 6));
    const bed = path.join(TMP, 'bed.wav');
    ff(['-f', 'lavfi', '-i', 'sine=frequency=220:duration=8,volume=0.2', '-ac', '2', '-ar', '48000', bed]);

    A.eq(await F.detectFaces(land), [], 'no face is found in a picture with nobody in it');

    /* ---------- 4. prep: the sideways phone photo is a portrait ---------- */
    const { prepPhoto } = await import(M('prep.mjs'));
    const stored = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', sideways]).toString().trim();
    A.eq(stored, '1200,800', 'ffprobe reports the sideways photo by its STORED size, 1200x800 (the trap)');
    const pp = await prepPhoto(sideways, path.join(TMP, 'prep'), 0);
    A.eq([pp.w, pp.h], [800, 1200], 'prep sees it as displayed: 800x1200, a portrait');
    A.eq(L.orientationOf(pp.w, pp.h), 'portrait', 'so the planner is told "portrait"');
    const again = await prepPhoto(sideways, path.join(TMP, 'prep'), 0);
    A.ok(again.reused, 'an unchanged photo is not prepared twice');
    /* The same trap in the ORIGINAL engine: its fit decision must use the decoded size too. */
    const R = await import(M('render.mjs'));
    const Fit = await import(M('fit.mjs'));
    const dim = await R.probeImage(sideways);
    A.eq([dim.w, dim.h], [800, 1200], 'classic engine: probeImage reports the decoded 800x1200, not the stored 1200x800');
    A.eq(Fit.planFit(dim.w, dim.h, 1920, 1080).strategy, 'pad', 'classic engine: so the sideways portrait is padded, never cropped');
    A.eq(Fit.planFit(1200, 800, 1920, 1080).strategy, 'crop', '(taken from the stored size, the same photo WOULD have been cropped — the defect)');

    /* A screenshot with baked-in black bars loses them in prep, and says so. */
    const shot = path.join(TMP, 'screenshot.png');
    ff(['-f', 'lavfi', '-i', grad('600x700', '0xd0c0a0'), '-vf', 'pad=600:1000:0:150:black', '-frames:v', '1', shot]);
    const ps = await prepPhoto(shot, path.join(TMP, 'prep'), 1);
    A.ok(ps.trimmed && ps.h < 720 && ps.h > 680 && ps.w === 600, `screenshot bars are trimmed in prep (600x1000 → ${ps.w}x${ps.h})`);
    const keepBars = await prepPhoto(shot, path.join(TMP, 'prep'), 2, { trim: false });
    A.eq([keepBars.w, keepBars.h, keepBars.trimmed], [600, 1000, null], '"trim": false leaves the file exactly as sent');

    /* ---------- 5. plan + render ---------- */
    const order = (edit) => {
      const o = {
        orderId: 'gal-live', style: 'gallery', theme: 'warm', outputRoot: path.join(TMP, 'render'),
        subject: { name: 'Test Person', born: '1940-01-01', died: '2026-01-01' },
        music: { file: bed, licence: 'synthetic sine tone made by this test' },
        photos: [
          { file: sideways, caption: 'A sideways phone photo' },
          { file: tall },
          { file: land, faces: [[0.42, 0.30, 0.58, 0.56]] },
          { file: wide, faces: [] },
          { file: land, actBreak: true, motion: 'still' },
        ],
        cards: [
          { at: 'open', type: 'title', hold: 2.5 },
          { after: 2, type: 'verse', ref: 'Psalm 23:1', translation: 'KJV', text: 'The LORD is my shepherd; I shall not want.', reveal: false, hold: 2.5 },
          { at: 'close', type: 'closing', hold: 2.5 },
        ],
        hold: 2.4, xfade: 0.6,
      };
      if (edit) edit(o);
      return o;
    };
    const logs = [];
    const res = await G.renderGallery(order(), { height: 180, log: m => logs.push(m) });
    const rep = res.report;
    const scenes = rep.items.filter(i => i.kind === 'scene');
    A.ok(res.ok && fs.existsSync(res.path), 'the film renders');
    A.eq(scenes.map(s => s.layout), ['pair', 'full', 'full', 'full'], 'scenes: the two upright photos pair; the three landscapes fill the frame');
    A.eq(scenes[0].crop, 0, 'the sideways phone photo is shown WHOLE (crop 0%) — not cropped as the 1200x800 landscape it is stored as');
    A.eq(rep.photos.map(p => p.faceSource), ['unknown', 'unknown', 'operator', 'operator', 'unknown'], 'face sources: nothing found → unknown; marked → operator; [] → operator');
    A.eq(rep.photos.map(p => p.faces), [null, null, 1, 0, null], 'face counts recorded (null = unknown)');
    A.eq(rep.auditFailed, 0, 'every placement check in the plan passes');
    A.ok(rep.audit.some(a => a.check === 'crop-keeps-faces' && a.ok && /operator/.test(a.detail)), 'the audit names the crop that relied on the operator-marked face');
    A.ok(rep.audit.filter(a => a.check === 'text-safe').every(a => a.ok), 'every card and caption is inside title-safe');
    A.ok(Math.abs(res.durationSec - res.targetSec) < 0.1, `the film is as long as planned (${res.durationSec.toFixed(2)} vs ${res.targetSec.toFixed(2)} s)`);
    A.eq(rep.items.filter(i => i.actBreak).length, 1, 'one act break in the plan');
    A.eq(rep.items[rep.items.length - 2].motion.kind, 'still', 'motion: "still" is honoured');
    A.eq(rep.music[0].tier, 'operator', 'the operator-supplied music is recorded as such, with its licence');
    A.ok(fs.existsSync(res.path.replace(/\.mp4$/, '.report.json')), 'a render report is written beside the film');

    /* ---------- 6. the quality gate, on the real output ---------- */
    const Q = await import(M('qc.mjs'));
    const q = await Q.qcFilm(res.path, { plan: res.plan, report: rep, expectAudio: true, gallery: true });
    if (!q.ok) console.log(Q.formatQc(q));
    A.ok(q.ok, `the finished film passes the quality gate (failed: ${q.failed.join(', ') || 'none'})`);
    const by = n => q.checks.find(c => c.name === n);
    A.ok(by('colour-bt709') && by('colour-bt709').ok, 'colour: tagged BT.709 limited range on all four fields');
    A.ok(by('faststart') && by('faststart').ok, 'the file plays from its first byte (moov before mdat)');
    A.ok(by('act-breaks-dip') && by('act-breaks-dip').ok && /1 act break/.test(by('act-breaks-dip').detail), 'the act break measurably reaches black');
    A.ok(by('no-stray-black').ok && by('no-hard-cuts').ok && by('no-frozen-picture').ok, 'no stray black, no hard cut, no freeze outside the designed still');
    A.ok(by('loudness').ok && by('true-peak').ok, `loudness on target (${by('loudness').detail})`);
    A.ok(by('av-length').ok, 'music and picture are the same length');
    A.ok(q.warnings.includes('faces-reviewed'), 'QC warns that no person has reviewed the faces');
    A.ok(by('music-licence') && by('music-licence').ok, 'the music licence is on record');

    /* A defect planted in a copy must be caught. */
    const broken = path.join(TMP, 'broken.mp4');
    ff(['-i', res.path, '-filter_complex', '[0:v]trim=0:3,setpts=PTS-STARTPTS[a];[0:v]trim=8:10,setpts=PTS-STARTPTS[b];color=black:s=320x180:r=30:d=1.2,format=yuv420p[k];[a][k][b]concat=n=3:v=1:a=0[v]', '-map', '[v]', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', broken]);
    const qb = await Q.qcFilm(broken, { plan: res.plan, report: rep, expectAudio: true, gallery: true });
    A.ok(!qb.ok, 'a copy with planted defects fails the gate');
    A.ok(qb.failed.includes('no-stray-black') && qb.failed.includes('no-hard-cuts'), `it is failed for the right reasons (${qb.failed.join(', ')})`);
    A.ok(qb.failed.includes('audio-stream'), 'and for the missing sound');

    /* ---------- 7. resume: nothing is re-rendered without a reason ---------- */
    const logs2 = [];
    const res2 = await G.renderGallery(order(), { height: 180, log: m => logs2.push(m) });
    A.eq(res2.reusedSegments, res2.segments, `a second render reuses every segment (${res2.reusedSegments}/${res2.segments})`);
    A.ok(logs2.some(l => /reuse existing join/.test(l)), 'and the join');

    const logs3 = [];
    const res3 = await G.renderGallery(order(o => { o.photos[0].caption = 'A corrected caption'; }), { height: 180, log: m => logs3.push(m) });
    A.eq(res3.segments - res3.reusedSegments, 1, 'changing one caption re-renders exactly one segment');
    A.ok(!logs3.some(l => /reuse existing join/.test(l)), 'and rebuilds the join — a corrected caption cannot be silently dropped');

    const res4 = await G.renderGallery(order(o => { o.photos[0].caption = 'A corrected caption'; }), { height: 180, force: true, log: () => {} });
    A.eq(res4.reusedSegments, 0, '--force re-renders everything');

    /* ---------- 8. a plan that would cut a face is refused outright ---------- */
    {
      /* Faces at the far left and far right of a square photo cannot both survive a 16:9 crop;
       * the planner frames it instead — so the operator's "full" is refused, not obeyed. */
      const sq = pic('square.png', '1200x1200', '0xa0a0d0');
      const r = await G.planGallery(order(o => {
        o.orderId = 'gal-refuse'; o.outputRoot = path.join(TMP, 'refuse');
        o.photos = [{ file: sq, layout: 'full', faces: [[0.35, 0.02, 0.6, 0.2], [0.35, 0.78, 0.6, 0.97]] }, { file: land }];
        o.cards = [];
      }), { height: 180 });
      const first = r.report.items[0];
      A.eq(first.layout, 'framed', 'operator "full" on a photo whose faces cannot fit → shown whole');
      A.eq(first.crop, 0, 'with no crop at all');
      A.eq(r.report.auditFailed, 0, 'and the plan still passes its audit');
    }

    /* ---------- 8b. a caption is never silently cut ---------- */
    {
      let threw = null;
      try {
        await G.planGallery(order(o => {
          o.orderId = 'gal-caption'; o.outputRoot = path.join(TMP, 'caption');
          o.photos[0].caption = 'This caption goes on and on, '.repeat(14);
        }), { height: 180 });
      } catch (e) { threw = e; }
      A.ok(threw && /caption is too long/.test(threw.message), 'a caption too long for two lines stops the order with a message — it is not truncated');
    }

    /* ---------- 8c. narration: voice over the music, or voice alone ---------- */
    {
      const voice = path.join(TMP, 'voice.wav');
      ff(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=5,volume=0.3', '-ac', '1', '-ar', '48000', voice]);
      const probeAudio = f => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', f]).toString()).streams.filter(x => x.codec_type === 'audio');
      const small = (id, music) => order(o => {
        o.orderId = id; o.outputRoot = path.join(TMP, id);
        o.photos = [{ file: land }, { file: wide, faces: [] }]; o.cards = [];
        o.narration = { file: voice }; o.music = music;
      });
      const both = await G.renderGallery(small('gal-narr', { file: bed, licence: 'synthetic' }), { height: 180, log: () => {} });
      A.eq(both.audio, 'bed+narration', 'narration with music → both are mixed');
      A.eq(probeAudio(both.path).length, 1, 'and the film has one audio stream');
      A.ok(Math.abs(both.durationSec - both.targetSec) < 0.15, 'at the planned length');
      const alone = await G.renderGallery(small('gal-voice', 'none'), { height: 180, log: () => {} });
      A.eq(alone.audio, 'narration', 'narration with no music → the voice alone (the classic engine delivered this SILENT)');
      A.eq(probeAudio(alone.path).length, 1, 'and it really has sound');
    }

    /* ---------- 9. music: fitted and mastered ---------- */
    {
      A.ok(Au.bedGraph(2, 20).includes('acrossfade') && Au.bedGraph(1, 20).includes('afade=t=out'), 'the bed graph crossfades between tracks and fades out at the end');
      const seq = Au.sequenceFor([{ durationSec: 8, slug: 'a' }], 20);
      A.ok(seq.seq.length === 4 && seq.covered >= 20, 'a track shorter than the film repeats until it covers it (8 s track → 4 plays for 20 s)');
      const out = path.join(TMP, 'bed-master.m4a');
      const m = await Au.masterBed([{ file: bed, durationSec: 8, title: 'sine' }], 12, out);
      const d = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).toString().trim());
      A.ok(Math.abs(d - 12) < 0.1, `the mastered bed is exactly the film's length (${d.toFixed(2)} s for 12 s)`);
      A.ok(m.loops, 'and reports that the music repeats');
      /* A film fitted to its song is a hair longer or shorter than the song. The song must not
       * start again for the sake of a fraction of a second. */
      A.eq(Au.sequenceFor([{ durationSec: 238.15, slug: 'a' }], 238.1 - Au.SHORTFALL_OK).seq.length, 1, 'a 238.15 s track under a 238.1 s film plays once');
      const fitted = await Au.masterBed([{ file: bed, durationSec: 8, title: 'sine' }], 8.4, path.join(TMP, 'bed-fitted.m4a'));
      A.ok(!fitted.loops && fitted.naturalEnd, 'a track 0.4 s shorter than the film plays once and is allowed its own ending');
      const fd = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path.join(TMP, 'bed-fitted.m4a')]).toString().trim());
      A.ok(Math.abs(fd - 8.4) < 0.1, `and the bed is still padded to the film's length (${fd.toFixed(2)} s)`);
      A.ok(Math.abs(m.measured.lufs - Au.TARGET_LUFS) <= 1.5, `mastered to target (${m.measured.lufs} LUFS, target ${Au.TARGET_LUFS})`);
      A.ok(m.measured.truePeak <= -1.0, `peak under the ceiling (${m.measured.truePeak} dBFS)`);
      let threw = null;
      try { await Au.resolveMusic({ music: { track: 'no-such-track' } }, TMP); } catch (e) { threw = e; }
      A.ok(threw && /no library track/.test(threw.message), 'an unknown library track is an error, never a silent film');
      A.eq(await Au.resolveMusic({ music: 'none' }, TMP), [], 'music: "none" is a deliberate silent film');
    }

    /* ---------- 9b. classic engine audio: never the old picture, never a silent narration ---------- */
    {
      const R = await import(M('render.mjs'));
      const white = path.join(TMP, 'white.png'), blue = path.join(TMP, 'blue.png');
      ff(['-f', 'lavfi', '-i', 'color=c=white:s=640x360', '-frames:v', '1', white]);
      ff(['-f', 'lavfi', '-i', 'color=c=0x2040a0:s=640x360', '-frames:v', '1', blue]);
      const lumaAt = (file, t) => {
        const log = path.join(TMP, 'yavg-c.txt');
        ff(['-ss', String(t), '-i', file, '-frames:v', '1', '-vf', `signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=${log}`, '-f', 'null', '-']);
        return Number((fs.readFileSync(log, 'utf8').match(/YAVG=([\d.]+)/) || [])[1]);
      };
      const classic = (first, extra = {}) => ({ orderId: 'classic-audio', hold: 2, xfade: 0.5, outputRoot: path.join(TMP, 'classic-audio'),
        music: { file: bed }, photos: [{ file: first, motion: 'still' }, { file: white, motion: 'still' }], ...extra });
      const c1 = await R.renderOrder(classic(white), { height: 180, log: () => {} });
      A.ok(lumaAt(c1.path, 0.5) > 200, 'classic: first render shows the white first photo');
      const c2 = await R.renderOrder(classic(blue), { height: 180, log: () => {} });
      const y2 = lumaAt(c2.path, 0.5);
      A.ok(y2 < 120, `classic: after the first photo is swapped to blue, the DELIVERED film shows blue (luma ${y2}; the stale-copy bug delivered the old white, 235)`);
      const voice = path.join(TMP, 'voice-c.wav');
      ff(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=4,volume=0.3', '-ac', '1', '-ar', '48000', voice]);
      const c3 = await R.renderOrder(classic(blue, { orderId: 'classic-voice', outputRoot: path.join(TMP, 'classic-voice'), music: undefined, narration: { file: voice } }), { height: 180, log: () => {} });
      const streams = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', c3.path]).toString()).streams;
      A.eq(c3.audio, 'narration', 'classic: narration with no music is mixed, not skipped');
      A.ok(streams.some(x => x.codec_type === 'audio'), 'classic: and the film really has sound (it used to be delivered silent)');
    }

    /* ---------- 10. the proof is the film, watermarked ---------- */
    {
      const Pf = await import(M('proof.mjs'));
      const proof = path.join(TMP, 'proof.mp4');
      await Pf.makeProof(res4.path, proof);
      const pj = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', proof]).toString());
      const pv = pj.streams.find(s => s.codec_type === 'video');
      A.eq([pv.width, pv.height], [960, 540], 'the proof is 960x540');
      A.ok(Math.abs(Number(pj.format.duration) - res4.durationSec) < 0.15, 'and exactly as long as the film it proofs');
      A.ok(pj.streams.some(s => s.codec_type === 'audio'), 'with its music');
    }
  } finally {
    fs.rmSync(TMP, { recursive: true, force: true });
  }

  A.report('memorial-gallery');
})().catch(e => {
  A.ok(false, 'test threw: ' + (e && e.stack || e));
  A.report('memorial-gallery');
});

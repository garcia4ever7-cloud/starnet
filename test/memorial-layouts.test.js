/* test/memorial-layouts.test.js — the face-protection rules of the layout engine, as properties.
 *
 * WHY IT EXISTS (2026-11-24). memorial/layouts.mjs decides which photographs may be cropped and
 * how far a scene may zoom. A mistake there cuts a dead person's face out of their own memorial
 * film. The rules are pure arithmetic, so they are tested exhaustively and without ffmpeg:
 *
 *  - a crop that is allowed ALWAYS contains every protected face (face box + hair/chin margin)
 *  - with no face information, a portrait is never cropped and a landscape only within the caps
 *  - "no faces found" is not "no faces": only an explicit [] from the operator means face-free
 *  - a zoom never pushes a protected region out of the frame; it gets gentler, then stops
 *  - an operator who asks for a layout the face rule refuses gets the photo shown whole instead
 *  - a scene never spans a card or an act break
 *  - a collage keeps every photo whole, inside the frame, at its own aspect ratio
 *
 * Also covers memorial/join.mjs: transition arithmetic and the windows QC treats as designed black.
 *
 * Run standalone: node test/memorial-layouts.test.js */
'use strict';
const A = require('./_assert.js');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

/* Deterministic pseudo-random numbers so a failure reproduces. */
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

(async () => {
  const L = await import(pathToFileURL(path.join(__dirname, '..', 'memorial', 'layouts.mjs')).href);
  const J = await import(pathToFileURL(path.join(__dirname, '..', 'memorial', 'join.mjs')).href);
  const AR = L.FRAME_AR;

  /* ---------- 1. safeCrop: an allowed crop always keeps every protected face ---------- */
  {
    const r = rng(20261124);
    let allowed = 0, refused = 0, violations = 0, outOfBounds = 0, wrongShape = 0;
    for (let n = 0; n < 4000; n++) {
      const w = 600 + Math.floor(r() * 3400), h = 600 + Math.floor(r() * 3400);
      const faces = [];
      const k = 1 + Math.floor(r() * 4);
      for (let i = 0; i < k; i++) {
        const fw = 0.04 + r() * 0.22, fh = fw * (w / h) * (0.9 + r() * 0.3);
        if (fh >= 0.9) continue;
        const x0 = r() * (1 - fw), y0 = r() * (1 - fh);
        faces.push({ x0, y0, x1: x0 + fw, y1: y0 + fh });
      }
      if (!faces.length) continue;
      const c = L.safeCrop(w, h, AR, faces);
      if (!c.ok) { refused++; continue; }
      allowed++;
      if (!L.facesInside(faces, c)) violations++;
      if (c.x < -1e-9 || c.y < -1e-9 || c.x + c.w > 1 + 1e-9 || c.y + c.h > 1 + 1e-9) outOfBounds++;
      if (Math.abs((c.w * w) / (c.h * h) - AR) > 1e-6) wrongShape++;
    }
    A.ok(allowed > 300 && refused > 300, `the random set exercises both outcomes (${allowed} crops allowed, ${refused} refused)`);
    A.eq(violations, 0, `no allowed crop cuts into a protected face (${allowed} crops checked)`);
    A.eq(outOfBounds, 0, 'no crop rectangle leaves the photo');
    A.eq(wrongShape, 0, 'every allowed crop is exactly frame-shaped');
  }

  /* ---------- 2. the protected region is bigger than the detector's box ---------- */
  {
    const p = L.protect({ x0: 0.4, y0: 0.4, x1: 0.6, y1: 0.6 });
    A.ok(p.y0 < 0.4 - 0.09 && p.y1 > 0.6 && p.x0 < 0.4 && p.x1 > 0.6, 'protect() adds headroom above, and margin below and at the sides');
    A.ok((0.4 - p.y0) > (p.y1 - 0.6), 'more room is kept above the face (hair) than below it');
    const edge = L.protect({ x0: 0.0, y0: 0.0, x1: 0.2, y1: 0.2 });
    A.ok(edge.x0 === 0 && edge.y0 === 0, 'a face at the photo edge is clamped, not pushed outside');
  }

  /* ---------- 3. no face information → the original conservative rules ---------- */
  {
    const portrait = L.safeCrop(1200, 1800, AR, null);
    A.ok(!portrait.ok && /never cropped/.test(portrait.reason), 'unknown faces: a portrait is never cropped');
    const threeTwo = L.safeCrop(3000, 2000, AR, null);
    A.ok(threeTwo.ok && threeTwo.cutY > 0.15 && threeTwo.cutY < 0.16, 'unknown faces: a 3:2 landscape may be cropped (15.6% of height)');
    A.ok(Math.abs(threeTwo.y - (1 - threeTwo.h) * 0.25) < 1e-9, 'unknown faces: that crop keeps the headroom (only a quarter of the loss comes off the top)');
    const fourThree = L.safeCrop(2000, 1500, AR, null);
    A.ok(!fourThree.ok, 'unknown faces: a 4:3 photo (25% of height) is not cropped');
    const square = L.safeCrop(2000, 2000, AR, null);
    A.ok(!square.ok, 'unknown faces: a square photo is not cropped');
  }

  /* ---------- 4. [] means the operator says nobody is in the photo ---------- */
  {
    const c = L.safeCrop(3000, 2000, AR, []);
    A.ok(c.ok && !c.blind, 'faces: [] is an explicit face-free declaration and the crop is allowed');
    A.throws(() => L.normFaces('none'), 'faces must be an array');
    A.throws(() => L.normFaces([[0.1, 0.1, 0.5]]), 'a face needs four numbers');
    A.throws(() => L.normFaces([[0.5, 0.5, 0.2, 0.9]]), 'a face with no area is refused');
    A.throws(() => L.normFaces([[10, 20, 300, 400]]), 'pixel coordinates are refused — fractions only');
    A.eq(L.normFaces(null), null, 'null stays "unknown"');
    A.eq(L.normFaces([[0.1, 0.2, 0.3, 0.4]]), [{ x0: 0.1, y0: 0.2, x1: 0.3, y1: 0.4 }], 'an [x0,y0,x1,y1] list is accepted');
  }

  /* ---------- 5. faces that cannot fit are never squeezed ---------- */
  {
    const top = { x0: 0.4, y0: 0.02, x1: 0.6, y1: 0.2 }, bottom = { x0: 0.4, y0: 0.8, x1: 0.6, y1: 0.97 };
    const c = L.safeCrop(2000, 1500, AR, [top, bottom], { maxCut: 0.5 });
    A.ok(!c.ok && /do not fit/.test(c.reason), 'faces at the top AND bottom of a 4:3 photo: no 16:9 crop is allowed');
    const pc = L.partialCrop(2000, 1500, [top, bottom]);
    A.ok(!pc.ok, 'and no partial trim is allowed either');
    const mid = L.partialCrop(2336, 1744, [{ x0: 0.3, y0: 0.2, x1: 0.5, y1: 0.45 }]);
    A.ok(mid.ok && mid.cut <= L.MAX_CUT_GROUP + 1e-6 && L.facesInside([{ x0: 0.3, y0: 0.2, x1: 0.5, y1: 0.45 }], mid), 'a 4:3 group photo gets a trim of at most 15% that keeps the face');
  }

  /* ---------- 6. safeMotion: the zoom window always contains what must be kept ---------- */
  {
    const r = rng(7);
    let checked = 0, bad = 0, stilled = 0;
    for (let n = 0; n < 3000; n++) {
      /* One region in five is (nearly) the whole frame: those cannot be zoomed at all. */
      const whole = r() < 0.2;
      const x0 = whole ? r() * 0.005 : r() * 0.8, y0 = whole ? r() * 0.005 : r() * 0.8;
      const keep = whole ? { x0, y0, x1: 1 - r() * 0.005, y1: 1 - r() * 0.005 }
        : { x0, y0, x1: Math.min(1, x0 + 0.05 + r() * 0.95), y1: Math.min(1, y0 + 0.05 + r() * 0.95) };
      const m = L.safeMotion(r() < 0.5 ? 'push' : 'pull', keep, { x: r(), y: r() }, 0.09);
      if (m.kind === 'still') { stilled++; continue; }
      checked++;
      const win = L.motionWindow(m);
      if (keep.x0 < win.x - 1e-6 || keep.y0 < win.y - 1e-6 || keep.x1 > win.x + win.w + 1e-6 || keep.y1 > win.y + win.h + 1e-6) bad++;
    }
    A.ok(checked > 500 && stilled > 100, `random regions exercise both moving and stopped outcomes (${checked} moving, ${stilled} still)`);
    A.eq(bad, 0, 'no zoom ever pushes the kept region out of the frame');
    const full = L.safeMotion('push', { x0: 0, y0: 0, x1: 1, y1: 1 }, { x: 0.5, y: 0.5 });
    A.eq(full.kind, 'still', 'a region filling the frame cannot be zoomed at all → still');
    const topFace = L.safeMotion('push', { x0: 0.3, y0: 0, x1: 0.7, y1: 0.5 }, { x: 0.5, y: 0.25 });
    A.ok(topFace.kind === 'push' && topFace.fy === 0, 'a face touching the top edge: the zoom anchors on the top edge instead of giving up');
    A.eq(L.safeMotion('still', null).amp, 0, 'still is still');
  }

  /* ---------- 7. the planner ---------- */
  const face = (x0, y0, x1, y1) => ({ x0, y0, x1, y1 });
  const P = (i, w, h, faces, extra = {}) => ({ index: i, w, h, faces, ...extra });
  {
    const scenes = L.planScenes([
      P(0, 1200, 1800, null), P(1, 1200, 1700, null),                       // two portraits → pair
      P(2, 3000, 2000, [face(0.4, 0.25, 0.55, 0.5)]),                        // landscape, face fits → full
      P(3, 2336, 1744, [face(0.15, 0.05, 0.42, 0.37), face(0.3, 0.4, 0.55, 0.7)]),   // 4:3 group → trimmed, large
      P(4, 1200, 1800, null),                                                // lone portrait → framed
      P(5, 800, 600, null),                                                  // small 4:3, no faces → framed whole
    ], { breaks: new Set([5]) });
    A.eq(scenes.map(s => s.kind), ['pair', 'full', 'group', 'framed', 'framed'], 'auto plan: pair, full, group, framed, framed');
    A.eq(scenes.map(s => s.photos), [[0, 1], [2], [3], [4], [5]], 'every photo appears exactly once, in order');
    A.ok(scenes[1].crop && scenes[1].crop.cut > 0.15, 'the full-bleed scene carries its crop');
    A.ok(!scenes[0].crop && !scenes[3].crop && !scenes[4].crop, 'pair and framed scenes have no crop — photos shown whole');
  }
  {
    /* A card after photo 1 sits between two portraits: they must not be paired across it. */
    const two = [P(0, 1200, 1800, null), P(1, 1200, 1800, null)];
    A.eq(L.planScenes(two, {}).map(s => s.kind), ['pair'], 'two portraits with nothing between them pair up');
    A.eq(L.planScenes(two, { breaks: new Set([1]) }).map(s => s.kind), ['framed', 'framed'], 'a card between them keeps them apart');
    const brk = [P(0, 1200, 1800, null), P(1, 1200, 1800, null, { actBreak: true })];
    A.eq(L.planScenes(brk, {}).map(s => s.kind), ['framed', 'framed'], 'an act break on the second keeps them apart');
  }
  {
    /* The operator asks for full-bleed on a portrait. The face rule wins and says so. */
    const s = L.planScenes([P(0, 1200, 1800, [face(0.3, 0.1, 0.7, 0.4)], { layout: 'full' })], {});
    A.eq(s[0].kind, 'framed', 'operator "full" on a portrait is refused → framed');
    A.ok(/shown whole instead/.test(s[0].why), 'and the plan records why');
    const ok = L.planScenes([P(0, 900, 600, [face(0.4, 0.3, 0.6, 0.6)], { layout: 'full' })], {});
    A.eq(ok[0].kind, 'full', 'operator "full" on a small but safe landscape is honoured');
    const auto = L.planScenes([P(0, 900, 600, [face(0.4, 0.3, 0.6, 0.6)])], {});
    A.ok(auto[0].kind !== 'full', 'the same small photo is NOT full-bleed automatically (too few pixels for a television)');
    const fr = L.planScenes([P(0, 3000, 2000, [face(0.4, 0.3, 0.6, 0.6)], { layout: 'framed' })], {});
    A.eq(fr[0].kind, 'framed', 'operator "framed" is honoured');
  }
  {
    const four = [0, 1, 2, 3].map(i => P(i, i % 2 ? 3000 : 1200, i % 2 ? 2000 : 1800, null, { layout: 'collage' }));
    const s = L.planScenes(four, {});
    A.eq(s.map(x => x.kind), ['collage'], 'four photos marked collage → one collage');
    A.eq(s[0].photos, [0, 1, 2, 3], 'holding all four');
    const two = L.planScenes(four.slice(0, 2), {});
    A.ok(!two.some(x => x.kind === 'collage'), 'two marked photos are not enough for a collage');
    const duo = L.planScenes([P(0, 3000, 2000, null, { layout: 'duo' }), P(1, 1200, 1800, null)], {});
    A.eq(duo.map(x => x.kind), ['duo'], 'operator "duo" pairs a dominant photo with the next one');
  }

  /* ---------- 8. geometry: whole photos, inside the frame, undistorted ---------- */
  {
    const sets = [[0.75, 0.8, 1.5, 1.34], [1.5, 1.5, 1.5, 1.5], [0.75, 0.75, 0.75], [1.5, 0.75, 1.5], [0.66, 0.66, 0.66, 0.66], [1.78, 0.56, 1.0]];
    let inFrame = true, undistorted = true, overlap = false, minArea = 1;
    for (const ars of sets) {
      const rects = L.collageRects(ars);
      rects.forEach((q, i) => {
        if (q.x < 0.035 || q.y < 0.035 || q.x + q.w > 0.965 || q.y + q.h > 0.965) inFrame = false;
        if (Math.abs((q.w * AR) / q.h - ars[i]) > 1e-6) undistorted = false;
      });
      for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i], b = rects[j];
        if (a.x < b.x + b.w - 1e-9 && b.x < a.x + a.w - 1e-9 && a.y < b.y + b.h - 1e-9 && b.y < a.y + a.h - 1e-9) overlap = true;
      }
      minArea = Math.min(minArea, rects.reduce((s, q) => s + q.w * q.h, 0));
    }
    A.ok(inFrame, 'collage: every photo sits inside the action-safe area');
    A.ok(undistorted, 'collage: every photo keeps its own aspect ratio (nothing stretched, nothing cropped)');
    A.ok(!overlap, 'collage: no photo covers another');
    A.ok(minArea > 0.40, `collage: photos fill a good part of the screen (least ${(minArea * 100).toFixed(0)}% of the frame)`);

    const all = L.planScenes([P(0, 1200, 1800, null), P(1, 1500, 1800, null), P(2, 800, 600, null), P(3, 1000, 1000, null)], {});
    let ok = true;
    for (const s of all) for (const q of s.rects) if (q.x < 0.035 || q.y < 0.035 || q.x + q.w > 0.965 || q.y + q.h > 0.965) ok = false;
    A.ok(ok, 'framed and pair prints sit inside the action-safe area');
  }
  {
    const picks = L.pickRecap([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => ({ index: i })), 4);
    A.eq(picks.map(p => p.index), [0, 3, 6, 9], 'recap takes four photos spread across the film');
    A.eq(L.pickRecap([{ index: 0 }, { index: 1 }]).length, 0, 'no recap from fewer than three photos');
  }

  /* ---------- 9. join arithmetic ---------- */
  {
    const plan = { xfade: 1.2, items: [{ hold: 6 }, { hold: 6 }, { hold: 6, actBreak: true }, { hold: 6 }] };
    A.eq(J.joinSpecs(plan).map(s => s.type), ['dissolve', 'dip', 'dissolve'], 'the dip is on the join INTO the act-break item only');
    const dip = J.joinSpecs(plan)[1];
    A.eq([dip.d, dip.f], [J.DIP_HOLD, J.DIP_FADE], 'a normal-length scene gets the full dip (0.9 s fades, 0.5 s black)');
    A.ok(Math.abs(J.totalSeconds(plan) - (24 - 1.2 - 0.5 - 1.2)) < 1e-9, 'film length = holds − every overlap');
    const tl = J.timeline(plan);
    A.eq(tl.starts.map(t => Number(t.toFixed(3))), [0, 4.8, 10.3, 15.1], 'each item starts where the overlaps say it does');
    A.eq(tl.black.length, 1, 'one designed black window');
    A.ok(Math.abs(tl.black[0].from - 9.4) < 1e-9 && Math.abs(tl.black[0].to - 11.7) < 1e-9, 'the black window covers fade-out, hold and fade-in (9.4–11.7 s)');

    const g = J.joinGraph(plan);
    A.ok(g.includes('[1:v]fade=t=out:st=4.600:d=0.900[p1]') && g.includes('[2:v]fade=t=in:st=0.500:d=0.900[p2]'), 'the dip is a fade-out and an equal fade-in around the overlap');
    A.ok(g.includes('[x1][p2]xfade=transition=fade:duration=0.500:offset=10.300[x2]'), 'joined by a plain dissolve as long as the black hold');
    A.ok(!g.includes('fadeblack') && !g.includes('custom'), 'neither the lopsided fadeblack nor a custom xfade expression is used');
    A.ok(g.endsWith('format=yuv420p,setsar=1[vo]'), 'classic plans are not colour-tagged (their pixels are not BT.709)');

    const faded = { ...plan, headFade: 1, tailFade: 2, colour: 'bt709' };
    const fg = J.joinGraph(faded);
    A.ok(fg.includes('[0:v]fade=t=in:st=0:d=1.000[p0]') && fg.includes('fade=t=out:st=4.000:d=2.000[p3]'), 'head and tail fades land on the first and last segments');
    A.ok(fg.includes('setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv[vo]'), 'gallery plans stamp BT.709 on the output');
    A.eq(J.timeline(faded).black.length, 3, 'head and tail fades are designed black too');

    /* Two scenes too short for a full dip: the dip shrinks instead of producing an invalid graph. */
    const tiny = { xfade: 1.0, items: [{ hold: 2 }, { hold: 2, actBreak: true }] };
    const ts = J.joinSpecs(tiny)[0];
    A.ok(ts.d + ts.f <= 2 * 0.45 + 1e-9 && ts.d > 0 && ts.f > 0, `a 2 s scene gets a proportionally shorter dip (${ts.f} s fades, ${ts.d} s black)`);
    /* A scene that dips at both ends keeps clear picture between its fade-in and its fade-out. */
    const both = { xfade: 1.0, items: [{ hold: 2 }, { hold: 2, actBreak: true }, { hold: 2, actBreak: true }] };
    const bg = J.joinGraph(both);
    const inEnd = Number(bg.match(/\[1:v\]fade=t=in:st=([0-9.]+):d=([0-9.]+)/).slice(1).reduce((x, y) => Number(x) + Number(y)));
    const outStart = Number(bg.match(/\[1:v\][^;\[]*fade=t=out:st=([0-9.]+)/)[1]);
    A.ok(inEnd <= outStart + 1e-9, `a scene with a dip at both ends: fade-in ends (${inEnd}) before fade-out starts (${outStart})`);

    const one = J.joinGraph({ xfade: 1.2, items: [{ hold: 5 }] });
    A.eq(one, '[0:v]format=yuv420p,setsar=1[vo]', 'a single-segment film needs no join');
  }

  A.report('memorial-layouts');
})().catch(e => {
  A.ok(false, 'test threw: ' + (e && e.stack || e));
  A.report('memorial-layouts');
});

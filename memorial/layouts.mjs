/* memorial/layouts.mjs — decide what each moment of the film looks like. Pure: numbers in, plan out.
 *
 * WHY THIS EXISTS
 * ---------------
 * The first engine had one picture per moment and one decision per picture (crop or pad). The
 * 2026-11-24 layout benchmark showed what families actually respond to: prints laid on a soft
 * background, two portraits side by side, a group photo shown as large as it can be without
 * cutting anyone, a scenic photo filling the screen. This module chooses between those, and it is
 * where FACE PROTECTION is decided:
 *
 *   A photograph is only ever cropped when every protected face — the detected (or operator-
 *   marked) face box grown by headroom for hair and a margin for chin and ears — stays inside
 *   the crop. If that cannot be guaranteed, the photo is shown WHOLE in a frame. And if no face
 *   information exists for a photo at all, it is treated exactly as the original engine treated
 *   it: portraits are never cropped, landscapes only within the conservative caps.
 *
 * Scene kinds (the letters are the benchmark's):
 *   full     F  one landscape photo filling the frame, zoom anchored on the faces
 *   framed   A  one photo, whole, as a bordered print on the background
 *   pair     B  two photos, whole, side by side
 *   duo      C  a dominant photo with a smaller companion              (operator-marked)
 *   group    D  one photo cropped a little (face-safe) and shown large on its own blurred copy
 *   collage  E  three or four photos, whole, as one arrangement        (operator-marked / recap)
 *
 * All rectangles are fractions of the frame (0..1), so the same plan renders at any size.
 */
'use strict';

export const FRAME_AR = 16 / 9;

/* How far a face box is grown before it is called "protected". Detectors box the face from
 * roughly eyebrows to chin; hair and a little air above it are part of the person. */
export const HEADROOM = 0.55;     // × face height added above
export const CHINROOM = 0.30;     // × face height added below
export const SIDEROOM = 0.30;     // × face width added each side

/* Crop caps. With faces known the binding rule is "faces stay inside"; these only stop a crop
 * from discarding most of a photograph. Without faces the original, tighter caps apply. */
export const MAX_CUT_FULL = 0.25;        // full-bleed, faces known
export const MAX_CUT_GROUP = 0.15;       // group layout: "a little", per the benchmark
export const MAX_CUT_V_BLIND = 0.20;     // no face info: top/bottom
export const MAX_CUT_H_BLIND = 0.25;     // no face info: sides
export const BLIND_Y_BIAS = 0.25;        // no face info: keep headroom, lose the bottom

/* Below this many source pixels across the frame width a full-bleed photo would be visibly
 * soft on a television; it reads better as a smaller framed print. */
export const MIN_FULL_BLEED_PX = 1100;

export const HOLD = { full: 6.0, framed: 6.0, group: 6.5, pair: 7.5, duo: 7.5, collage: 9.0 };

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function orientationOf(w, h) {
  const ar = w / h;
  if (ar > 1.08) return 'landscape';
  if (ar < 0.92) return 'portrait';
  return 'square';
}

/** Normalise a face list to [{x0,y0,x1,y1}] fractions; reject nonsense loudly. */
export function normFaces(faces, where = 'faces') {
  if (faces == null) return null;                 // unknown
  if (!Array.isArray(faces)) throw new Error(`${where} must be an array`);
  return faces.map((f, i) => {
    let b;
    if (Array.isArray(f) && f.length === 4) b = { x0: f[0], y0: f[1], x1: f[2], y1: f[3] };
    else if (f && typeof f === 'object' && 'x0' in f) b = { x0: f.x0, y0: f.y0, x1: f.x1, y1: f.y1 };
    else if (f && typeof f === 'object' && 'w' in f) b = { x0: f.x, y0: f.y, x1: f.x + f.w, y1: f.y + f.h };
    else throw new Error(`${where}[${i}] must be [x0,y0,x1,y1] in 0..1`);
    for (const k of ['x0', 'y0', 'x1', 'y1']) {
      if (!(typeof b[k] === 'number' && b[k] >= -0.001 && b[k] <= 1.001)) throw new Error(`${where}[${i}] ${k}=${b[k]} is outside 0..1`);
      b[k] = clamp(b[k], 0, 1);
    }
    if (!(b.x1 > b.x0 && b.y1 > b.y0)) throw new Error(`${where}[${i}] has no area`);
    return b;
  });
}

/** The protected region of one face: the box grown for hair, chin and ears, clamped to the photo. */
export function protect(face) {
  const fw = face.x1 - face.x0, fh = face.y1 - face.y0;
  return {
    x0: clamp(face.x0 - SIDEROOM * fw, 0, 1), x1: clamp(face.x1 + SIDEROOM * fw, 0, 1),
    y0: clamp(face.y0 - HEADROOM * fh, 0, 1), y1: clamp(face.y1 + CHINROOM * fh, 0, 1),
  };
}

export function unionOf(boxes) {
  if (!boxes || !boxes.length) return null;
  return {
    x0: Math.min(...boxes.map(b => b.x0)), y0: Math.min(...boxes.map(b => b.y0)),
    x1: Math.max(...boxes.map(b => b.x1)), y1: Math.max(...boxes.map(b => b.y1)),
  };
}

/**
 * safeCrop — the crop of a w×h photo to aspect `ar` that keeps every protected face.
 * `faces`: null = unknown (blind rules), [] = operator/detector says there are none.
 * @returns {{ok:boolean, reason:string, x:number,y:number,w:number,h:number, cut:number,
 *            cutX:number, cutY:number, blind:boolean}}  crop rect as fractions of the photo
 */
export function safeCrop(w, h, ar, faces, opts = {}) {
  const srcAr = w / h;
  const blind = faces == null;
  let cw = 1, ch = 1;                                   // fractions of the photo kept
  if (srcAr > ar) cw = ar / srcAr; else ch = srcAr / ar;
  const cutX = 1 - cw, cutY = 1 - ch, cut = Math.max(cutX, cutY);
  const base = { w: cw, h: ch, cut, cutX, cutY, blind };
  const pct = n => (n * 100).toFixed(1) + '%';

  if (blind) {
    if (orientationOf(w, h) === 'portrait' && ar > 1.08) return { ok: false, reason: 'portrait photo, no face data — never cropped', x: 0, y: 0, ...base };
    if (cutY > (opts.maxCutV ?? MAX_CUT_V_BLIND)) return { ok: false, reason: `would cut ${pct(cutY)} of height with no face data`, x: 0, y: 0, ...base };
    if (cutX > (opts.maxCutH ?? MAX_CUT_H_BLIND)) return { ok: false, reason: `would cut ${pct(cutX)} of width with no face data`, x: 0, y: 0, ...base };
    return { ok: true, reason: cut < 0.001 ? 'already frame-shaped' : `cuts ${pct(cut)}, no face data — headroom kept`, x: (1 - cw) / 2, y: (1 - ch) * BLIND_Y_BIAS, ...base };
  }

  const maxCut = opts.maxCut ?? MAX_CUT_FULL;
  if (cut > maxCut) return { ok: false, reason: `would cut ${pct(cut)} (cap ${pct(maxCut)})`, x: 0, y: 0, ...base };

  const u = unionOf(faces.map(protect));
  if (!u) {
    /* Declared face-free (a landscape, a house, a headstone): centre it, slight upward bias. */
    return { ok: true, reason: cut < 0.001 ? 'already frame-shaped' : `cuts ${pct(cut)}, no faces in photo`, x: (1 - cw) / 2, y: (1 - ch) * 0.4, ...base };
  }
  if (u.x1 - u.x0 > cw + 1e-9 || u.y1 - u.y0 > ch + 1e-9) {
    return { ok: false, reason: 'faces with headroom do not fit inside the crop', x: 0, y: 0, ...base };
  }
  /* Centre the crop on the faces, then slide it only as far as needed to stay on the photo.
   * Because the union fits, the slide can never push a protected face out. */
  const x = clamp((u.x0 + u.x1) / 2 - cw / 2, Math.max(0, u.x1 - cw), Math.min(1 - cw, u.x0));
  const y = clamp((u.y0 + u.y1) / 2 - ch / 2, Math.max(0, u.y1 - ch), Math.min(1 - ch, u.y0));
  return { ok: true, reason: cut < 0.001 ? 'already frame-shaped' : `cuts ${pct(cut)}, all ${faces.length} face(s) kept with headroom`, x, y, ...base };
}

/**
 * partialCrop — trim a photo TOWARD the frame shape by at most MAX_CUT_GROUP, faces kept.
 * A 4:3 group photo cannot become 16:9 without losing a quarter of itself, but trimming 15%
 * lets it sit visibly larger on screen. Tries the largest trim first, then gentler ones.
 * The result carries `ar`, the aspect of the trimmed picture.
 */
export function partialCrop(w, h, faces, frameAr = FRAME_AR) {
  const srcAr = w / h;
  let last = { ok: false, reason: 'no trim keeps every face', x: 0, y: 0, w: 1, h: 1, cut: 0 };
  for (const cut of [MAX_CUT_GROUP, 0.10, 0.06]) {
    const ar = srcAr < frameAr ? Math.min(frameAr, srcAr / (1 - cut)) : Math.max(frameAr, srcAr * (1 - cut));
    const c = safeCrop(w, h, ar, faces, { maxCut: MAX_CUT_GROUP + 1e-6 });
    if (c.ok) return { ...c, ar };
    last = c;
  }
  return { ...last, ok: false };
}

/** Are all protected faces inside rect r (fractions of the photo)? Used by the audit. */
export function facesInside(faces, r, eps = 1e-6) {
  if (!faces || !faces.length) return true;
  return faces.map(protect).every(p => p.x0 >= r.x - eps && p.y0 >= r.y - eps && p.x1 <= r.x + r.w + eps && p.y1 <= r.y + r.h + eps);
}

/**
 * safeMotion — a zoom whose visible window never loses a protected region.
 * `focus` and `keep` are fractions of the FRAME. Zoom is anchored on `focus`: at zoom z the
 * window spans focus*(1-1/z) .. focus*(1-1/z)+1/z on each axis.
 * The anchor is moved, as little as possible from `focus`, to wherever keeps the region inside;
 * only if no anchor can does the zoom get gentler, and finally stop.
 * @returns {{kind:'push'|'pull'|'still', amp:number, fx:number, fy:number}}
 */
export function safeMotion(kind, keep, focus = { x: 0.5, y: 0.5 }, want = 0.09) {
  if (kind === 'still') return { kind: 'still', amp: 0, fx: 0.5, fy: 0.5 };
  /* On one axis, the anchors f for which the window at zoom z still contains [k0,k1]:
   *   f*(1-1/z) <= k0   and   f*(1-1/z) + 1/z >= k1.   Empty when the region is wider than 1/z. */
  const anchor = (want01, k0, k1, inv) => {
    const lo = Math.max(0, (k1 - inv) / (1 - inv)), hi = Math.min(1, k0 / (1 - inv));
    return lo <= hi + 1e-9 ? clamp(want01, lo, hi) : null;
  };
  for (const amp of [want, want * 0.75, want * 0.5, want * 0.3, 0.015]) {
    if (amp > want + 1e-9) continue;
    const inv = 1 / (1 + amp);
    if (!keep) return { kind, amp: Number(amp.toFixed(4)), fx: clamp(focus.x, 0, 1), fy: clamp(focus.y, 0, 1) };
    const fx = anchor(focus.x, keep.x0, keep.x1, inv), fy = anchor(focus.y, keep.y0, keep.y1, inv);
    /* The anchor is NOT rounded: rounding to four places moved the window by up to 4e-6 of the
     * frame, enough to put the edge of a protected region outside it (caught by the property
     * test, 205 of 3,000 random regions). */
    if (fx != null && fy != null) return { kind, amp: Number(amp.toFixed(4)), fx, fy };
  }
  return { kind: 'still', amp: 0, fx: 0.5, fy: 0.5 };
}

/** The window (frame fractions) visible at the tightest point of a motion. */
export function motionWindow(m) {
  const inv = 1 / (1 + (m.amp || 0));
  return { x: m.fx * (1 - inv), y: m.fy * (1 - inv), w: inv, h: inv };
}

/* ------------------------------------------------------------------ geometry of each layout */

/* Largest rect of aspect `ar` (photo aspect) inside a box, centred on (cx,cy). Frame fractions:
 * a frame-fraction rect of width fw and height fh has pixel aspect (fw/fh)*FRAME_AR. */
function fitIn(ar, boxW, boxH, cx, cy, frameAr = FRAME_AR) {
  let w = boxW, h = (w * frameAr) / ar;
  if (h > boxH) { h = boxH; w = (h * ar) / frameAr; }
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/* A row of photos at one common height, centred, with a gap — the "justified" arrangement. */
function rowOf(ars, maxW, maxH, cx, cy, gap, frameAr = FRAME_AR) {
  const unit = ars.reduce((a, r) => a + r / frameAr, 0);        // total width per unit height
  let h = Math.min(maxH, (maxW - gap * (ars.length - 1)) / unit);
  const widths = ars.map(r => (h * r) / frameAr);
  const total = widths.reduce((a, b) => a + b, 0) + gap * (ars.length - 1);
  let x = cx - total / 2;
  return widths.map(wd => { const r = { x, y: cy - h / 2, w: wd, h }; x += wd + gap; return r; });
}

/* Three or four whole photos as one arrangement. The photos are grouped into COLUMNS; inside a
 * column they stack at one width, and the column widths are solved so every column comes out
 * the same height — the classic "portrait | two stacked landscapes | portrait" falls out of
 * this for a mixed set. Every ordering and every grouping is tried (at most 24 x 8) and the one
 * showing the most picture wins, with a penalty for leaving any one photo much smaller than
 * the rest. Returns rects in the ORIGINAL photo order. */
export function collageRects(ars, opts = {}) {
  const maxW = opts.maxW ?? 0.90, maxH = opts.maxH ?? 0.80, gap = opts.gap ?? 0.014, cy = opts.cy ?? 0.5;
  const gapV = gap * FRAME_AR;
  const n = ars.length;
  const perms = [];
  const permute = (arr, k = 0) => {
    if (k === arr.length) { perms.push(arr.slice()); return; }
    for (let i = k; i < arr.length; i++) { [arr[k], arr[i]] = [arr[i], arr[k]]; permute(arr, k + 1); [arr[k], arr[i]] = [arr[i], arr[k]]; }
  };
  permute(ars.map((_, i) => i));
  /* compositions of n into column sizes, each column 1 or 2 photos */
  const comps = [];
  const compose = (left, acc) => {
    if (left === 0) { comps.push(acc.slice()); return; }
    for (const k of [1, 2]) if (k <= left) { acc.push(k); compose(left - k, acc); acc.pop(); }
  };
  compose(n, []);

  let best = null;
  for (const perm of perms) {
    for (const comp of comps) {
      if (comp.length < 2) continue;
      /* Column c of width w (frame fraction) has height  w*FRAME_AR*sum(1/ar) + gaps. Solve the
       * common height H: w_c = (H - gaps_c) / (FRAME_AR * sum_c(1/ar)). */
      const cols = [];
      let at = 0;
      for (const k of comp) { cols.push(perm.slice(at, at + k)); at += k; }
      const inv = cols.map(c => c.reduce((a, i) => a + 1 / ars[i], 0) * FRAME_AR);
      const gaps = cols.map(c => gapV * (c.length - 1));
      const widthAt = H => cols.reduce((a, _, c) => a + (H - gaps[c]) / inv[c], 0) + gap * (cols.length - 1);
      let H = maxH;
      if (widthAt(H) > maxW) {
        /* widthAt is linear in H: solve widthAt(H) = maxW. */
        const slope = cols.reduce((a, _, c) => a + 1 / inv[c], 0);
        const offs = cols.reduce((a, _, c) => a - gaps[c] / inv[c], 0) + gap * (cols.length - 1);
        H = (maxW - offs) / slope;
      }
      if (!(H > 0.2)) continue;
      const total = widthAt(H);
      const rects = new Array(n);
      let x = 0.5 - total / 2;
      cols.forEach((col, c) => {
        const w = (H - gaps[c]) / inv[c];
        let y = cy - H / 2;
        for (const i of col) { const h = (w * FRAME_AR) / ars[i]; rects[i] = { x, y, w, h }; y += h + gapV; }
        x += w + gap;
      });
      const areas = rects.map(r => r.w * r.h);
      const score = areas.reduce((a, b) => a + b, 0) * Math.pow(Math.min(...areas) / Math.max(...areas), 0.35);
      if (!best || score > best.score + 1e-12) best = { score, rects };
    }
  }
  /* Two photos, or nothing workable: a plain row. */
  return best ? best.rects : rowOf(ars, maxW, maxH, 0.5, cy, gap);
}

/* ------------------------------------------------------------------ the planner */

function describe(p) {
  const o = orientationOf(p.w, p.h);
  const faces = p.faces;                          // null | []
  const full = safeCrop(p.w, p.h, FRAME_AR, faces);
  const group = faces && faces.length ? partialCrop(p.w, p.h, faces) : { ok: false, reason: 'no faces' };
  /* Source pixels that would span the frame width if shown full-bleed. */
  const fullPx = p.w * full.w;
  return { ...p, orientation: o, full, group, fullPx };
}

function sceneFor(kind, photos, extra = {}) {
  return { kind, photos, hold: HOLD[kind], ...extra };
}

/**
 * planScenes — group an order's photos into scenes.
 * @param photos [{index, w, h, faces, layout?, hold?, motion?, caption?, actBreak?}]
 * @param opts   {breaks?: Set<number>  photo counts after which a card/chapter sits — a scene
 *                                        never spans one}
 * @returns scenes [{kind, photos:[index…], rects:[…], crop?, motion, hold, why}]
 */
export function planScenes(photos, opts = {}) {
  const breaks = opts.breaks || new Set();
  const P = photos.map(describe);
  const scenes = [];
  const boundaryAfter = i => i === P.length - 1 || breaks.has(i + 1) || P[i + 1].actBreak === true;

  let i = 0;
  while (i < P.length) {
    const p = P[i];
    const want = p.layout || 'auto';

    /* ---- operator-marked multi-photo layouts ---- */
    if (want === 'collage') {
      const run = [p];
      while (run.length < 4 && !boundaryAfter(i + run.length - 1) && (P[i + run.length].layout || '') === 'collage') run.push(P[i + run.length]);
      if (run.length >= 3) {
        scenes.push(sceneFor('collage', run.map(q => q.index), { rects: collageRects(run.map(q => q.w / q.h)), why: `operator: collage of ${run.length}` }));
        i += run.length; continue;
      }
      /* fewer than three marked in a row — fall through and treat as auto */
    }
    if (want === 'duo' && !boundaryAfter(i)) {
      const q = P[i + 1];
      scenes.push(sceneFor('duo', [p.index, q.index], { rects: duoRects(p, q), why: 'operator: dominant + companion' }));
      i += 2; continue;
    }
    if (want === 'pair' && !boundaryAfter(i)) {
      const q = P[i + 1];
      scenes.push(sceneFor('pair', [p.index, q.index], { rects: pairRects(p, q), why: 'operator: pair' }));
      i += 2; continue;
    }

    /* ---- single-photo decisions ---- */
    const forcedFramed = want === 'framed';
    const forcedFull = want === 'full';
    const forcedGroup = want === 'group';

    if (forcedFull && !p.full.ok) {
      /* The operator asked for something the face rule refuses. The face rule wins, visibly. */
      scenes.push(framed(p, `operator asked for full-bleed but ${p.full.reason} — shown whole instead`));
      i++; continue;
    }
    if (!forcedFramed && !forcedGroup && p.full.ok && (forcedFull || (p.orientation === 'landscape' && p.fullPx >= MIN_FULL_BLEED_PX))) {
      scenes.push(sceneFor('full', [p.index], { rects: [{ x: 0, y: 0, w: 1, h: 1 }], crop: cropOf(p.full), why: p.full.reason }));
      i++; continue;
    }
    if (!forcedFramed && p.group.ok && p.group.cut > 0.001 && (forcedGroup || p.orientation === 'landscape')) {
      scenes.push(sceneFor('group', [p.index], {
        rects: [fitIn(p.group.ar, 0.94, 0.92, 0.5, 0.5)], crop: cropOf(p.group), why: p.group.reason,
      }));
      i++; continue;
    }

    /* ---- two whole portraits side by side ---- */
    if (want === 'auto' && p.orientation !== 'landscape' && !boundaryAfter(i)) {
      const q = P[i + 1];
      if ((q.layout || 'auto') === 'auto' && q.orientation !== 'landscape') {
        scenes.push(sceneFor('pair', [p.index, q.index], { rects: pairRects(p, q), why: 'two upright photos shown whole, side by side' }));
        i += 2; continue;
      }
    }

    scenes.push(framed(p, forcedFramed ? 'operator: framed'
      : p.orientation === 'landscape' ? `shown whole: ${p.full.reason}` : `${p.orientation} photo shown whole`));
    i++;
  }
  return scenes;

  function cropOf(c) { return { x: c.x, y: c.y, w: c.w, h: c.h, cut: c.cut }; }
  function framed(p, why) {
    const ar = p.w / p.h;
    const box = ar > 1.08 ? [0.80, 0.80] : [0.56, 0.84];
    return sceneFor('framed', [p.index], { rects: [fitIn(ar, box[0], box[1], 0.5, 0.5)], why });
  }
  function pairRects(p, q) {
    return rowOf([p.w / p.h, q.w / q.h], 0.86, 0.80, 0.5, 0.5, 0.03);
  }
  function duoRects(p, q) {
    const a = fitIn(p.w / p.h, 0.58, 0.78, 0.36, 0.50);
    const b = fitIn(q.w / q.h, 0.26, 0.58, 0.81, 0.56);
    /* Close the gap so the two read as one composition, then re-centre the pair. */
    const gap = 0.025;
    b.x = a.x + a.w + gap;
    const shift = 0.5 - (a.x + (b.x + b.w)) / 2;
    a.x += shift; b.x += shift;
    return [a, b];
  }
}

/** A recap collage: up to four photos spread evenly through the film, shown once more together. */
export function pickRecap(photos, n = 4) {
  const ok = photos.filter(p => p.recap !== false);
  if (ok.length < 3) return [];
  const k = Math.min(n, ok.length);
  const picks = [];
  for (let j = 0; j < k; j++) picks.push(ok[Math.round((j * (ok.length - 1)) / (k - 1))]);
  return [...new Set(picks)];
}

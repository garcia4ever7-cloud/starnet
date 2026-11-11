/* memorial/fit.mjs — decide how one photograph meets the frame, without ever cutting a face.
 *
 * WHY THIS EXISTS
 * ---------------
 * A memorial film is made of photographs of a dead person, handed over by a grieving family.
 * The single most likely way to ruin one is to crop a portrait-orientation photo to a 16:9 frame:
 * that removes the top and bottom of the image, which is exactly where heads are. The research
 * phase found a real paying customer's 3.7-star review on a memorial order whose complaint was
 * that AI processing "made the people unrecognisable" — the same class of harm from the other
 * direction. Faces are the product. Everything here is biased toward never touching them.
 *
 * NO FACE DETECTION IS AVAILABLE ON THIS DEVICE. Verified 2026-11-09: no OpenCV, no onnxruntime
 * (Termux uses bionic libc, so the manylinux wheels cannot install), no numpy, no rembg. So we
 * cannot find the face and crop around it. The rule is therefore conservative by construction
 * rather than clever: when in doubt, letterbox — never cut.
 *
 * THE RULES, in priority order:
 *   1. An explicit per-photo `fit` in the order spec always wins. The operator can see the photo.
 *   2. A portrait photo in a landscape frame (or vice versa) is ALWAYS padded, never cropped.
 *      No tolerance, no exceptions. This is the face rule.
 *   3. Otherwise, crop only if filling the frame discards no more than MAX_CROP_LOSS of either
 *      dimension. A small crop tightens the composition; a large one eats the subject.
 *   4. Anything else is padded.
 *
 * Padding is not black bars. It is the same photograph, scaled to cover, heavily blurred and
 * darkened, sitting behind the photograph scaled to fit. That is the standard broadcast treatment
 * and it reads as deliberate rather than as a mistake.
 *
 * Pure module: no fs, no ffmpeg, no clock. Everything here is a function of numbers, so it is
 * cheap to test and the test is the specification.
 */
'use strict';

/* Crop caps are ASYMMETRIC, and the reason matters.
 *
 * Going from any taller aspect to a wider one crops VERTICALLY — top and bottom — which is
 * exactly where heads are. (A 3:2 photo, the most common family format, loses 15.6% vertically
 * in a 16:9 frame; a square loses 43.8%.) Horizontal crops take the sides, where subjects
 * rarely sit. So the vertical cap is tighter than the horizontal one.
 *
 * But padding every 3:2 photo would leave most of the film as blurred backdrop, which looks
 * timid. A human editor crops a 3:2 to 16:9 and simply keeps the headroom — taking the loss
 * from the bottom. That is what CROP_Y_BIAS does: when a vertical crop is allowed, only a
 * quarter of the discarded height comes off the top.
 */
export const MAX_CROP_LOSS_V = 0.20;   // top/bottom — the face axis
export const MAX_CROP_LOSS_H = 0.25;   // sides — safer
export const CROP_Y_BIAS = 0.25;       // 0 = keep all headroom, 0.5 = centred

/* Kept for callers/tests that want a single conservative number. */
export const MAX_CROP_LOSS = MAX_CROP_LOSS_V;

/* Orientation is decided with a dead zone so a 1.02:1 photo is not called "landscape". */
const SQUARE_BAND = 0.08;

export function orientationOf(w, h) {
  const ar = w / h;
  if (ar > 1 + SQUARE_BAND) return 'landscape';
  if (ar < 1 - SQUARE_BAND) return 'portrait';
  return 'square';
}

/* How much of each dimension a cover-crop would throw away, as a fraction 0..1. */
export function cropLoss(srcW, srcH, dstW, dstH) {
  const scale = Math.max(dstW / srcW, dstH / srcH);
  const sw = srcW * scale;
  const sh = srcH * scale;
  return {
    x: sw > dstW ? (sw - dstW) / sw : 0,
    y: sh > dstH ? (sh - dstH) / sh : 0,
    get max() { return Math.max(this.x, this.y); },
  };
}

/**
 * planFit — choose crop or pad for one photo.
 * @returns {{strategy:'crop'|'pad', reason:string, loss:number,
 *            srcOrientation:string, dstOrientation:string}}
 */
export function planFit(srcW, srcH, dstW, dstH, mode = 'auto') {
  if (!(srcW > 0 && srcH > 0 && dstW > 0 && dstH > 0)) {
    throw new Error(`planFit: dimensions must be positive (got ${srcW}x${srcH} -> ${dstW}x${dstH})`);
  }

  const srcOrientation = orientationOf(srcW, srcH);
  const dstOrientation = orientationOf(dstW, dstH);
  const l = cropLoss(srcW, srcH, dstW, dstH);
  const loss = l.max;
  const base = { loss, lossX: l.x, lossY: l.y, srcOrientation, dstOrientation };
  const pct = n => (n * 100).toFixed(1) + '%';

  /* 1. Operator override. They can see the photograph; we cannot. */
  if (mode === 'crop') return { strategy: 'crop', reason: 'operator forced crop', ...base };
  if (mode === 'pad') return { strategy: 'pad', reason: 'operator forced pad', ...base };
  if (mode !== 'auto') throw new Error(`planFit: unknown fit mode '${mode}'`);

  /* 2. THE FACE RULE. Orientation mismatch is never cropped, whatever the arithmetic says.
   *    A portrait in a landscape frame loses 40-60% of its height; there is no bias that saves it. */
  if (srcOrientation !== dstOrientation && srcOrientation !== 'square' && dstOrientation !== 'square') {
    return { strategy: 'pad', reason: `${srcOrientation} photo in ${dstOrientation} frame — never cropped`, ...base };
  }

  /* 3. Vertical loss is the face axis and gets the tight cap. */
  if (l.y > MAX_CROP_LOSS_V) {
    return { strategy: 'pad', reason: `would cut ${pct(l.y)} of height (cap ${pct(MAX_CROP_LOSS_V)}) — heads live there`, ...base };
  }
  /* 4. Horizontal loss takes the sides and gets a looser cap. */
  if (l.x > MAX_CROP_LOSS_H) {
    return { strategy: 'pad', reason: `would cut ${pct(l.x)} of width (cap ${pct(MAX_CROP_LOSS_H)})`, ...base };
  }

  const how = l.y > 0.001 ? `cuts ${pct(l.y)} of height, biased to keep headroom` : `cuts ${pct(l.x)} of width`;
  return { strategy: 'crop', reason: how, ...base };
}

/**
 * fitFilter — the ffmpeg filter fragment that brings one input to exactly ow x oh.
 *
 * `ow`/`oh` are the OVERSAMPLED working size (output size x the oversample factor), because
 * zoompan rounds its crop window to whole pixels and that stepping is what makes a slow drift
 * shudder. Measured on this device: RMS 2nd-difference of a tracked edge was 1.12 output px at
 * 1x, 0.27 at 4x and 0.106 at 8x, against a visibility threshold of about 0.1. Hence 8x.
 *
 * The blurred backdrop is built by downscaling to a tiny frame, blurring there, then upscaling.
 * Blurring at 15360px wide directly would cost more than the rest of the render combined, and the
 * result is indistinguishable because it is a blur.
 *
 * @param {string} inLabel  e.g. '0:v'
 * @param {string} outLabel e.g. 'fit0'
 */
export function fitFilter(inLabel, outLabel, plan, ow, oh, opts = {}) {
  const blurW = opts.blurW || 480;
  const blurH = Math.max(2, Math.round((blurW * oh) / ow / 2) * 2);
  const sigma = opts.sigma ?? 16;
  /* -0.28 crushed a dark photo into what read as plain black pillarbox bars — the cheap-slideshow
   * look this whole module exists to avoid. The backdrop has to stay visibly a photograph. */
  const dim = opts.backdropDim ?? -0.10;
  const sat = opts.backdropSat ?? 0.55;
  /* Enlarging the backdrop past the frame keeps it from being a visibly aligned copy of the
   * foreground, which is what makes the treatment read as deliberate. */
  const zoom = opts.backdropZoom ?? 1.18;

  if (plan.strategy === 'crop') {
    /* Horizontally centred; vertically biased UPWARD so the headroom survives and the loss
     * comes off the bottom of the frame, which is what a human editor does. */
    const bias = opts.yBias ?? CROP_Y_BIAS;
    return `[${inLabel}]scale=${ow}:${oh}:force_original_aspect_ratio=increase:flags=bicubic,`
         + `crop=${ow}:${oh}:(in_w-${ow})/2:(in_h-${oh})*${bias},setsar=1[${outLabel}]`;
  }

  /* pad: blurred, darkened copy of the same photo behind the whole photo */
  const bg = `${outLabel}_bg`;
  const fg = `${outLabel}_fg`;
  const zw = Math.round((blurW * zoom) / 2) * 2;
  const zh = Math.round((blurH * zoom) / 2) * 2;
  return [
    `[${inLabel}]split=2[${bg}_s][${fg}_s]`,
    /* Blur small, then upscale: a gaussian at 15360px wide would cost more than the whole
     * render and the result is indistinguishable, because it is a blur. */
    `[${bg}_s]scale=${zw}:${zh}:force_original_aspect_ratio=increase:flags=bicubic,`
      + `crop=${blurW}:${blurH},gblur=sigma=${sigma},eq=brightness=${dim}:saturation=${sat},`
      + `scale=${ow}:${oh}:flags=bicubic,setsar=1[${bg}]`,
    `[${fg}_s]scale=${ow}:${oh}:force_original_aspect_ratio=decrease:flags=bicubic,setsar=1[${fg}]`,
    `[${bg}][${fg}]overlay=(W-w)/2:(H-h)/2:format=auto,setsar=1[${outLabel}]`,
  ].join(';');
}

/* Parse "16:9" / "9:16" / "4:3" into pixel dimensions at a given height class. */
export function frameSize(aspect = '16:9', height = 1080) {
  const m = String(aspect).match(/^(\d+):(\d+)$/);
  if (!m) throw new Error(`frameSize: bad aspect '${aspect}'`);
  const a = Number(m[1]), b = Number(m[2]);
  const h = height;
  const w = Math.round((h * a) / b / 2) * 2;
  return { w, h: Math.round(h / 2) * 2 };
}

/* test/memorial-fit.test.js — the face-safety rule for memorial films.
 *
 * WHY IT EXISTS (2026-11-09). A memorial film is made of photographs of a dead person. The single
 * most likely way to ruin one is to crop a portrait to a landscape frame, which removes the top
 * and bottom of the picture — where heads are. There is no face detector on this device (no
 * OpenCV, no onnxruntime: Termux is bionic libc, so the manylinux wheels cannot install), so the
 * rule has to be conservative by construction rather than clever. These assertions ARE that rule.
 *
 * What must stay true:
 *  - a portrait photo in a landscape frame is NEVER cropped, whatever the arithmetic says
 *  - the vertical crop cap is tighter than the horizontal one, because heads are at the top
 *  - when a vertical crop IS allowed, the window is biased upward to keep headroom
 *  - an operator override always wins, in both directions
 *  - the generated ffmpeg fragment is syntactically whole and carries the bias term
 *
 * Run standalone: node test/memorial-fit.test.js */
'use strict';
const A = require('./_assert.js');

(async () => {
  const F = await import('../memorial/fit.mjs');

  /* ---------- 1. ORIENTATION, with a dead zone so 1.02:1 is not "landscape" ---------- */
  {
    A.eq(F.orientationOf(1920, 1080), 'landscape', 'wide is landscape');
    A.eq(F.orientationOf(1080, 1920), 'portrait', 'tall is portrait');
    A.eq(F.orientationOf(1000, 1000), 'square', 'square is square');
    A.eq(F.orientationOf(1020, 1000), 'square', 'a 2% deviation is still square, not landscape');
  }

  /* ---------- 2. CROP LOSS is measured per axis, not as one number ---------- */
  {
    const l = F.cropLoss(3000, 2000, 1920, 1080);
    A.eq(l.x, 0, '3:2 into 16:9 loses nothing horizontally');
    A.ok(l.y > 0.15 && l.y < 0.16, `3:2 into 16:9 loses ~15.6% vertically (got ${l.y})`);

    const sq = F.cropLoss(2400, 2400, 1920, 1080);
    A.ok(sq.y > 0.43 && sq.y < 0.44, `square into 16:9 loses ~43.8% vertically (got ${sq.y})`);

    const same = F.cropLoss(3200, 1800, 1920, 1080);
    A.ok(same.max < 0.001, 'matching aspect loses nothing');
  }

  /* ---------- 3. THE FACE RULE — this is the one that protects the product ---------- */
  {
    const p = F.planFit(2000, 3000, 1920, 1080);
    A.eq(p.strategy, 'pad', 'a portrait photo in a landscape frame is padded, never cropped');
    A.ok(/never cropped/.test(p.reason), 'and says so plainly');

    const q = F.planFit(1080, 1920, 1080, 1920);
    A.eq(q.strategy, 'crop', 'a portrait photo in a PORTRAIT frame is fine to crop');

    /* The rule must hold even when the arithmetic is mild. */
    const mild = F.planFit(1000, 1100, 1920, 1080);
    A.eq(mild.strategy, 'pad', 'portrait-ish in landscape frame is still padded');
  }

  /* ---------- 4. ASYMMETRIC CAPS ---------- */
  {
    A.ok(F.MAX_CROP_LOSS_V < F.MAX_CROP_LOSS_H,
      'the vertical cap must stay TIGHTER than the horizontal one — heads are at the top');

    const threeTwo = F.planFit(3000, 2000, 1920, 1080);
    A.eq(threeTwo.strategy, 'crop', '3:2 (15.6% vertical) is within the 20% vertical cap');
    A.ok(/headroom/.test(threeTwo.reason), 'and the reason records that headroom is preserved');

    const square = F.planFit(2400, 2400, 1920, 1080);
    A.eq(square.strategy, 'pad', 'square (43.8% vertical) exceeds the cap and is padded');

    /* A very wide panorama loses width, not height — the looser axis. */
    const pano = F.planFit(6000, 1800, 1920, 1080);
    A.eq(pano.lossY, 0, 'a panorama loses nothing vertically');
  }

  /* ---------- 5. OPERATOR OVERRIDE wins in both directions ---------- */
  {
    A.eq(F.planFit(2000, 3000, 1920, 1080, 'crop').strategy, 'crop', 'forced crop overrides the face rule');
    A.eq(F.planFit(3200, 1800, 1920, 1080, 'pad').strategy, 'pad', 'forced pad overrides a free crop');
    A.throws(() => F.planFit(100, 100, 100, 100, 'nonsense'), 'an unknown fit mode is refused, not guessed');
    A.throws(() => F.planFit(0, 100, 100, 100), 'a zero dimension is refused');
  }

  /* ---------- 6. THE FFMPEG FRAGMENT ---------- */
  {
    const crop = F.fitFilter('0:v', 'fit', F.planFit(3000, 2000, 1920, 1080), 15360, 8640);
    A.ok(crop.includes('[0:v]') && crop.includes('[fit]'), 'crop fragment wires input to output');
    A.ok(crop.includes('force_original_aspect_ratio=increase'), 'crop scales to cover');
    A.ok(crop.includes(`*${F.CROP_Y_BIAS}`), 'crop carries the upward y-bias term, not a centred crop');

    const pad = F.fitFilter('0:v', 'fit', F.planFit(2000, 3000, 1920, 1080), 15360, 8640);
    A.ok(pad.includes('split=2'), 'pad builds both a backdrop and a foreground from one input');
    A.ok(pad.includes('gblur'), 'pad blurs the backdrop');
    A.ok(pad.includes('overlay='), 'pad composites the photo over the backdrop');
    A.ok(pad.includes('[fit]'), 'pad ends on the requested label');
    /* The blur must happen at low resolution. Blurring at 15360px would cost more than the
     * entire render and look identical, because it is a blur. */
    A.ok(!/scale=15360:8640:[^;]*gblur/.test(pad), 'pad does not blur at the oversampled size');
  }

  /* ---------- 7. FRAME SIZE ---------- */
  {
    A.eq(F.frameSize('16:9', 1080), { w: 1920, h: 1080 }, '16:9 at 1080p');
    A.eq(F.frameSize('9:16', 1920), { w: 1080, h: 1920 }, '9:16 vertical');
    A.eq(F.frameSize('4:3', 1080), { w: 1440, h: 1080 }, '4:3');
    A.throws(() => F.frameSize('banana', 1080), 'a malformed aspect is refused');
    const s = F.frameSize('16:9', 1081);
    A.ok(s.w % 2 === 0 && s.h % 2 === 0, 'dimensions are always even — h264 requires it');
  }

  A.report('memorial-fit');
})().catch(e => { console.error(e); process.exit(1); });

// picoface.mjs — self-contained re-implementation of the pico detector runtime (Markus et al., MIT)
// for the `facefinder` cascade, with in-plane rotation support (as in the C runtime's run_rotated_cascade).
// Node core only. No dependency on pico.js.
export function unpackCascade(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let p = 8;
  const tdepth = dv.getInt32(p, true); p += 4;
  const ntrees = dv.getInt32(p, true); p += 4;
  const nn = 1 << tdepth;
  const tcodes = new Int8Array(ntrees * nn * 4);
  const tpreds = new Float32Array(ntrees * nn);
  const thresh = new Float32Array(ntrees);
  for (let t = 0; t < ntrees; t++) {
    for (let i = 0; i < 4 * nn - 4; i++) tcodes[t * nn * 4 + 4 + i] = dv.getInt8(p + i);
    p += 4 * nn - 4;
    for (let i = 0; i < nn; i++) { tpreds[t * nn + i] = dv.getFloat32(p, true); p += 4; }
    thresh[t] = dv.getFloat32(p, true); p += 4;
  }
  if (p !== buf.length) throw new Error(`cascade size mismatch: parsed ${p} of ${buf.length}`);
  return { tdepth, ntrees, tcodes, tpreds, thresh };
}

// returns raw detections [row, col, size, score, angleDeg]
export function runCascade(img, cas, { minsize, maxsize, scalefactor = 1.1, shiftfactor = 0.1, angle = 0 }) {
  const { pixels, width, height } = img;
  const { tdepth, ntrees, tcodes, tpreds, thresh } = cas;
  const nn = 1 << tdepth;
  const a = (angle * Math.PI) / 180, qc = Math.cos(a), qs = Math.sin(a);
  const margin = angle ? Math.SQRT2 : 1; // rotated tests reach further from the centre
  const dets = [];
  for (let s = minsize; s <= maxsize; s *= scalefactor) {
    const step = Math.max(shiftfactor * s, 1) | 0;
    const off = (margin * s / 2 + 1) | 0;
    const kc = (s * qc) / 256, ks = (s * qs) / 256;
    for (let r = off; r <= height - off; r += step) {
      for (let c = off; c <= width - off; c += step) {
        let o = 0.0, t = 0, root = 0;
        for (; t < ntrees; t++) {
          let idx = 1;
          for (let d = 0; d < tdepth; d++) {
            const q = root + 4 * idx;
            const t0 = tcodes[q], t1 = tcodes[q + 1], t2 = tcodes[q + 2], t3 = tcodes[q + 3];
            const r1 = (r + kc * t0 - ks * t1) | 0, c1 = (c + ks * t0 + kc * t1) | 0;
            const r2 = (r + kc * t2 - ks * t3) | 0, c2 = (c + ks * t2 + kc * t3) | 0;
            idx = 2 * idx + (pixels[r1 * width + c1] <= pixels[r2 * width + c2] ? 1 : 0);
          }
          o += tpreds[nn * t + idx - nn];
          if (o <= thresh[t]) break;
          root += 4 * nn;
        }
        if (t === ntrees) dets.push([r, c, s, o - thresh[ntrees - 1], angle]);
      }
    }
  }
  return dets;
}

const iou = (a, b) => {
  const ow = Math.max(0, Math.min(a[1] + a[2] / 2, b[1] + b[2] / 2) - Math.max(a[1] - a[2] / 2, b[1] - b[2] / 2));
  const oh = Math.max(0, Math.min(a[0] + a[2] / 2, b[0] + b[2] / 2) - Math.max(a[0] - a[2] / 2, b[0] - b[2] / 2));
  return (ow * oh) / (a[2] * a[2] + b[2] * b[2] - ow * oh);
};

// Same greedy clustering as pico.js: sort by score, average members with IoU > thr, SUM the scores.
export function cluster(dets, thr = 0.2) {
  dets = dets.slice().sort((a, b) => b[3] - a[3]);
  const used = new Uint8Array(dets.length), out = [];
  for (let i = 0; i < dets.length; i++) {
    if (used[i]) continue;
    let r = 0, c = 0, s = 0, q = 0, n = 0; const ang = {};
    for (let j = i; j < dets.length; j++) {
      if (!used[j] && iou(dets[i], dets[j]) > thr) {
        used[j] = 1; r += dets[j][0]; c += dets[j][1]; s += dets[j][2]; q += dets[j][3]; n++;
        ang[dets[j][4]] = (ang[dets[j][4]] || 0) + dets[j][3];
      }
    }
    const best = +Object.entries(ang).sort((x, y) => y[1] - x[1])[0][0];
    out.push({ r: r / n, c: c / n, s: s / n, q, n, angle: best });
  }
  return out;
}

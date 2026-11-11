#!/usr/bin/env node
/* memorial/jitter-check.mjs — prove the 8x oversample decision has not rotted.
 *
 * WHY THIS IS COMPARATIVE, NOT AN ABSOLUTE THRESHOLD
 * --------------------------------------------------
 * The design choice came from measuring RMS of the 2nd difference of a tracked edge's sub-pixel
 * position: 1x = 1.1218, 4x = 0.2745, 8x = 0.1061 output px. It is tempting to assert
 * "RMS < 0.15" and be done. That assertion is wrong, and I got it wrong first:
 *
 *   - the calibration panned at ~0.50 px/frame; a real memorial drift is ~0.03 px/frame
 *   - at that speed the centroid estimator's own noise on a compressed frame DOMINATES the
 *     measurement, so the production pipeline scores ~0.24 while being visibly smooth
 *
 * So this renders the SAME content twice through the real pipeline, at 1x and at 8x, and compares.
 * That controls for pan rate, codec, resolution and estimator noise. The signal that actually
 * matters is the count of whole-pixel JUMPS: integer snapping produces a staircase, and a
 * staircase is what the eye sees.
 *
 * Measured here 2026-11-09:  1x -> RMS 1.6255, 54 jumps/119 frames
 *                            8x -> RMS 0.2391,  4 jumps/119 frames
 *
 * Takes a couple of minutes. Deliberately NOT in test/fast.list — it renders video.
 *   node memorial/jitter-check.mjs
 */
'use strict';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createCanvas } from '@napi-rs/canvas';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-jitter-'));
const IN = path.join(TMP, 'in');
fs.mkdirSync(IN, { recursive: true });

/* One hard vertical edge with mild lens softness — the cleanest possible sub-pixel target. */
{
  const W = 3000, H = 1688;
  const c = createCanvas(W, H), x = c.getContext('2d');
  x.fillStyle = '#1e1e1e'; x.fillRect(0, 0, W, H);
  x.fillStyle = '#e6e6e6'; x.fillRect(W / 2, 0, W / 2, H);
  x.filter = 'blur(1px)'; x.drawImage(c, 0, 0);
  fs.writeFileSync(path.join(IN, 'chart.png'), c.toBuffer('image/png'));
}

const order = {
  orderId: 'jitter', aspect: '16:9', hold: 5.0, xfade: 0.5, outputRoot: './out',
  subject: { name: 'J' },
  photos: [{ file: 'in/chart.png', motion: 'driftR', fit: 'crop' }],
  cards: [],
};
fs.writeFileSync(path.join(TMP, 'order.json'), JSON.stringify(order));

function measure(video) {
  const frames = path.join(TMP, 'f');
  for (const f of fs.readdirSync(TMP).filter(n => n.startsWith('f') && n.endsWith('.png'))) {
    fs.unlinkSync(path.join(TMP, f));
  }
  execFileSync('ffmpeg', ['-v', 'error', '-i', video, '-vf', 'crop=iw:2:0:ih/2',
    '-frames:v', '120', frames + '-%03d.png', '-y']);

  const pos = [];
  for (const name of fs.readdirSync(TMP).filter(n => /^f-\d+\.png$/.test(n)).sort()) {
    /* Decode with ffmpeg to raw gray rather than pulling in an image decoder. */
    const r = spawnSync('ffmpeg', ['-v', 'error', '-i', path.join(TMP, name),
      '-vf', 'crop=iw:1:0:0', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1 << 24 });
    const px = r.stdout;
    if (!px || px.length < 16) continue;
    let s = 0, m = 0, acc = 0;
    for (let i = 0; i < px.length - 1; i++) {
      const g = Math.abs(px[i + 1] - px[i]);
      s += g; acc += i * g; if (g > m) m = g;
    }
    if (m < 30 || s === 0) continue;
    pos.push(acc / s);
  }
  const d1 = pos.slice(1).map((p, i) => p - pos[i]);
  const d2 = d1.slice(1).map((v, i) => v - d1[i]);
  const rms = Math.sqrt(d2.reduce((a, v) => a + v * v, 0) / Math.max(1, d2.length));
  const jumps = d1.filter(v => Math.abs(v) > 0.6).length;
  return { frames: pos.length, rms, jumps, total: d1.length };
}

const out = {};
for (const over of [1, 8]) {
  fs.rmSync(path.join(TMP, 'out'), { recursive: true, force: true });
  execFileSync(process.execPath, ['-e', `
    import('${path.resolve('memorial/render.mjs')}').then(async m => {
      const o = JSON.parse(require('fs').readFileSync('${path.join(TMP, 'order.json')}','utf8'));
      await m.renderOrder(o, { baseDir: '${TMP}', log: () => {} });
    }).catch(e => { console.error(e.message); process.exit(1); });
  `], { env: { ...process.env, MEMORIAL_OVERSAMPLE: String(over) }, stdio: ['ignore', 'ignore', 'inherit'] });
  out[over] = measure(path.join(TMP, 'out', 'out', 'jitter.mp4'));
  const r = out[over];
  console.log(`  oversample ${over}x : RMS 2nd-diff=${r.rms.toFixed(4)}  whole-pixel jumps=${r.jumps}/${r.total}`);
}

fs.rmSync(TMP, { recursive: true, force: true });

/* The assertions are RELATIVE, for the reason in the header. */
const better = out[1].rms / out[8].rms;
const ok = out[8].jumps <= 12 && better >= 3;
console.log();
console.log(`  8x is ${better.toFixed(1)}x smoother than 1x; ${out[8].jumps} jumps in ${out[8].total} frames`);
console.log(ok ? 'PASS — oversampling is working' : 'FAIL — oversampling is not doing its job');
process.exit(ok ? 0 : 1);

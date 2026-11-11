#!/usr/bin/env node
/* memorial/examples/make-demo-assets.mjs — build the LIFE WORTH REMEMBERING demo's assets.
 *
 * WHY SYNTHETIC: the demo must contain no real deceased person and no real family's photographs.
 * Etsy requires a listing to show "photos of real, finished items you've made in the past", so a
 * genuine finished film has to exist before the product can be listed compliantly — but the
 * subject of that film must be fictional. Every image here is drawn from scratch by this script.
 * The subject, the dates and the places are invented.
 *
 * The audio bed is likewise SYNTHESISED here (a slow three-note pad built from sine waves), not a
 * hymn recording. A public-domain hymn TEXT and TUNE does not make a RECORDING public domain —
 * the sound recording and any modern arrangement are separate copyrights. Shipping a demo with an
 * unlicensed hymn recording would be the exact mistake the research flagged.
 *
 * Aspect ratios are deliberately mixed so the demo exercises BOTH fit paths: the 3:2 and 16:9
 * frames crop (with headroom preserved), the portraits and the square pad.
 */
'use strict';

import { createCanvas } from '@napi-rs/canvas';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const IN = path.join(HERE, 'life-worth-remembering', 'in');
fs.mkdirSync(IN, { recursive: true });

/* Era palettes: early life reads warm and faded, later life cooler and cleaner. */
const ERAS = {
  1930: { sky: '#d8c7a4', ground: '#9c8560', ink: '#6b5536', grain: 0.22 },
  1950: { sky: '#cdbfa2', ground: '#8f8358', ink: '#5e5433', grain: 0.17 },
  1970: { sky: '#c3c0a6', ground: '#8a8a64', ink: '#55553a', grain: 0.12 },
  1990: { sky: '#bcc6cb', ground: '#7f8a84', ink: '#42514f', grain: 0.07 },
  2010: { sky: '#c6d3dc', ground: '#8a9a93', ink: '#3a4b4c', grain: 0.03 },
};

function grain(ctx, w, h, amount) {
  if (amount <= 0) return;
  for (let i = 0; i < w * h * amount * 0.004; i++) {
    const a = Math.random() * amount * 0.5;
    ctx.fillStyle = `rgba(${Math.random() > 0.5 ? 255 : 0},${Math.random() > 0.5 ? 250 : 0},230,${a})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 1.6, 1.6);
  }
}

/* A deliberately abstract "figure": a head and shoulders, placed HIGH in the frame so that a
 * careless crop to a wider aspect would decapitate it. That is the whole point of the demo. */
function figure(ctx, w, h, pal, scale = 1) {
  const cx = w / 2;
  const headR = Math.min(w, h) * 0.105 * scale;
  const headY = h * 0.26;
  ctx.fillStyle = '#e8cdb0';
  ctx.beginPath(); ctx.arc(cx, headY, headR, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = pal.ink;
  ctx.beginPath();
  ctx.ellipse(cx, headY + headR * 2.6, headR * 2.0, headR * 2.3, 0, 0, Math.PI * 2);
  ctx.fill();
}

function scene(file, w, h, eraKey, caption, variant) {
  const pal = ERAS[eraKey];
  const c = createCanvas(w, h);
  const x = c.getContext('2d');

  const g = x.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, pal.sky);
  g.addColorStop(0.62, pal.sky);
  g.addColorStop(1, pal.ground);
  x.fillStyle = g; x.fillRect(0, 0, w, h);

  if (variant === 'trees') {
    for (let i = 0; i < 9; i++) {
      const tx = (i + 0.5) * (w / 9) + (Math.random() - 0.5) * w * 0.05;
      const th = h * (0.18 + Math.random() * 0.14);
      x.fillStyle = pal.ink; x.globalAlpha = 0.33;
      x.beginPath(); x.ellipse(tx, h * 0.60, w * 0.045, th, 0, 0, Math.PI * 2); x.fill();
      x.globalAlpha = 1;
    }
  } else if (variant === 'house') {
    x.fillStyle = pal.ink; x.globalAlpha = 0.28;
    x.fillRect(w * 0.12, h * 0.46, w * 0.30, h * 0.26);
    x.beginPath(); x.moveTo(w * 0.10, h * 0.46); x.lineTo(w * 0.27, h * 0.34); x.lineTo(w * 0.44, h * 0.46); x.closePath(); x.fill();
    x.globalAlpha = 1;
  } else if (variant === 'sea') {
    x.fillStyle = pal.ink; x.globalAlpha = 0.16;
    for (let i = 0; i < 26; i++) x.fillRect(0, h * 0.66 + i * (h * 0.013), w, h * 0.004);
    x.globalAlpha = 1;
  }

  figure(x, w, h, pal, variant === 'group' ? 0.8 : 1);
  if (variant === 'group') {
    const save = x.translate ? null : null;
    x.save(); x.translate(-w * 0.17, h * 0.02); figure(x, w, h, pal, 0.72); x.restore();
    x.save(); x.translate(w * 0.17, h * 0.02); figure(x, w, h, pal, 0.72); x.restore();
  }

  /* A soft vignette, because every old print has one. */
  const v = x.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.30, w / 2, h / 2, Math.max(w, h) * 0.72);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(40,28,14,0.34)');
  x.fillStyle = v; x.fillRect(0, 0, w, h);

  grain(x, w, h, pal.grain);

  fs.writeFileSync(path.join(IN, file), c.toBuffer('image/jpeg', { quality: 90 }));
  return { file, w, h, caption };
}

/* Thirty photographs. A two-to-three minute film at a six-second hold needs roughly this many —
 * ten would give about seventy-five seconds, which is not the product the brief describes.
 * Shapes are mixed on purpose: portraits and squares take the PAD path, 3:2 and 16:9 take CROP. */
const SHAPES = {
  portrait: [1800, 2400],
  square:   [2400, 2400],
  classic:  [3000, 2000],   // 3:2
  wide:     [3200, 1800],   // 16:9
};

const SCRIPT = [
  [1930, 'portrait', 'Margaret, aged four',          'house'],
  [1930, 'classic',  'The family garden',            'trees'],
  [1930, 'classic',  'Her mother, Elsie',            'house'],
  [1930, 'square',   'School, Bell Lane',            'group'],
  [1930, 'portrait', 'Sunday best',                  'trees'],
  [1930, 'wide',     'The long field',               'trees'],
  [1950, 'square',   'A wedding morning',            'group'],
  [1950, 'classic',  'Thomas',                       'house'],
  [1950, 'wide',     'The house on Bell Lane',       'house'],
  [1950, 'portrait', 'First winter',                 'house'],
  [1950, 'classic',  'The kitchen table',            'house'],
  [1950, 'classic',  'Summers by the sea',           'sea'],
  [1970, 'square',   'Three children',               'group'],
  [1970, 'classic',  'The allotment',                'trees'],
  [1970, 'wide',     'Harvest',                      'trees'],
  [1970, 'portrait', 'Choir practice',               'house'],
  [1970, 'classic',  'The caravan',                  'sea'],
  [1970, 'classic',  'Every Easter',                 'trees'],
  [1990, 'square',   'Grandchildren',                'group'],
  [1990, 'classic',  'Still gardening',              'trees'],
  [1990, 'wide',     'The old walk',                 'trees'],
  [1990, 'portrait', 'Eighty candles',               'house'],
  [1990, 'classic',  'Tea, always',                  'house'],
  [1990, 'classic',  'The sea again',                'sea'],
  [2010, 'square',   'Four generations',             'group'],
  [2010, 'classic',  'Her chair by the window',      'house'],
  [2010, 'wide',     'The last garden',              'trees'],
  [2010, 'portrait', 'Ninety years',                 'house'],
  [2010, 'classic',  'Hands',                        'house'],
  [2010, 'classic',  'The last spring',              'sea'],
];

const PHOTOS = SCRIPT.map(([era, shape, caption, variant], i) => {
  const [w, h] = SHAPES[shape];
  return scene(String(i + 1).padStart(2, '0') + '.jpg', w, h, era, caption, variant);
});

/* A slow, soft pad. Three sine partials, long fades, well below any melody — this is a bed, and
 * it is OURS, which is the only reason it can ship in a demo. */
const BED_SEC = 220;   // comfortably longer than the film; audio-finish trims to the video
const musicPath = path.join(HERE, 'life-worth-remembering', 'bed.m4a');
execFileSync('ffmpeg', [
  '-hide_banner', '-loglevel', 'error', '-y',
  '-f', 'lavfi', '-i', `sine=frequency=174.61:duration=${BED_SEC}`,   // F3
  '-f', 'lavfi', '-i', `sine=frequency=220.00:duration=${BED_SEC}`,   // A3
  '-f', 'lavfi', '-i', `sine=frequency=261.63:duration=${BED_SEC}`,   // C4
  '-filter_complex',
  '[0:a]volume=0.26[a];[1:a]volume=0.18[b];[2:a]volume=0.13[c];' +
  '[a][b][c]amix=inputs=3:normalize=0,' +
  'tremolo=f=0.14:d=0.30,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,' +
  `afade=t=in:st=0:d=6,afade=t=out:st=${BED_SEC - 6}:d=6[out]`,
  /* AAC rather than WAV: a 220-second stereo WAV is ~40 MB of demo asset for no benefit. */
  '-map', '[out]', '-c:a', 'aac', '-b:a', '160k', musicPath,
]);

console.log(`${PHOTOS.length} photographs -> ${IN}`);
for (const p of PHOTOS) console.log(`  ${p.file}  ${p.w}x${p.h}  "${p.caption}"`);
console.log(`audio bed -> ${musicPath} (${(fs.statSync(musicPath).size / 1048576).toFixed(1)} MB, synthesised here, no third-party rights)`);

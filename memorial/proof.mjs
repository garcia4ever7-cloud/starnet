/* memorial/proof.mjs — the pictures a human looks at before and after a render.
 *
 *   faceSheet     every photo with its face boxes drawn — the operator's check on the detector
 *   storyboard    every scene and card as a still, in order, with its timing — the film on one
 *                 page, in seconds, before twenty minutes are spent rendering it
 *   makeProof     a small watermarked copy of the finished film to send for approval; the
 *                 family sees exactly the final cut, and the deliverable stays unsent until they
 *                 have approved it
 *   makeTvPreview the film playing on a television in a room — the "how it will look at the
 *                 service" image for the customer and the shop listing
 *
 * The proof and the TV preview are transcoded FROM the finished master, never re-rendered, so
 * they cannot differ from what will be delivered.
 */
'use strict';

import { createCanvas, loadImage } from '@napi-rs/canvas';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { protect } from './layouts.mjs';
import { ensureFonts } from './plates.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const TV_ROOM = path.join(HERE, 'assets', 'tv', 'tv-mockup-room.png');
/* The television's screen inside tv-mockup-room.png (2688x1520). Measured 2026-11-24 by scanning
 * the image for the dark panel (x 626–2059, y 142–923) and insetting 8 px for the bezel. The
 * panel is slightly wider than 16:9 (1.85:1), so the film is scaled to the screen's width and
 * 2% is trimmed from its top and bottom — in this PREVIEW only; all text sits 5% in. */
export const TV_SCREEN = { imgW: 2688, imgH: 1520, x: 634, y: 150, w: 1418, h: 766 };

function run(cmd, args) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    p.stderr.on('data', d => { err += d; });
    p.on('error', e => resolve({ code: -1, err: String(e && e.message || e) }));
    p.on('close', code => resolve({ code, err }));
  });
}

/* ------------------------------------------------------------------ face sheet */

/**
 * faceSheet — one JPEG showing each photo with its faces boxed.
 *   solid box   the face as marked (operator) or found (detector)
 *   faint box   the protected region the engine will never crop into
 * @param photos from planGallery: [{index, file, w, h, faces, faceSource, order}]
 */
export async function faceSheet(photos, outFile) {
  const F = ensureFonts();
  const cols = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(photos.length))));
  const cell = 480, label = 46, pad = 12;
  const rows = Math.ceil(photos.length / cols);
  const c = createCanvas(cols * (cell + pad) + pad, rows * (cell + label + pad) + pad);
  const x = c.getContext('2d');
  x.fillStyle = '#1b1b1b'; x.fillRect(0, 0, c.width, c.height);
  const colour = { operator: '#4da3ff', detector: '#3ddc84', unknown: '#ff9f43' };
  for (const [k, p] of photos.entries()) {
    const img = await loadImage(p.file);
    const s = Math.min(cell / img.width, cell / img.height);
    const w = img.width * s, h = img.height * s;
    const cx = pad + (k % cols) * (cell + pad), cy = pad + Math.floor(k / cols) * (cell + label + pad);
    const ox = cx + (cell - w) / 2, oy = cy + (cell - h) / 2;
    x.drawImage(img, ox, oy, w, h);
    const col = colour[p.faceSource] || '#fff';
    for (const f of (p.faces || [])) {
      const pr = protect(f);
      x.strokeStyle = col; x.globalAlpha = 0.45; x.lineWidth = 2; x.setLineDash([6, 5]);
      x.strokeRect(ox + pr.x0 * w, oy + pr.y0 * h, (pr.x1 - pr.x0) * w, (pr.y1 - pr.y0) * h);
      x.globalAlpha = 1; x.setLineDash([]); x.lineWidth = 3;
      x.strokeRect(ox + f.x0 * w, oy + f.y0 * h, (f.x1 - f.x0) * w, (f.y1 - f.y0) * h);
    }
    x.fillStyle = col; x.font = `22px ${F.text}`; x.textBaseline = 'top'; x.textAlign = 'left';
    const n = p.faces ? p.faces.length : 0;
    const what = p.faceSource === 'unknown' ? 'no face found — will not be cropped' : `${n} face${n === 1 ? '' : 's'} (${p.faceSource})`;
    x.fillText(`${p.index + 1}. ${path.basename(p.order.file).slice(0, 22)} — ${what}`, cx, cy + cell + 8);
  }
  await fsp.writeFile(outFile, c.toBuffer('image/jpeg', 88));
  return outFile;
}

/* ------------------------------------------------------------------ storyboard */

/** storyboard — every item's plate (with its text) as one sheet. */
export async function storyboard(plan, report, outFile) {
  const F = ensureFonts();
  const cols = 3, tw = 640, th = 360, label = 40, pad = 10;
  const rows = Math.ceil(plan.items.length / cols);
  const c = createCanvas(cols * (tw + pad) + pad, rows * (th + label + pad) + pad);
  const x = c.getContext('2d');
  x.fillStyle = '#161616'; x.fillRect(0, 0, c.width, c.height);
  for (const [n, it] of plan.items.entries()) {
    const cx = pad + (n % cols) * (tw + pad), cy = pad + Math.floor(n / cols) * (th + label + pad);
    x.drawImage(await loadImage(it.plate), cx, cy, tw, th);
    for (const L of (it.layers || [])) x.drawImage(await loadImage(L.file), cx, cy, tw, th);
    const r = report.items[n];
    const at = Math.floor(r.at), mm = Math.floor(at / 60), ss = String(at % 60).padStart(2, '0');
    const what = it.kind === 'card' ? `card · ${it.card.type}` : `${it.scene.kind} · photo ${it.scene.photos.map(i => i + 1).join(', ')}`;
    x.fillStyle = it.actBreak ? '#ffcf70' : '#d8d8d8'; x.font = `20px ${F.text}`; x.textBaseline = 'top'; x.textAlign = 'left';
    x.fillText(`${n + 1}. ${mm}:${ss}  ${what}  · ${it.hold.toFixed(1)} s${it.actBreak ? '  · act break' : ''}`, cx + 2, cy + th + 8);
  }
  await fsp.writeFile(outFile, c.toBuffer('image/jpeg', 86));
  return outFile;
}

/* ------------------------------------------------------------------ proof */

function watermarkPng(w, h, text) {
  const F = ensureFonts();
  const c = createCanvas(w, h);
  const x = c.getContext('2d');
  x.textAlign = 'center'; x.textBaseline = 'middle';
  const big = Math.round(h * 0.11);
  x.font = `${big}px ${F.display}`;
  x.lineWidth = Math.max(2, big * 0.04);
  x.strokeStyle = 'rgba(0,0,0,0.28)'; x.fillStyle = 'rgba(255,255,255,0.42)';
  x.strokeText(text, w / 2, h / 2); x.fillText(text, w / 2, h / 2);
  const small = Math.round(h * 0.045);
  x.font = `${small}px ${F.text}`; x.textAlign = 'right'; x.textBaseline = 'alphabetic';
  x.fillStyle = 'rgba(255,255,255,0.55)';
  x.fillText(text, w - w * 0.04, h - h * 0.05);
  return c.toBuffer('image/png');
}

/** makeProof — 960x540 watermarked copy of the finished film, for approval before delivery. */
export async function makeProof(finalPath, outFile, opts = {}) {
  if (!fs.existsSync(finalPath)) throw new Error(`proof: film not found: ${finalPath}`);
  const w = 960, h = 540;
  const wm = outFile + '.wm.png';
  await fsp.writeFile(wm, watermarkPng(w, h, opts.text || 'PROOF  ·  NOT FINAL'));
  const tmp = outFile + '.tmp.mp4';
  const r = await run('ffmpeg', ['-hide_banner', '-nostats', '-y', '-i', finalPath, '-i', wm,
    '-filter_complex', `[0:v]scale=${w}:${h}:flags=bicubic[v];[v][1:v]overlay=0:0:format=auto,format=yuv420p[o]`,
    '-map', '[o]', '-map', '0:a?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', tmp]);
  await fsp.rm(wm, { force: true });
  if (r.code !== 0 || !fs.existsSync(tmp)) throw new Error(`proof failed: ${r.err.split('\n').filter(Boolean).slice(-3).join(' | ')}`);
  await fsp.rename(tmp, outFile);
  return outFile;
}

/* ------------------------------------------------------------------ TV preview */

/**
 * makeTvPreview — the film on the television in the mockup room.
 * @param opts {start?: sec, seconds?: number (default 12; 0 = whole film), still?: path}
 */
export async function makeTvPreview(finalPath, outFile, opts = {}) {
  if (!fs.existsSync(finalPath)) throw new Error(`tv preview: film not found: ${finalPath}`);
  if (!fs.existsSync(TV_ROOM)) throw new Error(`tv preview: ${TV_ROOM} is missing`);
  const W = 1920, H = 1080;
  const k = W / TV_SCREEN.imgW;
  const roomH = Math.round(TV_SCREEN.imgH * k / 2) * 2;
  const top = Math.max(0, Math.round((roomH - H) / 2));
  const sw = Math.round(TV_SCREEN.w * k / 2) * 2, sh = Math.round(TV_SCREEN.h * k / 2) * 2;
  const sx = Math.round(TV_SCREEN.x * k), sy = Math.round(TV_SCREEN.y * k) - top;
  const start = Number(opts.start ?? 0), secs = Number(opts.seconds ?? 12);
  const graph = `[0:v]scale=${W}:${roomH}:flags=lanczos,crop=${W}:${H}:0:${top},setsar=1[room];`
    + `[1:v]scale=${sw}:-2:flags=bicubic,crop=${sw}:${sh},setsar=1[film];[room][film]overlay=${sx}:${sy}:shortest=1,format=yuv420p[o]`;
  const tmp = outFile + '.tmp.mp4';
  const args = ['-hide_banner', '-nostats', '-y', '-loop', '1', '-framerate', '30', '-i', TV_ROOM, '-ss', String(start)];
  if (secs > 0) args.push('-t', String(secs));
  args.push('-i', finalPath, '-filter_complex', graph, '-map', '[o]', '-map', '1:a?',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-shortest', '-movflags', '+faststart', tmp);
  const r = await run('ffmpeg', args);
  if (r.code !== 0 || !fs.existsSync(tmp)) throw new Error(`tv preview failed: ${r.err.split('\n').filter(Boolean).slice(-3).join(' | ')}`);
  await fsp.rename(tmp, outFile);
  if (opts.still) {
    const s = await run('ffmpeg', ['-hide_banner', '-nostats', '-y', '-ss', String(Math.min(3, Math.max(0, secs / 2 || 3))), '-i', outFile, '-frames:v', '1', '-q:v', '3', opts.still]);
    if (s.code !== 0) throw new Error('tv preview still failed');
  }
  return outFile;
}

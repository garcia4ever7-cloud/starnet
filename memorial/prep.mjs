/* memorial/prep.mjs — bring every customer photograph to one known, upright form.
 *
 * WHY THIS EXISTS (measured 2026-11-24)
 * -------------------------------------
 * ffprobe reports a JPEG's STORED pixel grid; ffmpeg's decoder then applies the EXIF orientation.
 * A phone photo held upright is very often stored sideways with Orientation=6. For such a file
 * ffprobe said 600x400 while the decoded frame was 400x600 — so a fit decision taken from the
 * probe treated a portrait as a landscape and cropped it, which is precisely the face rule being
 * broken by the tool that exists to enforce it. Everything downstream of this module therefore
 * sees only DECODED, upright pixels and the dimensions measured from them.
 *
 * It also bounds the work: a 48-megapixel phone original is reduced once to at most MAX_SIDE on
 * its long edge (no film frame can use more), and odd inputs (HEIC, WebP, CMYK JPEG, 16-bit PNG)
 * become plain sRGB JPEGs the canvas library is guaranteed to open.
 *
 * SCREENSHOT BARS. Families send screenshots of photos as often as photos: a picture with solid
 * black (or white) bands above and below it, baked into the file. Left alone those bands sit
 * inside the print's border like a mistake. A band is trimmed only when it is unmistakable —
 * every row of it is flat (all pixels within a few levels of one very dark or very light tone),
 * it ends at a hard edge against the picture, it spans at least 3% of the side, and at least
 * 55% of the picture survives — and the trim is recorded. `"trim": false` on a photo
 * turns it off (for a picture that really does have a pure black sky).
 *
 * Originals are never modified. Prepared copies live in the order's work directory and are
 * reused while the source file's size and mtime are unchanged.
 */
'use strict';

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

export const MAX_SIDE = 4096;
export const TRIM = { work: 320, dark: 40, light: 215, flat: 4, rowSolid: 0.995, edgeShare: 0.35, minBand: 0.03, minKeep: 0.55 };

function run(cmd, args) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { err += d; });
    p.on('error', e => resolve({ code: -1, out, err: String(e && e.message || e) }));
    p.on('close', code => resolve({ code, out, err }));
  });
}

/* Decoded dimensions of an image file: what ffmpeg will actually hand to a filter graph. */
async function decodedSize(file) {
  const r = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]);
  const m = r.out.trim().match(/^(\d+),(\d+)/);
  return m ? { w: Number(m[1]), h: Number(m[2]) } : null;
}

export function sourceKey(file, trim = true) {
  const st = fs.statSync(file);
  return crypto.createHash('sha256')
    .update(`${path.resolve(file)}\n${st.size}\n${Math.round(st.mtimeMs)}\n${MAX_SIDE}\ntrim=${trim ? 4 : 0}`)
    .digest('hex').slice(0, 16);
}

/**
 * solidBands — how much of each edge of a gray image is a solid black or white band.
 * Pure function over a decoded buffer so it can be tested without ffmpeg.
 * @returns {{x:number,y:number,w:number,h:number}|null} the rect to KEEP (fractions), or null
 */
export function solidBands({ pixels, width, height }, cfg = TRIM) {
  /* A baked-in bar is FLAT: every pixel of a row within a few levels of that row's median, and
   * the median very dark or very light. Flatness, not darkness, is what separates a screenshot
   * bar (measured on a real one: every pixel exactly 11) from a night sky, which has noise.
   * Returns the row's tone (its median) when it is such a line, else null. */
  const solidLine = (get, n) => {
    const hist = new Uint32Array(256);
    for (let i = 0; i < n; i++) hist[get(i)]++;
    let acc = 0, med = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n / 2) { med = v; break; } }
    if (med > cfg.dark && med < cfg.light) return null;
    let near = 0;
    for (let v = Math.max(0, med - cfg.flat); v <= Math.min(255, med + cfg.flat); v++) near += hist[v];
    return near >= n * cfg.rowSolid ? med : null;
  };
  const row = y => solidLine(i => pixels[y * width + i], width);
  const col = x => solidLine(i => pixels[i * width + x], height);
  /* A band is a run of flat lines of ONE tone starting at the edge. */
  const run = (line, n, fromEnd) => {
    const tone = line(fromEnd ? n - 1 : 0);
    if (tone == null) return 0;
    let k = 0;
    for (; k < n; k++) { const t = line(fromEnd ? n - 1 - k : k); if (t == null || Math.abs(t - tone) > cfg.flat) break; }
    return k;
  };
  /* ...and it must END at a hard edge: within three lines of the band's last row, a line where
   * a large share of pixels are clearly not the band's tone. That is what a bar pasted against a
   * photograph looks like. A studio portrait on a flat black backdrop, or a smooth dark
   * gradient, has no such line — the dark simply thins out — and is left exactly as it is. */
  const differs = (get, n, tone) => { let d = 0; for (let i = 0; i < n; i++) if (Math.abs(get(i) - tone) > cfg.flat * 3) d++; return d / n; };
  const hardEdge = (k, n, fromEnd, isRow) => {
    if (!k || k >= n) return false;
    const at = j => (fromEnd ? n - 1 - j : j);
    const tone = (isRow ? row : col)(at(0));
    for (let j = k; j < Math.min(n, k + 3); j++) {
      const L = at(j);
      const share = isRow ? differs(i => pixels[L * width + i], width, tone) : differs(i => pixels[i * width + L], height, tone);
      if (share >= cfg.edgeShare) return true;
    }
    return false;
  };
  let top = run(row, height, false), bottom = run(row, height, true);
  let left = run(col, width, false), right = run(col, width, true);
  const drop = (k, n, fromEnd, isRow) => (k / n >= cfg.minBand && hardEdge(k, n, fromEnd, isRow) ? k : 0);
  top = drop(top, height, false, true); bottom = drop(bottom, height, true, true);
  left = drop(left, width, false, false); right = drop(right, width, true, false);
  if (!(top || bottom || left || right)) return null;
  /* One line of margin so a soft edge of the band is not left behind. */
  const pad = k => (k ? k + 1 : 0);
  const keep = {
    x: pad(left) / width, y: pad(top) / height,
    w: (width - pad(left) - pad(right)) / width, h: (height - pad(top) - pad(bottom)) / height,
  };
  if (keep.w * keep.h < cfg.minKeep || keep.w <= 0 || keep.h <= 0) return null;
  return keep;
}

function decodeGraySmall(file, work) {
  return new Promise((resolve) => {
    const vf = `scale='if(gt(iw,ih),${work},-2)':'if(gt(iw,ih),-2,${work})':flags=area,format=gray`;
    const p = spawn('ffmpeg', ['-hide_banner', '-nostats', '-v', 'error', '-i', file, '-frames:v', '1', '-vf', vf, '-f', 'image2pipe', '-vcodec', 'pgm', '-'], { stdio: ['ignore', 'pipe', 'ignore'] });
    const chunks = [];
    p.stdout.on('data', d => chunks.push(d));
    p.on('error', () => resolve(null));
    p.on('close', code => {
      if (code !== 0) return resolve(null);
      const buf = Buffer.concat(chunks);
      const m = buf.subarray(0, 64).toString('latin1').match(/^P5\s+(\d+)\s+(\d+)\s+(\d+)\s/);
      if (!m) return resolve(null);
      const width = Number(m[1]), height = Number(m[2]);
      const pixels = buf.subarray(m[0].length, m[0].length + width * height);
      resolve(pixels.length === width * height ? { pixels, width, height } : null);
    });
  });
}

/**
 * prepPhoto — an upright sRGB JPEG copy of `source`, at most MAX_SIDE on its long edge.
 * @returns {{file:string, w:number, h:number, source:string, key:string, reused:boolean}}
 */
export async function prepPhoto(source, prepDir, index = 0, opts = {}) {
  if (!fs.existsSync(source)) throw new Error(`photo not found: ${source}`);
  await fsp.mkdir(prepDir, { recursive: true });
  const wantTrim = opts.trim !== false;
  const key = sourceKey(source, wantTrim);
  const out = path.join(prepDir, `p${String(index).padStart(3, '0')}-${key}.jpg`);
  const meta = out + '.json';

  if (fs.existsSync(out) && fs.existsSync(meta)) {
    try {
      const m = JSON.parse(fs.readFileSync(meta, 'utf8'));
      if (m.key === key && m.w > 0 && m.h > 0) return { ...m, file: out, reused: true };
    } catch { /* fall through and rebuild */ }
  }

  /* -frames:v 1 takes the first picture of an animated/multi-frame file. The scale expression
   * only ever shrinks. q:v 2 is visually lossless for a source that is about to be resampled. */
  const tmp = out + '.tmp.jpg';
  let trimmed = null;
  if (wantTrim) {
    const gray = await decodeGraySmall(source, TRIM.work);
    trimmed = gray ? solidBands(gray) : null;
  }
  const cropVf = trimmed
    ? `crop=trunc(iw*${trimmed.w.toFixed(5)}/2)*2:trunc(ih*${trimmed.h.toFixed(5)}/2)*2:trunc(iw*${trimmed.x.toFixed(5)}):trunc(ih*${trimmed.y.toFixed(5)}),`
    : '';
  const vf = `${cropVf}scale='if(gt(iw,ih),min(iw,${MAX_SIDE}),-2)':'if(gt(iw,ih),-2,min(ih,${MAX_SIDE}))':flags=lanczos,format=yuvj444p`;
  const r = await run('ffmpeg', ['-hide_banner', '-nostats', '-v', 'error', '-y', '-i', source,
    '-frames:v', '1', '-vf', vf, '-q:v', '2', '-f', 'image2', '-update', '1', tmp]);
  if (r.code !== 0 || !fs.existsSync(tmp)) {
    const tail = r.err.split('\n').filter(Boolean).slice(-3).join(' | ');
    throw new Error(`cannot decode photo ${path.basename(source)}: ${tail || 'ffmpeg failed'}`);
  }
  const dim = await decodedSize(tmp);
  if (!dim) { await fsp.rm(tmp, { force: true }); throw new Error(`prepared photo is unreadable: ${path.basename(source)}`); }
  await fsp.rename(tmp, out);
  const rec = { source: path.resolve(source), key, w: dim.w, h: dim.h, trimmed };
  await fsp.writeFile(meta, JSON.stringify(rec));
  return { ...rec, file: out, reused: false };
}

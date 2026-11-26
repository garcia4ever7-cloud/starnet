/* memorial/plates.mjs — compose one scene into one picture (a "plate").
 *
 * WHY A PLATE
 * -----------
 * Every scene — a full-bleed photo, a framed print, a pair, a collage — is drawn once, at twice
 * the frame size, into a single opaque image. The segment renderer then gives that one image its
 * slow oversampled move, exactly as it always has for a single photo. Measured on this phone
 * (2026-11-24, 6 s scene, 8x oversample):
 *     one plate                     11 s     ← this design
 *     background + print as layers  120-159 s, 0.9-1.5 GB
 * Two moving layers look marginally richer and cost twelve times as much; a forty-scene film
 * would take two hours instead of ten minutes. One plate it is.
 *
 * FACE PROTECTION HAPPENS IN THE PLAN, NOT HERE. This module draws the crop rectangle it is
 * given and never chooses one. It reports, in frame fractions, where every photo and every line
 * of text landed, so QC can check the result instead of trusting the intent.
 */
'use strict';

import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const BG_DIR = path.join(HERE, 'assets', 'backgrounds');
const FONT_DIR = path.join(HERE, 'assets', 'fonts');

export const PLATE_SCALE = 2;                 // plate = 2x the frame
export const TITLE_SAFE = 0.05;               // EBU R95 / SMPTE ST 2046-1 graphics-safe margin
export const ACTION_SAFE = 0.035;
const PAPER = '#fbf6ec';                      // the print's border — warm white, not screen white

/* Background sets by theme: the order in which chapters take them. */
export const BACKGROUND_SETS = {
  warm:  ['golden-flowers-watercolor', 'classic-elegance', 'garden-of-memories', 'eternal-love'],
  cool:  ['heavenly-peace', 'scenic-sky-valley', 'faith-and-hope', 'classic-elegance'],
  plain: ['classic-elegance'],
  /* Four watercolour dawns over water, supplied by the owner 2026-11-25 ("Lord lead the way"). */
  dawn:  ['lead-the-way-sunrise', 'lead-the-way-river', 'lead-the-way-still-waters', 'lead-the-way-lake'],
};
export function backgroundsAvailable() {
  if (!fs.existsSync(BG_DIR)) return [];
  return fs.readdirSync(BG_DIR).filter(f => /\.jpe?g$/i.test(f)).map(f => f.replace(/\.jpe?g$/i, '')).sort();
}
export function backgroundPath(name) {
  if (!name) return null;
  if (path.isAbsolute(name) && fs.existsSync(name)) return name;
  const p = path.join(BG_DIR, `${name}.jpg`);
  return fs.existsSync(p) ? p : null;
}

/* ------------------------------------------------------------------ fonts */

let FONTS = null;
export function ensureFonts() {
  if (FONTS) return FONTS;
  const reg = (file, alias) => {
    const p = path.join(FONT_DIR, file);
    if (!fs.existsSync(p)) return false;
    GlobalFonts.registerFromPath(p, alias);
    return true;
  };
  const sys = (file, alias) => {
    const p = path.join('/system/fonts', file);
    if (!fs.existsSync(p)) return false;
    GlobalFonts.registerFromPath(p, alias);
    return true;
  };
  /* Display face for names and headings; text face for verses and captions. Both SIL OFL.
   * The Android system serif is the floor so the engine still renders if the bundle is missing. */
  const display = reg('CormorantGaramond-Medium.ttf', 'MemDisplay') || reg('EBGaramond-Regular.ttf', 'MemDisplay') || sys('NotoSerif-Regular.ttf', 'MemDisplay');
  const text = reg('EBGaramond-Regular.ttf', 'MemText') || sys('NotoSerif-Regular.ttf', 'MemText');
  const italic = reg('EBGaramond-Italic.ttf', 'MemItalic') || sys('NotoSerif-Italic.ttf', 'MemItalic');
  if (!display || !text) throw new Error('memorial/plates: no serif font found — see memorial/assets/fonts/');
  /* Script face for the portrait card's name (Great Vibes, SIL OFL). Falls back to the italic. */
  const script = reg('GreatVibes-Regular.ttf', 'MemScript');
  FONTS = { display: 'MemDisplay', text: 'MemText', italic: italic ? 'MemItalic' : 'MemText', script: script ? 'MemScript' : (italic ? 'MemItalic' : 'MemText') };
  return FONTS;
}

/* ------------------------------------------------------------------ drawing helpers */

const imgCache = new Map();
async function load(file) {
  if (!imgCache.has(file)) imgCache.set(file, await loadImage(file));
  return imgCache.get(file);
}
export function clearImageCache() { imgCache.clear(); }

function coverRect(iw, ih, W, H) {
  const s = Math.max(W / iw, H / ih);
  const w = W / s, h = H / s;
  return { sx: (iw - w) / 2, sy: (ih - h) / 2, sw: w, sh: h };
}

/* A blurred, dimmed copy filling the canvas. Blurring a small copy and enlarging it is both
 * much cheaper and smoother than blurring at plate size. */
function drawBlurred(ctx, img, W, H, { blur = 14, dim = 0.82, sat = 0.75, src = null } = {}) {
  const sw = Math.round(W / 8), sh = Math.round(H / 8);
  const small = createCanvas(sw, sh);
  const sx = small.getContext('2d');
  const c = src || coverRect(img.width, img.height, sw, sh);
  sx.filter = `blur(${blur}px) saturate(${sat})`;
  /* Draw oversize so the blur has real pixels to pull from at the edges. */
  const pad = blur * 2;
  sx.drawImage(img, c.sx, c.sy, c.sw, c.sh, -pad, -pad, sw + 2 * pad, sh + 2 * pad);
  sx.filter = 'none';
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(small, 0, 0, W, H);
  if (dim < 1) { ctx.fillStyle = `rgba(0,0,0,${(1 - dim).toFixed(3)})`; ctx.fillRect(0, 0, W, H); }
}

async function drawArtBackground(ctx, bgFile, W, H, { soften = 3, dim = 0.96 } = {}) {
  const img = await load(bgFile);
  const c = coverRect(img.width, img.height, W, H);
  ctx.imageSmoothingQuality = 'high';
  if (soften > 0) ctx.filter = `blur(${soften}px)`;
  ctx.drawImage(img, c.sx, c.sy, c.sw, c.sh, 0, 0, W, H);
  ctx.filter = 'none';
  if (dim < 1) { ctx.fillStyle = `rgba(20,14,8,${(1 - dim).toFixed(3)})`; ctx.fillRect(0, 0, W, H); }
}

/* An elliptical pool of light: full strength in the middle, gone by the edge of (rx, ry). */
function lightPool(ctx, cx, cy, rx, ry, rgb, peak) {
  ctx.save();
  ctx.translate(cx, cy); ctx.scale(1, ry / rx);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, `rgba(${rgb},${peak})`);
  g.addColorStop(0.45, `rgba(${rgb},${(peak * 0.78).toFixed(3)})`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g; ctx.fillRect(-rx, -rx, rx * 2, rx * 2);
  ctx.restore();
}

function vignette(ctx, W, H, strength = 0.28) {
  const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.45, W / 2, H / 2, Math.hypot(W, H) * 0.56);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${strength})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

/* One print: soft shadow, paper border, the photograph. `rect` is the PHOTO area in pixels;
 * `crop` (fractions of the photo) selects what is shown. Returns the outer (bordered) rect. */
function drawPrint(ctx, img, rect, { border, crop = null, shadow = 0.5 }) {
  const { x, y, w, h } = rect;
  const ox = x - border, oy = y - border, ow = w + 2 * border, oh = h + 2 * border;
  ctx.save();
  ctx.shadowColor = `rgba(24,16,8,${shadow})`;
  ctx.shadowBlur = border > 0 ? border * 2.4 : w * 0.02;
  ctx.shadowOffsetX = Math.max(4, w * 0.004);
  ctx.shadowOffsetY = Math.max(8, w * 0.008);
  ctx.fillStyle = border > 0 ? PAPER : '#000';
  ctx.fillRect(ox, oy, ow, oh);
  ctx.restore();
  const c = crop || { x: 0, y: 0, w: 1, h: 1 };
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, c.x * img.width, c.y * img.height, c.w * img.width, c.h * img.height, x, y, w, h);
  if (border > 0) {
    /* A hairline inside the border keeps a pale photo from bleeding into the paper. */
    ctx.strokeStyle = 'rgba(60,45,30,0.18)';
    ctx.lineWidth = Math.max(1, border * 0.06);
    ctx.strokeRect(x, y, w, h);
  }
  return { x: ox, y: oy, w: ow, h: oh };
}

function wrapLines(ctx, text, maxWidth) {
  const out = [];
  for (const para of String(text).split(/\n/)) {
    const words = para.split(/\s+/).filter(Boolean);
    let line = '';
    for (const word of words) {
      const probe = line ? line + ' ' + word : word;
      if (ctx.measureText(probe).width > maxWidth && line) { out.push(line); line = word; }
      else line = probe;
    }
    if (line) out.push(line);
  }
  return out;
}

/* Caption: at most two centred lines, shrunk to fit, never outside title-safe. It sits on a
 * soft dark band that fades out at both ends, so it reads over florals as well as over a photo. */
function drawCaption(ctx, text, W, H) {
  const F = ensureFonts();
  const maxW = W * (1 - 2 * TITLE_SAFE) * 0.88;
  let size = Math.round(H * 0.046), lines;
  for (;;) {
    ctx.font = `${size}px ${F.italic}`;
    lines = wrapLines(ctx, text, maxW);
    if (lines.length <= 2 || size <= Math.round(H * 0.030)) break;
    size -= 2;
  }
  /* Never cut a family's words to make them fit. A caption that needs more than two lines at
   * the smallest legible size is an error the operator fixes, not text the film quietly drops. */
  if (lines.length > 2) throw new Error(`caption is too long to show in two lines (${text.length} characters): "${text.slice(0, 60)}…" — shorten it to about ${Math.floor(text.length * 2 / lines.length / 10) * 10} characters`);
  const lh = size * 1.26;
  /* Last baseline sits so the descenders still clear the title-safe line. */
  const lastBase = H * (1 - TITLE_SAFE) - size * 0.34;
  const firstTop = lastBase - (lines.length - 1) * lh - size;
  const widest = Math.max(...lines.map(ln => ctx.measureText(ln).width));
  const bandW = Math.min(W, widest + size * 6), bandTop = firstTop - size * 0.55, bandH = (lastBase + size * 0.55) - bandTop;
  const g = ctx.createLinearGradient(W / 2 - bandW / 2, 0, W / 2 + bandW / 2, 0);
  g.addColorStop(0, 'rgba(18,12,6,0)'); g.addColorStop(0.22, 'rgba(18,12,6,0.50)');
  g.addColorStop(0.78, 'rgba(18,12,6,0.50)'); g.addColorStop(1, 'rgba(18,12,6,0)');
  ctx.fillStyle = g;
  ctx.fillRect(W / 2 - bandW / 2, bandTop, bandW, bandH);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const boxes = [];
  let y = lastBase - (lines.length - 1) * lh;
  for (const ln of lines) {
    const tw = ctx.measureText(ln).width;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = size * 0.25;
    ctx.shadowOffsetY = size * 0.04;
    ctx.fillStyle = '#fdf8ee';
    ctx.fillText(ln, W / 2, y);
    ctx.restore();
    boxes.push({ x: (W / 2 - tw / 2) / W, y: (y - size) / H, w: tw / W, h: (size * 1.3) / H, text: ln });
    y += lh;
  }
  return boxes;
}

/* ------------------------------------------------------------------ the scene plate */

/**
 * renderScenePlate
 * @param scene  from layouts.planScenes: {kind, rects, crop?, photos:[index]}
 * @param photos prepared photos by index: {file, w, h}
 * @param opts   {w, h, background: path|null, caption?: string}
 * @returns {{png:Buffer, prints:[{x,y,w,h}], photoRects:[…], text:[…], bg:string}}
 */
export async function renderScenePlate(scene, photos, opts) {
  const W = opts.w * PLATE_SCALE, H = opts.h * PLATE_SCALE;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const imgs = [];
  for (const idx of scene.photos) imgs.push(await load(photos[idx].file));
  const caption = (opts.caption || '').trim();
  /* The caption is NOT drawn into the plate. It is its own frame-size layer, laid over the
   * picture after the move, so the words stay still, stay sharp and stay inside title-safe
   * while the photograph drifts beneath them. */
  let captionPng = null;
  const drawCaptionLayer = (withScrim) => {
    const c = createCanvas(opts.w, opts.h);
    const x = c.getContext('2d');
    if (withScrim) {
      const g = x.createLinearGradient(0, opts.h * 0.74, 0, opts.h);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.42)');
      x.fillStyle = g;
      x.fillRect(0, opts.h * 0.74, opts.w, opts.h * 0.26);
    }
    const boxes = drawCaption(x, caption, opts.w, opts.h);
    captionPng = c.toBuffer('image/png');
    return boxes;
  };
  const text = [];
  const prints = [];
  const photoRects = [];
  let bg = 'none';

  const px = r => ({ x: r.x * W, y: r.y * H, w: r.w * W, h: r.h * H });
  const fr = r => ({ x: r.x / W, y: r.y / H, w: r.w / W, h: r.h / H });

  if (scene.kind === 'full') {
    const c = scene.crop;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(imgs[0], c.x * imgs[0].width, c.y * imgs[0].height, c.w * imgs[0].width, c.h * imgs[0].height, 0, 0, W, H);
    vignette(ctx, W, H, 0.24);
    photoRects.push({ x: 0, y: 0, w: 1, h: 1 });
    if (caption) text.push(...drawCaptionLayer(true));
  } else {
    /* Background first. A group photo always sits on its own blurred copy; everything else
     * takes the chapter's art background, or its own blur when the order asks for that. */
    const ownBlur = scene.kind === 'group' || !opts.background;
    if (ownBlur) {
      drawBlurred(ctx, imgs[0], W, H, { blur: 16, dim: 0.78, sat: 0.7 });
      vignette(ctx, W, H, 0.22);
      bg = 'own-blur';
    } else {
      await drawArtBackground(ctx, opts.background, W, H, { soften: scene.kind === 'collage' ? 5 : 3 });
      vignette(ctx, W, H, 0.12);
      bg = path.basename(opts.background).replace(/\.jpe?g$/i, '');
    }

    /* With a caption the prints shrink toward the top so the words get their own clear band. */
    const lift = caption ? { s: 0.88, dy: -0.052 } : { s: 1, dy: 0 };
    const border = scene.kind === 'group' ? 0 : Math.round(W * (scene.kind === 'collage' ? 0.0042 : 0.0068));
    scene.rects.forEach((r0, k) => {
      const r = {
        x: 0.5 + (r0.x - 0.5) * lift.s, y: 0.5 + (r0.y - 0.5) * lift.s + lift.dy,
        w: r0.w * lift.s, h: r0.h * lift.s,
      };
      const outer = drawPrint(ctx, imgs[k], px(r), {
        border, crop: scene.kind === 'group' ? scene.crop : null, shadow: scene.kind === 'collage' ? 0.38 : 0.5,
      });
      photoRects.push(r);
      prints.push(fr(outer));
    });
    if (caption) text.push(...drawCaptionLayer(false));
  }
  return { png: canvas.toBuffer('image/png'), caption: captionPng, prints, photoRects, text, bg, w: W, h: H };
}

/* ------------------------------------------------------------------ card plates */

function tracked(ctx, s, cx, y, tracking) {
  const chars = [...s];
  const widths = chars.map(c => ctx.measureText(c).width);
  const total = widths.reduce((a, b) => a + b, 0) + tracking * Math.max(0, chars.length - 1);
  let x = cx - total / 2;
  ctx.textAlign = 'left';
  for (let i = 0; i < chars.length; i++) { ctx.fillText(chars[i], x, y); x += widths[i] + tracking; }
  return total;
}
function trackedWidth(ctx, s, tracking) {
  const chars = [...s];
  return chars.reduce((a, c) => a + ctx.measureText(c).width, 0) + tracking * Math.max(0, chars.length - 1);
}

const INK = { warm: { ink: '#fff6e6', faint: '#f0dfc2', rule: '#e2c99c', scrim: '38,26,14' },
              cool: { ink: '#f4f8fb', faint: '#d5e2ea', rule: '#b9cfdb', scrim: '14,24,32' },
              plain: { ink: '#f5f2ec', faint: '#d9d2c6', rule: '#b8ad9c', scrim: '18,16,14' },
              /* Light cards: the background at full brightness, a pool of morning light behind the
               * text, dark ink with a soft light halo. Made for the 'dawn' watercolours. */
              dawn:  { ink: '#4a3520', faint: '#6a4e30', rule: '#a08048', scrim: '38,26,14', light: '253,248,238' } };

function fmtDate(d, style = 'year') {
  if (!d) return '';
  const s = String(d);
  const m = s.match(/^(\d{4})(?:-(\d{2})-(\d{2}))?/);
  if (!m) return s;
  if (style === 'full' && m[2]) {
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return `${months[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
  }
  return m[1];
}

/**
 * renderCardPlates — a card as a background plate plus text layers.
 *
 * The background takes the slow move; the text is drawn at exactly frame size and laid over it
 * AFTER the move, so letters are never resampled. Each layer carries the second at which it
 * should begin to appear, which is how a verse arrives line by line.
 *
 * @returns {{base:Buffer (plate size), layers:[{png:Buffer (frame size), at:number, fade:number}],
 *            text:[{x,y,w,h,text}], minHold:number}}
 */
export async function renderCardPlates(card, subject, opts) {
  const F = ensureFonts();
  const w = opts.w, h = opts.h;
  const W = w * PLATE_SCALE, H = h * PLATE_SCALE;
  const theme = INK[opts.theme] || INK.warm;

  /* ---- base: art background, softened and dimmed so type stays legible on any of them ---- */
  const baseC = createCanvas(W, H);
  const bx = baseC.getContext('2d');
  if (theme.light && !((card.type === 'title' || card.type === 'closing') && opts.portrait)) {
    if (opts.background) await drawArtBackground(bx, opts.background, W, H, { soften: 3, dim: 1 });
    else { bx.fillStyle = `rgb(${theme.light})`; bx.fillRect(0, 0, W, H); }
    bx.fillStyle = `rgba(${theme.light},0.14)`; bx.fillRect(0, 0, W, H);
    lightPool(bx, W / 2, H / 2, W * 0.50, H * 0.40, theme.light, 0.80);
    vignette(bx, W, H, 0.10);
  } else if (opts.background) {
    await drawArtBackground(bx, opts.background, W, H, { soften: 10, dim: 1 });
    bx.fillStyle = `rgba(${theme.scrim},0.46)`;
    bx.fillRect(0, 0, W, H);
  } else {
    const g = bx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, `rgb(${theme.scrim})`); g.addColorStop(1, '#0b0806');
    bx.fillStyle = g; bx.fillRect(0, 0, W, H);
  }
  if (!theme.light) {
    /* A soft dark pool behind the text block: contrast without a visible box. */
    const pool = bx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W * 0.46);
    pool.addColorStop(0, `rgba(${theme.scrim},0.50)`);
    pool.addColorStop(1, `rgba(${theme.scrim},0)`);
    bx.fillStyle = pool; bx.fillRect(0, 0, W, H);
    vignette(bx, W, H, 0.30);
  }

  /* ---- text layers, at frame size ---- */
  const layers = [];
  const text = [];
  const mk = () => { const c = createCanvas(w, h); const x = c.getContext('2d'); x.textBaseline = 'alphabetic'; return [c, x]; };
  const shadow = theme.light
    ? (x, size) => { x.shadowColor = `rgba(${theme.light},0.95)`; x.shadowBlur = size * 0.35; x.shadowOffsetY = 0; }
    : (x, size) => { x.shadowColor = 'rgba(0,0,0,0.55)'; x.shadowBlur = size * 0.30; x.shadowOffsetY = size * 0.05; };
  const box = (cx, y, tw, size, s) => text.push({ x: (cx - tw / 2) / w, y: (y - size) / h, w: tw / w, h: (size * 1.25) / h, text: s });
  const maxTextW = w * (1 - 2 * TITLE_SAFE) * 0.90;
  const stagger = opts.stagger ?? 1.6, fade = opts.fade ?? 1.2, lead = opts.lead ?? 0.9;
  const type = card.type;

  const fitTracked = (x, s, font, size, trackK, limit) => {
    for (;;) {
      x.font = `${size}px ${font}`;
      if (trackedWidth(x, s, size * trackK) <= limit || size <= 20) return size;
      size -= 2;
    }
  };

  if ((type === 'title' || type === 'closing') && opts.portrait) return renderPortraitCard(card, subject, opts, F);

  if (type === 'title' || type === 'closing' || type === 'chapter') {
    const [c, x] = mk();
    let y;
    if (type === 'title') {
      const pre = card.line ?? 'In Loving Memory';
      const name = String(subject.name || '').toUpperCase();
      const span = [fmtDate(subject.born, card.dates || 'year'), fmtDate(subject.died, card.dates || 'year')].filter(Boolean).join('   —   ');
      if (pre) {
        const ps = Math.round(h * 0.040);
        x.font = `${ps}px ${F.italic}`; x.fillStyle = theme.faint; x.textAlign = 'center'; shadow(x, ps);
        x.fillText(pre, w / 2, h * 0.355);
        box(w / 2, h * 0.355, x.measureText(pre).width, ps, pre);
      }
      const ns = fitTracked(x, name, F.display, Math.round(h * 0.105), 0.14, maxTextW);
      x.font = `${ns}px ${F.display}`; x.fillStyle = theme.ink; shadow(x, ns);
      const tw = tracked(x, name, w / 2, h * 0.505, ns * 0.14);
      box(w / 2, h * 0.505, tw, ns, name);
      if (span) {
        x.shadowColor = 'transparent';
        x.strokeStyle = theme.rule; x.lineWidth = Math.max(1, h / 720);
        x.beginPath(); x.moveTo(w / 2 - w * 0.07, h * 0.565); x.lineTo(w / 2 + w * 0.07, h * 0.565); x.stroke();
        const ds = Math.round(h * 0.040);
        x.font = `${ds}px ${F.text}`; x.fillStyle = theme.faint; shadow(x, ds);
        const dw = tracked(x, span, w / 2, h * 0.640, ds * 0.16);
        box(w / 2, h * 0.640, dw, ds, span);
      }
    } else if (type === 'chapter') {
      const title = String(card.title || '').toUpperCase();
      const ts = fitTracked(x, title, F.display, Math.round(h * 0.078), 0.16, maxTextW);
      x.font = `${ts}px ${F.display}`; x.fillStyle = theme.ink; shadow(x, ts);
      y = card.subtitle ? h * 0.490 : h * 0.525;
      const tw = tracked(x, title, w / 2, y, ts * 0.16);
      box(w / 2, y, tw, ts, title);
      if (card.subtitle) {
        x.shadowColor = 'transparent';
        x.strokeStyle = theme.rule; x.lineWidth = Math.max(1, h / 720);
        x.beginPath(); x.moveTo(w / 2 - w * 0.05, h * 0.545); x.lineTo(w / 2 + w * 0.05, h * 0.545); x.stroke();
        const ss = Math.round(h * 0.038);
        x.font = `${ss}px ${F.italic}`; x.fillStyle = theme.faint; x.textAlign = 'center'; shadow(x, ss);
        x.fillText(card.subtitle, w / 2, h * 0.615);
        box(w / 2, h * 0.615, x.measureText(card.subtitle).width, ss, card.subtitle);
      }
    } else {
      const line = card.line ?? 'Forever in our hearts';
      const ls = Math.round(h * 0.046);
      x.font = `${ls}px ${F.italic}`; x.fillStyle = theme.faint; x.textAlign = 'center'; shadow(x, ls);
      const lines = wrapLines(x, line, maxTextW * 0.8).slice(0, 2);
      let ly = h * 0.44 - (lines.length - 1) * ls * 1.35;
      for (const ln of lines) { x.fillText(ln, w / 2, ly); box(w / 2, ly, x.measureText(ln).width, ls, ln); ly += ls * 1.35; }
      const name = String(subject.name || '').toUpperCase();
      const ns = fitTracked(x, name, F.display, Math.round(h * 0.066), 0.14, maxTextW);
      x.font = `${ns}px ${F.display}`; x.fillStyle = theme.ink; shadow(x, ns);
      const tw = tracked(x, name, w / 2, h * 0.575, ns * 0.14);
      box(w / 2, h * 0.575, tw, ns, name);
      const span = [fmtDate(subject.born), fmtDate(subject.died)].filter(Boolean).join('   —   ');
      if (span) {
        const ds = Math.round(h * 0.034);
        x.font = `${ds}px ${F.text}`; x.fillStyle = theme.faint; shadow(x, ds);
        const dw = tracked(x, span, w / 2, h * 0.655, ds * 0.16);
        box(w / 2, h * 0.655, dw, ds, span);
      }
    }
    layers.push({ png: c.toBuffer('image/png'), at: lead * 0.5, fade });
    return { base: baseC.toBuffer('image/png'), layers, text, minHold: lead * 0.5 + fade + 3.0 };
  }

  if (type === 'verse') {
    if (!card.text) throw new Error('memorial/plates: verse card has no text');
    const probe = createCanvas(8, 8).getContext('2d');
    let size = Math.round(h * 0.056), lines;
    for (;;) {
      probe.font = `${size}px ${F.text}`;
      lines = wrapLines(probe, card.text, maxTextW * 0.86);
      if (lines.length <= 6 || size <= 22) break;
      size -= 2;
    }
    const lh = size * 1.5;
    const refSize = Math.round(h * 0.030);
    const blockH = lines.length * lh + (card.ref ? lh * 1.25 : 0);
    let y = h / 2 - blockH / 2 + size;
    const reveal = card.reveal !== false;
    let t = lead;
    for (const ln of lines) {
      const [c, x] = mk();
      x.font = `${size}px ${F.text}`; x.fillStyle = theme.ink; x.textAlign = 'center'; shadow(x, size);
      x.fillText(ln, w / 2, y);
      box(w / 2, y, x.measureText(ln).width, size, ln);
      layers.push({ png: c.toBuffer('image/png'), at: reveal ? t : lead, fade });
      if (reveal) t += stagger;
      y += lh;
    }
    if (card.ref) {
      const [c, x] = mk();
      x.strokeStyle = theme.rule; x.lineWidth = Math.max(1, h / 720);
      x.beginPath(); x.moveTo(w / 2 - w * 0.045, y - lh * 0.35); x.lineTo(w / 2 + w * 0.045, y - lh * 0.35); x.stroke();
      const refText = String(card.ref).toUpperCase() + (card.translation ? `  ·  ${String(card.translation).toUpperCase()}` : '');
      x.font = `${refSize}px ${F.text}`; x.fillStyle = theme.faint; shadow(x, refSize);
      const rw = tracked(x, refText, w / 2, y + lh * 0.45, refSize * 0.18);
      box(w / 2, y + lh * 0.45, rw, refSize, refText);
      layers.push({ png: c.toBuffer('image/png'), at: reveal ? t : lead, fade });
      if (reveal) t += stagger;
    }
    /* Long enough for the last line to arrive and then be read. */
    const lastIn = (reveal ? t - stagger : lead) + fade;
    return { base: baseC.toBuffer('image/png'), layers, text, minHold: lastIn + 3.2 };
  }
  throw new Error(`memorial/plates: unknown card type '${type}'`);
}

/* ------------------------------------------------------------------ portrait card */

/* The portrait card answers the first ten seconds of a competitor's listing video: the person's
 * own photograph melted into the art background on the left, their name written on in a script
 * face on the right. Opt-in per card (`"portrait": <photo number>`); a card without it renders
 * exactly as before. Light background, dark ink — the reverse of the classic dark card.
 * Where the photo sits and how its edge fades are fixed here so the planner can prove, before
 * rendering, that every protected face lies in the fully opaque core (portraitAlpha). */
export const PORTRAIT = { x: 300 / 1920, y: 95 / 1080, w: 700 / 1920, h: 891 / 1080, exp: 2.4, gain: 1.7 };
/* When the portrait rises: after the landscape has been seen alone for a breath. */
/* Edge brightening starts below 0.97 opacity; faces are proven at ≥ 0.98, so a face pixel is never altered. */
export const EDGE_LIGHT = 0.88, EDGE_LIGHT_FROM = 0.97;
export const PORTRAIT_IN = { at: 0.5, fade: 2.0 };
export const PORTRAIT_AR = (PORTRAIT.w * 16) / (PORTRAIT.h * 9);   // width/height of the photo window

/** Opacity of the portrait at (u, v), fractions of the portrait window (0..1 each). */
export function portraitAlpha(u, v) {
  const dx = Math.abs(u * 2 - 1), dy = Math.abs(v * 2 - 1);
  return Math.min(1, Math.max(0, (1 - Math.pow(dx, PORTRAIT.exp) - Math.pow(dy, PORTRAIT.exp)) * PORTRAIT.gain));
}

const LIGHT_INK = { warm: { ink: '#4f3820', name: '#76531f', faint: '#6a4e30', rule: '#a08048', wash: '251,246,236' },
                    cool: { ink: '#2c3b48', name: '#3a5166', faint: '#46596a', rule: '#8da2b4', wash: '244,248,251' } };
LIGHT_INK.plain = LIGHT_INK.warm;
LIGHT_INK.dawn = LIGHT_INK.warm;

async function renderPortraitCard(card, subject, opts, F) {
  const w = opts.w, h = opts.h;
  const W = w * PLATE_SCALE, H = h * PLATE_SCALE;
  const ink = LIGHT_INK[opts.theme] || LIGHT_INK.warm;
  const { file, crop } = opts.portrait;

  /* ---- base: the art background at full brightness, a paper wash under the text column ---- */
  const baseC = createCanvas(W, H);
  const bx = baseC.getContext('2d');
  /* Drawn sharp: on the title card the background is the picture people remember, not a texture. */
  if (opts.background) await drawArtBackground(bx, opts.background, W, H, { soften: 0, dim: 1 });
  else { const g = bx.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#f3e7d3'); g.addColorStop(1, '#fbf6ec'); bx.fillStyle = g; bx.fillRect(0, 0, W, H); }
  /* Two pools of light: one the portrait rises out of, one the name is written into. */
  lightPool(bx, (PORTRAIT.x + PORTRAIT.w / 2) * W, (PORTRAIT.y + PORTRAIT.h / 2) * H, PORTRAIT.w * W * 0.70, PORTRAIT.h * H * 0.62, ink.wash, 0.42);
  lightPool(bx, 0.7266 * W, 0.50 * H, W * 0.27, H * 0.40, ink.wash, 0.60);

  vignette(bx, W, H, 0.08);

  /* ---- the photograph, its edge faded by portraitAlpha ----
   * Its own layer at frame size, not part of the base: it is resampled once from the original
   * (sharper than plate-then-downscale), it rises out of the landscape instead of being there at
   * the first frame, and it stays still while the background takes the slow move, which reads as
   * depth. Same window and same alpha, so the planner's face proof still holds. */
  const layers = [], text = [];
  const img = await load(file);
  const pw = Math.round(PORTRAIT.w * w), ph = Math.round(PORTRAIT.h * h);
  const pc = createCanvas(pw, ph);
  const px = pc.getContext('2d');
  px.imageSmoothingQuality = 'high';
  px.drawImage(img, crop.x * img.width, crop.y * img.height, crop.w * img.width, crop.h * img.height, 0, 0, pw, ph);
  const id = px.getImageData(0, 0, pw, ph);
  const washRGB = ink.wash.split(',').map(Number);
  for (let j = 0; j < ph; j++) {
    for (let i = 0; i < pw; i++) {
      const a = portraitAlpha((i + 0.5) / pw, (j + 0.5) / ph);
      const o = (j * pw + i) * 4;
      /* Where the photo thins out it also brightens toward the light, so a dark photo
       * background (a fence, a porch) melts into glow instead of leaving a smudge. The fully
       * opaque core — every face, by the planner's proof — is not touched. */
      if (a < EDGE_LIGHT_FROM) {
        const k = EDGE_LIGHT * Math.pow((EDGE_LIGHT_FROM - a) / EDGE_LIGHT_FROM, 0.4);
        for (let ch = 0; ch < 3; ch++) id.data[o + ch] = Math.round(id.data[o + ch] * (1 - k) + washRGB[ch] * k);
      }
      id.data[o + 3] = Math.round(id.data[o + 3] * a);
    }
  }
  px.putImageData(id, 0, 0);
  {
    const lc = createCanvas(w, h);
    lc.getContext('2d').drawImage(pc, Math.round(PORTRAIT.x * w), Math.round(PORTRAIT.y * h));
    layers.push({ png: lc.toBuffer('image/png'), at: PORTRAIT_IN.at, fade: PORTRAIT_IN.fade });
  }

  /* ---- text layers, at frame size, in the right-hand column ---- */
  const cx = w * 0.7266, colW = w * 0.40;
  const mk = () => { const c = createCanvas(w, h); const x = c.getContext('2d'); x.textBaseline = 'alphabetic'; x.textAlign = 'center'; return [c, x]; };
  const glow = (x, size) => { x.shadowColor = `rgba(${ink.wash},0.85)`; x.shadowBlur = size * 0.25; x.shadowOffsetY = 0; };
  const box = (y, tw, size, s) => text.push({ x: (cx - tw / 2) / w, y: (y - size) / h, w: tw / w, h: (size * 1.25) / h, text: s });

  const pre = card.line ?? (card.type === 'title' ? 'In Loving Memory' : 'Forever in our hearts');
  if (pre) {
    const [c, x] = mk();
    const ps = Math.round(h * 0.050);
    x.font = `${ps}px ${F.italic}`; x.fillStyle = ink.faint; glow(x, ps);
    x.fillText(pre, cx, h * 0.300);
    box(h * 0.300, x.measureText(pre).width, ps, pre);
    layers.push({ png: c.toBuffer('image/png'), at: 1.6, fade: 1.2 });
  }

  /* The name: one line if it fits at a generous size, otherwise two (split at the middle space). */
  const name = String(subject.name || '').trim();
  const [nc, nx] = mk();
  let size = Math.round(h * 0.128), lines = [name];
  const widest = (ls, s) => { nx.font = `${s}px ${F.script}`; return Math.max(...ls.map(l => nx.measureText(l).width)); };
  while (widest(lines, size) > colW && size > h * 0.090) size -= 2;
  if (widest(lines, size) > colW && name.includes(' ')) {
    const words = name.split(/\s+/);
    let best = 1, bestDiff = Infinity;
    for (let k = 1; k < words.length; k++) { const d = Math.abs(words.slice(0, k).join(' ').length - words.slice(k).join(' ').length); if (d < bestDiff) { bestDiff = d; best = k; } }
    lines = [words.slice(0, best).join(' '), words.slice(best).join(' ')];
    size = Math.round(h * 0.118);
  }
  while (widest(lines, size) > colW && size > 24) size -= 2;
  nx.font = `${size}px ${F.script}`; nx.fillStyle = ink.name; glow(nx, size);
  let ny = lines.length === 1 ? h * 0.470 : h * 0.420;
  let x0 = w, x1 = 0;
  for (const ln of lines) {
    const tw = nx.measureText(ln).width;
    nx.fillText(ln, cx, ny);
    box(ny, tw, size, ln);
    x0 = Math.min(x0, cx - tw / 2); x1 = Math.max(x1, cx + tw / 2);
    ny += size * 0.95;
  }
  const writeAt = pre ? 2.4 : 1.7, writeFor = lines.length === 1 ? 2.3 : 2.8;
  layers.push({ png: nc.toBuffer('image/png'), at: writeAt, fade: 0, wipe: { dur: writeFor, x0: Math.floor(x0 - size * 0.25), x1: Math.ceil(x1 + size * 0.25) } });

  /* Rule, dates and (title only) a short tagline. */
  const span = [fmtDate(subject.born, card.dates || 'year'), fmtDate(subject.died, card.dates || 'year')].filter(Boolean).join('   —   ');
  const tagline = card.tagline ?? (card.type === 'title' ? 'Forever loved  ·  Always remembered' : '');
  const restAt = writeAt + writeFor - 0.2;
  if (span || tagline) {
    const [c, x] = mk();
    const top = lines.length === 1 ? h * 0.565 : h * 0.585;
    x.strokeStyle = ink.rule; x.lineWidth = Math.max(1.5, h / 540);
    x.beginPath(); x.moveTo(cx - w * 0.085, top); x.lineTo(cx - w * 0.012, top); x.moveTo(cx + w * 0.012, top); x.lineTo(cx + w * 0.085, top); x.stroke();
    x.fillStyle = ink.rule; x.beginPath(); x.arc(cx, top, Math.max(2, h / 300), 0, Math.PI * 2); x.fill();
    if (span) {
      const ds = Math.round(h * 0.048);
      x.font = `${ds}px ${F.text}`; x.fillStyle = ink.ink; glow(x, ds);
      const dw = tracked(x, span, cx, top + h * 0.080, ds * 0.10);
      box(top + h * 0.080, dw, ds, span);
    }
    if (tagline) {
      const ts = Math.round(h * 0.026);
      const t = tagline.toUpperCase();
      x.font = `${ts}px ${F.text}`; x.fillStyle = ink.faint; glow(x, ts);
      const tw = tracked(x, t, cx, top + h * 0.160, ts * 0.18);
      box(top + h * 0.160, tw, ts, t);
    }
    layers.push({ png: c.toBuffer('image/png'), at: restAt, fade: 1.0 });
  }
  const rect = { x0: PORTRAIT.x, y0: PORTRAIT.y, x1: PORTRAIT.x + PORTRAIT.w, y1: PORTRAIT.y + PORTRAIT.h };
  return { base: baseC.toBuffer('image/png'), layers, text, portraitRect: rect, minHold: restAt + 1.0 + 3.0 };
}

/** Is every text box inside the title-safe area? Returns the offenders. */
export function textOutsideSafe(text, margin = TITLE_SAFE) {
  const eps = 1e-6;
  return text.filter(b => b.x < margin - eps || b.y < margin - eps || b.x + b.w > 1 - margin + eps || b.y + b.h > 1 - margin + eps);
}

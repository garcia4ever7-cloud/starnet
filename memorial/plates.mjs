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
  FONTS = { display: 'MemDisplay', text: 'MemText', italic: italic ? 'MemItalic' : 'MemText' };
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
              plain: { ink: '#f5f2ec', faint: '#d9d2c6', rule: '#b8ad9c', scrim: '18,16,14' } };

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
  if (opts.background) {
    await drawArtBackground(bx, opts.background, W, H, { soften: 10, dim: 1 });
    bx.fillStyle = `rgba(${theme.scrim},0.46)`;
    bx.fillRect(0, 0, W, H);
  } else {
    const g = bx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, `rgb(${theme.scrim})`); g.addColorStop(1, '#0b0806');
    bx.fillStyle = g; bx.fillRect(0, 0, W, H);
  }
  /* A soft dark pool behind the text block: contrast without a visible box. */
  const pool = bx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W * 0.46);
  pool.addColorStop(0, `rgba(${theme.scrim},0.50)`);
  pool.addColorStop(1, `rgba(${theme.scrim},0)`);
  bx.fillStyle = pool; bx.fillRect(0, 0, W, H);
  vignette(bx, W, H, 0.30);

  /* ---- text layers, at frame size ---- */
  const layers = [];
  const text = [];
  const mk = () => { const c = createCanvas(w, h); const x = c.getContext('2d'); x.textBaseline = 'alphabetic'; return [c, x]; };
  const shadow = (x, size) => { x.shadowColor = 'rgba(0,0,0,0.55)'; x.shadowBlur = size * 0.30; x.shadowOffsetY = size * 0.05; };
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

/** Is every text box inside the title-safe area? Returns the offenders. */
export function textOutsideSafe(text, margin = TITLE_SAFE) {
  const eps = 1e-6;
  return text.filter(b => b.x < margin - eps || b.y < margin - eps || b.x + b.w > 1 - margin + eps || b.y + b.h > 1 - margin + eps);
}

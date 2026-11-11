/* memorial/cards.mjs — the title, verse and closing cards, rendered as PNGs.
 *
 * WHY THIS EXISTS
 * ---------------
 * Typography carries more of the perceived production value in a memorial film than motion does.
 * The research phase inspected a competitor's four-beat structure (Faith & Glory, $49.97) and it
 * opens on "their name in gold, over soft clouds" and closes on "a verse of comfort" — the cards
 * ARE the product's frame. A slideshow with beautiful cards reads as a film; one with a default
 * system font reads as a screensaver.
 *
 * Cards are full-frame SEGMENTS, not overlays. Every element in the film is therefore a segment of
 * known duration, and the xfade chain in render.mjs handles all of them identically. A verse that
 * gets its own held moment also reads better than a verse floating over someone's photograph.
 *
 * TWO DEVICE FACTS THAT SHAPE THIS FILE:
 *   - `fc-list` returns 0 on this phone: there is NO fontconfig. Any font must be loaded from an
 *     explicit path. `GlobalFonts.registerFromPath(path, alias)` then `ctx.font = '40px alias'`.
 *   - `sharp` does not build for android-arm64 (see sidecar/tools/builtin/print-prep.js) and Pillow
 *     is Python-only, so `@napi-rs/canvas` is the station's sanctioned image library. Verified
 *     working here 2026-11-09.
 *
 * FONT UPGRADE PATH (deliberately not taken automatically): dropping an SIL Open Font License
 * display serif — EB Garamond, Cormorant Garamond, Playfair Display — into memorial/assets/fonts/
 * is a visible step up from Noto Serif and is free for commercial use. This module picks those up
 * automatically if present. It does NOT download them, because fetching files is the owner's call.
 */
'use strict';

import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BUNDLED_FONTS = path.join(HERE, 'assets', 'fonts');

/* Ordered by preference: a bundled display serif wins, the Android system serif is the floor. */
const FONT_CANDIDATES = [
  ['EBGaramond-Regular.ttf', 'MemSerif'],
  ['CormorantGaramond-Regular.ttf', 'MemSerif'],
  ['PlayfairDisplay-Regular.ttf', 'MemSerif'],
  ['NotoSerif-Regular.ttf', 'MemSerif'],
];
const SYSTEM_SERIF = '/system/fonts/NotoSerif-Regular.ttf';
const SYSTEM_SERIF_ITALIC = '/system/fonts/NotoSerif-Italic.ttf';

let FONT_READY = null;

export function ensureFonts() {
  if (FONT_READY) return FONT_READY;
  let regular = null;
  let source = null;

  for (const [file] of FONT_CANDIDATES) {
    const p = path.join(BUNDLED_FONTS, file);
    if (fs.existsSync(p)) { regular = p; source = 'bundled:' + file; break; }
  }
  if (!regular && fs.existsSync(SYSTEM_SERIF)) { regular = SYSTEM_SERIF; source = 'system:NotoSerif'; }
  if (!regular) throw new Error('memorial/cards: no serif font found — drop an OFL serif into memorial/assets/fonts/');

  GlobalFonts.registerFromPath(regular, 'MemSerif');
  if (fs.existsSync(SYSTEM_SERIF_ITALIC)) GlobalFonts.registerFromPath(SYSTEM_SERIF_ITALIC, 'MemSerifItalic');

  FONT_READY = { regular, source, italic: fs.existsSync(SYSTEM_SERIF_ITALIC) };
  return FONT_READY;
}

export const THEMES = {
  warm:  { top: '#3a2f27', bottom: '#15100c', ink: '#f3e9db', faint: '#c9b79e', rule: '#7a6652' },
  cool:  { top: '#263038', bottom: '#0e1317', ink: '#e8eef2', faint: '#a9bcc8', rule: '#53707f' },
  plain: { top: '#1a1a1a', bottom: '#050505', ink: '#f2f2f2', faint: '#bdbdbd', rule: '#6b6b6b' },
};

function backdrop(ctx, w, h, theme) {
  const t = THEMES[theme] || THEMES.warm;
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, t.top);
  g.addColorStop(1, t.bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  /* A soft off-centre glow keeps a flat gradient from looking like a PowerPoint background. */
  const r = Math.max(w, h) * 0.75;
  const rg = ctx.createRadialGradient(w * 0.5, h * 0.40, 0, w * 0.5, h * 0.40, r);
  rg.addColorStop(0, 'rgba(255,245,230,0.10)');
  rg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, w, h);
  return t;
}

/* Manual letter-spacing. ctx.letterSpacing is not dependable across canvas builds, and the
 * wide-tracked serif capital is most of what makes a title card look engraved rather than typed. */
function drawTracked(ctx, text, cx, y, tracking) {
  const chars = [...text];
  const widths = chars.map(c => ctx.measureText(c).width);
  const total = widths.reduce((a, b) => a + b, 0) + tracking * Math.max(0, chars.length - 1);
  let x = cx - total / 2;
  for (let i = 0; i < chars.length; i++) {
    ctx.fillText(chars[i], x, y);
    x += widths[i] + tracking;
  }
  return total;
}

function wrap(ctx, text, maxWidth) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const probe = line ? line + ' ' + word : word;
    if (ctx.measureText(probe).width > maxWidth && line) { lines.push(line); line = word; }
    else line = probe;
  }
  if (line) lines.push(line);
  return lines;
}

function fmtYear(d) {
  if (!d) return '';
  const m = String(d).match(/^(\d{4})/);
  return m ? m[1] : String(d);
}

/** Title card: the name, tracked, with a rule and the year span beneath. */
export function renderTitleCard({ name, born, died }, opts = {}) {
  ensureFonts();
  const w = opts.w || 1920, h = opts.h || 1080;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  const t = backdrop(ctx, w, h, opts.theme || 'warm');

  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = t.ink;

  /* Shrink to fit rather than wrap — a wrapped name looks like an accident. */
  const upper = String(name || '').toUpperCase();
  let size = Math.round(h * 0.085);
  let tracking = size * 0.18;
  for (;;) {
    ctx.font = `${size}px MemSerif`;
    const widths = [...upper].map(c => ctx.measureText(c).width);
    const total = widths.reduce((a, b) => a + b, 0) + tracking * Math.max(0, upper.length - 1);
    if (total <= w * 0.82 || size <= 20) break;
    size -= 2; tracking = size * 0.18;
  }
  ctx.font = `${size}px MemSerif`;
  drawTracked(ctx, upper, w / 2, h * 0.47, tracking);

  const span = [fmtYear(born), fmtYear(died)].filter(Boolean).join('  —  ');
  if (span) {
    const ruleW = w * 0.14;
    ctx.strokeStyle = t.rule;
    ctx.lineWidth = Math.max(1, Math.round(h / 900));
    ctx.beginPath();
    ctx.moveTo(w / 2 - ruleW / 2, h * 0.535);
    ctx.lineTo(w / 2 + ruleW / 2, h * 0.535);
    ctx.stroke();

    ctx.fillStyle = t.faint;
    const ds = Math.round(h * 0.030);
    ctx.font = `${ds}px MemSerif`;
    drawTracked(ctx, span, w / 2, h * 0.60, ds * 0.22);
  }
  return canvas.toBuffer('image/png');
}

/** Verse card: wrapped scripture, centred, with the reference beneath a rule. */
export function renderVerseCard({ text, ref }, opts = {}) {
  ensureFonts();
  const w = opts.w || 1920, h = opts.h || 1080;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  const t = backdrop(ctx, w, h, opts.theme || 'warm');

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = t.ink;

  const maxW = w * 0.74;
  let size = Math.round(h * 0.050);
  let lines = [];
  for (;;) {
    ctx.font = `${size}px MemSerif`;
    lines = wrap(ctx, text, maxW);
    if (lines.length <= 6 || size <= 18) break;
    size -= 2;
  }
  ctx.font = `${size}px MemSerif`;
  const lh = size * 1.52;
  const block = lines.length * lh;
  let y = h / 2 - block / 2 + lh * 0.72;
  for (const ln of lines) { ctx.fillText(ln, w / 2, y); y += lh; }

  if (ref) {
    const ruleW = w * 0.10;
    ctx.strokeStyle = t.rule;
    ctx.lineWidth = Math.max(1, Math.round(h / 900));
    ctx.beginPath();
    ctx.moveTo(w / 2 - ruleW / 2, y + lh * 0.25);
    ctx.lineTo(w / 2 + ruleW / 2, y + lh * 0.25);
    ctx.stroke();

    ctx.fillStyle = t.faint;
    const rs = Math.round(h * 0.026);
    ctx.font = `${rs}px MemSerif`;
    drawTracked(ctx, String(ref).toUpperCase(), w / 2, y + lh * 1.05, rs * 0.20);
  }
  return canvas.toBuffer('image/png');
}

/** Closing card: a short line, then the name. Deliberately sparse. */
export function renderClosingCard({ name, line }, opts = {}) {
  ensureFonts();
  const w = opts.w || 1920, h = opts.h || 1080;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  const t = backdrop(ctx, w, h, opts.theme || 'warm');

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  if (line) {
    ctx.fillStyle = t.faint;
    const ls = Math.round(h * 0.034);
    ctx.font = `${ls}px MemSerif`;
    for (const [i, ln] of wrap(ctx, line, w * 0.7).entries()) {
      ctx.fillText(ln, w / 2, h * 0.44 + i * ls * 1.5);
    }
  }
  ctx.fillStyle = t.ink;
  const ns = Math.round(h * 0.044);
  ctx.font = `${ns}px MemSerif`;
  ctx.textAlign = 'left';
  drawTracked(ctx, String(name || '').toUpperCase(), w / 2, h * 0.60, ns * 0.18);

  return canvas.toBuffer('image/png');
}

export function renderCard(card, subject, opts = {}) {
  const type = card && card.type;
  if (type === 'title') return renderTitleCard(subject, opts);
  if (type === 'verse') return renderVerseCard({ text: card.text, ref: card.ref }, opts);
  if (type === 'closing') return renderClosingCard({ name: subject.name, line: card.line }, opts);
  throw new Error(`memorial/cards: unknown card type '${type}'`);
}

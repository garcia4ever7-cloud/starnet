/* memorial/gallery.mjs — the layout engine: `"style": "gallery"` in an order.
 *
 * The original engine (render.mjs, style "classic") shows one photograph per moment. This one
 * arranges them: full-bleed where a photo can fill the screen without cutting anyone, framed
 * prints on a soft background where it cannot, pairs, groups, collages, chapter cards, verses
 * that arrive line by line. It reuses the original's proven machinery unchanged — the 8x
 * oversampled move, per-segment rendering, the resumable join — and adds, in order:
 *
 *   1. prep      every photo decoded upright (prep.mjs)
 *   2. faces     operator marks, else the detector, else "unknown" (faces.mjs)
 *   3. scenes    which photos share a moment, and how (layouts.mjs)   ← face protection decided here
 *   4. plates    each scene and card drawn once at 2x (plates.mjs)
 *   5. audit     every face and every word checked against where it actually landed
 *   6. segments  one plate → one moving clip, in BT.709
 *   7. join      dissolves, act-break dips, head and tail fades (join.mjs)
 *   8. music     licensed library, fitted and mastered (audio.mjs)
 *
 * Steps 1–5 need no video encoder and take seconds, so `planGallery` can be run on its own to
 * show the operator the whole film as stills (`cli.mjs plan`) before twenty minutes are spent
 * rendering it.
 */
'use strict';

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

import { frameSize } from './fit.mjs';
import {
  OVERSAMPLE, FPS, run, ffprobeJson, segmentIsGood, segmentMatches, stampSegment, fingerprint,
  dirsFor, assemble,
} from './render.mjs';
import { prepPhoto } from './prep.mjs';
import { detectFaces, resolveFaces } from './faces.mjs';
import {
  planScenes, pickRecap, collageRects, normFaces, protect, unionOf, facesInside, safeMotion,
  motionWindow, HOLD, FRAME_AR,
} from './layouts.mjs';
import {
  renderScenePlate, renderCardPlates, textOutsideSafe, backgroundPath, backgroundsAvailable,
  BACKGROUND_SETS, PLATE_SCALE, TITLE_SAFE, ACTION_SAFE, clearImageCache, PORTRAIT_AR, portraitAlpha,
} from './plates.mjs';
import { totalSeconds, timeline, HEAD_FADE, TAIL_FADE } from './join.mjs';
import { resolveMusic, masterBed, muxBed } from './audio.mjs';

export const PARALLEL = Math.min(4, Math.max(1, Number(process.env.MEMORIAL_PARALLEL) || 2));
export const CARD_HOLD = 5.5;
export const SCENE_ZOOM = { full: 0.09, fullBlind: 0.06, framed: 0.035, pair: 0.03, duo: 0.03, group: 0.035, collage: 0.025 };
export const CAPTION_AT = 0.7;
export const CAPTION_FADE = 0.9;
/* Fitting the photos to the song: the per-scene hold may stretch or shrink this far, no further. */
export const FIT_MIN = 0.75, FIT_MAX = 1.34;

const sha = buf => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 20);
const LAYOUTS = new Set(['auto', 'full', 'framed', 'pair', 'duo', 'group', 'collage']);
const MOTIONS = new Set(['auto', 'push', 'pull', 'still', 'driftR', 'driftD']);
const CARD_TYPES = new Set(['title', 'chapter', 'verse', 'closing']);

/* ------------------------------------------------------------------ order validation */

/** Everything that can be known to be wrong before any file is opened. Throws on the first. */
export function validateGalleryOrder(order) {
  if (!order || typeof order !== 'object') throw new Error('order must be an object');
  if (!order.orderId) throw new Error('order.orderId is required');
  const photos = Array.isArray(order.photos) ? order.photos : [];
  if (!photos.length) throw new Error('order.photos must not be empty');
  photos.forEach((p, i) => {
    if (!p || !p.file) throw new Error(`photos[${i}] has no file`);
    if (p.layout != null && !LAYOUTS.has(p.layout)) throw new Error(`photos[${i}].layout '${p.layout}' is not one of ${[...LAYOUTS].join(', ')}`);
    if (p.motion != null && !MOTIONS.has(p.motion)) throw new Error(`photos[${i}].motion '${p.motion}' is not one of ${[...MOTIONS].join(', ')}`);
    if (p.actBreak != null && typeof p.actBreak !== 'boolean') throw new Error(`photos[${i}].actBreak must be true or false`);
    if (p.hold != null && !(Number(p.hold) >= 2 && Number(p.hold) <= 30)) throw new Error(`photos[${i}].hold must be between 2 and 30 seconds`);
    if (p.faces != null) normFaces(p.faces, `photos[${i}].faces`);
  });
  const cards = Array.isArray(order.cards) ? order.cards : [];
  cards.forEach((c, i) => {
    if (!c || !CARD_TYPES.has(c.type)) throw new Error(`cards[${i}].type must be one of ${[...CARD_TYPES].join(', ')}`);
    const placed = c.at === 'open' || c.at === 'close' || Number.isFinite(c.after);
    if (!placed) throw new Error(`cards[${i}] needs "at": "open" | "close" or "after": <photo count>`);
    if (Number.isFinite(c.after) && !(Number.isInteger(c.after) && c.after >= 1 && c.after <= photos.length)) {
      throw new Error(`cards[${i}].after is ${c.after} — must be a whole number from 1 to ${photos.length}`);
    }
    if (c.actBreak != null && typeof c.actBreak !== 'boolean') throw new Error(`cards[${i}].actBreak must be true or false`);
    if (c.type === 'verse' && !String(c.text || '').trim()) throw new Error(`cards[${i}] is a verse with no text`);
    if (c.type === 'chapter' && !String(c.title || '').trim()) throw new Error(`cards[${i}] is a chapter with no title`);
    if (c.background != null && !backgroundPath(c.background)) {
      throw new Error(`cards[${i}].background: no background '${c.background}' (have: ${backgroundsAvailable().join(', ')})`);
    }
    if (c.portrait != null) {
      if (c.type !== 'title' && c.type !== 'closing') throw new Error(`cards[${i}].portrait is only for a title or closing card`);
      if (!(Number.isInteger(c.portrait) && c.portrait >= 1 && c.portrait <= photos.length)) {
        throw new Error(`cards[${i}].portrait is ${c.portrait} — must be a photo number from 1 to ${photos.length}`);
      }
    }
  });
  if (cards.some(c => c.type === 'title' || c.type === 'closing') && !(order.subject && String(order.subject.name || '').trim())) {
    throw new Error('order.subject.name is required for a title or closing card');
  }
  if (order.background != null && !['art', 'blur'].includes(order.background) && !backgroundPath(order.background)) {
    throw new Error(`order.background '${order.background}' is not "art", "blur" or one of: ${backgroundsAvailable().join(', ')}`);
  }
  for (const b of (order.backgrounds || [])) if (!backgroundPath(b)) throw new Error(`order.backgrounds: no background '${b}' (have: ${backgroundsAvailable().join(', ')})`);
  return true;
}

/* ------------------------------------------------------------------ planning */

function backgroundCycle(order) {
  if (order.background === 'blur') return { scene: () => null, card: k => cyc(k) };
  if (order.background && order.background !== 'art') { const p = backgroundPath(order.background); return { scene: () => p, card: () => p }; }
  function cyc(k) { return pick(k); }
  return { scene: k => pick(k), card: k => pick(k) };
  function pick(k) {
    const names = (order.backgrounds && order.backgrounds.length) ? order.backgrounds : (BACKGROUND_SETS[order.theme || 'warm'] || BACKGROUND_SETS.warm);
    const usable = names.map(backgroundPath).filter(Boolean);
    return usable.length ? usable[((k % usable.length) + usable.length) % usable.length] : null;
  }
}

/* Map a rect in photo fractions into frame fractions, given where the photo was drawn. */
function toFrame(box, photoRect, crop) {
  const c = crop || { x: 0, y: 0, w: 1, h: 1 };
  const fx = v => photoRect.x + ((v - c.x) / c.w) * photoRect.w;
  const fy = v => photoRect.y + ((v - c.y) / c.h) * photoRect.h;
  return { x0: fx(box.x0), y0: fy(box.y0), x1: fx(box.x1), y1: fy(box.y1) };
}

/**
 * planGallery — steps 1–5. Writes plates into <work>/plates and returns the full plan.
 * @returns {{plan, dirs, photos, report}}
 */
export async function planGallery(order, opts = {}) {
  const log = opts.log || (() => {});
  validateGalleryOrder(order);
  const dirs = dirsFor(order, opts.baseDir);
  dirs.force = !!opts.force;
  const platesDir = path.join(dirs.work, 'plates');
  await fsp.mkdir(platesDir, { recursive: true });
  await fsp.mkdir(dirs.out, { recursive: true });
  const { w, h } = frameSize(order.aspect || '16:9', opts.height || 1080);
  if (Math.abs(w / h - FRAME_AR) > 0.01) throw new Error(`gallery style renders 16:9 only (order.aspect is ${order.aspect})`);

  /* ---- 1. prep ---- */
  const photos = [];
  for (let i = 0; i < order.photos.length; i++) {
    const p = order.photos[i];
    const src = path.isAbsolute(p.file) ? p.file : path.join(dirs.base, p.file);
    if (p.trim != null && typeof p.trim !== 'boolean') throw new Error(`photos[${i}].trim must be true or false`);
    const prepped = await prepPhoto(src, path.join(dirs.work, 'prep'), i, { trim: p.trim });
    photos.push({ index: i, ...prepped, order: p });
  }
  const nTrim = photos.filter(p => p.trimmed).length;
  log(`  prepared ${photos.length} photo(s)` + (nTrim ? ` — solid screenshot bars trimmed from ${nTrim} (photo ${photos.filter(p => p.trimmed).map(p => p.index + 1).join(', ')})` : ''));

  /* ---- 2. faces ---- */
  const facesFile = path.join(dirs.work, 'faces.json');
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(facesFile, 'utf8')); } catch { /* first run */ }
  for (const p of photos) {
    const marked = p.order.faces != null ? normFaces(p.order.faces, `photos[${p.index}].faces`) : null;
    let detected = null;
    if (!marked) {
      if (!dirs.force && cache[p.key]) detected = cache[p.key];
      else { detected = await detectFaces(p.file); cache[p.key] = detected; }
    }
    const r = resolveFaces(marked, detected);
    p.faces = r.faces; p.faceSource = r.source; p.detected = detected || [];
  }
  await fsp.writeFile(facesFile, JSON.stringify(cache));
  const bySource = s => photos.filter(p => p.faceSource === s).length;
  log(`  faces: ${bySource('operator')} marked by operator, ${bySource('detector')} detected, ${bySource('unknown')} unknown (treated conservatively)`);

  /* ---- 3. scenes ---- */
  const cards = Array.isArray(order.cards) ? order.cards : [];
  const breaks = new Set(cards.filter(c => Number.isFinite(c.after)).map(c => c.after));
  const meta = photos.map(p => ({ index: p.index, w: p.w, h: p.h, faces: p.faces, layout: p.order.layout, actBreak: p.order.actBreak, recap: p.order.recap }));
  const scenes = planScenes(meta, { breaks });

  /* Interleave cards and scenes. A card "after N" follows the scene that ends on photo N. */
  const holdScale = Number(order.hold ?? 6.0) / 6.0;
  const xfade = Number(order.xfade ?? 1.2);
  const items = [];
  const cardItem = (c) => ({
    kind: 'card', card: c, hold: 0,
    /* A chapter opens a new act unless the order says otherwise. */
    actBreak: c.actBreak != null ? c.actBreak : c.type === 'chapter',
  });
  for (const c of cards.filter(c => c.at === 'open')) items.push(cardItem(c));
  let seen = 0;
  for (const s of scenes) {
    const first = order.photos[s.photos[0]];
    const holds = s.photos.map(i => order.photos[i].hold).filter(v => v != null).map(Number);
    const captions = [...new Set(s.photos.map(i => String(order.photos[i].caption || '').trim()).filter(Boolean))];
    items.push({
      kind: 'scene', scene: s, hold: holds.length ? Math.max(...holds) : Number((HOLD[s.kind] * holdScale).toFixed(2)),
      heldByOperator: holds.length > 0,
      caption: captions.join('   ·   '), actBreak: first.actBreak === true,
      wantMotion: first.motion || 'auto',
    });
    seen += s.photos.length;
    for (const c of cards.filter(c => c.after === seen)) items.push(cardItem(c));
  }
  if (order.recap) {
    const picks = pickRecap(meta, 4);
    if (picks.length >= 3) {
      items.push({
        kind: 'scene', hold: Number((HOLD.collage * holdScale).toFixed(2)), caption: typeof order.recap === 'string' ? order.recap : '',
        actBreak: false, wantMotion: 'auto', recap: true,
        scene: { kind: 'collage', photos: picks.map(p => p.index), rects: collageRects(picks.map(p => p.w / p.h)), hold: HOLD.collage, why: 'recap: photos from across the film, together' },
      });
    }
  }
  for (const c of cards.filter(c => c.at === 'close')) items.push(cardItem(c));

  /* ---- 4. plates, 5. audit ---- */
  const bgs = backgroundCycle(order);
  let chapter = 0;
  const audit = [];
  const check = (item, name, ok, detail) => audit.push({ item, check: name, ok: !!ok, detail });
  let sceneNo = 0;
  for (let n = 0; n < items.length; n++) {
    const it = items[n];
    const tag = String(n).padStart(3, '0');
    if (it.kind === 'card') {
      if (it.card.type === 'chapter' && n > 0) chapter++;
      /* A card may name its own background; otherwise it takes its chapter's. */
      const bg = it.card.background != null ? backgroundPath(it.card.background) : bgs.card(chapter);
      /* Portrait card: the crop of the chosen photo that keeps every protected face, then proof
       * that each face sits where the faded edge is still fully opaque. Unknown faces refuse. */
      let portrait = null;
      if (it.card.portrait != null) {
        const p = photos[it.card.portrait - 1];
        const crop = portraitCrop(p);
        if (!crop.ok) {
          check(n, 'portrait-crop', false, `photo ${it.card.portrait}: ${crop.reason}${p.faces == null ? ' — mark its faces ("faces") or choose another photo' : ''}`);
        } else {
          portrait = { file: p.file, crop };
          const faces = p.faces || [];
          /* The face itself must be fully opaque; hair and shoulders (the protected margin) may soften. */
          const minFace = faces.length ? Math.min(...faces.map(f => faceOpacity(f, crop))) : 1;
          const minHead = faces.length ? Math.min(...faces.map(f => faceOpacity(protect(f), crop))) : 1;
          check(n, 'portrait-keeps-faces', minFace >= 0.98, faces.length
            ? `photo ${it.card.portrait}: ${faces.length} face(s), lowest face opacity ${minFace.toFixed(2)} (needs ≥ 0.98); with headroom ${minHead.toFixed(2)}`
            : `photo ${it.card.portrait}: declared face-free`);
        }
      }
      const r = await renderCardPlates(it.card, order.subject || {}, { w, h, theme: order.theme || 'warm', background: bg, portrait });
      it.plate = path.join(platesDir, `plate-${tag}.png`);
      await fsp.writeFile(it.plate, r.base);
      it.layers = [];
      for (let k = 0; k < r.layers.length; k++) {
        const f = path.join(platesDir, `plate-${tag}-L${k}.png`);
        await fsp.writeFile(f, r.layers[k].png);
        it.layers.push({ file: f, at: r.layers[k].at, fade: r.layers[k].fade, wipe: r.layers[k].wipe, sha: sha(r.layers[k].png) });
      }
      it.portrait = portrait ? it.card.portrait : undefined;
      it.plateSha = sha(r.base);
      it.text = r.text;
      it.hold = Number(Math.max(Number(it.card.hold ?? CARD_HOLD), r.minHold).toFixed(2));
      it.minHold = r.minHold;
      it.bg = bg ? path.basename(bg, '.jpg') : 'gradient';
      it.motion = safeMotion(n % 2 ? 'pull' : 'push', r.portraitRect || null, { x: 0.5, y: 0.5 }, 0.05);
      const bad = textOutsideSafe(r.text);
      check(n, 'text-safe', bad.length === 0, bad.length ? `outside title-safe: ${bad.map(b => JSON.stringify(b.text)).join(', ')}` : `${r.text.length} line(s) inside the ${TITLE_SAFE * 100}% title-safe margin`);
      continue;
    }

    const s = it.scene;
    const bg = bgs.scene(chapter);
    const r = await renderScenePlate(s, photos, { w, h, background: bg, caption: it.caption });
    it.plate = path.join(platesDir, `plate-${tag}.png`);
    await fsp.writeFile(it.plate, r.png);
    it.plateSha = sha(r.png);
    it.layers = [];
    if (r.caption) {
      const f = path.join(platesDir, `plate-${tag}-L0.png`);
      await fsp.writeFile(f, r.caption);
      it.layers.push({ file: f, at: CAPTION_AT, fade: CAPTION_FADE, sha: sha(r.caption) });
    }
    it.text = r.text;
    it.bg = r.bg;

    /* Where did every protected face land in the frame? */
    const landed = [];
    s.photos.forEach((idx, k) => {
      const f = photos[idx].faces;
      if (!f || !f.length) return;
      for (const face of f) landed.push({ photo: idx, raw: toFrame(face, r.photoRects[k], s.crop), safe: toFrame(protect(face), r.photoRects[k], s.crop) });
    });

    /* The crop (if any) must contain every protected face — re-checked here, on the numbers
     * actually drawn, rather than trusted from the planner. */
    if (s.crop) {
      const idx = s.photos[0];
      const inside = facesInside(photos[idx].faces, s.crop);
      const src = photos[idx].faceSource;
      check(n, 'crop-keeps-faces', inside, inside
        ? `crop cuts ${(s.crop.cut * 100).toFixed(1)}%; ${photos[idx].faces ? photos[idx].faces.length : 0} face(s) (${src}) inside with headroom`
        : `crop cuts into a protected face (${src})`);
    } else {
      check(n, 'photos-whole', true, `${s.photos.length} photo(s) shown whole — no crop`);
    }

    /* Motion: zoom about the faces for a full-bleed photo; about the centre for prints, and
     * never so far that a print (or, full-bleed, a protected face) leaves the frame. */
    let keep, focus, want;
    if (s.kind === 'full') {
      const u = unionOf(landed.map(l => ({ x0: Math.max(0, l.safe.x0), y0: Math.max(0, l.safe.y0), x1: Math.min(1, l.safe.x1), y1: Math.min(1, l.safe.y1) })));
      keep = u; focus = u ? { x: (u.x0 + u.x1) / 2, y: (u.y0 + u.y1) / 2 } : { x: 0.5, y: 0.42 };
      want = u ? SCENE_ZOOM.full : SCENE_ZOOM.fullBlind;
    } else {
      keep = unionOf(r.prints.map(p => ({ x0: p.x, y0: p.y, x1: p.x + p.w, y1: p.y + p.h })));
      focus = { x: 0.5, y: 0.5 }; want = SCENE_ZOOM[s.kind] ?? 0.03;
    }
    const m = it.wantMotion;
    const kind = m === 'still' ? 'still' : (m === 'push' || m === 'driftR' || m === 'driftD') ? 'push' : m === 'pull' ? 'pull' : (sceneNo % 2 ? 'pull' : 'push');
    it.motion = safeMotion(kind, keep, focus, want);
    sceneNo++;

    const win = motionWindow(it.motion);
    const out = landed.filter(l => l.safe.x0 < win.x - 1e-6 && l.safe.x0 > 0 || l.safe.y0 < win.y - 1e-6 && l.safe.y0 > 0 || l.safe.x1 > win.x + win.w + 1e-6 && l.safe.x1 < 1 || l.safe.y1 > win.y + win.h + 1e-6 && l.safe.y1 < 1);
    check(n, 'faces-stay-in-frame', out.length === 0, out.length
      ? `${out.length} protected face(s) leave the frame at full zoom`
      : landed.length ? `${landed.length} face(s) inside the frame through the whole ${it.motion.kind} (zoom ${(it.motion.amp * 100).toFixed(1)}%)` : 'no face data for this scene — photos uncropped or conservative crop');
    const nearEdge = landed.filter(l => l.raw.x0 < ACTION_SAFE || l.raw.y0 < ACTION_SAFE || l.raw.x1 > 1 - ACTION_SAFE || l.raw.y1 > 1 - ACTION_SAFE);
    if (nearEdge.length) audit.push({ item: n, check: 'face-near-edge', ok: true, warn: true, detail: `${nearEdge.length} face(s) within ${ACTION_SAFE * 100}% of the frame edge — an overscanning TV may trim them; consider "layout": "framed"` });
    const bad = textOutsideSafe(r.text);
    if (r.text.length) check(n, 'text-safe', bad.length === 0, bad.length ? `caption outside title-safe: ${bad.map(b => JSON.stringify(b.text)).join(', ')}` : 'caption inside title-safe');
    it.faceSources = s.photos.map(i => photos[i].faceSource);
  }
  clearImageCache();

  const plan = {
    orderId: order.orderId, style: 'gallery', w, h, fps: FPS, xfade, theme: order.theme || 'warm',
    subject: order.subject || {}, items, headFade: HEAD_FADE, tailFade: TAIL_FADE, colour: 'bt709', totalSec: 0,
  };

  /* A fade needs room: the first and last items must outlast the head and tail fades. */
  plan.headFade = Math.min(HEAD_FADE, items[0].hold * 0.3);
  plan.tailFade = Math.min(TAIL_FADE, items[items.length - 1].hold * 0.4);
  plan.totalSec = totalSeconds(plan);
  if (plan.totalSec <= 0) throw new Error('planGallery: transitions are longer than the content');

  /* ---- fit the photos to the song ---- */
  const music = await resolveMusic(order, dirs.base);
  plan.music = music;
  plan.musicFit = null;
  if (music.length && order.music && order.music.fit) {
    const target = music.reduce((a, t) => a + t.durationSec, 0) - Math.max(0, music.length - 1) * 3.0;
    const flex = items.filter(it => it.kind === 'scene' && !it.heldByOperator);
    const flexSum = flex.reduce((a, it) => a + it.hold, 0);
    const fixed = plan.totalSec - flexSum;
    const k = flexSum > 0 ? (target - fixed) / flexSum : 1;
    if (k >= FIT_MIN && k <= FIT_MAX) {
      for (const it of flex) it.hold = Number((it.hold * k).toFixed(2));
      plan.totalSec = totalSeconds(plan);
      plan.musicFit = { applied: true, scale: Number(k.toFixed(3)), targetSec: Number(target.toFixed(1)) };
    } else {
      plan.musicFit = { applied: false, scale: Number(k.toFixed(3)), targetSec: Number(target.toFixed(1)),
        reason: `the film would need its photo holds scaled ×${k.toFixed(2)} (allowed ${FIT_MIN}–${FIT_MAX}) — add or remove photos, or choose different music` };
    }
  }

  const tl = timeline(plan);
  const report = {
    orderId: order.orderId, style: 'gallery', width: w, height: h, fps: FPS,
    durationSec: Number(plan.totalSec.toFixed(3)),
    photos: photos.map(p => ({ index: p.index, file: p.order.file, size: `${p.w}x${p.h}`, faces: p.faces ? p.faces.length : null, faceSource: p.faceSource,
      trimmed: p.trimmed ? `solid bands removed, ${(p.trimmed.w * p.trimmed.h * 100).toFixed(0)}% of the file kept` : undefined })),
    facesReviewed: order.facesReviewed === true,
    items: items.map((it, n) => ({
      n, at: Number(tl.starts[n].toFixed(2)), hold: it.hold, kind: it.kind,
      ...(it.kind === 'card'
        ? { type: it.card.type, lines: it.layers.length, background: it.bg, portrait: it.portrait }
        : { layout: it.scene.kind, photos: it.scene.photos, why: it.scene.why, crop: it.scene.crop ? Number((it.scene.crop.cut * 100).toFixed(1)) : 0, background: it.bg, caption: it.caption || undefined, recap: it.recap || undefined }),
      motion: it.motion, actBreak: it.actBreak || undefined,
    })),
    audit, auditFailed: audit.filter(a => !a.ok).length,
    music: music.map(t => ({ track: t.slug || t.title, licence: t.licence, tier: t.tier, attribution: t.attribution, durationSec: t.durationSec })),
    musicFit: plan.musicFit,
  };
  await fsp.writeFile(path.join(dirs.work, 'plan.json'), JSON.stringify(report, null, 1));
  return { plan, dirs, photos, report };
}

/**
 * portraitCrop — the window of a photo shown on a portrait card. The largest window (most of
 * the photo) whose bare faces all land where the faded edge is still fully opaque; it zooms in
 * only as far as that needs, face centre placed a little above the middle. Unknown faces are
 * refused (the edge could fade a face nobody marked); no window narrower than 560 px of the
 * original is used, so a small face is never blown up into mush.
 */
export const PORTRAIT_MIN_PX = 560;

/** Lowest portrait opacity on the oval inscribed in face box `f` (photo fractions) under crop `c`.
 *  A face is an oval: the corners of its box are background, so they are not tested. */
export function faceOpacity(f, c) {
  const ex = (f.x0 + f.x1) / 2, ey = (f.y0 + f.y1) / 2, rx = (f.x1 - f.x0) / 2, ry = (f.y1 - f.y0) / 2;
  let min = 1;
  for (let k = 0; k < 32; k++) {
    const a = (k / 32) * Math.PI * 2;
    const u = (ex + rx * Math.cos(a) - c.x) / c.w, v = (ey + ry * Math.sin(a) - c.y) / c.h;
    min = Math.min(min, u < 0 || u > 1 || v < 0 || v > 1 ? 0 : portraitAlpha(u, v));
  }
  return min;
}
export function portraitCrop(p) {
  if (p.faces == null) return { ok: false, reason: 'faces unknown' };
  const ar = PORTRAIT_AR;
  const maxW = Math.min(p.w, p.h * ar);
  if (!p.faces.length) {
    const cw = maxW, ch = cw / ar;
    return { ok: true, x: (p.w - cw) / 2 / p.w, y: (p.h - ch) * 0.4 / p.h, w: cw / p.w, h: ch / p.h, reason: 'declared face-free' };
  }
  const u = unionOf(p.faces);
  const cx = (u.x0 + u.x1) / 2 * p.w, cy = (u.y0 + u.y1) / 2 * p.h;
  const alphaOf = (f, c) => faceOpacity(f, c);
  for (let s = 1; s >= 0.2; s -= 0.02) {
    const cw = maxW * s, ch = cw / ar;
    if (cw < Math.min(PORTRAIT_MIN_PX, maxW)) break;
    const x = Math.min(Math.max(0, cx - cw / 2), p.w - cw), y = Math.min(Math.max(0, cy - ch * 0.42), p.h - ch);
    const c = { x: x / p.w, y: y / p.h, w: cw / p.w, h: ch / p.h };
    if (Math.min(...p.faces.map(f => alphaOf(f, c))) >= 0.98) return { ok: true, ...c, reason: `${Math.round(cw)}x${Math.round(ch)} px window, zoom ×${(1 / s).toFixed(2)}` };
  }
  return { ok: false, reason: 'no window puts every face in the solid centre of the portrait (faces too far apart, or too near the photo edge) — choose a photo with one or two close faces' };
}

/* ------------------------------------------------------------------ segments */

function zoomExpr(m, frames) {
  const d = Math.max(2, frames - 1);
  if (m.kind === 'still' || !m.amp) return `z='1.0':x='0':y='0'`;
  const z = m.kind === 'pull' ? `${(1 + m.amp).toFixed(4)}-${m.amp}*on/${d}` : `1+${m.amp}*on/${d}`;
  return `z='${z}':x='(iw-iw/zoom)*${m.fx}':y='(ih-ih/zoom)*${m.fy}'`;
}

/** The filter graph of one gallery segment. Input 0 is the plate; inputs 1.. are text layers. */
export function segmentGraph(item, plan, oversample = OVERSAMPLE) {
  const ow = plan.w * oversample, oh = plan.h * oversample;
  const frames = Math.round(item.hold * plan.fps);
  const tag709 = 'setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv';
  /* RGB → BT.709 limited-range YUV happens HERE, once, before the upscale. Left to default the
   * conversion uses the BT.601 matrix and every skin tone in the film shifts; converting first
   * also makes the 8x stage 3.4x faster than carrying RGB through it (11 s vs 37 s, measured). */
  const g = [`[0:v]scale=in_range=pc:out_range=tv:out_color_matrix=bt709:flags=bicubic,format=yuv420p,`
    + `scale=${ow}:${oh}:flags=bicubic,setsar=1,zoompan=${zoomExpr(item.motion, frames)}:d=${frames}:s=${plan.w}x${plan.h}:fps=${plan.fps},setsar=1[m0]`];
  let prev = 'm0';
  (item.layers || []).forEach((L, k) => {
    /* The layer is ONE still picture. It is read and colour-converted once, then repeated
     * inside the graph by `loop`; feeding it with `-loop 1` instead decoded and converted the
     * same PNG on every frame. Measured on a 4-layer verse card (2026-11-24): 69.2 s → 52.7 s,
     * output identical (PSNR infinite, same 303 frames). */
    const src = `[${k + 1}:v]scale=in_range=pc:out_range=tv:out_color_matrix=bt709,format=yuva444p,loop=loop=-1:size=1:start=0`;
    if (L.wipe) {
      /* Written on: the layer's own alpha is multiplied by a soft edge travelling left to right.
       * The edge is a crop window sliding over ONE pre-drawn gradient strip (drawn once, then
       * repeated by `loop`), so the per-frame cost is a crop and a multiply — no per-pixel maths. */
      const W = plan.w, H = plan.h, R = Math.round(H * 0.15);
      const sx = W + R - L.wipe.x0, ex = W - L.wipe.x1;
      g.push(`${src},split[l${k}c][l${k}s]`);
      g.push(`[l${k}s]alphaextract[l${k}a]`);
      g.push(`color=c=black:s=${2 * W + R}x${H}:r=${plan.fps},format=gray,geq=lum='255*clip((${W + R}-X)/${R},0,1)',trim=end_frame=1,loop=loop=-1:size=1:start=0,setpts=N/${plan.fps}/TB,`
        + `crop=${W}:${H}:x='${sx}-${sx - ex}*clip((t-${L.at.toFixed(3)})/${L.wipe.dur.toFixed(3)},0,1)':y=0[l${k}m]`);
      g.push(`[l${k}a][l${k}m]blend=all_mode=multiply,format=gray[l${k}w]`);
      g.push(`[l${k}c][l${k}w]alphamerge[l${k}]`);
    } else {
      g.push(`${src},fade=t=in:st=${L.at.toFixed(3)}:d=${L.fade.toFixed(3)}:alpha=1[l${k}]`);
    }
    g.push(`[${prev}][l${k}]overlay=0:0:format=auto:eof_action=repeat[m${k + 1}]`);
    prev = `m${k + 1}`;
  });
  g.push(`[${prev}]format=yuv420p,setsar=1,${tag709}[v]`);
  return g.join(';');
}

async function renderGallerySegment(plan, item, index, dirs, log) {
  const segFile = path.join(dirs.work, `seg-${String(index).padStart(3, '0')}.mp4`);
  const want = { w: plan.w, h: plan.h };
  const graph = segmentGraph(item, plan);
  const print = fingerprint({ v: 2, plate: item.plateSha, layers: (item.layers || []).map(l => [l.sha, l.at, l.fade]), graph, hold: item.hold });
  const label = item.kind === 'card' ? `card:${item.card.type}` : `${item.scene.kind} [${item.scene.photos.map(i => i + 1).join(',')}]`;

  if (!dirs.force && segmentMatches(segFile, print) && await segmentIsGood(segFile, item.hold, want)) {
    log(`  [${index + 1}/${plan.items.length}] reuse ${label}`);
    return { segFile, reused: true, item };
  }
  const graphFile = path.join(dirs.work, `.graph-${index}.txt`);
  await fsp.writeFile(graphFile, graph);
  const inputs = ['-loop', '1', '-framerate', String(plan.fps), '-t', String(item.hold), '-i', item.plate];
  for (const L of (item.layers || [])) inputs.push('-framerate', String(plan.fps), '-i', L.file);

  const t0 = Date.now();
  const tmp = segFile + '.tmp.mp4';
  const r = await run('ffmpeg', [
    '-hide_banner', '-nostats', '-y', ...inputs,
    '-filter_complex_script', graphFile, '-map', '[v]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16',
    '-r', String(plan.fps), '-t', String(item.hold),
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', tmp,
  ]);
  if (r.code !== 0) {
    const tail = r.err.split('\n').filter(Boolean).slice(-6).join('\n');
    throw new Error(`segment ${index} (${label}) failed (ffmpeg ${r.code}):\n${tail}`);
  }
  await fsp.rename(tmp, segFile);
  if (!(await segmentIsGood(segFile, item.hold, want))) throw new Error(`segment ${index} rendered but failed its own check: ${segFile}`);
  await stampSegment(segFile, print, { label });
  log(`  [${index + 1}/${plan.items.length}] ${label.padEnd(22)} ${item.hold.toFixed(1)}s  ${item.motion.kind}${item.motion.amp ? ' ' + (item.motion.amp * 100).toFixed(1) + '%' : ''}  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  return { segFile, reused: false, item };
}

/* Delivery encode: H.264 High@4.0, closed 2-second GOPs, a bitrate ceiling old TV and USB
 * decoders can follow. CRF 18 on photographic content lands at roughly 4–10 Mbps. */
export const DELIVERY_ENCODE = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-profile:v', 'high', '-level:v', '4.0',
  '-g', '60', '-keyint_min', '30', '-bf', '2', '-maxrate', '12M', '-bufsize', '24M'];

/* ------------------------------------------------------------------ entry point */

export async function renderGallery(order, opts = {}) {
  const log = opts.log || (() => {});
  const t0 = Date.now();
  log(`order ${order.orderId} (gallery): planning`);
  const { plan, dirs, report } = await planGallery(order, opts);
  await fsp.mkdir(dirs.work, { recursive: true });

  const failed = report.audit.filter(a => !a.ok);
  if (failed.length) {
    /* A film that would cut a face or push a name off the screen is not rendered at all. */
    throw new Error(`plan failed its audit — nothing rendered:\n` + failed.map(a => `  item ${a.item + 1}: ${a.check} — ${a.detail}`).join('\n'));
  }
  log(`order ${plan.orderId}: ${plan.items.length} segments, ${plan.w}x${plan.h}, ${plan.totalSec.toFixed(1)}s target`
    + (plan.musicFit ? (plan.musicFit.applied ? ` (holds ×${plan.musicFit.scale} to fit the music)` : ` (music fit NOT applied: ${plan.musicFit.reason})`) : ''));

  /* Two scenes at a time. One oversampled segment keeps a single core busy and peaks at
   * 0.65–0.9 GB; measured on this phone (2026-11-24, 7.6 s scenes): one alone 20.7 s, two
   * together 15.0 s for the pair, three together 27.4 s for the three. Two is both the fastest
   * per scene and inside the memory this device has free. MEMORIAL_PARALLEL=1 restores serial. */
  const segs = new Array(plan.items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= plan.items.length) return;
      segs[i] = await renderGallerySegment(plan, plan.items[i], i, dirs, log);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, plan.items.length) }, worker));

  const silent = await assemble(plan, segs, dirs, log, dirs.force, DELIVERY_ENCODE);
  const finalPath = path.join(dirs.out, `${plan.orderId}.mp4`);

  let audio = { audio: 'none' };
  let mastered = null;
  if (order.narration && order.narration.file) {
    /* Narration keeps the station's ducking mixer (sidecar/audio-finish.js muxFinal): the bed is
     * fitted and faded here first, then ducked under the voice and mastered there (to its own
     * -14 LUFS target). A narrated film with no music is voice alone. */
    const voice = path.isAbsolute(order.narration.file) ? order.narration.file : path.join(dirs.base, order.narration.file);
    if (!fs.existsSync(voice)) throw new Error(`narration file not found: ${voice}`);
    let bed = null;
    if (plan.music.length) {
      bed = path.join(dirs.work, 'bed.m4a');
      mastered = await masterBed(plan.music, plan.totalSec, bed);
    }
    const { createRequire } = await import('node:module');
    const af = createRequire(import.meta.url)(path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'sidecar', 'audio-finish.js'));
    await fsp.copyFile(silent, finalPath);
    await fsp.rm(path.join(dirs.work, 'video_silent.mp4'), { force: true });
    const res = af.muxFinal(finalPath, bed, voice, { silentCopy: path.join(dirs.work, 'video_silent.mp4'), durationSec: plan.totalSec });
    if (!res || !res.ok) throw new Error(`narration mix failed: ${(res && res.reason) || 'unknown'}`);
    audio = { audio: bed ? 'bed+narration' : 'narration' };
    mastered = null;
    log(`  audio: narration${bed ? ' ducked over the music' : ' only'}, mastered by the station mixer`);
  } else if (plan.music.length) {
    const bed = path.join(dirs.work, 'bed.m4a');
    mastered = await masterBed(plan.music, plan.totalSec, bed);
    await muxBed(silent, bed, finalPath, plan.totalSec);
    audio = { audio: 'bed' };
    log(`  music: ${mastered.tracks.join(' → ')}${mastered.loops ? ' (repeats to cover the film)' : ''} — ${mastered.measured.lufs} LUFS, peak ${mastered.measured.truePeak} dBFS`);
  } else {
    log('  no music in order — delivering silent');
    await fsp.copyFile(silent, finalPath);
  }

  const wall = (Date.now() - t0) / 1000;
  const probe = await ffprobeJson(finalPath);
  const bytes = fs.existsSync(finalPath) ? fs.statSync(finalPath).size : 0;
  const durationSec = probe && probe.format ? Number(probe.format.duration) : 0;
  report.render = { path: finalPath, bytes, durationSec, wallSec: Number(wall.toFixed(1)), reusedSegments: segs.filter(s => s.reused).length, mastered: mastered && mastered.measured, musicLoops: mastered ? mastered.loops : false };
  await fsp.writeFile(path.join(dirs.out, `${plan.orderId}.report.json`), JSON.stringify(report, null, 1));

  log(`done in ${wall.toFixed(1)}s → ${finalPath} (${(bytes / 1048576).toFixed(1)} MB, ${durationSec.toFixed(1)}s)`);
  return {
    ok: bytes > 0, orderId: plan.orderId, path: finalPath, bytes, durationSec, targetSec: plan.totalSec,
    segments: segs.length, reusedSegments: segs.filter(s => s.reused).length,
    fits: [], audio: audio.audio, wallSec: wall, realtimeRatio: durationSec > 0 ? wall / durationSec : null,
    width: plan.w, height: plan.h, style: 'gallery', report, plan,
  };
}

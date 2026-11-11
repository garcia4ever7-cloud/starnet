/* memorial/render.mjs — turn an order JSON into a finished memorial film.
 *
 * WHY THIS EXISTS
 * ---------------
 * StarNet structurally cannot make this product: sidecar/higgsfield-video.js generateVideo() has
 * no input-image parameter, so a customer photograph has no route into the video pipeline; there
 * is no clip assembly anywhere in the sidecar; and output is hardcoded to ~5 seconds. Meanwhile
 * ffmpeg 8.1.3 on this phone rendered a 40-photo, 193-second, 1920x1080 film end to end at 1.48x
 * realtime for $0. This module is that capability, made repeatable.
 *
 * DESIGN RULES, each one forced by a measurement or a finding:
 *
 *  1. ZERO MODEL CALLS, ZERO NETWORK, ZERO SPEND. Every text provider on this station is dry and
 *     the sidecar currently holds no provider keys at all. Production must never block on a
 *     wallet. A hand-written order JSON renders a complete film. Agents, when funded, only
 *     improve the words inside that JSON.
 *
 *  2. EIGHT-TIMES OVERSAMPLE. zoompan rounds its crop window to whole pixels, which makes slow
 *     drifts shudder. Measured here (edgetrack, RMS 2nd-difference of a tracked edge, output px):
 *     1x = 1.1218, 4x = 0.2745, 8x = 0.1061, against a visibility threshold of ~0.1. Only 8x is
 *     actually smooth.
 *
 *  3. THEREFORE, PER-SEGMENT RENDERING. 8x across 40 photos in one filter graph does not fit in
 *     the ~2.7 GB free on this device (the 4x single-pass run peaked at 3,925 MB). Each segment is
 *     rendered alone, so only one oversampled buffer is ever live. This also makes the render
 *     RESUMABLE and lets one bad photo be retried without rebuilding the film.
 *
 *  4. LIBX264, NOT THE HARDWARE ENCODER. Counterintuitive but measured on this phone:
 *     h264_mediacodec took 481s wall vs libx264's 285s for the same film, and produced a 3x larger
 *     file. CPU time halves but mediacodec is the bottleneck and cannot keep up, while libx264
 *     spreads across all 8 cores.
 *
 *  5. GENTLE DISSOLVES ONLY. AV Workshop — a real memorial business with 12 published tiers —
 *     uses "soft dissolve" as its default and sells Pan & Zoom as a $10-per-image ADD-ON. Motion
 *     is the upcharge, not the baseline. No fadeblack except where the order asks for an act break.
 *
 *  6. AUDIO IS NOT REIMPLEMENTED. sidecar/audio-finish.js already does sidechain ducking of a bed
 *     under narration plus loudnorm mastering to AAC 192k, and runs on every video the station
 *     produces. We call it.
 */
'use strict';

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { planFit, fitFilter, frameSize } from './fit.mjs';
import { renderCard } from './cards.mjs';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');

/* 8x is the measured sweet spot (see the header). The env override exists so the jitter
 * regression can render the SAME content at 1x and 8x and compare — an absolute RMS figure is
 * only meaningful against an identical pan rate and codec, so the test must control for both. */
export const OVERSAMPLE = Math.max(1, Number(process.env.MEMORIAL_OVERSAMPLE) || 8);
export const FPS = 30;
export const DEFAULT_HOLD = 6.0;
export const DEFAULT_XFADE = 1.2;
export const CARD_HOLD = 5.0;

/* ---------------------------------------------------------------- small helpers */

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    let out = '', err = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { err += d; });
    p.on('error', e => resolve({ code: -1, out, err: String(e && e.message || e) }));
    p.on('close', code => resolve({ code, out, err }));
  });
}

export async function ffprobeJson(file) {
  const r = await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
  if (r.code !== 0) return null;
  try { return JSON.parse(r.out); } catch { return null; }
}

async function probeImage(file) {
  const j = await ffprobeJson(file);
  const s = j && j.streams && j.streams.find(x => x.width && x.height);
  if (!s) throw new Error(`cannot read image dimensions: ${file}`);
  return { w: Number(s.width), h: Number(s.height) };
}

/* A segment counts as already-done only if it decodes to roughly the duration we asked for.
 * A truncated file from a killed render must not be silently accepted — that is the exact class
 * of failure that let a 1,056-byte placeholder ship as a finished video on this station before. */
async function segmentIsGood(file, wantSec, want) {
  if (!fs.existsSync(file)) return false;
  const j = await ffprobeJson(file);
  if (!j || !j.format) return false;
  const v = (j.streams || []).find(s => s.codec_type === 'video');
  if (!v) return false;
  if (Number(v.width) !== want.w || Number(v.height) !== want.h) return false;
  const dur = Number(j.format.duration);
  return Number.isFinite(dur) && Math.abs(dur - wantSec) < 0.25;
}

const MOTIONS = ['push', 'pull', 'driftR', 'driftD'];

/* zoompan expressions. Deliberately small amplitudes: 9-10% over six seconds is a drift you feel
 * rather than notice, which is the whole Ken Burns teaching and the opposite of the energetic
 * wedding-template look the supplied After Effects tutorial produces. */
function motionExpr(kind, frames) {
  const d = Math.max(2, frames - 1);
  switch (kind) {
    case 'push':   return `z='1+0.10*on/${d}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`;
    case 'pull':   return `z='1.10-0.10*on/${d}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`;
    case 'driftR': return `z='1+0.09*on/${d}':x='(iw-iw/zoom)*(0.35+0.30*on/${d})':y='ih/2-(ih/zoom/2)'`;
    case 'driftD': return `z='1+0.09*on/${d}':x='iw/2-(iw/zoom/2)':y='(ih-ih/zoom)*(0.60-0.30*on/${d})'`;
    case 'still':  return `z='1.0':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`;
    /* Cards get the faintest possible breath so they are not dead frames next to moving photos. */
    case 'breath': return `z='1+0.022*on/${d}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`;
    default: throw new Error(`unknown motion '${kind}'`);
  }
}

/* ---------------------------------------------------------------- order -> plan */

export function buildPlan(order, opts = {}) {
  if (!order || typeof order !== 'object') throw new Error('buildPlan: order must be an object');
  if (!order.orderId) throw new Error('buildPlan: order.orderId is required');
  const photos = Array.isArray(order.photos) ? order.photos : [];
  if (!photos.length) throw new Error('buildPlan: order.photos must not be empty');

  const { w, h } = frameSize(order.aspect || '16:9', opts.height || 1080);
  const xfade = Number(order.xfade ?? DEFAULT_XFADE);
  const theme = order.theme || 'warm';
  const cards = Array.isArray(order.cards) ? order.cards : [];
  const subject = order.subject || {};

  const items = [];
  const open = cards.filter(c => c.at === 'open');
  const close = cards.filter(c => c.at === 'close');
  const mid = cards.filter(c => Number.isFinite(c.after))
    .slice().sort((a, b) => a.after - b.after);

  for (const c of open) items.push({ kind: 'card', card: c, hold: Number(c.hold ?? CARD_HOLD), motion: 'breath' });

  let placed = 0;
  for (let i = 0; i < photos.length; i++) {
    const p = photos[i];
    if (!p || !p.file) throw new Error(`buildPlan: photos[${i}] has no file`);
    items.push({
      kind: 'photo',
      file: p.file,
      caption: p.caption || '',
      hold: Number(p.hold ?? order.hold ?? DEFAULT_HOLD),
      motion: p.motion && p.motion !== 'auto' ? p.motion : MOTIONS[placed % MOTIONS.length],
      fit: p.fit || 'auto',
    });
    placed++;
    for (const c of mid) {
      if (c.after === placed) items.push({ kind: 'card', card: c, hold: Number(c.hold ?? CARD_HOLD), motion: 'breath' });
    }
  }

  for (const c of close) items.push({ kind: 'card', card: c, hold: Number(c.hold ?? CARD_HOLD), motion: 'breath' });

  const totalRaw = items.reduce((a, it) => a + it.hold, 0);
  const total = totalRaw - xfade * Math.max(0, items.length - 1);
  if (total <= 0) throw new Error('buildPlan: crossfade longer than the content');

  return { orderId: order.orderId, w, h, fps: FPS, xfade, theme, subject, items, totalSec: total };
}

/* ---------------------------------------------------------------- pass 1: segments */

async function renderSegment(plan, item, index, dirs, log) {
  const segFile = path.join(dirs.work, `seg-${String(index).padStart(3, '0')}.mp4`);
  const want = { w: plan.w, h: plan.h };

  if (await segmentIsGood(segFile, item.hold, want)) {
    log(`  [${index + 1}/${plan.items.length}] reuse ${path.basename(segFile)}`);
    return { segFile, reused: true, item };
  }

  const ow = plan.w * OVERSAMPLE;
  const oh = plan.h * OVERSAMPLE;
  const frames = Math.round(item.hold * plan.fps);

  let source, fitChain, fitInfo = null;
  if (item.kind === 'card') {
    const png = path.join(dirs.work, `card-${String(index).padStart(3, '0')}.png`);
    await fsp.writeFile(png, renderCard(item.card, plan.subject, { w: plan.w, h: plan.h, theme: plan.theme }));
    source = png;
    /* Cards are authored at exactly frame size; just lift them to the working resolution. */
    fitChain = `[0:v]scale=${ow}:${oh}:flags=bicubic,setsar=1[fit]`;
  } else {
    source = path.isAbsolute(item.file) ? item.file : path.join(dirs.base, item.file);
    if (!fs.existsSync(source)) throw new Error(`photo not found: ${source}`);
    const dim = await probeImage(source);
    const fp = planFit(dim.w, dim.h, plan.w, plan.h, item.fit);
    fitInfo = { ...fp, src: `${dim.w}x${dim.h}` };
    fitChain = fitFilter('0:v', 'fit', fp, ow, oh);
    log(`  [${index + 1}/${plan.items.length}] ${path.basename(source)} ${dim.w}x${dim.h} → ${fp.strategy} (${fp.reason})`);
  }

  const graph = `${fitChain};[fit]zoompan=${motionExpr(item.motion, frames)}:d=${frames}:s=${plan.w}x${plan.h}:fps=${plan.fps},format=yuv420p,setsar=1[v]`;
  const graphFile = path.join(dirs.work, `.graph-${index}.txt`);
  await fsp.writeFile(graphFile, graph);

  const tmp = segFile + '.tmp.mp4';
  const r = await run('ffmpeg', [
    '-hide_banner', '-nostats', '-y',
    '-loop', '1', '-t', String(item.hold), '-i', source,
    '-filter_complex_script', graphFile,
    '-map', '[v]',
    /* Intermediate: near-lossless and FAST. These segments are re-encoded by the assembly pass,
     * so spending `medium`/CRF19 here buys nothing and costs most of the render budget. */
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16',
    '-r', String(plan.fps), '-t', String(item.hold),
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', tmp,
  ]);
  if (r.code !== 0) {
    const tail = r.err.split('\n').filter(Boolean).slice(-6).join('\n');
    throw new Error(`segment ${index} failed (ffmpeg ${r.code}):\n${tail}`);
  }
  await fsp.rename(tmp, segFile);
  if (!(await segmentIsGood(segFile, item.hold, want))) {
    throw new Error(`segment ${index} rendered but failed its own check: ${segFile}`);
  }
  return { segFile, reused: false, item, fit: fitInfo };
}

/* ---------------------------------------------------------------- pass 2: assembly */

async function assemble(plan, segs, dirs, log, force = false) {
  const out = path.join(dirs.work, 'silent.mp4');

  /* Joining 35 segments is the expensive pass. If a good join already exists and no segment is
   * newer than it, reuse it — otherwise fixing something downstream (audio, packaging) costs a
   * full re-render every time. */
  if (!force && await segmentIsGood(out, plan.totalSec, { w: plan.w, h: plan.h })) {
    const joinedAt = fs.statSync(out).mtimeMs;
    const stale = segs.some(s => fs.existsSync(s.segFile) && fs.statSync(s.segFile).mtimeMs > joinedAt);
    if (!stale) { log(`  reuse existing join (${plan.totalSec.toFixed(1)}s)`); return out; }
    log('  a segment is newer than the join — rebuilding');
  }

  const inputs = [];
  for (const s of segs) inputs.push('-i', s.segFile);

  const chain = [];
  let prev = '0:v';
  let offset = 0;
  for (let i = 1; i < segs.length; i++) {
    offset += plan.items[i - 1].hold - plan.xfade;
    const tag = `x${i}`;
    const tr = plan.items[i].actBreak ? 'fadeblack' : 'fade';
    chain.push(`[${prev}][${i}:v]xfade=transition=${tr}:duration=${plan.xfade}:offset=${offset.toFixed(3)}[${tag}]`);
    prev = tag;
  }
  const graph = chain.length
    ? chain.join(';') + `;[${prev}]format=yuv420p,setsar=1[vo]`
    : `[0:v]format=yuv420p,setsar=1[vo]`;

  const graphFile = path.join(dirs.work, '.graph-assemble.txt');
  await fsp.writeFile(graphFile, graph);

  log(`  joining ${segs.length} segments → ${plan.totalSec.toFixed(1)}s`);
  const r = await run('ffmpeg', [
    '-hide_banner', '-nostats', '-y', ...inputs,
    '-filter_complex_script', graphFile,
    '-map', '[vo]',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '19',
    '-r', String(plan.fps), '-t', plan.totalSec.toFixed(3),
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out,
  ]);
  if (r.code !== 0) {
    const tail = r.err.split('\n').filter(Boolean).slice(-8).join('\n');
    throw new Error(`assembly failed (ffmpeg ${r.code}):\n${tail}`);
  }
  return out;
}

/* ---------------------------------------------------------------- pass 3: audio */

async function addAudio(order, silentPath, finalPath, dirs, log) {
  const music = order.music && order.music.file;
  if (!music) {
    log('  no music in order — delivering silent');
    await fsp.copyFile(silentPath, finalPath);
    return { audio: 'none' };
  }
  const bed = path.isAbsolute(music) ? music : path.join(dirs.base, music);
  if (!fs.existsSync(bed)) throw new Error(`music file not found: ${bed}`);

  /* Reuse the station's own finisher — specifically muxFinal, NOT audioFinish.
   *
   * audioFinish is an automatic RESCUE layer: it detects a silent video and tries to GENERATE
   * audio for it (TTS narration, then FAL-generated SFX), writing to its own internal
   * <workDir>/.audio-bed.mp3. It takes no caller-supplied bed, so handing it ours produced
   * "no audio could be produced: no FAL_KEY" and a silent film. muxFinal is the layer that
   * actually mixes audio we already have:
   *   - ducks the bed under narration with sidechaincompress when both are present
   *   - loudnorm=I=..:TP=..:LRA=11 measured on the FINAL mix
   *   - AAC 192k stereo, -c:v copy so the video is not re-encoded
   *   - preserves the silent original and renames over the target only on success
   */
  const af = require(path.join(REPO, 'sidecar', 'audio-finish.js'));
  await fsp.copyFile(silentPath, finalPath);

  const voice = order.narration && order.narration.file
    ? (path.isAbsolute(order.narration.file) ? order.narration.file : path.join(dirs.base, order.narration.file))
    : null;
  if (voice && !fs.existsSync(voice)) throw new Error(`narration file not found: ${voice}`);

  const res = af.muxFinal(finalPath, bed, voice, {
    silentCopy: path.join(dirs.work, 'video_silent.mp4'),
  });
  if (!res || !res.ok) {
    throw new Error(`audio mux failed: ${(res && res.reason) || 'unknown'}`);
  }
  log(`  audio: ${voice ? 'narration ducked over bed' : 'bed'} + loudnorm, AAC 192k`);
  return { audio: voice ? 'bed+narration' : 'bed' };
}

/* ---------------------------------------------------------------- entry point */

export function dirsFor(order, baseDir) {
  const base = baseDir || path.dirname(order.__file || process.cwd());
  const root = order.outputRoot
    ? (path.isAbsolute(order.outputRoot) ? order.outputRoot : path.join(base, order.outputRoot))
    : path.join(os.homedir(), '.local', 'share', 'StarNet', 'workspaces', 'memorial', order.orderId);
  return { base, root, work: path.join(root, 'work'), out: path.join(root, 'out') };
}

export async function renderOrder(order, opts = {}) {
  const log = opts.log || (() => {});
  const t0 = Date.now();
  const plan = buildPlan(order, opts);
  const dirs = dirsFor(order, opts.baseDir);
  await fsp.mkdir(dirs.work, { recursive: true });
  await fsp.mkdir(dirs.out, { recursive: true });

  log(`order ${plan.orderId}: ${plan.items.length} segments, ${plan.w}x${plan.h}, ${plan.totalSec.toFixed(1)}s target`);

  const segs = [];
  const fits = [];
  for (let i = 0; i < plan.items.length; i++) {
    const s = await renderSegment(plan, plan.items[i], i, dirs, log);
    segs.push(s);
    if (s.fit) fits.push({ file: plan.items[i].file, ...s.fit });
  }

  const silent = await assemble(plan, segs, dirs, log);
  const finalPath = path.join(dirs.out, `${plan.orderId}.mp4`);
  const audio = await addAudio(order, silent, finalPath, dirs, log);

  const wall = (Date.now() - t0) / 1000;
  const probe = await ffprobeJson(finalPath);
  const bytes = fs.existsSync(finalPath) ? fs.statSync(finalPath).size : 0;
  const durationSec = probe && probe.format ? Number(probe.format.duration) : 0;

  log(`done in ${wall.toFixed(1)}s → ${finalPath} (${(bytes / 1048576).toFixed(1)} MB, ${durationSec.toFixed(1)}s)`);

  return {
    ok: bytes > 0,
    orderId: plan.orderId,
    path: finalPath,
    bytes,
    durationSec,
    targetSec: plan.totalSec,
    segments: segs.length,
    reusedSegments: segs.filter(s => s.reused).length,
    fits,
    audio: audio.audio,
    wallSec: wall,
    realtimeRatio: durationSec > 0 ? wall / durationSec : null,
    width: plan.w,
    height: plan.h,
  };
}

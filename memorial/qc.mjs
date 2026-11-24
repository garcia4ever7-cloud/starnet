/* memorial/qc.mjs — the gate between "rendered" and "may be sent to a family".
 *
 * verify.mjs answers "is this the film we planned" (real file, right size, right length, has
 * sound). This answers "is it FIT TO BE SEEN": no black frames where none were designed, no
 * frozen picture, no hard cut in a film that is supposed to be all dissolves, loudness on target,
 * colour correctly labelled, plays from the first byte, and — from the plan — no face cut, no
 * word outside the title-safe area, and music whose licence is on record.
 *
 * Every check is measured from the finished file or recomputed from the plan. A check that
 * cannot be run is a FAILURE, not a pass: this station has shipped work that "passed" because
 * nothing looked.
 *
 * Levels:  fail = not deliverable.   warn = deliverable, but a human should read the line.
 *
 * Thresholds were calibrated on synthetic clips with planted defects (2026-11-24): hard cuts
 * scored 0.60–1.00 on ffmpeg's scene metric while a 1 s dissolve between unlike pictures peaked
 * at 0.29, hence 0.40.
 */
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { timeline } from './join.mjs';
import { TARGET_LUFS } from './audio.mjs';

export const QC = {
  blackMinSec: 0.35, blackSlack: 0.45,
  freezeNoise: '-60dB', freezeMinSec: 2.0, freezeSlack: 0.6,
  sceneCut: 0.40,
  lufsTol: 1.5, truePeakMax: -1.0,
  silenceNoise: '-55dB', silenceMinSec: 3.0,
  avDriftMax: 0.08, keyframeMaxSec: 2.2,
};

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

const inWindows = (t0, t1, wins, slack) => wins.some(w => t0 >= w.from - slack && t1 <= w.to + slack);

/**
 * qcFilm
 * @param file   the finished MP4
 * @param ctx    { plan?, report?, expectAudio?, gallery? }  plan/report from planGallery when available
 * @returns {{ok, checks:[{name, level, ok, detail}], failed:[names], warnings:[names]}}
 */
export async function qcFilm(file, ctx = {}) {
  const checks = [];
  const add = (name, ok, detail, level = 'fail') => checks.push({ name, level, ok: !!ok, detail });
  const done = () => {
    const failed = checks.filter(c => !c.ok && c.level === 'fail').map(c => c.name);
    const warnings = checks.filter(c => !c.ok && c.level === 'warn').map(c => c.name);
    return { ok: failed.length === 0, checks, failed, warnings };
  };
  if (!fs.existsSync(file)) { add('file', false, `not found: ${file}`); return done(); }

  const plan = ctx.plan || null;
  const tl = plan ? timeline(plan) : null;

  /* ---- 1. container and stream properties ---- */
  const pr = await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', '-count_packets', file]);
  let probe = null;
  try { probe = JSON.parse(pr.out); } catch { /* handled below */ }
  if (!probe) { add('probe', false, 'ffprobe could not read the file'); return done(); }
  const v = (probe.streams || []).find(s => s.codec_type === 'video');
  const a = (probe.streams || []).find(s => s.codec_type === 'audio');
  const dur = Number(probe.format.duration);
  if (!v) { add('video-stream', false, 'no video stream'); return done(); }

  const fpsOf = s => { const [n, d] = String(s || '0/1').split('/').map(Number); return d ? n / d : 0; };
  const fps = fpsOf(v.avg_frame_rate);
  add('codec', v.codec_name === 'h264' && v.pix_fmt === 'yuv420p' && (v.field_order || 'progressive') === 'progressive',
    `${v.codec_name} ${v.profile} L${v.level}, ${v.pix_fmt}, ${v.field_order || 'progressive'}, ${fps.toFixed(2)} fps`);
  if (ctx.gallery) {
    add('h264-level', v.profile === 'High' && Number(v.level) <= 40, `profile ${v.profile}, level ${v.level} (want High, ≤ 40 — plays on older TVs)`);
    const tags = [v.color_range, v.color_space, v.color_transfer, v.color_primaries];
    add('colour-bt709', tags[0] === 'tv' && tags.slice(1).every(t => t === 'bt709'), `range ${tags[0]}, matrix ${tags[1]}, transfer ${tags[2]}, primaries ${tags[3]}`);
  }
  const packets = Number(v.nb_read_packets);
  const wantFrames = Math.round(dur * fps);
  add('frame-count', Number.isFinite(packets) && Math.abs(packets - wantFrames) <= 2, `${packets} frames for ${dur.toFixed(2)} s at ${fps.toFixed(0)} fps (expected ${wantFrames})`);

  /* ---- 2. plays from the first byte ---- */
  const tr = await run('ffprobe', ['-v', 'trace', '-i', file]);
  const atoms = [...tr.err.matchAll(/type:'(moov|mdat)'/g)].map(m => m[1]);
  add('faststart', atoms.length >= 2 && atoms.indexOf('moov') < atoms.indexOf('mdat'), atoms.length ? `atom order: ${atoms.slice(0, 2).join(' → ')}` : 'could not read atom order');

  /* ---- 3. keyframe spacing (seeking and slow players) ---- */
  const kf = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-skip_frame', 'nokey', '-show_entries', 'frame=pts_time', '-of', 'csv=p=0', file]);
  const kts = kf.out.split('\n').map(s => Number(s.split(',')[0])).filter(Number.isFinite);
  let maxGap = 0;
  for (let i = 1; i < kts.length; i++) maxGap = Math.max(maxGap, kts[i] - kts[i - 1]);
  if (ctx.gallery) add('keyframes', kts.length > 1 && maxGap <= QC.keyframeMaxSec, `${kts.length} keyframes, widest gap ${maxGap.toFixed(2)} s (max ${QC.keyframeMaxSec})`);

  /* ---- 4. one decode of the whole picture: black, freeze, hard cuts ---- */
  const sceneLog = path.join(path.dirname(file), `.qc-scene-${process.pid}.txt`);
  /* One chain, one output. The select keeps frame 0 unconditionally: a film with no hard cut
   * would otherwise hand the encoder zero frames, and ffmpeg reports that as a failure. */
  const vf = `blackdetect=d=${QC.blackMinSec}:pic_th=0.98:pix_th=0.10,freezedetect=n=${QC.freezeNoise}:d=${QC.freezeMinSec},`
    + `select='eq(n,0)+gt(scene,${QC.sceneCut})',metadata=print:key=lavfi.scene_score:file=${sceneLog}`;
  const pass = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-an', '-vf', vf, '-f', 'null', '-']);
  if (pass.code !== 0) {
    add('picture-scan', false, `analysis pass failed: ${pass.err.split('\n').filter(Boolean).slice(-2).join(' | ')}`);
  } else {
    const blacks = [...pass.err.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map(m => ({ from: Number(m[1]), to: Number(m[2]) }));
    const allowed = tl ? tl.black : [];
    const stray = blacks.filter(b => !inWindows(b.from, b.to, allowed, QC.blackSlack));
    add('no-stray-black', stray.length === 0, stray.length
      ? `black where none was designed: ${stray.map(b => `${b.from.toFixed(2)}–${b.to.toFixed(2)} s`).join(', ')}`
      : `${blacks.length} black interval(s), all inside designed fades`);
    if (tl) {
      const dips = tl.black.filter(w => w.into > 0 && w.into < plan.items.length);
      const missing = dips.filter(w => !blacks.some(b => b.from < w.to && b.to > w.from));
      add('act-breaks-dip', missing.length === 0, dips.length
        ? (missing.length ? `${missing.length} of ${dips.length} act break(s) never reached black` : `${dips.length} act break(s) reach black`)
        : 'no act breaks in this film');
    }

    const fz = [];
    const starts = [...pass.err.matchAll(/freeze_start: ([\d.]+)/g)].map(m => Number(m[1]));
    const ends = [...pass.err.matchAll(/freeze_end: ([\d.]+)/g)].map(m => Number(m[1]));
    starts.forEach((s, i) => fz.push({ from: s, to: ends[i] ?? dur }));
    /* Legitimately still: black holds, and scenes the order asked to be still. */
    const stillWins = [...(tl ? tl.black : [])];
    if (tl) plan.items.forEach((it, i) => {
      const m = it.motion;
      const isStill = (m && typeof m === 'object') ? (m.kind === 'still' || !m.amp) : m === 'still';
      if (isStill) stillWins.push({ from: tl.starts[i], to: tl.starts[i] + it.hold });
    });
    const badFz = fz.filter(f => !inWindows(f.from, f.to, stillWins, QC.freezeSlack));
    add('no-frozen-picture', badFz.length === 0, badFz.length
      ? `picture frozen at ${badFz.map(f => `${f.from.toFixed(1)}–${f.to.toFixed(1)} s`).join(', ')}`
      : `no freeze longer than ${QC.freezeMinSec} s outside designed stills`);

    let cuts = [];
    try {
      const txt = fs.readFileSync(sceneLog, 'utf8');
      const times = [...txt.matchAll(/pts_time:([\d.]+)/g)].map(m => Number(m[1]));
      const scores = [...txt.matchAll(/scene_score=([\d.]+)/g)].map(m => Number(m[1]));
      cuts = times.map((t, i) => ({ t, score: scores[i] })).filter(c => c.score > QC.sceneCut);
    } catch { /* no file = no hits */ }
    add('no-hard-cuts', cuts.length === 0, cuts.length
      ? `abrupt change at ${cuts.slice(0, 6).map(c => `${c.t.toFixed(2)} s (${c.score})`).join(', ')}`
      : `no frame-to-frame change above ${QC.sceneCut}`);
  }
  try { fs.unlinkSync(sceneLog); } catch { /* nothing to remove */ }

  /* ---- 5. sound ---- */
  if (ctx.expectAudio) {
    if (!a) add('audio-stream', false, 'no audio stream');
    else {
      add('audio-format', a.codec_name === 'aac' && Number(a.sample_rate) === 48000 && Number(a.channels) === 2, `${a.codec_name} ${a.sample_rate} Hz ${a.channels} ch`);
      const drift = Math.abs(Number(a.duration) - Number(v.duration));
      add('av-length', Number.isFinite(drift) && drift <= QC.avDriftMax, `audio ${Number(a.duration).toFixed(2)} s vs video ${Number(v.duration).toFixed(2)} s`);
      const au = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-vn', '-af',
        `ebur128=peak=true:framelog=quiet,silencedetect=n=${QC.silenceNoise}:d=${QC.silenceMinSec}`, '-f', 'null', '-']);
      const sum = au.err.slice(au.err.lastIndexOf('Summary:'));
      const num = re => { const m = sum.match(re); return m ? Number(m[1]) : null; };
      const I = num(/I:\s+(-?[\d.]+) LUFS/), TP = num(/Peak:\s+(-?[\d.]+) dBFS/), LRA = num(/LRA:\s+(-?[\d.]+) LU/);
      const target = ctx.targetLufs ?? TARGET_LUFS;
      if (I == null) add('loudness', false, 'loudness could not be measured');
      else {
        add('loudness', Math.abs(I - target) <= QC.lufsTol, `${I} LUFS integrated (target ${target} ± ${QC.lufsTol}), range ${LRA} LU`);
        add('true-peak', TP != null && TP <= QC.truePeakMax, `${TP} dBTP (ceiling ${QC.truePeakMax})`);
      }
      const sil = [...au.err.matchAll(/silence_start: ([\d.]+)/g)].map(m => Number(m[1])).filter(t => t < dur - 1.5);
      add('no-dropout', sil.length === 0, sil.length ? `silence longer than ${QC.silenceMinSec} s begins at ${sil.map(t => t.toFixed(1) + ' s').join(', ')}` : 'no gap in the music', 'warn');
    }
  }

  /* ---- 6. the plan's own audit, and what a human still has to look at ---- */
  const rep = ctx.report || null;
  if (rep) {
    const bad = (rep.audit || []).filter(x => !x.ok);
    add('face-and-text-audit', bad.length === 0, bad.length
      ? bad.map(x => `item ${x.item + 1} ${x.check}: ${x.detail}`).join('; ')
      : `${(rep.audit || []).length} placement checks passed (faces inside every crop and zoom; all text title-safe)`);
    const edge = (rep.audit || []).filter(x => x.warn);
    if (edge.length) add('faces-near-edge', false, edge.map(x => `item ${x.item + 1}: ${x.detail}`).join('; '), 'warn');

    const unknown = rep.photos.filter(p => p.faceSource === 'unknown').length;
    const detected = rep.photos.filter(p => p.faceSource === 'detector').length;
    const cropsOnDetector = rep.items.filter(it => it.kind === 'scene' && it.crop > 0).length;
    add('faces-reviewed', rep.facesReviewed || (detected === 0 && unknown === 0),
      rep.facesReviewed ? 'order states the face sheet was reviewed'
        : `not reviewed by a person: ${detected} photo(s) rely on the detector (${cropsOnDetector} cropped), ${unknown} had no face found and were left uncropped. `
          + 'The detector misses profiles and faces at the photo edge — run `cli.mjs faces`, look at the sheet, then set "facesReviewed": true',
      'warn');

    for (const t of (rep.music || [])) {
      if (t.tier === 'operator' && !t.licence) add('music-licence', false, `"${t.track}" has no licence recorded in the order — a film cannot be sold on unlicensed music`);
      else if (t.tier === 'us-gov') add('music-licence-scope', false, `"${t.track}" is a U.S. government recording: public domain in the United States, not a worldwide waiver`, 'warn');
      else add('music-licence', true, `"${t.track}": ${t.licence}${t.attribution ? ` — credit: ${t.attribution}` : ''}`);
    }
    if (rep.musicFit && !rep.musicFit.applied) add('music-fit', false, rep.musicFit.reason, 'warn');
    if (rep.render && rep.render.musicLoops) add('music-repeats', false, 'the music is shorter than the film and repeats — consider a second track', 'warn');
  }
  return done();
}

export function formatQc(result) {
  return result.checks.map(c => `  ${c.ok ? 'PASS' : (c.level === 'warn' ? 'WARN' : 'FAIL')}  ${c.name.padEnd(20)} ${c.detail || ''}`).join('\n');
}

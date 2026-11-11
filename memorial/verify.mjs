/* memorial/verify.mjs — prove the film is real before anyone calls it finished.
 *
 * WHY THIS EXISTS
 * ---------------
 * This station has shipped a fake. `proj-1792964044657-xs9vyt/video.mp4` was a 32,770-byte
 * placeholder recorded as a finished deliverable, and an earlier 1,056-byte file was described in
 * the project notes as a "Real video … No further work needed". The tests were green the whole
 * time. sidecar/video-verify.js was written in response and it is good — it is reused here rather
 * than re-implemented.
 *
 * But video-verify.js answers "is this a real video file", not "is this the film we were asked
 * for". A 5-second clip of the wrong aspect ratio with no audio passes it. So this adds the
 * order-level checks: the duration we promised, the resolution we promised, audio actually
 * present and not silent, and every segment accounted for.
 *
 * FAILS CLOSED. An unverifiable film is not deliverable. Nothing here guesses.
 */
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ffprobeJson } from './render.mjs';

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* How far the finished film may drift from the planned duration before we call it wrong.
 * Crossfade arithmetic and frame rounding make an exact match impossible. */
export const DURATION_TOLERANCE_SEC = 1.0;
/* Mean volume above this is treated as "there is no real audio here". -70 dB is digital silence. */
export const SILENCE_MEAN_DB = -70;

async function meanVolumeDb(file) {
  const { spawn } = await import('node:child_process');
  return new Promise(resolve => {
    const p = spawn('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'volumedetect', '-f', 'null', '-'],
      { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', d => { err += d; });
    p.on('error', () => resolve(null));
    p.on('close', () => {
      const m = err.match(/mean_volume:\s*(-?[\d.]+) dB/);
      resolve(m ? Number(m[1]) : null);
    });
  });
}

/**
 * verifyFilm — mechanical verification of a finished memorial film.
 * @returns {{ok:boolean, checks:Array<{name,ok,detail}>, failed:string[]}}
 */
export async function verifyFilm(filePath, expect = {}) {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok: !!ok, detail });

  /* 1. The station's own gate first. Fail-closed, catches placeholders and truncation. */
  let base = null;
  try {
    const vv = require(path.join(REPO, 'sidecar', 'video-verify.js'));
    base = await vv.verifyVideoFile(filePath);
  } catch (e) {
    add('video-verify', false, `could not run sidecar/video-verify.js: ${e.message}`);
  }
  if (base) {
    add('video-verify', base.ok, base.ok
      ? `${base.bytes} bytes, ${base.durationSec.toFixed(2)}s, ${base.bitrate} bps, ${base.frames} frames`
      : base.reason);
  }

  if (!fs.existsSync(filePath)) {
    return { ok: false, checks, failed: checks.filter(c => !c.ok).map(c => c.name) };
  }

  const probe = await ffprobeJson(filePath);
  const v = probe && (probe.streams || []).find(s => s.codec_type === 'video');
  const a = probe && (probe.streams || []).find(s => s.codec_type === 'audio');
  const dur = probe && probe.format ? Number(probe.format.duration) : NaN;

  /* 2. The film we were actually asked for. */
  if (expect.width && expect.height) {
    const ok = v && Number(v.width) === expect.width && Number(v.height) === expect.height;
    add('resolution', ok, v ? `${v.width}x${v.height} (expected ${expect.width}x${expect.height})` : 'no video stream');
  }
  if (Number.isFinite(expect.durationSec)) {
    const drift = Math.abs(dur - expect.durationSec);
    add('duration', drift <= DURATION_TOLERANCE_SEC,
      `${Number.isFinite(dur) ? dur.toFixed(2) : '?'}s vs planned ${expect.durationSec.toFixed(2)}s (drift ${drift.toFixed(2)}s, tol ${DURATION_TOLERANCE_SEC}s)`);
  }

  /* 3. Audio. A memorial film delivered silent by accident is a defect the customer finds
   *    at the service, which is the worst possible moment. Checked unless silence was chosen. */
  if (expect.expectAudio) {
    if (!a) {
      add('audio-stream', false, 'no audio stream');
    } else {
      add('audio-stream', true, `${a.codec_name} ${a.channels}ch`);
      const db = await meanVolumeDb(filePath);
      add('audio-not-silent', db != null && db > SILENCE_MEAN_DB,
        db == null ? 'volumedetect unavailable' : `mean ${db} dB (floor ${SILENCE_MEAN_DB})`);
    }
  }

  /* 4. Every planned segment produced a file. Catches a partial resume. */
  if (expect.workDir && Number.isFinite(expect.segments)) {
    let found = 0;
    for (let i = 0; i < expect.segments; i++) {
      if (fs.existsSync(path.join(expect.workDir, `seg-${String(i).padStart(3, '0')}.mp4`))) found++;
    }
    add('segments', found === expect.segments, `${found}/${expect.segments} segment files present`);
  }

  const failed = checks.filter(c => !c.ok).map(c => c.name);
  return { ok: failed.length === 0, checks, failed };
}

export function formatChecks(result) {
  return result.checks.map(c => `  ${c.ok ? 'PASS' : 'FAIL'}  ${c.name.padEnd(18)} ${c.detail || ''}`).join('\n');
}

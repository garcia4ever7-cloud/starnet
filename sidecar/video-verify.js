/* sidecar/video-verify.js — the single gate deciding whether a file on disk is a real
   video or a placeholder. Every path that could mark a video deliverable KEPT must call
   verifyVideoFile() rather than re-deriving its own check, so the gate cannot be closed
   in one call site and left open in another.

   Background: a 32KB solid-colour ffmpeg clip was handed over as a finished 1080p film.
   It is a structurally valid 10s/242-frame MP4, so size-and-frames tests pass it. Only
   bitrate separates it from real content (23 kbps vs the thousands real 1080p needs).

   Failing closed is deliberate: if ffprobe is missing or unreadable we return not-ok.
   An unprovable video must never be presented as a proven one. */

'use strict';

const fs = require('node:fs');
const { guardChildProcess } = require('./child-env.js');
const { execFileSync } = guardChildProcess(require('node:child_process'));

const MIN_BYTES = 100 * 1024;
const MIN_BITRATE = 150000;
const MIN_DURATION_SEC = 1.0;
const MIN_FRAMES = 2;
const FFPROBE_TIMEOUT_MS = 15000;

function result(ok, reason, extra) {
  return Object.assign({ ok, reason, bytes: 0, durationSec: 0, width: 0, height: 0, bitrate: 0, frames: 0 }, extra || {});
}

function probe(absPath) {
  const out = execFileSync('ffprobe', [
    '-v', 'error', '-show_format', '-show_streams', '-of', 'json', absPath,
  ], { encoding: 'utf8', timeout: FFPROBE_TIMEOUT_MS });
  return JSON.parse(out);
}

/* Bitrate is the load-bearing signal, and the stream/container values disagree on some
   muxes, so take whichever is present and trust the larger — being generous here means a
   rejection is a real rejection, not a muxing artefact. */
function bitrateOf(format, stream) {
  const a = Number(format.bit_rate) || 0;
  const b = Number(stream.bit_rate) || 0;
  return Math.max(a, b);
}

function framesOf(stream, durationSec) {
  const counted = Number(stream.nb_frames) || 0;
  if (counted > 0) return counted;
  // nb_frames is absent in some containers; derive it from fps so a real video is not
  // rejected for a missing tag.
  const [num, den] = String(stream.r_frame_rate || '0/1').split('/');
  const fps = (Number(num) || 0) / (Number(den) || 1);
  return Math.round(fps * durationSec);
}

function verifyVideoFile(absPath) {
  let stat;
  try {
    stat = fs.statSync(absPath);
  } catch (_) {
    return result(false, 'file-missing');
  }
  if (!stat.isFile()) return result(false, 'not-a-regular-file');

  const bytes = stat.size;
  if (bytes === 0) return result(false, 'file-empty', { bytes });

  let header;
  try {
    header = Buffer.alloc(12);
    const fd = fs.openSync(absPath, 'r');
    try { fs.readSync(fd, header, 0, 12, 0); } finally { fs.closeSync(fd); }
  } catch (_) {
    return result(false, 'file-unreadable', { bytes });
  }
  if (header.toString('ascii', 4, 8) !== 'ftyp') return result(false, 'not-an-mp4', { bytes });

  if (bytes < MIN_BYTES) {
    return result(false, `too-small: ${bytes} bytes is under the ${MIN_BYTES}-byte floor`, { bytes });
  }

  let data;
  try {
    data = probe(absPath);
  } catch (e) {
    const missing = e && (e.code === 'ENOENT' || /ENOENT/.test(String(e.message)));
    return result(false, missing ? 'ffprobe-unavailable' : 'ffprobe-failed: ' + (e && e.message), { bytes });
  }

  const format = data.format || {};
  const stream = (data.streams || []).find(s => s.codec_type === 'video');
  if (!stream) return result(false, 'no-video-stream', { bytes });

  const durationSec = Number(format.duration) || Number(stream.duration) || 0;
  const width = Number(stream.width) || 0;
  const height = Number(stream.height) || 0;
  const bitrate = bitrateOf(format, stream);
  const frames = framesOf(stream, durationSec);
  const found = { bytes, durationSec, width, height, bitrate, frames };

  if (frames < MIN_FRAMES) return result(false, `no-real-frames: ${frames}`, found);
  if (durationSec < MIN_DURATION_SEC) return result(false, `too-short: ${durationSec.toFixed(2)}s`, found);
  if (bitrate < MIN_BITRATE) {
    return result(false, `placeholder-bitrate: ${bitrate} bps is under ${MIN_BITRATE} bps — looks like flat colour, not real footage`, found);
  }

  return result(true, '', found);
}

module.exports = { verifyVideoFile, MIN_BYTES, MIN_BITRATE, MIN_DURATION_SEC, MIN_FRAMES };

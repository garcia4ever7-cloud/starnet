/* memorial/audio.mjs — the music: chosen from a licensed library, fitted to the film, mastered.
 *
 * WHY THIS EXISTS
 * ---------------
 * The first engine handed one audio file to the station's general-purpose muxer, which pads a
 * short bed with silence, cuts a long one dead at the last frame, and normalises in a single
 * pass to -14 LUFS. For a memorial that means music that stops mid-phrase or runs out early.
 * This module:
 *   - resolves music from the licensed library (assets/music/manifest.json) or a file the
 *     operator supplies, and carries the licence with it into the render report
 *   - builds a bed EXACTLY as long as the film: tracks follow one another with a crossfade and
 *     repeat if needed; the last four seconds fade out and finish half a second before the
 *     picture does
 *   - masters with two-pass loudnorm to -16 LUFS / -1.5 dBTP. There is no delivery standard for
 *     a family video; -23 (broadcast) is too quiet on a phone or laptop and -14 (YouTube) leaves
 *     little headroom for dynamic piano. The measured result is reported, not the intent.
 *
 * Narration still goes through sidecar/audio-finish.js muxFinal, which ducks the bed under the
 * voice; that path is unchanged.
 */
'use strict';

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const MUSIC_DIR = path.join(HERE, 'assets', 'music');

export const TARGET_LUFS = -16;
export const TARGET_TP = -1.5;
export const TARGET_LRA = 11;
export const CROSSFADE = 3.0;       // between consecutive tracks
export const FADE_IN = 0.6;
export const FADE_OUT = 4.0;
export const TAIL_SILENCE = 0.5;    // the music is down before the picture is
/* A film may outlast its music by this much without the music starting again: the closing
 * card simply finishes in quiet. Without it, a film FITTED to its song came out a fraction of a
 * second longer than the song, and the track restarted under a crossfade in the last three
 * seconds (seen on the 30-photo test film, 2026-11-24). */
export const SHORTFALL_OK = 1.0;
export const NATURAL_FADE = 1.2;    // when the piece ends by itself, only tidy its last moment

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

export function library() {
  const mf = path.join(MUSIC_DIR, 'manifest.json');
  if (!fs.existsSync(mf)) return { default: null, tracks: [] };
  const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
  return { default: m.default || null, tracks: m.tracks || [], note: m.note || '' };
}

async function durationOf(file) {
  const r = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  const d = Number(r.out.trim());
  return Number.isFinite(d) && d > 0 ? d : null;
}

/**
 * resolveMusic — the order's music as a list of playable files with their licences.
 *   "music": { "track": "goldberg-aria" }                 one library track
 *   "music": { "tracks": ["goldberg-aria", "air-on-g"] }  several, in order
 *   "music": { "file": "song.m4a", "licence": "..." }     the operator's own file
 *   "music": "none" / absent                              silent film
 * A library track whose audio file is missing is an error, never a silent fallback.
 */
export async function resolveMusic(order, baseDir) {
  const m = order.music;
  if (!m || m === 'none') return [];
  const lib = library();
  const out = [];
  const fromLib = async (slug) => {
    const t = lib.tracks.find(x => x.slug === slug);
    if (!t) throw new Error(`music: no library track '${slug}' (have: ${lib.tracks.map(x => x.slug).join(', ') || 'none'})`);
    const file = path.join(MUSIC_DIR, t.file);
    if (!fs.existsSync(file)) throw new Error(`music: library track '${slug}' is listed but ${t.file} is missing from memorial/assets/music/`);
    out.push({ file, slug, title: t.title, composer: t.composer, performer: t.performer, licence: t.licence, tier: t.tier, attribution: t.attribution, durationSec: await durationOf(file) });
  };
  if (typeof m === 'string') { await fromLib(m); return out; }
  if (m.file) {
    const file = path.isAbsolute(m.file) ? m.file : path.join(baseDir, m.file);
    if (!fs.existsSync(file)) throw new Error(`music file not found: ${file}`);
    out.push({ file, slug: null, title: m.title || path.basename(file), licence: m.licence || null, tier: 'operator', attribution: m.attribution || null, durationSec: await durationOf(file) });
  }
  if (m.track) await fromLib(m.track);
  for (const s of (Array.isArray(m.tracks) ? m.tracks : [])) await fromLib(s);
  for (const t of out) if (!t.durationSec) throw new Error(`music: cannot read duration of ${t.file}`);
  return out;
}

/** The sequence of tracks (repeating the list) needed to cover `need` seconds with crossfades. */
export function sequenceFor(tracks, need, xf = CROSSFADE) {
  const seq = [];
  let have = 0;
  for (let i = 0; have < need && i < 64; i++) {
    const t = tracks[i % tracks.length];
    have += t.durationSec - (seq.length ? xf : 0);
    seq.push(t);
  }
  return { seq, covered: have };
}

/** The bed's filter graph up to (not including) loudness: inputs [0:a]..[n-1:a] → [bed]. */
export function bedGraph(n, durSec, opts = {}) {
  const xf = opts.crossfade ?? CROSSFADE;
  const fin = 'aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo';
  const parts = [];
  for (let i = 0; i < n; i++) parts.push(`[${i}:a]${fin}[a${i}]`);
  let prev = 'a0';
  for (let i = 1; i < n; i++) { parts.push(`[${prev}][a${i}]acrossfade=d=${xf}:c1=tri:c2=tri[c${i}]`); prev = `c${i}`; }
  const fo = Math.min(opts.fadeOut ?? FADE_OUT, Math.max(0.2, durSec * 0.25));
  const tail = Math.min(opts.tailSilence ?? TAIL_SILENCE, durSec * 0.05);
  const end = durSec - tail;
  parts.push(`[${prev}]atrim=0:${end.toFixed(3)},afade=t=in:st=0:d=${Math.min(FADE_IN, durSec * 0.1).toFixed(2)},afade=t=out:st=${(end - fo).toFixed(3)}:d=${fo.toFixed(2)},apad=whole_dur=${durSec.toFixed(3)}[bed]`);
  return parts.join(';');
}

function parseLoudnormJson(stderr) {
  const i = stderr.lastIndexOf('{');
  const j = stderr.lastIndexOf('}');
  if (i < 0 || j < i) return null;
  try { return JSON.parse(stderr.slice(i, j + 1)); } catch { return null; }
}

/** Measure a file's programme loudness with ebur128: {lufs, truePeak, lra}. */
export async function measureLoudness(file) {
  const r = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-vn', '-af', 'ebur128=peak=true:framelog=quiet', '-f', 'null', '-']);
  const sum = r.err.slice(r.err.lastIndexOf('Summary:'));
  const num = re => { const m = sum.match(re); return m ? Number(m[1]) : null; };
  return { lufs: num(/I:\s+(-?[\d.]+) LUFS/), lra: num(/LRA:\s+(-?[\d.]+) LU/), truePeak: num(/Peak:\s+(-?[\d.]+) dBFS/) };
}

/**
 * masterBed — write an AAC bed of exactly `durSec`, loudness-normalised in two passes.
 * @returns {{file, tracks:[…], loops:boolean, measured:{lufs,truePeak,lra}}}
 */
export async function masterBed(tracks, durSec, outFile, opts = {}) {
  if (!tracks.length) throw new Error('masterBed: no tracks');
  const { seq, covered } = sequenceFor(tracks, durSec - SHORTFALL_OK);
  const inputs = [];
  for (const t of seq) inputs.push('-i', t.file);
  /* If the music ends about when the film does, it is ending on its own final bar: do not lay a
   * four-second fade over the composer's ending. */
  const natural = covered <= durSec + 1.5;
  const graph = bedGraph(seq.length, durSec, { ...opts, fadeOut: opts.fadeOut ?? (natural ? NATURAL_FADE : FADE_OUT) });
  const target = `I=${opts.lufs ?? TARGET_LUFS}:TP=${opts.tp ?? TARGET_TP}:LRA=${TARGET_LRA}`;

  const p1 = await run('ffmpeg', ['-hide_banner', '-nostats', '-y', ...inputs,
    '-filter_complex', `${graph};[bed]loudnorm=${target}:print_format=json[o]`, '-map', '[o]', '-f', 'null', '-']);
  const m = p1.code === 0 ? parseLoudnormJson(p1.err) : null;
  if (!m) throw new Error(`music mastering failed (measure pass): ${p1.err.split('\n').filter(Boolean).slice(-3).join(' | ')}`);

  const measured = `measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
  const tmp = outFile + '.tmp.m4a';
  const p2 = await run('ffmpeg', ['-hide_banner', '-nostats', '-y', ...inputs,
    '-filter_complex', `${graph};[bed]loudnorm=${target}:${measured},aresample=48000[o]`, '-map', '[o]',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-t', durSec.toFixed(3), tmp]);
  if (p2.code !== 0 || !fs.existsSync(tmp)) throw new Error(`music mastering failed: ${p2.err.split('\n').filter(Boolean).slice(-3).join(' | ')}`);
  await fsp.rename(tmp, outFile);
  return { file: outFile, tracks: seq.map(t => t.slug || t.title), loops: seq.length > tracks.length, naturalEnd: natural, measured: await measureLoudness(outFile) };
}

/** Put a mastered bed under a silent film without touching the picture. */
export async function muxBed(silentVideo, bed, outFile, durSec) {
  const tmp = outFile + '.tmp.mp4';
  const r = await run('ffmpeg', ['-hide_banner', '-nostats', '-y', '-i', silentVideo, '-i', bed,
    '-map', '0:v:0', '-map', '1:a:0', '-c', 'copy', '-t', durSec.toFixed(3), '-movflags', '+faststart', tmp]);
  if (r.code !== 0 || !fs.existsSync(tmp)) throw new Error(`audio mux failed: ${r.err.split('\n').filter(Boolean).slice(-3).join(' | ')}`);
  await fsp.rename(tmp, outFile);
  return outFile;
}

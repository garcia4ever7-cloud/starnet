/* sidecar/audio-finish.js — every video StarNet produces leaves here with sound.

   Runs automatically after a video is generated and verified. Four layers, each falling
   through to the next so a missing key degrades the result instead of stopping the pipeline:

     L1  native audio at generation   — flags set by the provider chain, not here
     L2  video-to-audio SFX + score   — fal mmaudio-v2, needs FAL_KEY
     L3  narration                    — edge-tts, free, no key
     L4  mix + master                 — ffmpeg: duck music under voice, -14 LUFS, AAC 192k

   DESIGN RULES, each load-bearing:

   - **Never destroy the input.** The original is preserved as video_silent.mp4 before any
     mux. If mastering fails, the caller still has exactly what it had.
   - **Never claim sound that is not there.** The result is re-probed AFTER muxing and the
     report carries the measured stream/loudness, not the intent. A silent "finished" video
     is reported as silent.
   - **Never burn text into the picture.** The owner's standing requirement — narration is
     audio only, no subtitles, no title cards.
   - **Degrade, never block.** Any layer may be unavailable; the run continues and the reason
     is named in the report so the owner can act on one line.

   All shell-outs go through child-env.js's guardChildProcess, like the other media tools. */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { guardChildProcess } = require('./child-env.js');
const cp = guardChildProcess(require('node:child_process'));

/* A video whose audio track is present but effectively inaudible is still a silent video to
   the owner. -50 dBFS mean is far below anything audible in a mix. */
const SILENCE_MEAN_DB = -50;
const TARGET_LUFS = -14;        // YouTube / Shorts integrated loudness
const TARGET_TRUE_PEAK = -1;    // dBTP
const AUDIO_BITRATE = '192k';
const AUDIO_RATE = 48000;

// Measured on-device 2026-10-26 by low-band energy; see STATION_FIELD_NOTES.md.
// Configurable because "cinematic" is a taste judgement a measurement cannot settle.
const DEFAULT_VOICE = 'en-US-ChristopherNeural';
const DEFAULT_RATE = '-5%';
const MAX_SPEEDUP_PCT = 10;     // never rush narration past this to force a fit
/* How far a single un-splittable sentence may exceed the time budget and still be narrated
   WHOLE. Scripture verses are typically a little over and must not be cut mid-phrase; a
   screenplay run-on is many multiples over and gets hard-capped instead. */
const OVERFLOW_TOLERANCE = 3;

const SFX_PROMPT_HINT =
  'cinematic sound design: sword clashes, demon roars, armor movement, footsteps on stone, '
  + 'wind, deep impacts, epic orchestral score';
const AUDIO_NEGATIVE =
  'distorted audio, muffled sound, clipping, random music lyrics, speech, voices, mumbling';

function run(bin, args, opts) {
  const r = cp.spawnSync(bin, args, Object.assign({ encoding: 'utf8', timeout: 180000 }, opts || {}));
  return { ok: r.status === 0, status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

/* Probe with BOTH flag styles. ffmpeg/ffprobe take `-version`; Python CLIs like edge-tts take
   `--version` and exit non-zero on the single-dash form — which made a perfectly working
   edge-tts report as "not installed" and silently disabled narration. */
function haveBinary(bin) {
  return run(bin, ['--version'], { timeout: 20000 }).ok
      || run(bin, ['-version'], { timeout: 20000 }).ok;
}

/* ---- probing ---------------------------------------------------------------- */

function durationOf(file) {
  const r = run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=nw=1:nk=1', file]);
  const d = parseFloat(String(r.stdout).trim());
  return Number.isFinite(d) ? d : 0;
}

/* meanVolumeDb is null when there is no audio stream at all — distinct from a stream that
   measures silent, because the fixes differ (add a track vs replace a dead one). */
function probeAudio(file) {
  if (!fs.existsSync(file)) return { ok: false, reason: 'file-missing' };
  const streams = run('ffprobe', ['-v', 'error', '-select_streams', 'a',
    '-show_entries', 'stream=index,codec_name', '-of', 'csv=p=0', file]);
  const hasStream = String(streams.stdout).trim().length > 0;
  const durationSec = durationOf(file);

  let meanVolumeDb = null;
  if (hasStream) {
    const vd = run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'volumedetect', '-f', 'null', '-']);
    const m = /mean_volume:\s*(-?[\d.]+) dB/.exec(vd.stderr);
    if (m) meanVolumeDb = parseFloat(m[1]);
  }

  const silent = !hasStream || (meanVolumeDb !== null && meanVolumeDb < SILENCE_MEAN_DB);
  return { ok: true, hasStream, meanVolumeDb, durationSec, silent };
}

/* ---- L3: narration ---------------------------------------------------------- */

/* Trim a script to what can be spoken in the available time WITHOUT rushing the delivery.
   Scripture must never be paraphrased, so this cuts at sentence boundaries only — a partial
   verse is worse than a shorter narration. */
/* Agents write screenplays in MARKDOWN, and a narrator handed raw markdown reads the syntax
   out loud — "hash ARMOR OF LIGHT hash hash hash, asterisk asterisk Genre…". Strip the page
   furniture so only speakable prose survives: headings, emphasis markers, rules, slug lines
   (EXT./INT.), transitions (FADE IN:, CUT TO:), parentheticals, and `**Key:** value`
   production metadata. */
function spokenTextFrom(script) {
  return String(script || '')
    .replace(/```[\s\S]*?```/g, ' ')                     // code fences
    .replace(/^\s*#{1,6}\s*/gm, ' ')                     // ATX headings
    .replace(/^\s*[-*_]{3,}\s*$/gm, ' ')                 // horizontal rules
    .replace(/^\s*\*\*[^*]+:\*\*.*$/gm, ' ')             // **Genre:** Anime Action …
    .replace(/^\s*[A-Z][A-Za-z ]{0,20}:\s*$/gm, ' ')     // bare "ACT ONE:" style labels
    .replace(/^\s*(?:INT\.|EXT\.|FADE IN|FADE OUT|CUT TO|DISSOLVE TO|SMASH CUT)[^\n]*$/gmi, ' ')
    .replace(/\([^)]{0,80}\)/g, ' ')                     // parentheticals / stage directions
    .replace(/[*_`>#|]+/g, ' ')                          // leftover markdown punctuation
    .replace(/\s+/g, ' ')
    .trim();
}

function fitScriptToDuration(script, durationSec, wordsPerSec) {
  const wps = wordsPerSec || 2.3;                 // ~140 wpm at -5% rate
  const budget = Math.max(1, Math.floor(durationSec * wps));
  const clean = spokenTextFrom(script);
  const words = clean.split(' ').filter(Boolean);
  if (words.length <= budget) return { text: clean, truncated: false, words: words.length, budget };

  // Keep whole sentences up to the budget.
  const sentences = clean.split(/(?<=[.!?])\s+/);
  const kept = [];
  let count = 0;
  for (const s of sentences) {
    const n = s.split(' ').filter(Boolean).length;
    if (count + n > budget) break;
    kept.push(s); count += n;
  }
  if (!kept.length) {
    /* No whole sentence fits. Two bad options, and which is worse depends on how far over:
       - cutting mid-sentence mangles a scripture verse, which must never be paraphrased;
       - keeping a 2,000-word run-on narrates minutes past the end of a 5s video.
       So: keep the first sentence WHOLE when it is only modestly over (verses land here),
       and fall back to a hard word cap only for a genuine run-on. */
    const first = sentences[0] || clean;
    const firstWords = first.split(' ').filter(Boolean).length;
    if (firstWords <= budget * OVERFLOW_TOLERANCE) {
      kept.push(first); count = firstWords;
    } else {
      kept.push(words.slice(0, budget).join(' ')); count = budget;
    }
  }
  return { text: kept.join(' '), truncated: true, words: words.length, budget, spokenWords: count };
}

async function synthNarration(text, outPath, opts) {
  const o = opts || {};
  if (!haveBinary('edge-tts')) {
    return { ok: false, reason: 'edge-tts not installed — run: pip install edge-tts' };
  }
  const r = run('edge-tts', [
    '--voice', o.voice || DEFAULT_VOICE,
    '--rate=' + (o.rate || DEFAULT_RATE),
    '--text', text,
    '--write-media', outPath,
  ], { timeout: 180000 });
  if (!r.ok || !fs.existsSync(outPath) || fs.statSync(outPath).size === 0) {
    return { ok: false, reason: 'edge-tts failed: ' + String(r.stderr || '').slice(0, 200) };
  }
  return { ok: true, path: outPath, bytes: fs.statSync(outPath).size, durationSec: durationOf(outPath), voice: o.voice || DEFAULT_VOICE };
}

/* ---- L2: fal video-to-audio ------------------------------------------------- */

const FAL_MODELS = ['fal-ai/mmaudio-v2', 'fal-ai/kling-video/video-to-audio'];
const FAL_USD_PER_SEC = 0.001;   // mmaudio-v2 list price; recorded so spend stays honest

function falKey(env) {
  return String(((env || process.env).FAL_KEY) || '').trim();
}

/* Returns { ok, path, usd } or { ok:false, skipped, reason }. One retry then fall through —
   a second failure means the next layer should run, not that the pipeline stops. */
async function falVideoToAudio(videoUrlOrPath, outPath, opts) {
  const o = opts || {};
  const key = falKey(o.env);
  if (!key) {
    return { ok: false, skipped: true, reason: 'no FAL_KEY — add FAL_KEY to ~/.config/starnet/env to enable synced SFX' };
  }
  const fetchImpl = o.fetch || globalThis.fetch;
  const durationSec = o.durationSec || 0;

  for (const model of FAL_MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetchImpl('https://fal.run/' + model, {
          method: 'POST',
          headers: { Authorization: 'Key ' + key, 'Content-Type': 'application/json' },
          body: JSON.stringify({ video_url: videoUrlOrPath, prompt: o.prompt || SFX_PROMPT_HINT, negative_prompt: AUDIO_NEGATIVE }),
        });
        if (!res.ok) continue;
        const body = await res.json();
        const url = (body && (body.audio && body.audio.url)) || (body && body.video && body.video.url) || (body && body.url);
        if (!url) continue;
        const dl = await fetchImpl(url, { method: 'GET' });
        if (!dl.ok) continue;
        fs.writeFileSync(outPath, Buffer.from(await dl.arrayBuffer()));
        return { ok: true, path: outPath, model, usd: Number((durationSec * FAL_USD_PER_SEC).toFixed(4)) };
      } catch (_) { /* retry once, then next model */ }
    }
  }
  return { ok: false, reason: 'all fal video-to-audio models failed' };
}


/* ---- L4: mix + master ------------------------------------------------------- */

/* Build the ffmpeg filter graph.
   - narration sits ON TOP; bed (SFX/score) is ducked under it with sidechaincompress so the
     words stay intelligible without the bed dropping out entirely.
   - loudnorm last, so normalisation measures the FINAL mix rather than one element.
   - apad + the video's own duration govern length: audio is never allowed to dictate how
     long the picture runs. */
function buildFilter(hasBed, hasVoice, videoDurationSec) {
  const dur = Math.max(0.1, Number(videoDurationSec) || 0.1);
  const norm = 'loudnorm=I=' + TARGET_LUFS + ':TP=' + TARGET_TRUE_PEAK + ':LRA=11';
  const fin = 'aresample=' + AUDIO_RATE + ',aformat=sample_fmts=fltp:channel_layouts=stereo';

  if (hasBed && hasVoice) {
    return [
      '[1:a]' + fin + ',apad,atrim=0:' + dur + '[bed]',
      '[2:a]' + fin + ',apad,atrim=0:' + dur + '[voc]',
      '[voc]asplit=2[voc_mix][voc_key]',
      // duck the bed using the voice as the key
      '[bed][voc_key]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=400[ducked]',
      '[ducked][voc_mix]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mixed]',
      '[mixed]' + norm + '[aout]',
    ].join(';');
  }
  if (hasVoice) {
    return ['[1:a]' + fin + ',apad,atrim=0:' + dur + ',' + norm + '[aout]'].join(';');
  }
  return ['[1:a]' + fin + ',apad,atrim=0:' + dur + ',' + norm + '[aout]'].join(';');
}

/* muxFinal — write videoPath with the given audio. The ORIGINAL is preserved first.
   Writes to a temp file and only renames on success, so a failed master cannot leave a
   half-written video.mp4 where a good one used to be. */
function muxFinal(videoPath, bedPath, voicePath, opts) {
  const o = opts || {};
  const dir = path.dirname(videoPath);
  const silentCopy = o.silentCopy || path.join(dir, 'video_silent.mp4');

  if (!fs.existsSync(silentCopy)) {
    fs.copyFileSync(videoPath, silentCopy);
  }

  const dur = o.durationSec || durationOf(videoPath);
  const hasBed = !!(bedPath && fs.existsSync(bedPath));
  const hasVoice = !!(voicePath && fs.existsSync(voicePath));
  if (!hasBed && !hasVoice) return { ok: false, reason: 'nothing to mix — no bed and no narration' };

  // Input order must match buildFilter: 0=video, 1=first audio, 2=second audio.
  const args = ['-y', '-hide_banner', '-nostats', '-i', silentCopy];
  if (hasBed) args.push('-i', bedPath);
  if (hasVoice) args.push('-i', voicePath);

  const filter = (hasBed && hasVoice) ? buildFilter(true, true, dur)
    : buildFilter(false, true, dur);

  const tmp = videoPath + '.mastering-' + process.pid + '.mp4';
  args.push(
    '-filter_complex', filter,
    '-map', '0:v:0', '-map', '[aout]',
    '-c:v', 'copy',
    '-c:a', 'aac', '-b:a', AUDIO_BITRATE, '-ar', String(AUDIO_RATE), '-ac', '2',
    '-movflags', '+faststart',
    '-shortest',
    tmp,
  );

  const r = run('ffmpeg', args, { timeout: 300000 });
  if (!r.ok || !fs.existsSync(tmp) || fs.statSync(tmp).size === 0) {
    try { fs.unlinkSync(tmp); } catch (_) {}
    return { ok: false, reason: 'ffmpeg mux failed: ' + String(r.stderr || '').slice(-300) };
  }
  fs.renameSync(tmp, videoPath);
  return { ok: true, videoPath, silentCopy, filter };
}

/* audioFinish — the one entry point. Always returns a report; never throws into the caller.

   `script` is optional; when absent the video still gets a bed (L2) if one can be made.
   Everything is re-probed at the end so the report states MEASURED fact, not intent. */
async function audioFinish(opts) {
  const o = opts || {};
  const videoPath = o.videoPath;
  const report = { ok: false, layers: [], notes: [], usd: 0, videoPath };

  if (!videoPath || !fs.existsSync(videoPath)) {
    report.reason = 'video not found: ' + videoPath;
    return report;
  }
  if (!haveBinary('ffmpeg') || !haveBinary('ffprobe')) {
    report.reason = 'ffmpeg/ffprobe unavailable — run: pkg install -y ffmpeg';
    return report;
  }

  const before = probeAudio(videoPath);
  report.before = before;

  if (!before.silent && !o.force) {
    // L1 already delivered usable audio at generation. Nothing to add.
    report.ok = true;
    report.layers.push('L1 native audio present');
    report.after = before;
    return report;
  }
  report.layers.push('L1 produced no usable audio (' +
    (before.hasStream ? ('mean ' + before.meanVolumeDb + ' dB') : 'no audio stream') + ')');

  const dir = path.dirname(videoPath);
  const work = o.workDir || dir;
  const bedPath = path.join(work, '.audio-bed.mp3');
  const voicePath = path.join(work, '.audio-voice.mp3');

  // --- L2 ---
  let bed = null;
  const fal = await falVideoToAudio(o.videoUrl || videoPath, bedPath, {
    env: o.env, fetch: o.fetch, durationSec: before.durationSec, prompt: o.sfxPrompt,
  });
  if (fal.ok) {
    bed = bedPath;
    report.usd += fal.usd || 0;
    report.layers.push('L2 SFX + score via ' + fal.model + ' ($' + (fal.usd || 0) + ')');
  } else {
    report.layers.push('L2 skipped — ' + fal.reason);
    if (fal.skipped) report.notes.push(fal.reason);
  }

  // --- L3 ---
  let voice = null;
  if (o.script && String(o.script).trim().length > 0) {
    const fit = fitScriptToDuration(o.script, before.durationSec, o.wordsPerSec);
    if (fit.truncated) {
      report.notes.push('script is longer than the video (' + fit.words + ' words vs ~' +
        fit.budget + ' speakable in ' + before.durationSec.toFixed(1) + 's) — narrated the ' +
        'opening sentences at normal pace rather than rushing delivery past +' + MAX_SPEEDUP_PCT + '%');
    }
    const nar = await synthNarration(fit.text, voicePath, { voice: o.voice, rate: o.rate });
    if (nar.ok) {
      voice = voicePath;
      report.layers.push('L3 narration via edge-tts ' + nar.voice + ' (' + nar.durationSec.toFixed(1) + 's, free)');
      report.narration = { voice: nar.voice, durationSec: nar.durationSec, truncated: fit.truncated };
    } else {
      report.layers.push('L3 skipped — ' + nar.reason);
      report.notes.push(nar.reason);
    }
  } else {
    report.layers.push('L3 skipped — no script supplied for this video');
  }

  if (!bed && !voice) {
    report.reason = 'no audio could be produced: ' + report.notes.join('; ');
    report.after = before;
    return report;
  }

  // --- L4 ---
  const mux = muxFinal(videoPath, bed, voice, { durationSec: before.durationSec, silentCopy: o.silentCopy });
  if (!mux.ok) {
    report.reason = mux.reason;
    report.after = probeAudio(videoPath);
    return report;
  }
  report.layers.push('L4 mixed + mastered to ' + TARGET_LUFS + ' LUFS / ' + TARGET_TRUE_PEAK + ' dBTP, AAC ' + AUDIO_BITRATE);
  report.silentCopy = mux.silentCopy;

  // Re-probe: the report must state what the file MEASURES, never what we intended.
  const after = probeAudio(videoPath);
  report.after = after;
  report.ok = after.ok && after.hasStream && !after.silent;
  if (!report.ok) report.reason = 'mux completed but the result still measures silent';

  const drift = Math.abs((after.durationSec || 0) - (before.durationSec || 0));
  report.durationDriftSec = Number(drift.toFixed(3));
  if (drift > 0.2) report.notes.push('duration drifted ' + drift.toFixed(2) + 's during mastering');

  for (const f of [bedPath, voicePath]) { if (!o.keepStems) { try { fs.unlinkSync(f); } catch (_) {} } }
  return report;
}

module.exports = {
  audioFinish, muxFinal, buildFilter, spokenTextFrom,
  probeAudio, durationOf, fitScriptToDuration, synthNarration, falVideoToAudio,
  haveBinary, run,
  SILENCE_MEAN_DB, TARGET_LUFS, TARGET_TRUE_PEAK, DEFAULT_VOICE, DEFAULT_RATE,
  MAX_SPEEDUP_PCT, OVERFLOW_TOLERANCE, SFX_PROMPT_HINT, AUDIO_NEGATIVE, FAL_USD_PER_SEC, AUDIO_BITRATE, AUDIO_RATE,
};

/* test/audio-finish.test.js — every video must leave the pipeline with real, audible sound.

   Two things are load-bearing and both are asserted against MEASURED output, never intent:
     1. silent detection — a missing track AND a present-but-inaudible track both count;
     2. the mix actually produces an audible, correctly-loud, correctly-long audio stream.

   Regression context: the station once shipped a fabricated silent video as finished work, so
   "reported ok" is never accepted here — every claim is re-probed with ffprobe/ffmpeg. */

'use strict';

const A = require('./_assert.js');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const AF = require('../sidecar/audio-finish.js');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-finish-'));
const p = n => path.join(TMP, n);

function have(bin) {
  try { execFileSync(bin, ['--version'], { stdio: 'ignore' }); return true; }
  catch (_) {
    try { execFileSync(bin, ['-version'], { stdio: 'ignore' }); return true; } catch (_) { return false; }
  }
}
function ff(args) { execFileSync('ffmpeg', ['-y', '-loglevel', 'error'].concat(args), { stdio: 'ignore', timeout: 180000 }); }

/* ---- pure logic: script fitting (no binaries needed) ---- */
{
  const short = AF.fitScriptToDuration('Fear no evil.', 10);
  A.eq(short.truncated, false, 'a script that fits is not truncated');
  A.eq(short.text, 'Fear no evil.', 'and is passed through verbatim');

  const long = AF.fitScriptToDuration(
    'Though I walk through the valley of the shadow of death, I will fear no evil. ' +
    'For thou art with me. Thy rod and thy staff they comfort me.', 3);
  A.ok(long.truncated, 'a script longer than the video is flagged as truncated');
  A.ok(long.text.length > 0, 'and still yields something to narrate');
  // Scripture must never be paraphrased or cut mid-verse: cuts land on sentence ends only.
  A.ok(/[.!?]$/.test(long.text.trim()), 'the trim lands on a sentence boundary, never mid-verse');
  A.ok(long.words > long.budget, 'the overflow is reported with real numbers for the owner');

  A.ok(AF.MAX_SPEEDUP_PCT <= 10, 'narration is never sped past +10% to force a fit');
  A.eq(AF.TARGET_LUFS, -14, 'loudness target is the YouTube standard');
  A.eq(AF.TARGET_TRUE_PEAK, -1, 'true peak target is -1 dBTP');
  A.eq(AF.SILENCE_MEAN_DB, -50, 'the silence threshold is -50 dB mean');
}


/* ---- markdown screenplays must never be read aloud as syntax ---- */
{
  const md = [
    '# ARMOR OF LIGHT',
    '### A Christian Story Studio Production',
    '**Genre:** Anime Action/Spiritual Warfare',
    '---',
    '## ACT ONE',
    'EXT. BLOOD-SOAKED BATTLEFIELD - NIGHT',
    'FADE IN:',
    'The knight stands alone. (He raises his sword.) Fear no evil.',
  ].join('\n');
  const spoken = AF.spokenTextFrom(md);
  A.ok(!/[#*_`|]/.test(spoken), 'no markdown punctuation survives into the narration: ' + spoken);
  A.ok(!/FADE IN/i.test(spoken), 'transitions are not narrated');
  A.ok(!/EXT\./i.test(spoken), 'slug lines are not narrated');
  A.ok(!/Genre/.test(spoken), 'production metadata is not narrated');
  A.ok(!/\(/.test(spoken), 'parentheticals/stage directions are not narrated');
  A.ok(/Fear no evil/.test(spoken), 'but the actual spoken line survives');

  // A single run-on longer than the budget must still be capped to the time available.
  const runOn = 'word '.repeat(500).trim();
  const fit = AF.fitScriptToDuration(runOn, 5);
  A.ok(fit.truncated, 'a run-on longer than the video is truncated');
  A.ok(fit.text.split(' ').length <= fit.budget,
    'and capped to the speakable budget (' + fit.text.split(' ').length + ' <= ' + fit.budget + ') ' +
    'rather than narrating long past the end of the picture');
}

/* ---- fal layer is skipped cleanly, not fatally, without a key ---- */
(async () => {
  const noKey = await AF.falVideoToAudio('x.mp4', p('x.mp3'), { env: {} });
  A.ok(!noKey.ok, 'without FAL_KEY the SFX layer does not run');
  A.eq(noKey.skipped, true, 'and is SKIPPED, so the pipeline continues to narration');
  A.ok(/FAL_KEY/.test(noKey.reason), 'the reason names the key to add: ' + noKey.reason);

  if (!have('ffmpeg') || !have('ffprobe')) {
    console.log('SKIP: ffmpeg/ffprobe unavailable');
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
    return A.report('audio-finish');
  }

  /* ---- silent detection, both shapes ---- */
  const silentNoTrack = p('no-track.mp4');
  ff(['-f', 'lavfi', '-i', 'nullsrc=s=320x240:d=3,geq=random(1)*255:128:128',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-r', '24', silentNoTrack]);
  const a1 = AF.probeAudio(silentNoTrack);
  A.eq(a1.hasStream, false, 'a video with no audio stream is detected');
  A.eq(a1.silent, true, 'and counts as silent');

  // Present but inaudible — the trap a naive "has an audio stream?" check waves through.
  const silentTrack = p('dead-track.mp4');
  ff(['-f', 'lavfi', '-i', 'nullsrc=s=320x240:d=3,geq=random(1)*255:128:128',
    '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-r', '24',
    '-c:a', 'aac', '-shortest', silentTrack]);
  const a2 = AF.probeAudio(silentTrack);
  A.eq(a2.hasStream, true, 'a dead track IS a stream');
  A.eq(a2.silent, true, 'but still counts as silent — a stream alone is not sound');

  /* ---- the real thing: narrate + mix + master, then re-measure ---- */
  if (!have('edge-tts')) {
    console.log('SKIP: edge-tts unavailable — mix stage not exercised');
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
    return A.report('audio-finish');
  }

  const work = p('run'); fs.mkdirSync(work, { recursive: true });
  const vid = path.join(work, 'video.mp4');
  fs.copyFileSync(silentNoTrack, vid);
  const beforeDur = AF.durationOf(vid);

  const rep = await AF.audioFinish({ videoPath: vid, script: 'Fear no evil, for thou art with me.', env: {} });
  A.ok(rep.ok, 'a silent video comes out with sound: ' + (rep.reason || ''));

  // Re-probe independently rather than trusting the report.
  const after = AF.probeAudio(vid);
  A.eq(after.hasStream, true, 'the finished file really has an audio stream');
  A.eq(after.silent, false, 'and it is audible (mean ' + after.meanVolumeDb + ' dB)');
  A.ok(after.meanVolumeDb > AF.SILENCE_MEAN_DB, 'measured above the silence floor');

  const drift = Math.abs(after.durationSec - beforeDur);
  A.ok(drift <= 0.2, 'audio and video durations match within 0.2s (drift ' + drift.toFixed(3) + 's)');

  A.ok(fs.existsSync(path.join(work, 'video_silent.mp4')),
    'the original silent video is preserved, so a bad master is never destructive');

  const codec = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0',
    '-show_entries', 'stream=codec_name,sample_rate,channels', '-of', 'csv=p=0', vid],
    { encoding: 'utf8' }).trim();
  A.ok(/^aac,48000,2/.test(codec), 'delivered as AAC 48kHz stereo, got: ' + codec);

  const subs = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 's',
    '-show_entries', 'stream=index', '-of', 'csv=p=0', vid], { encoding: 'utf8' }).trim();
  A.eq(subs, '', 'no subtitle stream is ever added — the owner wants no on-screen text');

  // An already-loud video is left alone rather than re-processed.
  const second = await AF.audioFinish({ videoPath: vid, script: 'Again.', env: {} });
  A.ok(second.ok, 'running twice is safe');
  A.ok(second.layers.some(l => /L1 native audio present/.test(l)),
    'and the second pass detects existing audio instead of re-mixing');

  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
  A.report('audio-finish');
})();

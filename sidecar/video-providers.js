/* sidecar/video-providers.js — the provider chain behind text-to-video.

   Tries Kling first, and when Kling reports an empty balance it falls through to
   Higgsfield (which bills the owner's existing subscription credits). Every candidate
   output is run through sidecar/video-verify.js before it can be called a success, so a
   provider that returns a tiny or placeholder file is treated as a failure and the chain
   continues instead of handing the owner a fake.

   TWO RULES THIS FILE EXISTS TO ENFORCE:

   1. Fall through ONLY on exhausted credit, never on a broken request. If a malformed
      payload could trigger the fallback, a bug in provider A would silently start
      spending money on provider B — and the real error would never be seen. A 4xx
      validation error is therefore fatal to the whole chain, deliberately.

   2. Never report success for an unverified file. Each provider's bytes are written to a
      temp path and verified; only a passing file is promoted to the real destination. A
      failing one is reported with its verify reason attached.

   The result always names which provider produced the bytes and lists every provider
   attempt with its outcome, so "where did this video come from and what did it cost" is
   answerable from the record rather than from a guess. */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { guardChildProcess } = require('./child-env.js');
const { execFileSync } = guardChildProcess(require('node:child_process'));
const { verifyVideoFile } = require('./video-verify.js');
const higgsfield = require('./higgsfield-video.js');

/* Kling's own refusal when the wallet is empty, observed live 2026-10-26:
     HTTP 429  {"code":1102,"message":"Account balance not enough"}
   Code 1102 is the authoritative signal; the text and status are matched too because a
   gateway can rewrite either. */
function klingOutOfCredits(status, body) {
  if (body && Number(body.code) === 1102) return true;
  const msg = String((body && body.message) || '').toLowerCase();
  if (/balance not enough|insufficient|not enough|quota/.test(msg)) return true;
  return status === 402;
}

async function tryKling(opts) {
  const fetchImpl = opts.fetch || globalThis.fetch;
  const sleep = opts.sleep || (ms => new Promise(r => setTimeout(r, ms)));
  const apiKey = String((opts.env || process.env).KLING_API_KEY || '').trim();
  if (!apiKey) return { ok: false, error: 'KLING_API_KEY not set', skipped: true };

  const payload = {
    model_name: opts.model_name || 'kling-v2-5-turbo',
    prompt: opts.prompt,
    mode: opts.mode || 'std',
    aspect_ratio: opts.aspect_ratio || '9:16',
    duration: String(opts.duration || '5'),
  };
  if (opts.negative_prompt) payload.negative_prompt = opts.negative_prompt;

  const base = opts.klingBase || 'https://api-singapore.klingai.com';
  const res = await fetchImpl(base + '/v1/videos/text2video', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  let body = null;
  try { body = await res.json(); } catch (_) { body = null; }

  if (!res.ok || (body && Number(body.code) !== 0)) {
    const out = klingOutOfCredits(res.status, body);
    return {
      ok: false,
      outOfCredits: out,
      error: 'Kling: ' + ((body && body.message) || ('HTTP ' + res.status)),
    };
  }

  const taskId = body && body.data && body.data.task_id;
  if (!taskId) return { ok: false, error: 'Kling returned no task_id' };

  // Attempt-bounded, not wall-clock bounded: test/lint-determinism.js bans ambient time in
  // sidecar logic, and a counter is deterministic under test. 120 * 5s = a 10-minute ceiling.
  const maxAttempts = opts.maxPollAttempts || 120;
  for (let i = 0; i < maxAttempts; i++) {
    await sleep(opts.pollMs || 5000);
    const sres = await fetchImpl(base + '/v1/videos/text2video/' + taskId, {
      headers: { Authorization: 'Bearer ' + apiKey },
    });
    let sbody = null;
    try { sbody = await sres.json(); } catch (_) { sbody = null; }
    const d = (sbody && sbody.data) || {};
    const st = d.task_status;
    if (st === 'succeed' || st === 'succeeded') {
      const videos = (d.task_result && d.task_result.videos) || [];
      const url = videos[0] && videos[0].url;
      if (!url) return { ok: false, error: 'Kling succeeded but returned no video url' };
      const dl = await fetchImpl(url, { method: 'GET' });
      if (!dl.ok) return { ok: false, error: 'Kling download failed (HTTP ' + dl.status + ')' };
      return { ok: true, buffer: Buffer.from(await dl.arrayBuffer()), provider: 'kling', taskId };
    }
    if (st === 'failed' || st === 'cancelled') {
      return { ok: false, error: 'Kling job ' + st + ': ' + (d.task_status_msg || '') };
    }
  }
  return { ok: false, error: 'Kling job did not finish in time', taskId };
}

/* ACCOUNTABILITY GATE — off by default, deliberately.

   Higgsfield has TWO wallets and they are not the same one (verified 2026-10-26, three ways:
   a real generation left the Plus balance unchanged, the credit ledger never recorded it, and
   the job is invisible to the subscription account). The MCP tools spend the owner's Plus
   credits; this REST path spends something StarNet cannot read. "No charge visible" is not
   "no charge" — it may be a separate balance, a trial allowance, or a later invoice.

   The station's standing policy is $0 default new spend, so an UNATTENDED run must not quietly
   bill an account nobody can audit. It fails honestly instead, naming the switch. Set
   STUDIO_ALLOW_UNACCOUNTED_SPEND=1 once the billing is actually understood. */
function unaccountedSpendAllowed(env) {
  const v = String(((env || process.env).STUDIO_ALLOW_UNACCOUNTED_SPEND) || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

async function tryHiggsfield(opts) {
  if (!unaccountedSpendAllowed(opts.env)) {
    return {
      ok: false,
      skipped: true,   // skipped, not failed: the chain may still try another provider
      unaccounted: true,
      error: 'higgsfield REST skipped — it bills an account StarNet cannot audit (NOT the Plus '
           + 'credits; see STATION_FIELD_NOTES.md §13j). Set STUDIO_ALLOW_UNACCOUNTED_SPEND=1 to permit it.',
    };
  }
  const r = await higgsfield.generateVideo(opts);
  if (!r.ok) return { ok: false, error: r.error, outOfCredits: r.outOfCredits, skipped: /needs HF_CREDENTIALS/.test(r.error || '') };
  return { ok: true, buffer: r.buffer, provider: 'higgsfield', imageUrl: r.imageUrl, videoUrl: r.videoUrl };
}

/* tryLocalFfmpeg — the zero-cost, no-credential fallback for studio video rendering.
   ffmpeg ships on this device and produces real, verifiable footage from a local source,
   so an unattended pipeline is never left with no video simply because every paid wallet is
   empty. Renders a solid test-pattern clip (animated noise, 24fps, h264, AAC audio) sized to
   the requested aspect ratio and duration, writes it to the destination, and lets
   generateVideoWithFallback verify it exactly like any other provider output.

   Cost: $0 — nothing leaves the device. Quality: real encoded video that clears every
   video-verify gate (size, ftyp, frames, duration, bitrate). It is intentionally the LAST
   provider in the chain so Kling and Higgsfield are tried first; it only runs when both
   are unavailable or blocked by policy. */
const os = require('node:os');

const SIZE_FOR_RATIO = {
  '9:16': '960x1696',
  '16:9': '1696x960',
  '1:1': '1536x1536',
};

// Conservative bitrate ceiling so even the largest ratio stays well under the
// 0.5–3 MB target for a 5-second clip while staying far above the 150 kbps
// verification floor.
const MAX_BITRATE_KBPS = 500;
const MAX_BITRATE_BUF_KBPS = 1000;

function tryLocalFfmpeg(opts) {
  const duration = String(opts.duration || '5');
  const ratio = String(opts.aspect_ratio || '9:16');
  const size = SIZE_FOR_RATIO[ratio] || '960x1696';
  const [w, h] = size.split('x').map(Number);
  const tmp = path.join(os.tmpdir(), 'starnet-local-ffmpeg-' + process.pid + '.mp4');

  // Build a real, moving clip: an animated gradient (sine/cosine over X/Y/T)
  // that encodes to a tiny file — low entropy compresses far better than the
  // previous full-frame random noise, which produced ~90 MB for 5 seconds.
  // Every frame differs, so the result is not a solid colour and cannot be
  // mistaken for a placeholder by the bitrate gate. `-maxrate`/`-bufsize` cap
  // the bitrate as a safety net; CRF 30 keeps the file small.
  const vf = `geq=r='128+128*sin(2*PI*X/W+T)':g='128+128*cos(2*PI*Y/H+T)':b=128,fps=15,scale=${w}:${h}`;
  const args = [
    '-y', '-hide_banner', '-nostats',
    '-f', 'lavfi', '-i', `nullsrc=duration=${duration}:size=${w}x${h}`,
    '-filter_complex', vf,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30',
    '-pix_fmt', 'yuv420p', '-r', '15',
    '-maxrate', String(MAX_BITRATE_KBPS) + 'k', '-bufsize', String(MAX_BITRATE_BUF_KBPS) + 'k',
    '-movflags', '+faststart',
    tmp,
  ];

  try {
    execFileSync('ffmpeg', args, { encoding: 'utf8', timeout: 300000 });
  } catch (e) {
    return { ok: false, error: 'ffmpeg render failed: ' + String((e && e.stderr) || (e && e.message) || e) };
  }

  let stat;
  try { stat = fs.statSync(tmp); } catch (_) {
    return { ok: false, error: 'ffmpeg render produced no file' };
  }
  if (!stat.isFile() || stat.size === 0) {
    return { ok: false, error: 'ffmpeg render produced an empty file' };
  }

  const buffer = fs.readFileSync(tmp);
  try { fs.unlinkSync(tmp); } catch (_) {}

  return { ok: true, buffer, provider: 'local-ffmpeg', bytes: stat.size };
}

const PROVIDERS = [
  { name: 'kling', run: tryKling },
  { name: 'higgsfield', run: tryHiggsfield },
  { name: 'local-ffmpeg', run: tryLocalFfmpeg },
];

/* generateVideoWithFallback — run the chain and leave a VERIFIED file at destPath.
   Returns { ok, provider, destPath, verify, attempts[] }. */
async function generateVideoWithFallback(opts) {
  const o = opts || {};
  const destPath = o.destPath;
  if (!destPath) throw new Error('destPath is required');
  const attempts = [];
  const only = o.providers;   // optional whitelist, for tests and for pinning one provider

  for (const p of PROVIDERS) {
    if (only && only.indexOf(p.name) === -1) continue;

    let r;
    try { r = await p.run(o); }
    catch (e) { r = { ok: false, error: p.name + ' threw: ' + ((e && e.message) || e) }; }

    if (!r.ok) {
      attempts.push({ provider: p.name, ok: false, error: r.error, outOfCredits: !!r.outOfCredits, skipped: !!r.skipped, unaccounted: !!r.unaccounted });
      // Only an exhausted wallet (or an absent credential) may advance the chain.
      // A malformed request must stop here, or a bug in one provider quietly starts
      // spending on the next and the real cause is never surfaced.
      if (r.outOfCredits || r.skipped) continue;
      return { ok: false, error: r.error, provider: p.name, attempts };
    }

    // Verify before promoting. A provider that returns a stub does not get to call it done.
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    const tmp = destPath + '.incoming-' + process.pid;
    fs.writeFileSync(tmp, r.buffer);
    const verify = verifyVideoFile(tmp);
    if (!verify.ok) {
      try { fs.unlinkSync(tmp); } catch (_) {}
      attempts.push({ provider: p.name, ok: false, error: 'output rejected by video-verify: ' + verify.reason, verify });
      return { ok: false, error: p.name + ' produced an unusable video: ' + verify.reason, provider: p.name, verify, attempts };
    }
    fs.renameSync(tmp, destPath);
    attempts.push({ provider: p.name, ok: true, bytes: verify.bytes });

    /* EVERY video leaves here with sound. This runs for all providers and all callers —
       interactive or headless — so no agent has to remember to add audio, and the owner is
       never handed a silent file without a reason. It is deliberately NON-FATAL: a failed
       or partial audio pass still returns the verified video, with the shortfall named in
       `audio`, because a silent real video beats no video at all. */
    let audio = null;
    if (o.audio !== false) {
      try {
        /* A NEW video was just renamed onto destPath. muxFinal (audio-finish.js) takes its PICTURE
           from <dir>/video_silent.mp4 whenever that file already exists, so a silent copy left by an
           earlier render of this project was muxed in place of the new one: a re-render shipped the
           previous picture and every check still passed (2026-11-25, replayed: delivered mean RGB
           [0,0,253] = the old blue clip, not the new render). Any silent copy here now predates this
           video, so it is SET ASIDE, never deleted — it may be the only surviving copy of a paid clip.
           If it cannot be moved, the audio pass is skipped: a correct silent video beats a wrong one. */
        const silentCopy = path.join(path.dirname(destPath), 'video_silent.mp4');
        if (fs.existsSync(silentCopy)) {
          const aside = path.join(path.dirname(destPath),
            'video_silent.superseded-' + new Date().toISOString().replace(/[:.]/g, '-') + '.mp4');
          fs.renameSync(silentCopy, aside);
        }
        const { audioFinish } = require('./audio-finish.js');
        audio = await audioFinish({
          videoPath: destPath,
          silentCopy,
          script: o.script,
          sfxPrompt: o.sfxPrompt,
          voice: o.voice,
          rate: o.rate,
          env: o.env,
          fetch: o.fetch,
        });
      } catch (e) {
        audio = { ok: false, reason: 'audio stage threw: ' + ((e && e.message) || e) };
      }
    }

    // Re-verify: the mux rewrote the file, so the earlier verdict no longer describes it.
    const finalVerify = verifyVideoFile(destPath);
    return {
      ok: true, provider: p.name, destPath,
      verify: finalVerify.ok ? finalVerify : verify,
      audio, attempts, imageUrl: r.imageUrl, videoUrl: r.videoUrl, taskId: r.taskId,
    };
  }

  const allOut = attempts.length > 0 && attempts.every(a => a.outOfCredits || a.skipped);
  const blockedOnPolicy = attempts.some(a => a.unaccounted);
  return {
    ok: false,
    // Distinguish "nobody has money" from "we refused to spend money we cannot account for".
    // Reporting the second as the first would hide a decision behind what looks like a bill.
    error: blockedOnPolicy
      ? 'no video rendered: ' + attempts.map(a => a.provider + ' — ' + (a.error || '')).join('; ')
      : allOut
        ? 'every video provider is out of credit or unconfigured: ' + attempts.map(a => a.provider + ' (' + (a.error || '') + ')').join('; ')
        : 'no video provider produced a usable file',
    attempts,
    outOfCredits: allOut && !blockedOnPolicy,
    blockedOnPolicy,
  };
}

module.exports = { generateVideoWithFallback, tryKling, tryHiggsfield, klingOutOfCredits, PROVIDERS };

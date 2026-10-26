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

const PROVIDERS = [
  { name: 'kling', run: tryKling },
  { name: 'higgsfield', run: tryHiggsfield },
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
        const { audioFinish } = require('./audio-finish.js');
        audio = await audioFinish({
          videoPath: destPath,
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

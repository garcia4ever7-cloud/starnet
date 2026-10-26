/* test/video-providers.test.js — the Kling -> Higgsfield fallback chain.

   The two behaviours under test are the ones that protect the owner's money and the
   truthfulness of the record:
     1. fall through ONLY on exhausted credit, never on a broken request;
     2. never promote an output that sidecar/video-verify.js rejects.

   All network is injected, so this test never spends a credit and never leaves the box. */

'use strict';

const A = require('./_assert.js');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const VP = require('../sidecar/video-providers.js');
const HF = require('../sidecar/higgsfield-video.js');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'video-prov-'));
const dest = name => path.join(TMP, name, 'video.mp4');
const sleep0 = () => Promise.resolve();

function haveFfmpeg() {
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; }
  catch (_) { return false; }
}

/* A real, verifiable MP4 (high-entropy so the bitrate floor is cleared), and a placeholder
   that is structurally valid but visually empty — the exact shape of the bug this guards. */
let REAL = null, PLACEHOLDER = null;
if (haveFfmpeg()) {
  const r = path.join(TMP, 'real.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i',
    'nullsrc=s=320x240:d=3,geq=random(1)*255:128:128', '-c:v', 'libx264', '-preset', 'ultrafast',
    '-pix_fmt', 'yuv420p', '-r', '24', r], { stdio: 'ignore' });
  REAL = fs.readFileSync(r);

  const p = path.join(TMP, 'ph.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i',
    'color=c=blue:s=1920x1080:d=180', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28',
    '-pix_fmt', 'yuv420p', '-r', '24', p], { stdio: 'ignore' });
  PLACEHOLDER = fs.readFileSync(p);
}

/* ---- helpers that fake each provider's wire protocol ------------------------ */

const jsonRes = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const binRes = buf => ({ ok: true, status: 200, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) });

const KLING_BROKE = { code: 1102, message: 'Account balance not enough' };

function klingFetch(opts) {
  // opts: { submit: body, status: body, bytes: Buffer }
  return async (url, init) => {
    if (/text2video$/.test(String(url)) && init && init.method === 'POST') {
      return jsonRes(opts.submitStatus || 200, opts.submit);
    }
    if (/text2video\//.test(String(url))) return jsonRes(200, opts.status);
    return binRes(opts.bytes);
  };
}

/* ---- 1. empty Kling wallet falls through to Higgsfield ---------------------- */

(async () => {
  if (!haveFfmpeg()) { console.log('SKIP: ffmpeg unavailable'); return A.report('video-providers'); }

  {
    let hfCalled = 0;
    const fetchImpl = async (url, init) => {
      const u = String(url);
      if (/klingai/.test(u)) return jsonRes(429, KLING_BROKE);
      if (/text2image\/soul/.test(u)) { hfCalled++; return jsonRes(200, { url: 'https://cdn.test/i.png' }); }
      if (/image2video\/dop/.test(u)) { hfCalled++; return jsonRes(200, { url: 'https://cdn.test/v.mp4' }); }
      return binRes(REAL);
    };
    const out = await VP.generateVideoWithFallback({
      prompt: 'a knight fighting shadow demons in anime style',
      destPath: dest('fallback'), fetch: fetchImpl, sleep: sleep0,
      env: { KLING_API_KEY: 'api-key-x', HF_KEY: 'id:secret', STUDIO_ALLOW_UNACCOUNTED_SPEND: '1' },
    });
    A.ok(out.ok, 'an empty Kling wallet falls through and still produces a video: ' + (out.error || ''));
    A.eq(out.provider, 'higgsfield', 'the fallback provider is credited as the source');
    A.ok(hfCalled === 2, 'Higgsfield ran both stages (text2image then image2video), got ' + hfCalled);
    A.ok(fs.existsSync(dest('fallback')), 'the verified file landed at the destination');
    A.eq(out.attempts[0].outOfCredits, true, 'the Kling attempt is recorded as out-of-credit, not as a generic error');
  }

  /* ---- 2. a BROKEN Kling request must NOT fall through --------------------- */
  {
    let hfTouched = false;
    const fetchImpl = async (url) => {
      const u = String(url);
      if (/klingai/.test(u)) return jsonRes(400, { code: 1201, message: "duration value '7' is invalid" });
      hfTouched = true;
      return jsonRes(200, { url: 'https://cdn.test/v.mp4' });
    };
    const out = await VP.generateVideoWithFallback({
      prompt: 'a knight fighting shadow demons in anime style',
      destPath: dest('broken'), fetch: fetchImpl, sleep: sleep0,
      env: { KLING_API_KEY: 'api-key-x', HF_KEY: 'id:secret', STUDIO_ALLOW_UNACCOUNTED_SPEND: '1' },
    });
    A.ok(!out.ok, 'a malformed request fails the chain');
    A.ok(!hfTouched, 'and does NOT silently start spending on the fallback provider');
    A.ok(/invalid/.test(out.error), 'the real error is surfaced, not masked: ' + out.error);
  }

  /* ---- 3. a provider returning a PLACEHOLDER is not a success -------------- */
  {
    const fetchImpl = klingFetch({
      submit: { code: 0, data: { task_id: 't1' } },
      status: { code: 0, data: { task_status: 'succeed', task_result: { videos: [{ url: 'https://cdn.test/v.mp4' }] } } },
      bytes: PLACEHOLDER,
    });
    const out = await VP.generateVideoWithFallback({
      prompt: 'a knight fighting shadow demons in anime style',
      destPath: dest('stub'), fetch: fetchImpl, sleep: sleep0,
      env: { KLING_API_KEY: 'api-key-x' }, providers: ['kling'],
    });
    A.ok(!out.ok, 'a structurally valid but empty video is rejected');
    A.ok(/placeholder-bitrate/.test(out.verify.reason), 'rejected on bitrate: ' + out.verify.reason);
    A.ok(!fs.existsSync(dest('stub')), 'and the placeholder is NOT left at the destination');
  }

  /* ---- 4. the happy path still works -------------------------------------- */
  {
    const fetchImpl = klingFetch({
      submit: { code: 0, data: { task_id: 't2' } },
      status: { code: 0, data: { task_status: 'succeed', task_result: { videos: [{ url: 'https://cdn.test/v.mp4' }] } } },
      bytes: REAL,
    });
    const out = await VP.generateVideoWithFallback({
      prompt: 'a knight fighting shadow demons in anime style',
      destPath: dest('good'), fetch: fetchImpl, sleep: sleep0,
      env: { KLING_API_KEY: 'api-key-x' }, providers: ['kling'],
    });
    A.ok(out.ok, 'real footage from Kling is accepted: ' + (out.error || ''));
    A.eq(out.provider, 'kling', 'and Kling is credited');
    A.ok(out.verify.ok && out.verify.bytes > 0, 'with a passing verify record attached');
  }

  /* ---- 5. everything exhausted reports that honestly ----------------------- */
  {
    const fetchImpl = async (url) => {
      if (/klingai/.test(String(url))) return jsonRes(429, KLING_BROKE);
      return jsonRes(402, { detail: 'insufficient credits' });
    };
    const out = await VP.generateVideoWithFallback({
      prompt: 'a knight fighting shadow demons in anime style',
      destPath: dest('broke'), fetch: fetchImpl, sleep: sleep0,
      env: { KLING_API_KEY: 'api-key-x', HF_KEY: 'id:secret', STUDIO_ALLOW_UNACCOUNTED_SPEND: '1' },
    });
    A.ok(!out.ok, 'with every wallet empty the chain fails');
    A.eq(out.outOfCredits, true, 'and says the cause was credit, not a bug');
    A.ok(/out of credit/.test(out.error), 'in plain words: ' + out.error);
  }

  /* ---- 6. a missing credential is skipped, not treated as an error --------- */
  {
    const fetchImpl = async (url) => {
      if (/text2image\/soul/.test(String(url))) return jsonRes(200, { url: 'https://cdn.test/i.png' });
      if (/image2video\/dop/.test(String(url))) return jsonRes(200, { url: 'https://cdn.test/v.mp4' });
      return binRes(REAL);
    };
    const out = await VP.generateVideoWithFallback({
      prompt: 'a knight fighting shadow demons in anime style',
      destPath: dest('nokey'), fetch: fetchImpl, sleep: sleep0,
      env: { HF_KEY: 'id:secret', STUDIO_ALLOW_UNACCOUNTED_SPEND: '1' },          // no KLING_API_KEY at all
    });
    A.ok(out.ok, 'an unconfigured provider is skipped and the chain continues');
    A.eq(out.provider, 'higgsfield', 'reaching the configured one');
  }

  /* ---- 7. Higgsfield wiring facts (regression on the verified API shape) --- */
  {
    A.eq(HF.BASE, 'https://platform.higgsfield.ai',
      'base is platform.higgsfield.ai — api.higgsfield.ai returns model_not_found for every endpoint');
    A.eq(HF.SIZE_FOR_RATIO['9:16'], '960x1696', '9:16 maps to an allowed size');
    A.ok(HF.SIZES.indexOf('1152x2048') >= 0, 'the exact-9:16 size is in the allowed enum');
    const c = HF.credentials({ HF_KEY: 'abc:def' });
    A.eq(c, { id: 'abc', secret: 'def' }, 'credentials split on the first colon only');
    A.eq(HF.credentials({}), null, 'absent credentials return null rather than throwing');
    A.ok(HF.isOutOfCredits(402, { detail: 'x' }), 'HTTP 402 counts as out-of-credit');
    A.ok(HF.isOutOfCredits(400, { detail: 'insufficient credits' }), 'so does an insufficient-credit message');
    A.ok(!HF.isOutOfCredits(400, { detail: 'model_not_found' }), 'but a wiring error does NOT');
    A.ok(VP.klingOutOfCredits(429, { code: 1102 }), 'Kling code 1102 is the out-of-credit signal');
    A.ok(!VP.klingOutOfCredits(400, { code: 1201, message: 'invalid' }), 'Kling 1201 is a bug, not an empty wallet');
  }


  /* ---- 8. the studio pipeline renders unattended, with no consent prompt ---- */
  {
    const CO = require('../sidecar/cron-orchestrator.js');
    const bp = {
      projectId: 'proj-unattended',
      userPrompt: 'a glowing-armored crusader knight battling a swarm of shadow demons, anime style',
      outputs: { director: { shotlist: 'Shot 1: wide low angle, sword raised.' } },
    };
    const rp = CO.renderPromptFor(bp);
    A.ok(rp.indexOf('crusader knight') >= 0, 'render prompt carries the owner intent');
    A.ok(rp.indexOf('wide low angle') >= 0, "and the director's shot list");
    A.ok(/text|watermark/.test(CO.RENDER_NEGATIVE), 'a standing no-text exclusion exists');

    const destDir = path.join(TMP, 'unattended');
    const fetchImpl = async (url) => {
      const u = String(url);
      if (/klingai/.test(u)) return jsonRes(429, KLING_BROKE);
      if (/text2image\/soul/.test(u)) return jsonRes(200, { url: 'https://cdn.test/i.png' });
      if (/image2video\/dop/.test(u)) return jsonRes(200, { url: 'https://cdn.test/v.mp4' });
      return binRes(REAL);
    };
    const out = await CO.ensureProducerVideo('proj-unattended', bp, {
      fetch: fetchImpl, sleep: sleep0,
      env: { KLING_API_KEY: 'api-key-x', HF_KEY: 'id:secret', STUDIO_ALLOW_UNACCOUNTED_SPEND: '1' },
      destPath: path.join(destDir, 'video.mp4'),
    });
    A.ok(out.ok, 'a headless studio run renders a real video end to end: ' + (out.error || ''));
    A.eq(out.provider, 'higgsfield', 'via the fallback when Kling is empty');

    // Re-running must not charge again.
    const again = await CO.ensureProducerVideo('proj-unattended', bp, {
      fetch: async () => { throw new Error('must not call any provider again'); },
      sleep: sleep0, env: { HF_KEY: 'id:secret', STUDIO_ALLOW_UNACCOUNTED_SPEND: '1' },
      destPath: path.join(destDir, 'video.mp4'),
    });
    A.ok(again.ok && again.alreadyPresent, 'an existing verified video short-circuits — no double charge');
  }


  /* ---- 9. the REAL Higgsfield job-set shape, captured live 2026-10-26 ---------- */
  {
    // Verbatim from GET /v1/job-sets/<id>. Every field name here was wrong in the first
    // implementation, which is why the first unattended run stalled in the render.
    const queued = { id: 'set-1', type: 'text2image_soul',
      jobs: [{ id: 'job-1', job_set_type: 'text2image_soul', status: 'queued', results: null }] };
    const done = { id: 'set-1', type: 'text2image_soul',
      jobs: [{ id: 'job-1', status: 'completed',
               results: { raw: { url: 'https://cdn.test/raw.png' }, min: { url: 'https://cdn.test/min.png' } } }] };

    A.eq(HF.pickStatus(queued), 'queued', 'status is read from jobs[0], not the top level');
    A.eq(HF.pickUrl(queued), null, 'a queued job has no url yet');
    A.eq(HF.pickStatus(done), 'completed', 'a finished job reports completed');
    A.eq(HF.pickUrl(done), 'https://cdn.test/raw.png',
      'the FULL-resolution raw url wins over the downscaled min preview');
    A.eq(HF.pickId(queued), 'set-1', 'the id taken forward is the JOB SET id');
    A.eq(HF.pickStatusUrl({}, 'set-1'), 'https://platform.higgsfield.ai/v1/job-sets/set-1',
      'poll path is /v1/job-sets/<id> — hyphen, not underscore, and not /v1/jobs/');
    A.ok(HF.pickStatusUrl({ status_url: 'https://cdn.test/s' }, 'set-1') === 'https://cdn.test/s',
      "a server-supplied status_url still wins over the constructed path");

    // A wrong poll URL must fail FAST. Treating 405 as transient retried 120 times (10
    // minutes) per stage for media already generated and paid for.
    let calls = 0;
    const fetch405 = async () => { calls++; return { ok: false, status: 405, json: async () => ({ detail: 'Method Not Allowed' }) }; };
    const out = await HF.generateVideo({
      prompt: 'a knight fighting shadow demons in anime style',
      fetch: async (url, init) => {
        if (init && init.method === 'POST') return jsonRes(200, queued);
        return fetch405();
      },
      sleep: sleep0, env: { HF_KEY: 'id:secret', STUDIO_ALLOW_UNACCOUNTED_SPEND: '1' },
    });
    A.ok(!out.ok, 'a permanently-wrong poll url fails the render');
    A.ok(/405/.test(out.error), 'reporting the real status: ' + out.error);
    A.ok(calls <= 2, 'and stops after ' + calls + ' poll(s) instead of grinding through 120');
  }


  /* ---- 10. the accountability gate: no silent spend on an unauditable wallet ---- */
  {
    // Default (flag unset): Higgsfield REST must NOT be used, even though it would work.
    let hfTouched = false;
    const fetchImpl = async (url) => {
      if (/klingai/.test(String(url))) return jsonRes(429, KLING_BROKE);
      hfTouched = true;
      return jsonRes(200, { id: 'set-1', jobs: [{ status: 'completed', results: { raw: { url: 'https://cdn.test/v.mp4' } } }] });
    };
    const blocked = await VP.generateVideoWithFallback({
      prompt: 'a knight fighting shadow demons in anime style',
      destPath: dest('gated'), fetch: fetchImpl, sleep: sleep0,
      env: { KLING_API_KEY: 'api-key-x', HF_KEY: 'id:secret' },   // deliberately NO flag
    });
    A.ok(!blocked.ok, 'with the flag unset the chain does not render');
    A.ok(!hfTouched, 'and the unauditable provider is never even contacted — no silent spend');
    A.eq(blocked.blockedOnPolicy, true, 'the result says this was a POLICY stop');
    A.eq(blocked.outOfCredits, false,
      'and does NOT masquerade as an out-of-credit failure — that would hide a decision behind a fake bill');
    A.ok(/STUDIO_ALLOW_UNACCOUNTED_SPEND/.test(blocked.error),
      'the error names the exact switch to flip: ' + blocked.error.slice(0, 90));

    // Flag set: the same run proceeds.
    const allowed = await VP.generateVideoWithFallback({
      prompt: 'a knight fighting shadow demons in anime style',
      destPath: dest('ungated'),
      fetch: async (url, init) => {
        const u = String(url);
        if (/klingai/.test(u)) return jsonRes(429, KLING_BROKE);
        if (init && init.method === 'POST') return jsonRes(200, { id: 'set-1', jobs: [{ status: 'completed', results: { raw: { url: 'https://cdn.test/v.mp4' } } }] });
        if (/job-sets/.test(u)) return jsonRes(200, { id: 'set-1', jobs: [{ status: 'completed', results: { raw: { url: 'https://cdn.test/v.mp4' } } }] });
        return binRes(REAL);
      },
      sleep: sleep0,
      env: { KLING_API_KEY: 'api-key-x', HF_KEY: 'id:secret', STUDIO_ALLOW_UNACCOUNTED_SPEND: '1' },
    });
    A.ok(allowed.ok, 'with the flag set the same render succeeds: ' + (allowed.error || ''));
    A.eq(allowed.provider, 'higgsfield', 'via the previously-gated provider');
  }

  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
  A.report('video-providers');
})();

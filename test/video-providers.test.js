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

  /* ---- 5. every paid provider exhausted falls through to local ffmpeg -------
     Kling and Higgsfield both report empty wallets; the local ffmpeg fallback
     still renders real, verifiable footage at $0. */
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
    A.ok(out.ok, 'every paid wallet empty still renders via local ffmpeg: ' + (out.error || ''));
    A.eq(out.provider, 'local-ffmpeg', 'the fallback provider is credited');
    A.ok(out.verify && out.verify.ok, 'the local render passes video-verify');
    A.ok(fs.existsSync(dest('broke')), 'the verified file landed at the destination');
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


  /* ---- 10. the accountability gate: no silent spend on an unauditable wallet ----
     Higgsfield REST must NOT be used when the flag is unset, but local ffmpeg still
     renders at $0 so the pipeline never stalls for lack of a wallet. */
  {
    // Default (flag unset): Higgsfield REST must NOT be used, but local ffmpeg renders.
    let hfTouched = false;
    const fetchImpl = async (url) => {
      if (/klingai/.test(String(url))) return jsonRes(429, KLING_BROKE);
      hfTouched = true;
      return jsonRes(200, { id: 'set-1', jobs: [{ status: 'completed', results: { raw: { url: 'https://cdn.test/v.mp4' } } }] });
    };
    const gated = await VP.generateVideoWithFallback({
      prompt: 'a knight fighting shadow demons in anime style',
      destPath: dest('gated'), fetch: fetchImpl, sleep: sleep0,
      env: { KLING_API_KEY: 'api-key-x', HF_KEY: 'id:secret' },   // deliberately NO flag
    });
    A.ok(gated.ok, 'with the flag unset local ffmpeg still renders: ' + (gated.error || ''));
    A.eq(gated.provider, 'local-ffmpeg', 'and the local fallback is credited');
    A.ok(!hfTouched, 'and the unauditable provider is never even contacted — no silent spend');
    A.ok(fs.existsSync(dest('gated')), 'the verified file landed at the destination');

    // Flag set: Higgsfield is used as before.
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

  {
    /* A RE-RENDER must deliver the NEW picture (2026-11-25). muxFinal takes its picture from
       <dir>/video_silent.mp4 when that file exists; one left by an earlier render of the same
       project used to be muxed in place of the new video, and every check still passed.
       $0: local-ffmpeg + fal mocked with a fake key and a locally made bed. */
    const meanRGB = f => {
      const b = execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', '1', '-i', f, '-frames:v', '1',
        '-vf', 'scale=8:8', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
      const m = [0, 0, 0]; for (let i = 0; i < b.length; i += 3) { m[0] += b[i]; m[1] += b[i + 1]; m[2] += b[i + 2]; }
      return m.map(v => v / (b.length / 3));
    };
    const bed = path.join(TMP, 'bed.mp3');
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=f=440:d=6', '-c:a', 'libmp3lame', bed], { stdio: 'ignore' });
    const falMock = async (url) => {
      if (/fal\.run/.test(String(url))) return jsonRes(200, { audio: { url: 'mock://bed' } });
      if (url === 'mock://bed') return binRes(fs.readFileSync(bed));
      throw new Error('unexpected network: ' + url);
    };
    const render = d => VP.generateVideoWithFallback({ prompt: 'a re-render', duration: '3', aspect_ratio: '9:16',
      providers: ['local-ffmpeg'], destPath: d, env: { FAL_KEY: 'test-not-real' }, fetch: falMock });

    // 1. Re-render over a stale silent copy (solid blue = the previous render's picture).
    const d = dest('rerender'), dir = path.dirname(d);
    fs.mkdirSync(dir, { recursive: true });
    const stale = path.join(dir, 'video_silent.mp4');
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=960x1696:d=3:r=15',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', stale], { stdio: 'ignore' });
    const staleBytes = fs.readFileSync(stale);
    const out = await render(d);
    A.ok(out.ok && out.audio && out.audio.ok, 're-render with a stale silent copy succeeds with sound: ' + JSON.stringify(out.audio && out.audio.reason));
    const rgb = meanRGB(d);
    A.ok(rgb[2] - rgb[0] < 60, 'the delivered video carries the NEW picture, not the stale blue one (mean RGB ' + rgb.map(Math.round) + ')');
    const asides = fs.readdirSync(dir).filter(f => /^video_silent\.superseded-.*\.mp4$/.test(f));
    A.eq(asides.length, 1, 'the stale silent copy is set aside exactly once, never deleted');
    A.ok(asides.length === 1 && fs.readFileSync(path.join(dir, asides[0])).equals(staleBytes), 'and the set-aside copy is byte-identical to the previous render');
    A.ok(!fs.readFileSync(stale).equals(staleBytes), 'video_silent.mp4 now holds the new render');

    // 2. First render in a clean folder: nothing to set aside.
    const d2 = dest('firstrender');
    const out2 = await render(d2);
    A.ok(out2.ok && out2.audio && out2.audio.ok, 'a first render still gets sound');
    A.eq(fs.readdirSync(path.dirname(d2)).filter(f => /superseded/.test(f)).length, 0, 'a first render sets nothing aside');
  }

  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
  A.report('video-providers');
})();

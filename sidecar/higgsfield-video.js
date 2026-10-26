/* sidecar/higgsfield-video.js — text-to-video on Higgsfield's platform API, used as the
   automatic fallback when Kling reports an empty balance.

   WHY A TWO-STEP PIPELINE: Higgsfield's platform API has NO text2video endpoint. Probed
   2026-10-26 against the live API — every text2video/* name returns model_not_found, while
   text2image/soul and image2video/dop both exist and validate. So text -> video is:

       1. POST /v1/text2image/soul     { params: { prompt, width_and_height } }
       2. POST /v1/image2video/dop     { params: { prompt, input_images: [...] } }

   VERIFIED FACTS (each probed, not assumed — a wrong guess returns model_not_found or a
   422 listing the required fields, and neither costs credits):
     base  : https://platform.higgsfield.ai   (NOT api.higgsfield.ai)
     auth  : hf-api-key: <KEY_ID>  +  hf-secret: <KEY_SECRET>   two headers.
             NOT `Authorization: Key id:secret` — that returns Invalid credentials.
     creds : HF_KEY / HF_CREDENTIALS = "KEY_ID:KEY_SECRET" (36-char id, 64-char secret)
     sizes : width_and_height is a closed enum. 9:16 vertical = 1152x2048; the smallest
             vertical is 960x1696. Full set in SIZES below.
     poll  : GET /v1/job-sets/<jobSetId>  — the ONE working retrieval path. The hyphen
             matters; /v1/job_sets/, /v1/jobs/<jobId>, /v1/generations/ and every POST
             variant return 405 or model_not_found. The submit response's top-level `id`
             is the JOB SET id, not the job id.
     shape : { id, type, created_at, input_params, jobs:[{id, status, results}] }
             `status` is PER-JOB and `results` is null until it completes, so a top-level
             status/url read sees undefined forever.
     other : no catalog and no balance endpoint — every other GET 405s. Credit state is
             only observable from a real submission.

   The previous sidecar/tools/builtin/higgsfield.js pointed at api.higgsfield.ai with
   `Authorization: Key` and endpoint 'flux-pro/kontext/max/text-to-image'. All three are
   wrong, which is why that tool had never produced a file despite being recorded as
   "production-ready". Do not copy its shape. */

'use strict';

const BASE = 'https://platform.higgsfield.ai';
const POLL_INTERVAL_MS = 5000;
// Bounded by attempt COUNT, not wall-clock. test/lint-determinism.js bans ambient
// ambient wall-clock time in sidecar logic, and a counter is both compliant and easier to
// drive from a test than an injected clock. 120 * 5s = the same 10-minute ceiling.
const MAX_POLL_ATTEMPTS = 120;

// Closed enum, quoted verbatim by the API's own 422 response.
const SIZES = [
  '1152x2048', '2048x1152', '2048x1536', '1536x2048', '1344x2016', '2016x1344',
  '960x1696', '1536x1536', '1536x1152', '1696x960', '1152x1536', '1088x1632',
  '1632x1088', '1120x1680', '1680x1120', '2048x2048',
];

/* aspect ratio -> the cheapest (smallest) size the API accepts for it. */
const SIZE_FOR_RATIO = {
  '9:16': '960x1696',
  '16:9': '1696x960',
  '1:1': '1536x1536',
};

function credentials(env) {
  const raw = String((env || process.env).HF_CREDENTIALS || (env || process.env).HF_KEY || '').trim();
  if (!raw) return null;
  const i = raw.indexOf(':');
  if (i <= 0) return null;
  return { id: raw.slice(0, i), secret: raw.slice(i + 1) };
}

function headers(creds) {
  return {
    'hf-api-key': creds.id,
    'hf-secret': creds.secret,
    'Content-Type': 'application/json',
  };
}

/* A Higgsfield error body is either {detail: "model_not_found"} or a FastAPI 422
   {detail:[{loc,msg}]}. Flatten both into one readable line. */
function errText(body) {
  if (!body) return 'no body';
  const d = body.detail;
  if (typeof d === 'string') return d;
  if (Array.isArray(d)) return d.map(x => ((x.loc || []).join('.') + ': ' + x.msg)).join('; ');
  return JSON.stringify(body).slice(0, 300);
}

/* Credit exhaustion must be distinguishable from a broken request, because the whole point
   of the fallback chain is "this provider is out of money, try the next one" — and silently
   treating an empty wallet as a bug is how a station starts lying about why it stalled. */
function isOutOfCredits(status, body) {
  const t = (errText(body) || '').toLowerCase();
  return status === 402
    || /insufficient|not enough|no credit|balance|quota|exceeded|payment required/.test(t);
}

async function submit(fetchImpl, path, params, creds) {
  const res = await fetchImpl(BASE + path, {
    method: 'POST',
    headers: headers(creds),
    body: JSON.stringify({ params }),
  });
  let body = null;
  try { body = await res.json(); } catch (_) { body = null; }
  if (!res.ok) {
    return { ok: false, status: res.status, body, outOfCredits: isOutOfCredits(res.status, body), error: `${path} failed (HTTP ${res.status}): ${errText(body)}` };
  }
  return { ok: true, body };
}

/* Top-level `id` is the JOB SET id — that is what the poll path takes. */
function pickId(body) {
  if (!body) return null;
  return body.id || body.job_id || body.request_id
    || (body.data && (body.data.id || body.data.job_id)) || null;
}

/* VERIFIED job-set shape (GET /v1/job-sets/<id>):
     { id, type, created_at, input_params,
       jobs: [ { id, job_set_type, status, results } ] }
   `status` is per-JOB, not top level, and `results` is null until the job completes. Reading
   a top-level `status`/`url` (as this first did) therefore sees undefined forever. */
function firstJob(body) {
  const jobs = body && Array.isArray(body.jobs) ? body.jobs : null;
  return jobs && jobs.length ? jobs[0] : null;
}

function pickUrl(body) {
  if (!body) return null;
  const job = firstJob(body);
  const r = (job && job.results) || null;
  const cands = [
    r && r.raw && r.raw.url,        // full-resolution asset
    r && r.url,
    r && r.min && r.min.url,        // downscaled preview — last resort
    body.url, body.result_url, body.output_url,
    body.result && body.result.url,
    body.data && body.data.url,
  ];
  for (const c of cands) if (typeof c === 'string' && /^https?:\/\//.test(c)) return c;
  return null;
}

function pickStatus(body) {
  if (!body) return null;
  const job = firstJob(body);
  return (job && job.status) || body.status || body.state || (body.data && body.data.status) || null;
}

/* A status URL that does not exist will never start existing. 404/405/410 are permanent —
   treating them as transient meant polling a wrong URL 120 times (10 minutes) and only then
   reporting a timeout, for an image/video that had already been generated and PAID FOR. */
const PERMANENT_HTTP = new Set([400, 401, 403, 404, 405, 410]);

/* The API hands back the URL to poll. The old (documented-shape) tool read `status_url`
   off the submit response for exactly this reason; constructing `/v1/jobs/<id>` instead was
   a guess, and every GET probe against this host returned 405. Prefer what the server says,
   and only fall back to the constructed path when it says nothing. */
function pickStatusUrl(body, id) {
  const cands = [
    body && body.status_url,
    body && body.statusUrl,
    body && body.data && body.data.status_url,
    body && body.links && body.links.status,
  ];
  for (const c of cands) if (typeof c === 'string' && /^https?:\/\//.test(c)) return c;
  // VERIFIED 2026-10-26: GET /v1/job-sets/<jobSetId> is the ONE retrieval path that works.
  // The hyphen matters — /v1/job_sets/, /v1/jobs/<jobId>, /v1/generations/ and every POST
  // variant all return 405 or model_not_found. The submit response's top-level `id` is the
  // JOB SET id (not the job id), and that is what this path takes.
  return id ? (BASE + '/v1/job-sets/' + id) : null;
}

async function pollJob(fetchImpl, statusUrl, creds, maxAttempts, sleep) {
  for (let i = 0; i < maxAttempts; i++) {
    await sleep(POLL_INTERVAL_MS);
    const res = await fetchImpl(statusUrl, { method: 'GET', headers: headers(creds) });
    let body = null;
    try { body = await res.json(); } catch (_) { body = null; }
    if (!res.ok) {
      if (PERMANENT_HTTP.has(res.status)) {
        return { ok: false, error: 'status url ' + statusUrl + ' returned HTTP ' + res.status + ' (' + errText(body) + ') — not a transient failure, so polling stops here' };
      }
      continue;                       // 5xx / network blip: keep polling
    }
    const st = String(pickStatus(body) || '').toLowerCase();
    const url = pickUrl(body);
    if (url) return { ok: true, url, status: st };
    if (/fail|error|cancel|nsfw|reject/.test(st)) {
      return { ok: false, error: 'Higgsfield job ' + st + ': ' + errText(body) };
    }
  }
  return { ok: false, error: 'Higgsfield job did not finish within ' + Math.round(maxAttempts * POLL_INTERVAL_MS / 1000) + 's' };
}

/* generateVideo — text prompt to an MP4 buffer. Returns { ok, buffer, ... } or
   { ok:false, error, outOfCredits }. Injected fetch/sleep so tests never touch the network. */
async function generateVideo(opts) {
  const o = opts || {};
  const fetchImpl = o.fetch || globalThis.fetch;
  const sleep = o.sleep || (ms => new Promise(r => setTimeout(r, ms)));
  const creds = credentials(o.env);
  if (!creds) {
    return { ok: false, error: 'Higgsfield needs HF_CREDENTIALS or HF_KEY as "KEY_ID:KEY_SECRET" in the sidecar environment' };
  }
  const prompt = String(o.prompt || '').trim();
  if (prompt.length < 10) return { ok: false, error: 'prompt must be at least 10 characters' };

  const ratio = o.aspect_ratio || '9:16';
  const size = o.width_and_height || SIZE_FOR_RATIO[ratio] || SIZE_FOR_RATIO['9:16'];
  if (SIZES.indexOf(size) === -1) {
    return { ok: false, error: 'width_and_height must be one of: ' + SIZES.join(', ') };
  }
  const negative = String(o.negative_prompt || '').trim();
  const maxAttempts = o.maxPollAttempts || MAX_POLL_ATTEMPTS;

  // Higgsfield has no negative_prompt field on these endpoints, so the exclusions have to
  // ride in the prompt text or they are silently dropped.
  const promptWithNeg = negative ? (prompt + ' Do not include: ' + negative + '.') : prompt;

  // --- Step 1: still frame -------------------------------------------------------------
  const img = await submit(fetchImpl, '/v1/text2image/soul', { prompt: promptWithNeg, width_and_height: size }, creds);
  if (!img.ok) return { ok: false, error: 'stage 1 (text2image/soul) — ' + img.error, outOfCredits: img.outOfCredits, stage: 'text2image' };

  let imageUrl = pickUrl(img.body);
  const imgId = pickId(img.body);
  if (!imageUrl && imgId) {
    const polled = await pollJob(fetchImpl, pickStatusUrl(img.body, imgId), creds, maxAttempts, sleep);
    if (!polled.ok) return { ok: false, error: 'stage 1 — ' + polled.error, stage: 'text2image' };
    imageUrl = polled.url;
  }
  if (!imageUrl) {
    return { ok: false, error: 'stage 1 returned no image url and no job id; body: ' + JSON.stringify(img.body).slice(0, 200), stage: 'text2image' };
  }

  // --- Step 2: animate it --------------------------------------------------------------
  const vid = await submit(fetchImpl, '/v1/image2video/dop', { prompt: promptWithNeg, input_images: [imageUrl] }, creds);
  if (!vid.ok) return { ok: false, error: 'stage 2 (image2video/dop) — ' + vid.error, outOfCredits: vid.outOfCredits, stage: 'image2video' };

  let videoUrl = pickUrl(vid.body);
  const vidId = pickId(vid.body);
  if (!videoUrl && vidId) {
    const polled = await pollJob(fetchImpl, pickStatusUrl(vid.body, vidId), creds, maxAttempts, sleep);
    if (!polled.ok) return { ok: false, error: 'stage 2 — ' + polled.error, stage: 'image2video' };
    videoUrl = polled.url;
  }
  if (!videoUrl) {
    return { ok: false, error: 'stage 2 returned no video url and no job id; body: ' + JSON.stringify(vid.body).slice(0, 200), stage: 'image2video' };
  }

  const dl = await fetchImpl(videoUrl, { method: 'GET' });
  if (!dl.ok) return { ok: false, error: 'video download failed (HTTP ' + dl.status + ')' };
  const buffer = Buffer.from(await dl.arrayBuffer());

  return { ok: true, buffer, bytes: buffer.length, videoUrl, imageUrl, provider: 'higgsfield', width_and_height: size, aspect_ratio: ratio };
}

module.exports = { generateVideo, credentials, isOutOfCredits, errText, pickUrl, pickId, pickStatus, pickStatusUrl, firstJob, SIZES, SIZE_FOR_RATIO, BASE };

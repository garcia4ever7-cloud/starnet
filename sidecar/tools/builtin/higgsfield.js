/* sidecar/tools/builtin/higgsfield.js — STUDIO capability: higgsfield.generate(prompt)

   Image generation via Higgsfield's platform REST API with polling. Credentials read from
   HF_CREDENTIALS environment variable ("KEY_ID:KEY_SECRET" format) or HF_API_KEY + HF_API_SECRET
   separately.

   WHY A TWO-STEP PIPELINE: Higgsfield's platform API has NO text2video endpoint; text->image is a
   single step: POST /v1/text2image/soul, then poll /v1/job-sets/<id>. Every field below was probed
   against the live API (a wrong guess returns model_not_found or a 422 listing the required fields,
   and neither costs credits):

     base  : https://platform.higgsfield.ai   (NOT api.higgsfield.ai)
     auth  : hf-api-key: <KEY_ID>  +  hf-secret: <KEY_SECRET>   two headers.
             NOT `Authorization: Key id:secret` — that returns Invalid credentials.
     creds : HF_CREDENTIALS / HF_KEY = "KEY_ID:KEY_SECRET"
     poll  : GET /v1/job-sets/<jobSetId> — the ONE working retrieval path. The top-level `id`
             in the submit response IS the job-set id. Every other GET path returns 405.

   The tool submits a job, polls for completion, and downloads the result
   into the agent's workspace. Integrates with the print-prep pipeline for Etsy publishing.
*/
'use strict';
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./fs.js'));
  else { root.SK = root.SK || {}; root.SK.tools = root.SK.tools || {}; (root.SK.tools.builtin = root.SK.tools.builtin || {}).higgsfield = factory(root.SK.tools.builtin.fs); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (fsMod) {
  'use strict';

  const MAX_POLL_SECONDS = 120;     // 2 minute timeout for generation
  const POLL_INTERVAL_MS = 2000;    // check every 2 seconds
  const MAX_IMAGE_BYTES = 50 * 1024 * 1024;  // 50MB limit (generous for quality images)

  // Higgsfield's platform API base. The old api.higgsfield.ai base returns model_not_found.
  const DEFAULT_HF_BASE = 'https://platform.higgsfield.ai';

  /* Split "KEY_ID:KEY_SECRET" into the two headers the platform API wants. */
  function parseCredentials(env) {
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
  /* Flatten a Higgsfield error body ({detail: string} or FastAPI 422 list) into one line. */
  function errText(body) {
    if (!body) return 'no body';
    const d = body.detail;
    if (typeof d === 'string') return d;
    if (Array.isArray(d)) return d.map(x => ((x.loc || []).join('.') + ': ' + x.msg)).join('; ');
    return JSON.stringify(body).slice(0, 300);
  }
  function pickId(body) {
    if (!body) return null;
    return body.id || body.job_id || body.request_id
      || (body.data && (body.data.id || body.data.job_id)) || null;
  }
  function firstJob(body) {
    const jobs = body && Array.isArray(body.jobs) ? body.jobs : null;
    return jobs && jobs.length ? jobs[0] : null;
  }
  function pickUrl(body) {
    if (!body) return null;
    const job = firstJob(body);
    const r = (job && job.results) || null;
    const cands = [
      r && r.raw && r.raw.url,
      r && r.url,
      r && r.min && r.min.url,
      body.url, body.result_url, body.output_url,
      body.result && body.result.url,
      body.data && body.data.url,
    ];
    for (const c of cands) if (typeof c === 'string' && /^https?:\/\//.test(c)) return c;
    return null;
  }
  function pickStatusUrl(body, id) {
    const cands = [
      body && body.status_url,
      body && body.statusUrl,
      body && body.data && body.data.status_url,
      body && body.links && body.links.status,
    ];
    for (const c of cands) if (typeof c === 'string' && /^https?:\/\//.test(c)) return c;
    return id ? (DEFAULT_HF_BASE + '/v1/job-sets/' + id) : null;
  }
  // Only text2image step exists on this surface; animating to video is image2video/dop
  // (handled by sidecar/higgsfield-video.js), so image generation is a single submit+poll.
  const DEFAULT_HF_ENDPOINT = '/v1/text2image/soul';

  function makeHiggsfieldTools(deps) {
    deps = deps || {};
    const fsp = deps.fsp, P = deps.pathMod, ROOT = deps.root;
    if (!fsp || !P || !ROOT) throw new Error('higgsfield.js requires { fsp, pathMod, root }');
    const doFetch = deps.fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    if (!doFetch) throw new Error('higgsfield.js requires global fetch (Node 18+) or deps.fetchImpl');

    // Reuse the workspace jail (fs.js) so generated paths can't escape the agent's directory
    const jail = fsMod.makeFsTools({ fsp, pathMod: P, root: ROOT })._internals;

    function emitDeliverable(ctx, agentId, relPath) {
      if (!ctx || typeof ctx.emit !== 'function') return;
      const d = {
        id: 'hf_' + String(relPath).replace(/[^A-Za-z0-9_.-]/g, '_'),
        agentId: agentId,
        kind: 'image',
        title: String(relPath)
      };
      if (ctx.room) d.room = ctx.room;
      ctx.emit('deliverable', d);
    }

    // Submit a generation job to Higgsfield and return the job-set id + status URL to poll.
    // The submit response's top-level `id` IS the job-set id; polling reads GET /v1/job-sets/<id>.
    async function submitJob(prompt, endpoint, aspectRatio, timeoutMs, signal) {
      const creds = parseCredentials();
      if (!creds) throw new Error('Higgsfield needs HF_CREDENTIALS="KEY_ID:KEY_SECRET" or HF_API_KEY + HF_API_SECRET in environment');

      const url = DEFAULT_HF_BASE + (endpoint || DEFAULT_HF_ENDPOINT);
      // width_and_height is a closed enum on this API; pass the requested aspect through to it.
      const params = { prompt: String(prompt || '').trim() };
      if (aspectRatio && aspectRatio.trim()) params.width_and_height = aspectRatio.trim();

      let body = null;
      try {
        const res = await doFetch(url, {
          method: 'POST',
          headers: headers(creds),
          body: JSON.stringify({ params }),
          signal
        });
        try { body = await res.json(); } catch (_) { body = null; }
        if (!res.ok) {
          throw new Error(`Higgsfield submission failed (HTTP ${res.status}): ${errText(body)}`);
        }
        const id = pickId(body);
        if (!id) {
          throw new Error(`Higgsfield submission returned no job-set id: ${JSON.stringify(body).slice(0, 200)}`);
        }
        return { jobSetId: id, statusUrl: pickStatusUrl(body, id) || DEFAULT_HF_BASE + '/v1/job-sets/' + id };
      } catch (e) {
        if (e && e.name === 'AbortError') throw e;
        throw new Error(`Higgsfield submission error: ${(e && e.message) || e}`);
      }
    }

    // Poll the job-set URL until completion, failure, or timeout.
    // Status and result live on the per-JOB record inside `jobs[0]`, never at top level.
    async function pollUntilDone(statusUrl, creds, timeoutMs, signal) {
      const maxAttempts = Math.ceil(timeoutMs / POLL_INTERVAL_MS);
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
        try {
          const res = await doFetch(statusUrl, { method: 'GET', headers: headers(creds), signal });
          let body = null;
          try { body = await res.json(); } catch (_) { body = null; }
          if (!res.ok) {
            throw new Error(`Status check failed (HTTP ${res.status}): ${errText(body)}`);
          }
          const job = firstJob(body);
          const status = String(job && job.status || '').toLowerCase();
          const url = pickUrl(body);
          if (url) return { imageUrl: url, status: body };
          if (/fail|error|cancel|nsfw|reject/.test(status)) {
            throw new Error(`Higgsfield job ${status || 'failed'}: ${errText(body)}`);
          }
          // queued / in_progress / undefined -> keep polling
        } catch (e) {
          if (e && e.name === 'AbortError') throw e;
          if (String((e && e.message) || '').indexOf('Status check failed') >= 0) throw e;
          throw e;
        }
      }
      throw new Error(`Higgsfield generation timed out after ${timeoutMs}ms (${maxAttempts} polls)`);
    }

    // Download image from URL and save to workspace
    async function downloadImage(imageUrl, agentId, filename, signal) {
      try {
        const res = await doFetch(imageUrl, { signal });
        if (!res.ok) {
          throw new Error(`Image download failed (HTTP ${res.status})`);
        }

        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > MAX_IMAGE_BYTES) {
          throw new Error(`Downloaded image too large (${buf.length} bytes, max ${MAX_IMAGE_BYTES})`);
        }

        // Write to agent's workspace
        const { abs: absPath } = await jail.resolveInside(agentId, filename);
        await fsp.mkdir(P.dirname(absPath), { recursive: true });
        await fsp.writeFile(absPath, buf);

        return { path: filename, size: buf.length, url: imageUrl };
      } catch (e) {
        if (e && e.name === 'AbortError') throw e;
        throw new Error(`Image download error: ${(e && e.message) || e}`);
      }
    }

    const generateTool = {
      name: 'higgsfield.generate',
      capability: 'studio',
      scope: 'write',
      requiresConsent: true,
      timeoutMs: (MAX_POLL_SECONDS + 30) * 1000,  // poll timeout + buffer
      description: 'Generate an image via Higgsfield AI. Requires HF_CREDENTIALS or HF_API_KEY+HF_API_SECRET in environment. ' +
        'The prompt is required; aspect_ratio and endpoint can be customized. Generated image is saved to workspace as a PNG. ' +
        'Supports text-to-image endpoints like "flux-pro/kontext/max/text-to-image" (default) and others.',
      schema: {
        type: 'object',
        required: ['prompt'],
        properties: {
          prompt: {
            type: 'string',
            description: 'The image generation prompt (required)'
          },
          aspect_ratio: {
            type: 'string',
            description: 'Aspect ratio like "1:1", "4:3", "16:9", "9:16", etc. (default: "4:3")'
          },
          endpoint: {
            type: 'string',
            description: 'Higgsfield endpoint path, e.g. "flux-pro/kontext/max/text-to-image" (default is used if omitted)'
          },
          filename: {
            type: 'string',
            description: 'Workspace filename to save as (default: generated name like "higgsfield-gen-<timestamp>.png")'
          }
        }
      },
      run: async (args, ctx) => {
        const agentId = (ctx && ctx.agentId) || 'agent';
        const prompt = String(args.prompt || '').trim();
        if (!prompt) throw new Error('prompt is required');

        const aspectRatio = String(args.aspect_ratio || '').trim() || '4:3';
        const endpoint = String(args.endpoint || '').trim() || DEFAULT_HF_ENDPOINT;
        // Deterministic default name (content-addressed on prompt+endpoint, no ambient clock —
        // see lint-determinism.js). Two identical prompts produce the same name, so re-running is
        // idempotent rather than piling up files.
        const filename = String(args.filename || '').trim()
          || 'images/higgsfield-' + require('node:crypto').createHash('sha1')
            .update(prompt + '|' + endpoint).digest('hex').slice(0, 12) + '.png';

        // Validate filename is safe
        if (filename.includes('..') || filename.startsWith('/') || filename.includes('\0')) {
          throw new Error('invalid filename');
        }

        const signal = (ctx && ctx.signal) || null;

        try {
          // Step 1: Submit generation job
          const { jobSetId, statusUrl } = await submitJob(
            prompt,
            endpoint,
            aspectRatio,
            (MAX_POLL_SECONDS + 10) * 1000,
            signal
          );

          // Step 2: Poll until done (no second credentials read — already validated above)
          const { imageUrl } = await pollUntilDone(
            statusUrl,
            parseCredentials(),
            MAX_POLL_SECONDS * 1000,
            signal
          );

          // Step 3: Download image to workspace
          const result = await downloadImage(imageUrl, agentId, filename, signal);

          // Emit deliverable event for the UI
          emitDeliverable(ctx, agentId, filename);

          return {
            content: `Generated image saved to workspace: ${filename}`,
            summary: `Higgsfield image generated (${result.size} bytes)`,
            detail: {
              filename: result.path,
              size: result.size,
              request_id: jobSetId,
              source_url: result.url
            }
          };
        } catch (e) {
          if (e && e.name === 'AbortError') throw new Error('Higgsfield generation cancelled');
          throw e;
        }
      }
    };

    return {
      generateTool,
      _internals: { submitJob, pollUntilDone, downloadImage, parseCredentials, headers, errText, pickId, firstJob, pickUrl, pickStatusUrl },
      register(reg) {
        reg.register(generateTool);
        return reg;
      }
    };
  }

  return { makeHiggsfieldTools };
});

/* sidecar/tools/builtin/higgsfield.js — STUDIO capability: higgsfield.generate(prompt)

   Image generation via Higgsfield's REST API with polling. Credentials read from HF_CREDENTIALS
   environment variable (KEY_ID:KEY_SECRET format) or HF_API_KEY + HF_API_SECRET separately.

   The tool submits a job, polls for completion (up to 2 minutes), and downloads the result
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

  // Higgsfield's default endpoint for v2 API
  const DEFAULT_HF_BASE = 'https://api.higgsfield.ai';
  // Common text-to-image endpoint; can be overridden via args
  const DEFAULT_HF_ENDPOINT = 'flux-pro/kontext/max/text-to-image';

  function makeHiggsfieldTools(deps) {
    deps = deps || {};
    const fsp = deps.fsp, P = deps.pathMod, ROOT = deps.root;
    if (!fsp || !P || !ROOT) throw new Error('higgsfield.js requires { fsp, pathMod, root }');
    const doFetch = deps.fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    if (!doFetch) throw new Error('higgsfield.js requires global fetch (Node 18+) or deps.fetchImpl');

    // Read credentials from environment: HF_CREDENTIALS (preferred) or HF_API_KEY + HF_API_SECRET
    function getCredentials() {
      let creds = process.env.HF_CREDENTIALS || '';
      if (!creds && process.env.HF_API_KEY && process.env.HF_API_SECRET) {
        creds = process.env.HF_API_KEY + ':' + process.env.HF_API_SECRET;
      }
      if (!creds) {
        throw new Error('Higgsfield generation requires HF_CREDENTIALS="KEY_ID:KEY_SECRET" or HF_API_KEY + HF_API_SECRET in environment');
      }
      return creds.trim();
    }

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

    // Submit a generation job to Higgsfield and return the request_id + status_url
    async function submitJob(prompt, endpoint, aspectRatio, timeoutMs, signal) {
      const creds = getCredentials();
      const baseUrl = DEFAULT_HF_BASE;
      const url = `${baseUrl}/v2/requests`;

      const payload = {
        endpoint: endpoint || DEFAULT_HF_ENDPOINT,
        input: {
          prompt: String(prompt || '').trim(),
          aspect_ratio: aspectRatio || '4:3'
        },
        withPolling: false  // We'll handle polling ourselves
      };

      try {
        const res = await doFetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Key ${creds}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload),
          signal
        });

        if (!res.ok) {
          const text = await res.text();
          throw new Error(`Higgsfield submission failed (HTTP ${res.status}): ${text.slice(0, 200)}`);
        }

        const data = await res.json();
        if (!data.request_id || !data.status_url) {
          throw new Error(`Higgsfield submission returned invalid response: ${JSON.stringify(data).slice(0, 200)}`);
        }

        return { request_id: data.request_id, status_url: data.status_url };
      } catch (e) {
        if (e && e.name === 'AbortError') throw e;
        throw new Error(`Higgsfield submission error: ${(e && e.message) || e}`);
      }
    }

    // Poll status_url until completion, failure, or timeout
    async function pollUntilDone(statusUrl, creds, timeoutMs, signal) {
      const startTime = Date.now();
      const deadline = startTime + timeoutMs;
      let attempts = 0;

      while (true) {
        attempts++;
        if (Date.now() > deadline) {
          throw new Error(`Higgsfield generation timed out after ${timeoutMs}ms (${attempts} polls)`);
        }

        try {
          const res = await doFetch(statusUrl, {
            method: 'GET',
            headers: { 'Authorization': `Key ${creds}` },
            signal
          });

          if (!res.ok) {
            const text = await res.text();
            throw new Error(`Status check failed (HTTP ${res.status}): ${text.slice(0, 200)}`);
          }

          const data = await res.json();
          const status = data.status || 'unknown';

          if (status === 'completed') {
            // Extract image URL from response
            let imageUrl = null;
            if (data.images && Array.isArray(data.images) && data.images[0]) {
              imageUrl = data.images[0].url || null;
            }
            if (!imageUrl && data.image) {
              imageUrl = data.image.url || data.image;
            }
            if (!imageUrl) {
              throw new Error(`Generation completed but no image URL in response: ${JSON.stringify(data).slice(0, 300)}`);
            }
            return { imageUrl, status: data };
          } else if (status === 'failed' || status === 'nsfw') {
            const reason = data.error || data.message || 'generation failed';
            throw new Error(`Higgsfield ${status}: ${reason}`);
          } else if (status === 'queued' || status === 'in_progress') {
            // Still processing; wait and retry
            await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
            continue;
          } else {
            throw new Error(`Unknown status "${status}": ${JSON.stringify(data).slice(0, 300)}`);
          }
        } catch (e) {
          if (e && e.name === 'AbortError') throw e;
          throw e;
        }
      }
    }

    // Download image from URL and save to workspace
    async function downloadImage(imageUrl, agentId, filename, signal) {
      try {
        const res = await doFetch(imageUrl, { signal });
        if (!res.ok) {
          throw new Error(`Image download failed (HTTP ${res.status})`);
        }

        const buf = await res.buffer();
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
        const filename = String(args.filename || '').trim() || `higgsfield-gen-${Date.now()}.png`;

        // Validate filename is safe
        if (filename.includes('..') || filename.startsWith('/') || filename.includes('\0')) {
          throw new Error('invalid filename');
        }

        const signal = (ctx && ctx.signal) || null;

        try {
          // Step 1: Submit generation job
          const { request_id, status_url } = await submitJob(
            prompt,
            endpoint,
            aspectRatio,
            (MAX_POLL_SECONDS + 10) * 1000,
            signal
          );

          // Step 2: Poll until done
          const creds = getCredentials();
          const { imageUrl } = await pollUntilDone(
            status_url,
            creds,
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
              request_id,
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
      _internals: { submitJob, pollUntilDone, downloadImage, getCredentials },
      register(reg) {
        reg.register(generateTool);
        return reg;
      }
    };
  }

  return { makeHiggsfieldTools };
});

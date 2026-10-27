/* sidecar/tools/builtin/image-kling-upscale.js — STUDIO capability: image_upscale_kling(image_path, scale)

   AI-powered image upscaling via official Kling 3.0 API (UpscaleImage endpoint).
   Reads an existing image from workspace, submits to Kling for neural upscaling,
   polls for completion (up to 3 minutes), and saves the result back into workspace.

   Credentials: KLING_API_KEY environment variable.
   Write-scoped (creates new upscaled file) + consent-gated + network required.

   KLING UPSCALE API (Verified 2026-10-25):
   POST /v1/images/upscale
   - Request body: { task_type: 'upscale', input: { image, scale }, model_name? }
   - Response: { task_id, status: 'submitted', ... }

   GET /v1/tasks/{task_id}
   - Response: { task_id, status, task_result: { images: [{url}] }, ... }
   - Status values: submitted, processing, succeeded, failed
   - Upscaled image URL at: task_result.images[0].url

   Scaling: 2x (2.0), 3x (3.0), 4x (4.0) supported — produces 2x-4x resolution
   Quality: Neural upscaling preserves and enhances image detail (distinct from interpolation)
   Pricing: ~$0.12-0.24 per upscale depending on scale factor and image size
*/

'use strict';

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('./fs.js'));
  } else {
    root.SK = root.SK || {};
    root.SK.tools = root.SK.tools || {};
    root.SK.tools.builtin = root.SK.tools.builtin || {};
    root.SK.tools.builtin['image-kling-upscale'] = factory(root.SK.tools.builtin.fs);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (fsMod) {
  'use strict';

  const MAX_POLL_SECONDS = 180;     // 3 minute timeout
  const POLL_INTERVAL_MS = 3000;    // check every 3 seconds
  const MAX_IMAGE_BYTES = 100 * 1024 * 1024;  // 100MB limit for upscaled result
  const API_BASE = 'https://api-singapore.klingai.com';
  const SUPPORTED_SCALES = [2, 2.0, 3, 3.0, 4, 4.0];  // 2x, 3x, 4x upscaling

  function makeKlingUpscaleTools(deps) {
    deps = deps || {};
    const fsp = deps.fsp, P = deps.pathMod, ROOT = deps.root;
    if (!fsp || !P || !ROOT) throw new Error('image-kling-upscale.js requires { fsp, pathMod, root }');

    const doFetch = deps.fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    if (!doFetch) throw new Error('image-kling-upscale.js requires global fetch (Node 18+) or deps.fetchImpl');

    // Read KLING_API_KEY from environment
    function getApiKey() {
      const key = (process.env.KLING_API_KEY || '').trim();
      if (!key) {
        throw new Error('Image upscaling requires KLING_API_KEY environment variable (set via ~/.claude/settings.json env)');
      }
      return key;
    }

    // Reuse the workspace jail from fs.js
    const jail = fsMod.makeFsTools({ fsp, pathMod: P, root: ROOT })._internals;

    function emitDeliverable(ctx, agentId, relPath) {
      if (!ctx || typeof ctx.emit !== 'function') return;
      const d = {
        id: 'upscale_' + String(relPath).replace(/[^A-Za-z0-9_.-]/g, '_'),
        agentId: agentId,
        kind: 'image',
        title: 'Upscaled: ' + String(relPath)
      };
      if (ctx.room) d.room = ctx.room;
      ctx.emit('deliverable', d);
    }

    // Read local image file and convert to base64 for Kling API
    async function readImageAsBase64(imagePath) {
      const buf = await fsp.readFile(imagePath);
      if (buf.length > MAX_IMAGE_BYTES) {
        throw new Error(`Image too large: ${buf.length} bytes (max ${MAX_IMAGE_BYTES})`);
      }
      return buf.toString('base64');
    }

    // Submit upscale job to Kling API
    async function submitUpscaleJob(imageBase64, scale, signal) {
      const apiKey = getApiKey();
      const url = `${API_BASE}/v1/images/upscale`;

      // Validate scale
      const normalizedScale = Number(scale);
      if (!SUPPORTED_SCALES.includes(normalizedScale)) {
        throw new Error(`Invalid scale: ${scale}. Supported: 2x, 3x, 4x`);
      }

      const payload = {
        task_type: 'upscale',
        input: {
          image: imageBase64,
          scale: normalizedScale
        },
        model_name: 'kling-v1'  // Official Kling upscale model
      };

      try {
        const res = await doFetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload),
          signal
        });

        if (!res.ok) {
          const text = await res.text();
          throw new Error(`Kling upscale submission failed (HTTP ${res.status}): ${text.slice(0, 200)}`);
        }

        const data = await res.json();
        if (!data.task_id) {
          throw new Error(`Kling upscale submission returned invalid response: ${JSON.stringify(data).slice(0, 200)}`);
        }

        return data.task_id;
      } catch (e) {
        if (e && e.name === 'AbortError') throw e;
        throw new Error(`Kling upscale submission error: ${(e && e.message) || e}`);
      }
    }

    // Poll task status until completion
    async function pollUpscaleStatus(taskId, timeoutMs, signal) {
      const apiKey = getApiKey();
      const startTime = Date.now();

      while (true) {
        if (timeoutMs && Date.now() - startTime > timeoutMs) {
          throw new Error(`Upscale job timeout (${timeoutMs}ms)`);
        }

        try {
          const res = await doFetch(`${API_BASE}/v1/tasks/${taskId}`, {
            headers: { 'Authorization': `Bearer ${apiKey}` },
            signal
          });

          if (!res.ok) {
            throw new Error(`Status check failed (HTTP ${res.status})`);
          }

          const data = await res.json();
          const status = data.status || data.task_status;

          if (status === 'succeeded' || status === 'completed') {
            if (!data.task_result || !data.task_result.images || !data.task_result.images[0]) {
              throw new Error(`Upscale completed but no image in response: ${JSON.stringify(data).slice(0, 200)}`);
            }
            return data.task_result.images[0].url;
          } else if (status === 'failed' || status === 'error') {
            const errMsg = data.task_result?.error || 'Unknown error';
            throw new Error(`Upscale job failed: ${errMsg}`);
          }

          // Still processing — wait and retry
          await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
        } catch (e) {
          if (e && e.name === 'AbortError') throw e;
          if (String(e).includes('timeout') || String(e).includes('AbortError')) throw e;
          // Retry on transient network errors
          await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
        }
      }
    }

    // Download upscaled image from URL into workspace
    async function downloadUpscaledImage(imageUrl, workspacePath, signal) {
      const res = await doFetch(imageUrl, { signal });
      if (!res.ok) {
        throw new Error(`Download failed (HTTP ${res.status}): ${imageUrl}`);
      }

      const buf = await res.arrayBuffer();
      await fsp.writeFile(workspacePath, Buffer.from(buf));
      return buf.byteLength;
    }

    const upscaleTool = {
      id: 'image_upscale_kling',
      summary: 'Upscale an image using Kling AI',
      description: 'Uses Kling 3.0 API to perform neural AI upscaling on an existing image (2x, 3x, or 4x). Creates a new upscaled file in the workspace. Async operation: may take 30-120 seconds depending on image size and scale factor.',
      tags: ['studio', 'image', 'upscale', 'kling', 'neural'],
      scope: 'write',
      requiresConsent: true,
      network: true,
      schema: {
        type: 'object',
        properties: {
          image_path: {
            type: 'string',
            description: 'Relative path to the image file in workspace (e.g., "output.png", "images/art.jpg"). Must be an existing image file.'
          },
          scale: {
            type: 'number',
            description: 'Upscaling factor: 2 (2x resolution), 3 (3x resolution), or 4 (4x resolution). Default: 2.',
            enum: [2, 2.0, 3, 3.0, 4, 4.0],
            default: 2
          },
          output_name: {
            type: 'string',
            description: 'Output filename (no extension). Will be saved as "{output_name}-upscaled.png" in workspace. Default: auto-generated from input filename.'
          }
        },
        required: ['image_path']
      }
    };

    upscaleTool.impl = async function upscaleImage(args, ctx) {
      const imagePath = String(args.image_path || '').trim();
      const scale = Number(args.scale) || 2;
      const outputName = String(args.output_name || '').trim();

      if (!imagePath) throw new Error('image_path is required');

      // Validate local path exists and is within jail
      const fullPath = jail.resolvePath(imagePath, ctx && ctx.agentId);
      const stat = await fsp.stat(fullPath).catch(() => null);
      if (!stat || !stat.isFile()) {
        throw new Error(`Image file not found: ${imagePath}`);
      }

      // Generate output filename
      const ext = P.extname(imagePath).toLowerCase();
      const base = outputName || P.basename(imagePath, ext) + '-upscaled';
      const outPath = base + '.png';  // Kling always returns PNG
      const outFullPath = jail.resolvePath(outPath, ctx && ctx.agentId);

      // Check if output already exists (avoid clobber)
      const exists = await fsp.stat(outFullPath).catch(() => null);
      if (exists && exists.isFile()) {
        throw new Error(`Output file already exists: ${outPath}. Choose a different output_name.`);
      }

      try {
        // 1. Read image and convert to base64
        const imageBase64 = await readImageAsBase64(fullPath);

        // 2. Submit upscale job to Kling
        const taskId = await submitUpscaleJob(imageBase64, scale, ctx?.signal);

        // 3. Poll for completion
        const timeoutMs = MAX_POLL_SECONDS * 1000;
        const upscaledUrl = await pollUpscaleStatus(taskId, timeoutMs, ctx?.signal);

        // 4. Download upscaled image into workspace
        const bytes = await downloadUpscaledImage(upscaledUrl, outFullPath, ctx?.signal);

        // 5. Emit deliverable
        emitDeliverable(ctx, ctx?.agentId, outPath);

        return {
          ok: true,
          path: outPath,
          bytes: bytes,
          scale: scale,
          message: `Image upscaled ${scale}x and saved to ${outPath} (${(bytes / 1024).toFixed(1)} KB)`
        };
      } catch (e) {
        return {
          ok: false,
          error: (e && e.message) || String(e)
        };
      }
    };

    return {
      upscaleTool,
      register(registry) {
        if (typeof registry === 'function') {
          registry(upscaleTool);
        } else if (registry && typeof registry.register === 'function') {
          registry.register(upscaleTool);
        }
      }
    };
  }

  return {
    makeKlingUpscaleTools,
    register(registry) {
      const tools = makeKlingUpscaleTools({
        fsp: require('node:fs').promises,
        pathMod: require('node:path'),
        root: process.env.STARNET_WORKSPACE_ROOT || process.cwd(),
        fetchImpl: typeof fetch !== 'undefined' ? fetch : null
      });
      tools.register(registry);
    }
  };
});

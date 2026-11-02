/* sidecar/tools/builtin/openai-image.js — STUDIO capability: openai_image_generate(prompt)

   DEDICATED, ISOLATED utility that renders through OpenAI's /v1/images/generations
   (gpt-image-2 / gpt-image-2.5-* / dall-e-2 family). It does NOT touch the default studio
   route (image_generate rides OpenRouter/Gemini first); an explicit openai_image_generate
   call is the only way this tool fires — default visual routing is unchanged.

   Credentials come from OPENAI_API_KEY in the sidecar process environment, resolved
   independently of Higgsfield (HF_CREDENTIALS) and OpenRouter (OPENROUTER_API_KEY)
   via providerRuntimeKey('openai', '') at the call site (sidecar/index.js).

   makeOpenAIImageTools({ fsp, pathMod, root, fetchImpl?, openaiApiKey?,
                          openaiBaseUrl?, imageModel?, onUsage?, signal? })
     -> { generateTool, register(reg), _internals }

   Node 18+ (global fetch). No dependencies. Reuses the fs.js workspace jail so a
   generated path can never escape <root>/<agentId>/. Outputs are written into the
   agent's workspace and emitted as a 'deliverable' event — mapped directly to
   StarNet's local output registry, never to a third-party asset store.

   OpenAI Images API protocol:
     POST https://api.openai.com/v1/images/generations
     Authorization: Bearer <OPENAI_API_KEY>
     Body: { model, prompt, n, size, quality? }

   Supported models: gpt-image-2, gpt-image-2.5-flare (default, strict upgrade at same
   price), gpt-image-2.5-sunburst (slower, higher cost, opt-in via args.model), dall-e-*.
   response_format is NOT sent — OpenAI's Images API rejects it. b64_json responses are
   decoded inline and saved into the workspace without a second network hop to a hosted
   URL. url-form responses are downloaded and saved the same way. */
'use strict';
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./fs.js'));
  else { root.SK = root.SK || {}; root.SK.tools = root.SK.tools || {}; (root.SK.tools.builtin = root.SK.tools.builtin || {}).openaiImage = factory(root.SK.tools.builtin.fs); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (fsMod) {
  'use strict';

  const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
  const DEFAULT_IMAGE_URL = DEFAULT_BASE_URL + '/images/generations';
  // Default model for this dedicated route. gpt-image-2.5-flare is the strict upgrade over
  // gpt-image-2 at the same price (verified in image.js's OPENAI_IMAGE_MODEL). Both
  // gpt-image-2.5-flare and gpt-image-2.5-sunburst pass the existing gpt-image-* model
  // validation regex; sunburst is left as an explicit opt-in via args.model.
  const OPENAI_IMAGE_MODEL = 'gpt-image-2.5-flare';
  const DEFAULT_SIZE = '1024x1024';
  const MAX_POLL_SECONDS = 120;   // generations complete in seconds, not minutes
  const MAX_IMAGE_BYTES = 50 * 1024 * 1024;

  const EXT_BY_MIME = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' };

  function sizeForAspect(aspectRatio) {
    const key = String(aspectRatio || '').trim().toLowerCase();
    const MAP = {
      '1:1': '1024x1024',
      '4:3': '1024x768',
      '3:4': '768x1024',
      '16:9': '1792x1024',
      '9:16': '1024x1792',
      '3:2': '1536x1024',
      '2:3': '1024x1536',
      '21:9': '1792x1024'
    };
    return MAP[key] || DEFAULT_SIZE;
  }

  // "data:image/png;base64,AAAA" -> { mime, buffer }
  function dataUrlToBuffer(url) {
    const m = /^data:([^;,]+)?(;base64)?,(.*)$/is.exec(String(url || ''));
    if (!m) throw new Error('not a data URL');
    const mime = (m[1] || 'image/png').toLowerCase();
    const isB64 = !!m[2];
    const buf = isB64 ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]), 'utf8');
    if (!buf.length) throw new Error('empty image data');
    return { mime, buffer: buf };
  }

  function makeOpenAIImageTools(deps) {
    deps = deps || {};
    const fsp = deps.fsp, P = deps.pathMod, ROOT = deps.root;
    if (!fsp || !P || !ROOT) throw new Error('openai-image.js requires { fsp, pathMod, root }');
    const doFetch = deps.fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    if (!doFetch) throw new Error('openai-image.js requires global fetch (Node 18+) or deps.fetchImpl');

    // Resolved once at the call site (sidecar/index.js) from OPENAI_API_KEY via
    // providerRuntimeKey('openai', '') — independent of HF_CREDENTIALS and OPENROUTER_API_KEY.
    const apiKey = String(deps.openaiApiKey || '').trim();
    const baseUrl = String(deps.openaiBaseUrl || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
    const imageUrl = baseUrl + '/images/generations';
    const configuredImageModel = String(deps.imageModel || '').trim();
    const IMAGE_MODEL = /^(?:gpt-image-|chatgpt-image-|dall-e-)/i.test(configuredImageModel)
      ? configuredImageModel : OPENAI_IMAGE_MODEL;
    const onUsage = typeof deps.onUsage === 'function' ? deps.onUsage : null;
    const globalSignal = deps.signal || null;

    // reuse the ONE workspace jail (fs.js) so generated paths can't escape the jail
    const jail = fsMod.makeFsTools({ fsp, pathMod: P, root: ROOT })._internals;

    function emitDeliverable(ctx, agentId, relPath) {
      if (!ctx || typeof ctx.emit !== 'function') return;
      const d = { id: 'oai_' + String(relPath).replace(/[^A-Za-z0-9_.-]/g, '_'), agentId: agentId, kind: 'image', title: String(relPath) };
      if (ctx.room) d.room = ctx.room;
      ctx.emit('deliverable', d);
    }

    async function postGenerate(body, signal) {
      const ctrl = new AbortController();
      const abort = () => ctrl.abort();
      if (signal) signal.addEventListener('abort', abort, { once: true });
      const t = setTimeout(abort, (MAX_POLL_SECONDS + 30) * 1000);
      try {
        const res = await doFetch(imageUrl, {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: ctrl.signal
        });
        const json = await res.json().catch(() => null);
        if (typeof onUsage === 'function' && (res.status >= 200 && res.status < 300 || json && json.usage)) {
          onUsage(normalizeUsage(json && json.usage), body.model);
        }
        if (res.status < 200 || res.status >= 300) {
          const errMsg = json && json.error && (json.error.message || json.error) || ('http ' + res.status);
          throw new Error('OpenAI ' + res.status + ': ' + (typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg)));
        }
        return json || {};
      } finally {
        clearTimeout(t);
        if (signal) signal.removeEventListener('abort', abort);
      }
    }

    // Normalize OpenAI Images API usage (input_tokens/output_tokens) into the shape the
    // cost engine reads (prompt_tokens/completion_tokens), mirroring image.js's
    // normalizeMediaUsage. Never overwrites a field the provider actually sent.
    function normalizeUsage(u) {
      if (!u || typeof u !== 'object') return u;
      const out = Object.assign({}, u);
      if (out.prompt_tokens == null) {
        const v = out.input_tokens != null ? out.input_tokens : u.promptTokenCount;
        if (v != null) out.prompt_tokens = v;
      }
      if (out.completion_tokens == null) {
        const v = out.output_tokens != null ? out.output_tokens : u.candidatesTokenCount;
        if (v != null) out.completion_tokens = v;
      }
      if (out.total_tokens == null && out.totalTokenCount != null) out.total_tokens = out.totalTokenCount;
      return out;
    }

    let publicationSequence = 0;

    /* openai_image_generate — text-to-image via OpenAI /v1/images/generations */
    const generateTool = {
      name: 'openai_image_generate',
      capability: 'studio',
      scope: 'write',
      requiresConsent: true,
      network: true,
      timeoutMs: (MAX_POLL_SECONDS + 30) * 1000,
      description: 'Generate an image via OpenAI\'s Images API (/v1/images/generations). ' +
        'Dedicated route: does not route through OpenRouter or Gemini, and does not change ' +
        'the default studio visual path (image_generate). Requires OPENAI_API_KEY in the ' +
        'sidecar environment, resolved independently of Higgsfield (HF_CREDENTIALS) and OpenRouter (OPENROUTER_API_KEY). ' +
        'Prompt is required; model/size/quality can be customized. Default model is ' +
        OPENAI_IMAGE_MODEL + '; pass model:"gpt-image-2.5-sunburst" for the slower, higher-' +
        'quality variant (costs more), or any gpt-image-*/dall-e-* model.',
      schema: {
        type: 'object',
        required: ['prompt'],
        properties: {
          prompt: {
            type: 'string',
            description: 'The image generation prompt (required)'
          },
          model: {
            type: 'string',
            description: 'OpenAI image model id (default ' + OPENAI_IMAGE_MODEL +
              '; gpt-image-2.5-sunburst, gpt-image-2, dall-e-* also supported)'
          },
          size: {
            type: 'string',
            description: 'Output size like "1024x1024", "1792x1024", "1024x1792", or "auto" (default 1024x1024)'
          },
          quality: {
            type: 'string',
            enum: ['low', 'medium', 'high', 'auto'],
            description: 'Generation quality: "low", "medium", "high", or "auto" (default auto)'
          },
          aspect_ratio: {
            type: 'string',
            description: 'Aspect ratio like "1:1", "16:9", "9:16" (overrides size; default 1:1)'
          },
          filename: {
            type: 'string',
            description: 'Workspace filename to save as (default: auto-generated content-addressed name)'
          }
        }
      },
      run: async (args, ctx) => {
        const agentId = (ctx && ctx.agentId) || 'agent';
        const prompt = String(args.prompt || '').trim();
        if (!prompt) throw new Error('prompt is required');

        const requestedModel = String(args.model || IMAGE_MODEL).trim();
        if (!/^(?:gpt-image-|chatgpt-image-|dall-e-)/i.test(requestedModel)) {
          throw new Error('model "' + requestedModel + '" is not an OpenAI image-output model (gpt-image-*/dall-e-*)');
        }
        const model = requestedModel;

        const quality = String(args.quality || 'auto').trim();
        if (quality && !/^(?:low|medium|high|auto)$/i.test(quality)) {
          throw new Error('quality must be one of: low, medium, high, auto');
        }

        let size = String(args.size || '').trim() || DEFAULT_SIZE;
        const aspect = String(args.aspect_ratio || '').trim();
        if (aspect) {
          size = sizeForAspect(aspect);
        }
        if (!/^(?:auto|\d+x\d+)$/i.test(size)) {
          throw new Error('size must be "auto" or WxH like "1024x1024"');
        }

        if (!apiKey) {
          throw new Error('openai_image_generate is unavailable: OPENAI_API_KEY is not configured in the sidecar environment. It is loaded independently of Higgsfield (HF_CREDENTIALS) and OpenRouter (OPENROUTER_API_KEY). No image was produced.');
        }

        const signal = (ctx && ctx.signal) || globalSignal || null;

        try {
          const body = { model, prompt, n: 1, size };
          if (quality && quality !== 'auto') body.quality = quality;

          const data = await postGenerate(body, signal);
          const item = data && Array.isArray(data.data) && data.data[0];
          if (!item) throw new Error('OpenAI Images API returned no image');

          let mime, buffer;
          if (item.b64_json) {
            const decoded = dataUrlToBuffer('data:image/png;base64,' + item.b64_json);
            mime = decoded.mime; buffer = decoded.buffer;
          } else if (item.url) {
            const res = await doFetch(item.url, { signal });
            if (!res.ok) throw new Error('could not download generated image (http ' + res.status + ')');
            mime = String(res.headers.get('content-type') || 'image/png').split(';')[0].toLowerCase();
            buffer = Buffer.from(await res.arrayBuffer());
          } else {
            throw new Error('OpenAI image returned neither b64_json nor a URL');
          }

          if (buffer.length > MAX_IMAGE_BYTES) {
            throw new Error('generated image too large (' + buffer.length + ' bytes, max ' + MAX_IMAGE_BYTES + ')');
          }

          const ext = EXT_BY_MIME[mime] || '.png';
          let rel = String(args.filename || '').trim();
          if (rel) {
            if (!/\.[a-z0-9]+$/i.test(rel)) rel += ext;
          } else {
            const h = require('node:crypto').createHash('sha1').update(buffer).digest('hex').slice(0, 12);
            rel = 'images/gen-' + h + ext;
          }
          if (rel.includes('..') || rel.startsWith('/') || rel.includes('\0')) {
            throw new Error('invalid filename');
          }

          const { abs } = await jail.resolveInside(agentId, rel);
          await fsp.mkdir(P.dirname(abs), { recursive: true });
          // Stage bytes separately: abort during a write must not truncate an existing output.
          const staging = abs + '.pending-' + process.pid + '-' + (++publicationSequence);
          try {
            await fsp.writeFile(staging, buffer, { flag: 'wx' });
            require('node:fs').renameSync(staging, abs);
            emitDeliverable(ctx, agentId, rel);
          } finally {
            await fsp.unlink(staging).catch(e => {
              if (!e || e.code !== 'ENOENT') require('../../failopen.js').note('openai-image.staging-cleanup', e);
            });
          }

          const kb = (buffer.length / 1024).toFixed(0) + ' KB';
          return {
            content: 'Generated and saved ' + rel + ' (' + kb + ', ' + mime + ', model ' + model + ', size ' + size + ').',
            summary: 'image → ' + rel,
            detail: {
              filename: rel,
              size: buffer.length,
              mime,
              model,
              size,
              quality,
              aspect_ratio: aspect || undefined,
              usage: data && data.usage
            }
          };
        } catch (e) {
          throw e;
        }
      }
    };

    return {
      generateTool,
      _internals: { postGenerate, normalizeUsage, sizeForAspect, dataUrlToBuffer },
      register(reg) { reg.register(generateTool); return reg; }
    };
  }

  return { makeOpenAIImageTools };
});

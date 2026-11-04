/* node test/image-gptimage2.test.js — gpt-image-* via the SECONDARY direct-OpenAI Images route.
   Offline + deterministic (fetch injected, real temp workspace). Pairs with the 2026-10-30 change in
   sidecar/tools/builtin/image.js: an explicit gpt-image or dall-e model on a station whose PRIMARY studio
   route is OpenRouter (the common case) rides deps.openaiImages to api.openai.com instead of being 404'd by
   OpenRouter (which proxies NO gpt-image model — verified against the live 456-model catalog) and then
   silently substituted by the slug-drift net. Also pins normalizeMediaUsage: the Images API reports
   input_tokens/output_tokens, which the cost engine (prompt_tokens/completion_tokens) used to read as ZERO
   — booking $0 for real spend with even the `unpriced` flag false. */
'use strict';
const A = require('./_assert.js');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { makeImageTools } = require('../sidecar/tools/builtin/image.js');

const ROOT = path.join(os.tmpdir(), 'starnet-image-gptimage2-test-' + process.pid);
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function stubFetch(handler) {
  const calls = [];
  const fn = async (url, init) => {
    let body = null; try { body = init && init.body ? JSON.parse(init.body) : null; } catch (_) {}
    calls.push({ url: String(url), body, init });
    return handler(String(url), body, init);
  };
  fn.calls = calls;
  return fn;
}
function jsonResp(obj, status) { return { status: status || 200, json: async () => obj, arrayBuffer: async () => Buffer.alloc(0), headers: { get: () => 'application/json' } }; }

(async () => {
  try { await fsp.rm(ROOT, { recursive: true, force: true }); } catch (_) {}

  // ---- A. normalizeMediaUsage: one shape out, whatever the vendor sent in ----
  const T0 = makeImageTools({ openrouter: { apiKey: 'k' }, fsp, pathMod: path, root: ROOT, fetchImpl: async () => jsonResp({}) });
  const n = T0._internals.normalizeMediaUsage;
  A.eq(n({ input_tokens: 8, output_tokens: 1600 }).prompt_tokens, 8, 'OpenAI Images input_tokens -> prompt_tokens');
  A.eq(n({ input_tokens: 8, output_tokens: 1600 }).completion_tokens, 1600, 'OpenAI Images output_tokens -> completion_tokens');
  A.eq(n({ promptTokenCount: 5, candidatesTokenCount: 7, totalTokenCount: 12 }).prompt_tokens, 5, 'Gemini promptTokenCount -> prompt_tokens');
  A.eq(n({ promptTokenCount: 5, candidatesTokenCount: 7, totalTokenCount: 12 }).total_tokens, 12, 'Gemini totalTokenCount -> total_tokens');
  const orShaped = n({ prompt_tokens: 3, completion_tokens: 4, cost: 0.01, input_tokens: 999 });
  A.eq(orShaped.prompt_tokens, 3, 'a field the provider actually sent is never overwritten');
  A.eq(orShaped.cost, 0.01, 'provider-reported cost (OpenRouter) passes through untouched');
  A.eq(n(null), null, 'null usage passes through (billed-nothing path unchanged)');

  // ---- B. explicit gpt-image-2 on an OpenRouter-primary station rides the secondary OpenAI route ----
  const usages = [];
  const biFetch = stubFetch((url) => {
    if (url.indexOf('api.openai.com') >= 0) return jsonResp({ data: [{ b64_json: PNG_B64 }], usage: { input_tokens: 13, output_tokens: 4160 } });
    return jsonResp({}, 404); // OpenRouter must never see this request
  });
  const TB = makeImageTools({
    openrouter: { apiKey: 'or-key' }, // primary: openrouter-chat
    openaiImages: { apiKey: 'station-openai-key' },
    fsp, pathMod: path, root: ROOT, fetchImpl: biFetch,
    onUsage: (u, m) => usages.push({ u, m })
  });
  const ctx = { agentId: 'hero', room: 'office', emit: () => {} };
  const gb = await TB.generateTool.run({ prompt: 'a quiet psalm over morning hills', model: 'gpt-image-2', aspect_ratio: 'portrait', path: 'outbox/test/sample.png' }, ctx);
  A.eq(biFetch.calls.length, 1, 'exactly one HTTP call — nothing leaked to the OpenRouter route');
  A.eq(biFetch.calls[0].url, 'https://api.openai.com/v1/images/generations', 'request goes to the OpenAI Images API');
  A.eq(biFetch.calls[0].init.headers.Authorization, 'Bearer station-openai-key', 'secondary route uses the STATION OpenAI key, not the OpenRouter key');
  A.eq(biFetch.calls[0].body, { model: 'gpt-image-2', prompt: 'a quiet psalm over morning hills', size: '1024x1536' }, 'native Images API body: requested model passes through, portrait -> 1024x1536');
  A.ok(/model gpt-image-2/.test(gb.content), 'tool output names the model that actually rendered');
  A.eq(usages.length, 1, 'usage was booked');
  A.eq(usages[0].m, 'gpt-image-2', 'usage is booked against the image model');
  A.eq(usages[0].u.prompt_tokens, 13, 'booked usage carries normalized prompt_tokens');
  A.eq(usages[0].u.completion_tokens, 4160, 'booked usage carries normalized completion_tokens');
  const saved = await fsp.readFile(path.join(ROOT, 'hero', 'outbox', 'test', 'sample.png'));
  A.ok(saved.length > 0 && saved[0] === 0x89 && saved[1] === 0x50, 'PNG bytes landed at the requested jailed path');

  // ---- C. default request is byte-identical to before: no model arg -> primary OpenRouter route ----
  const defFetch = stubFetch((url) => {
    if (url.indexOf('/chat/completions') >= 0) return jsonResp({ choices: [{ message: { images: [{ image_url: { url: 'data:image/png;base64,' + PNG_B64 } }] } }], usage: { prompt_tokens: 2, completion_tokens: 3, cost: 0.004 } });
    return jsonResp({}, 404);
  });
  const TC = makeImageTools({ openrouter: { apiKey: 'or-key' }, openaiImages: { apiKey: 'station-openai-key' }, fsp, pathMod: path, root: ROOT, fetchImpl: defFetch });
  await TC.generateTool.run({ prompt: 'a red cube' }, ctx);
  A.eq(defFetch.calls.length, 1, 'default generate makes one call');
  A.ok(defFetch.calls[0].url.indexOf('/chat/completions') >= 0, 'default generate stays on the primary OpenRouter route');
  A.ok(defFetch.calls[0].body.model.indexOf('gemini') >= 0, 'default model unchanged by the secondary route');
  A.ok(/gpt-image-2/.test(TC.generateTool.description), 'tool description teaches the gpt-image option when the secondary route exists');

  // ---- D. gpt-image-* with NO OpenAI key fails loudly — never silently substituted ----
  const noKeyFetch = stubFetch(() => jsonResp({}, 500));
  const TD = makeImageTools({ openrouter: { apiKey: 'or-key' }, fsp, pathMod: path, root: ROOT, fetchImpl: noKeyFetch });
  let err = null;
  try { await TD.generateTool.run({ prompt: 'x', model: 'gpt-image-2' }, ctx); } catch (e) { err = e; }
  A.ok(err && /OpenAI API key/.test(String(err.message)), 'clear error when no OpenAI key is configured');
  A.eq(noKeyFetch.calls.length, 0, 'no HTTP call is made — the request is refused before any spend');
  A.ok(!/gpt-image-2/.test(TD.generateTool.description), 'description does not advertise an unreachable model');

  // ---- E. primary openai-images protocol is unchanged (no secondary route involved) ----
  const oaFetch = stubFetch(() => jsonResp({ data: [{ b64_json: PNG_B64 }], usage: { input_tokens: 8, output_tokens: 16 } }));
  const TE = makeImageTools({ openrouter: { apiKey: 'openai-key', provider: 'openai', protocol: 'openai-images' }, fsp, pathMod: path, root: ROOT, fetchImpl: oaFetch });
  await TE.generateTool.run({ prompt: 'x', model: 'gpt-image-2' }, ctx);
  A.eq(oaFetch.calls[0].init.headers.Authorization, 'Bearer openai-key', 'openai-images primary protocol still uses its own route key');
  A.eq(oaFetch.calls[0].body.model, 'gpt-image-2', 'explicit model override still honored on the primary protocol');

  try { await fsp.rm(ROOT, { recursive: true, force: true }); } catch (_) {}
  A.report('image-gptimage2.test');
})().catch(e => { console.log('FATAL', e && e.stack || e); process.exit(1); });

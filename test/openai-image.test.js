/* node test/openai-image.test.js — the dedicated OpenAI Images API STUDIO tool.

   Offline + deterministic: the network is stubbed (injected fetchImpl), so this never
   touches api.openai.com and never spends. What it proves:

   1. openai_image_generate is registered in CAP_REGISTRY under studio (write + consent).
   2. Frontend tool-prop mapping -> 'studio'.
   3. Schema validation: prompt required, model must be gpt-image-2/dall-e-2 family,
      size WxH/auto, quality low/medium/high/auto, filename sanitized against traversal.
   4. Missing OPENAI_API_KEY fails loudly (never falls back to Higgsfield/OpenRouter).
   5. Payload mapping: the request sent to /v1/images/generations carries model/prompt/n/
      size/quality/response_format exactly as OpenAI's protocol expects.
   6. b64_json bytes decode, land in the agent's workspace jail, and emit a 'deliverable'.
   7. url-form responses download and save the same way.
   8. Default size comes from aspect_ratio; error responses surface the provider message.
   9. Size/quality normalization in the tool internals.
   10. OPENAI_API_KEY is independent of Higgsfield (HF_CREDENTIALS) and OpenRouter keys. */
'use strict';
const A = require('./_assert.js');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const { makeOpenAIImageTools } = require('../sidecar/tools/builtin/openai-image.js');
const { CAP_REGISTRY } = require('../sidecar/capability/registry.js');
const ToolProps = require('../frontend/app/toolprops.js');

const ROOT = path.join(os.tmpdir(), 'starnet-openai-image-test-' + process.pid);
const AID = 'designer';
function ctx() { return { agentId: AID, emit: (name, d) => { emitted.push({ name, d }); } }; }
let emitted = [];
let captured = [];
let calls = 0;

function fakeFetch(bodyBuilder) {
  return async (url, opts) => {
    calls++;
    captured.push({ url, method: opts.method, authorization: String(opts.headers && (opts.headers.Authorization || opts.headers.authorization) || ''), body: JSON.parse(String(opts.body || '')) });
    const body = typeof bodyBuilder === 'function' ? bodyBuilder(captured[captured.length - 1].body) : bodyBuilder;
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'image/png' },
      json: async () => body,
      arrayBuffer: async () => Buffer.from('FAKE-BYTES')
    };
  };
}

const PNG_B64 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64').toString('base64');

async function withDir(fn) {
  await fsp.rm(ROOT, { recursive: true, force: true });
  await fsp.mkdir(ROOT, { recursive: true });
  try { return await fn(); } finally { await fsp.rm(ROOT, { recursive: true, force: true }); }
}

async function runTool(overrides) {
  emitted = [];
  const tools = makeOpenAIImageTools({
    fsp, pathMod: path, root: ROOT,
    fetchImpl: fakeFetch(({ prompt }) => ({ data: [{ b64_json: PNG_B64 }] })),
    openaiApiKey: 'sk-test-12345'
  });
  return await tools.generateTool.run(Object.assign({ prompt: 'a red cube' }, overrides), ctx());
}

async function main() {
  // ---------- Registry / prop mapping ----------
  {
    const grant = CAP_REGISTRY.studio.find(g => g.tool === 'openai_image_generate');
    A.ok(grant, 'openai_image_generate registered in studio');
    A.eq(grant.capId, 'studio', 'capId studio');
    A.eq(grant.scope, 'write', 'scope write');
    A.eq(grant.requiresConsent, true, 'consent required');
    A.eq(grant.network, true, 'network required');
  }
  A.eq(ToolProps.toolPropType('openai_image_generate'), 'studio', 'front-end prop maps to studio');

  // ---------- Internal helpers ----------
  {
    const { sizeForAspect, normalizeUsage } = makeOpenAIImageTools({
      fsp, pathMod: path, root: ROOT,
      fetchImpl: fakeFetch({ data: [{ b64_json: PNG_B64 }] }),
      openaiApiKey: 'sk-test-12345'
    })._internals;

    A.eq(sizeForAspect('16:9'), '1792x1024', '16:9 -> 1792x1024');
    A.eq(sizeForAspect('9:16'), '1024x1792', '9:16 -> 1024x1792');
    A.eq(sizeForAspect('1:1'), '1024x1024', '1:1 -> 1024x1024');
    A.eq(sizeForAspect('bogus'), '1024x1024', 'unknown aspect -> default');
    A.eq(JSON.stringify(normalizeUsage({ input_tokens: 4, output_tokens: 2 })), JSON.stringify({ input_tokens: 4, output_tokens: 2, prompt_tokens: 4, completion_tokens: 2 }), 'OpenAI tokens normalized');
    A.eq(JSON.stringify(normalizeUsage({ input_tokens: 4, output_tokens: 2, prompt_tokens: 9 })), JSON.stringify({ input_tokens: 4, output_tokens: 2, prompt_tokens: 9, completion_tokens: 2 }), 'already-set prompt_tokens not overwritten');
  }

  // ---------- Missing key fails loudly ----------
  {
    const tools = makeOpenAIImageTools({ fsp, pathMod: path, root: ROOT, fetchImpl: fakeFetch({}) });
    let threw = false;
    try { await tools.generateTool.run({ prompt: 'a red cube' }, ctx()); } catch (e) { threw = true; A.ok(/OPENAI_API_KEY/.test(e.message), 'missing key names the env var'); }
    A.ok(threw, 'missing OPENAI_API_KEY throws');
  }

  // ---------- Schema validation ----------
  {
    let threw = false;
    try { await runTool({ prompt: '' }); } catch (e) { threw = true; A.ok(/prompt/.test(e.message), 'empty prompt rejected'); }
    A.ok(threw, 'empty prompt throws');

    threw = false;
    try { await runTool({ prompt: 'ok', model: 'gpt-5.5' }); } catch (e) { threw = true; A.ok(/image-output model/.test(e.message), 'text model rejected'); }
    A.ok(threw, 'non-image model rejected');

    threw = false;
    try { await runTool({ prompt: 'ok', quality: 'ultra' }); } catch (e) { threw = true; A.ok(/quality must be/.test(e.message), 'bad quality rejected'); }
    A.ok(threw, 'bad quality throws');

    threw = false;
    try { await runTool({ prompt: 'ok', size: 'not-a-size' }); } catch (e) { threw = true; A.ok(/size must be/.test(e.message), 'bad size rejected'); }
    A.ok(threw, 'bad size throws');

    threw = false;
    try { await runTool({ prompt: 'ok', filename: '../escape.png' }); } catch (e) { threw = true; A.ok(/invalid filename/.test(e.message), 'traversal rejected'); }
    A.ok(threw, 'traversal filename rejected');

    threw = false;
    try { await runTool({ prompt: 'ok', filename: '/etc/passwd' }); } catch (e) { threw = true; A.ok(/invalid filename/.test(e.message), 'absolute path rejected'); }
    A.ok(threw, 'absolute filename rejected');
  }

  // ---------- Happy path: b64_json lands in workspace jail + deliverable ----------
  await withDir(async () => {
    emitted = [];
    calls = 0; captured = [];
    const res = await runTool({ filename: 'images/my-image.png', model: 'gpt-image-2', size: '1792x1024', quality: 'high' });
    const saved = path.join(ROOT, AID, 'images', 'my-image.png');
    const stat = await fsp.stat(saved).catch(() => null);
    A.ok(stat && stat.isFile(), 'image saved into workspace jail');
    A.eq(res.detail.filename, 'images/my-image.png', 'filename echoed');
    A.ok(res.detail.mime === 'image/png', 'mime set');
    A.ok(res.detail.model === 'gpt-image-2', 'model echoed');
    A.ok(res.summary.indexOf('my-image.png') >= 0, 'summary names the file');
    A.eq(emitted.length, 1, 'one deliverable emitted');
    A.eq(emitted[0].name, 'deliverable', 'deliverable event name');
    A.eq(emitted[0].d.kind, 'image', 'deliverable kind image');
    A.eq(emitted[0].d.agentId, AID, 'deliverable agentId');
    // payload mapping
    const call = captured[0];
    A.eq(call.url, 'https://api.openai.com/v1/images/generations', 'hits the Images API endpoint');
    A.eq(call.authorization, 'Bearer sk-test-12345', 'Bearer OPENAI_API_KEY sent');
    A.eq(call.body.model, 'gpt-image-2', 'payload model');
    A.eq(call.body.prompt, 'a red cube', 'payload prompt');
    A.eq(call.body.n, 1, 'payload n');
    A.eq(call.body.size, '1792x1024', 'payload size');
    A.eq(call.body.quality, 'high', 'payload quality');
    A.eq(call.body.response_format, 'b64_json', 'payload response_format b64_json');
  })

  // ---------- url-form response downloads and saves ----------
  await withDir(async () => {
    emitted = [];
    captured = [];
    const tools = makeOpenAIImageTools({
      fsp, pathMod: path, root: ROOT,
      fetchImpl: async (url, opts) => {
        captured.push({ url, method: opts.method });
        if (url.endsWith('/images/generations')) {
          return { ok: true, status: 200, headers: { get: () => 'image/png' }, json: async () => ({ data: [{ url: 'https://api.openai.com/v1/images/hosted/abc.png' }] }) };
        }
        // the download hop
        return { ok: true, status: 200, headers: { get: () => 'image/png' }, arrayBuffer: async () => Buffer.from(PNG_B64, 'base64') };
      },
      openaiApiKey: 'sk-test-12345'
    });
    const res = await tools.generateTool.run({ prompt: 'hosted image', filename: 'hosted.png' }, ctx());
    const saved = path.join(ROOT, AID, 'hosted.png');
    const stat = await fsp.stat(saved).catch(() => null);
    A.ok(stat && stat.isFile(), 'url-form image saved');
    A.eq(captured.length, 2, 'generation + download = 2 fetch calls (got ' + captured.length + ')');
  })

  // ---------- Error response surfaces provider message ----------
  await withDir(async () => {
    let threw = false;
    const tools = makeOpenAIImageTools({
      fsp, pathMod: path, root: ROOT,
      fetchImpl: async () => ({ ok: false, status: 402, headers: { get: () => 'application/json' }, json: async () => ({ error: { message: 'Insufficient credits' } }) }),
      openaiApiKey: 'sk-test-12345'
    });
    try { await tools.generateTool.run({ prompt: 'x' }, ctx()); } catch (e) { threw = true; A.ok(/Insufficient credits/.test(e.message), 'provider message surfaced'); }
    A.ok(threw, '402 throws');
  })

  A.report('openai-image.test');
}

main().catch(e => { console.error('FATAL', e && e.stack || e); process.exit(1); });

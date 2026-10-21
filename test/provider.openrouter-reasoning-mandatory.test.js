/* node test/provider.openrouter-reasoning-mandatory.test.js — REGRESSION LOCK for the 2026-10-21 incident
   (every scheduled run on a mandatory-reasoning free model failing with openrouter http 400 "Reasoning is
   mandatory for this endpoint and cannot be disabled").

   OpenRouter's /models catalog reports a model's REAL allowed reasoning efforts in a NESTED `reasoning`
   object (`{mandatory, supported_efforts, default_effort}`). The adapter's catalog mapper used to read only
   flat keys (`reasoningEfforts` / `reasoning_efforts` / etc.) that do not exist on the real response, so for
   a mandatory-reasoning model (e.g. minimax/minimax-m3.1-flash:free — real floor 'low', no 'none') it fell
   through to the generic effort list, which wrongly includes 'none'. A 'none' request then sailed through
   clamping UNCLAMPED and reached the wire, and OpenRouter hard-rejected it. Fixed in sidecar/providers/
   openrouter.js by reading `m.reasoning.supported_efforts` first. This file pins both halves of that fix:
   the catalog mapping, and the wire-level clamp that must never let 'none' reach a mandatory-reasoning model. */
'use strict';
const A = require('./_assert.js');
const { makeOpenRouterProvider } = require('../sidecar/providers/openrouter.js');

async function collect(provider, req) { const out = []; for await (const e of provider.stream(req)) out.push(e); return out; }

(async () => {
  const MANDATORY_ID = 'minimax/minimax-m3.1-flash:free';
  // Shaped exactly like the real OpenRouter catalog entry for this model (captured 2026-10-21) — nested
  // `reasoning`, no flat reasoningEfforts/reasoning_effort fields at all.
  const CATALOG_ENTRY = {
    id: MANDATORY_ID,
    supported_parameters: ['include_reasoning', 'max_tokens', 'reasoning', 'reasoning_effort', 'tools'],
    reasoning: { mandatory: true, supported_efforts: ['max', 'xhigh', 'high', 'medium', 'low'], default_effort: 'max' }
  };

  const calls = [];
  const fakeFetch = async (url, opts) => {
    if (String(url).endsWith('/models')) return new Response(JSON.stringify({ data: [CATALOG_ENTRY] }), { status: 200 });
    calls.push({ url, body: opts && opts.body ? JSON.parse(opts.body) : null });
    return new Response(['data: [DONE]', ''].join('\n'), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  };

  // 1. The nested reasoning.supported_efforts list is read into the catalog — and it excludes 'none'/'minimal',
  //    exactly as OpenRouter declares for a mandatory-reasoning model.
  const p = makeOpenRouterProvider({ fetch: fakeFetch, key: 'k' });
  await p.listModels();
  A.eq(p.reasoningEfforts(MANDATORY_ID), ['max', 'xhigh', 'high', 'medium', 'low'],
    'nested reasoning.supported_efforts populates the catalog (not the empty list the flat-key bug produced)');

  // 2. A 'none' request against this model must clamp DOWN to its real floor ('low'), and that clamped
  //    value — never 'none' — is what actually reaches the wire. This is the exact failure mode: before the
  //    fix, 'none' was considered "allowed" (via the generic fallback list) and sent as-is.
  await collect(makeOpenRouterProvider({ fetch: fakeFetch, key: 'k', reasoningEffort: 'none' }), { model: MANDATORY_ID, messages: [] });
  A.eq(calls[0].body.reasoning, { effort: 'low' },
    'a none request on a mandatory-reasoning model clamps to its real floor instead of reaching the wire as none');

  // 3. A request already within the model's declared range (e.g. 'medium') passes through unclamped.
  calls.length = 0;
  await collect(makeOpenRouterProvider({ fetch: fakeFetch, key: 'k', reasoningEffort: 'medium' }), { model: MANDATORY_ID, messages: [] });
  A.eq(calls[0].body.reasoning, { effort: 'medium' }, 'an already-valid effort is sent unchanged');

  A.report('provider.openrouter-reasoning-mandatory.test');
})();

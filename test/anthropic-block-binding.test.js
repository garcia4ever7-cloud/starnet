/* test/anthropic-block-binding.test.js — thinking.block_binding: let the SERVER drop a mismatched thinking
   block instead of 400ing the whole run.

   WHY THIS EXISTS. A live cron run died mid-flight with money already spent:

     DESIGNER (webdesigner 7971fbcc, claude-sonnet-5-5, 17 turns, $0.603) ->
     400 Invalid `signature` in `thinking` block. The block is bound to a different conversation.
         Content before this block was rewritten since it was created, first at messages.8.content.3

   The host-side guard (thinkingBlocks: replay only blocks stamped with this run/model/epoch/tools) is sound
   and every compaction path bumps the epoch — yet the 400 still happened, and a read-only audit of every
   history mutation could not find the rewrite. 'drop_block' is Anthropic's own escape hatch for exactly this:
   the server discards the unbindable block rather than refusing the request, so a run degrades instead of dying.

   EVERY ASSERTION BELOW MIRRORS A LIVE PROBE, not a doc or a guess (one deliberately-invalid field per call):
     thinking.adaptive.block_binding.prefix_mismatch_behavior: Input should be 'error' or 'drop_block'
     adaptive      + block_binding -> HTTP 200 (incl. claude-sonnet-5-5)
     enabled       + block_binding -> HTTP 200 (claude-haiku-4-5)
     between_tools + block_binding -> 400 "thinking.between_tools.block_binding: Extra inputs are not permitted"
     disabled      + block_binding -> 400 "thinking.disabled.block_binding: Extra inputs are not permitted"
     no beta header                -> 400 "thinking.adaptive.block_binding: Extra inputs are not permitted"

   The refusals matter as much as the acceptances: sending the field on an off-switch would 400 every run that
   turns thinking OFF, which is how this adapter broke the Commander once before (see thinkingOffType).

   Run standalone: node test/anthropic-block-binding.test.js */
'use strict';

const A = require('./_assert.js');
const { makeAnthropicProvider } = require('../sidecar/providers/anthropic.js');

const SSE = [
  'data: ' + JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: 1, output_tokens: 0 } } }),
  'data: ' + JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } }),
  'data: ' + JSON.stringify({ type: 'message_stop' }),
  ''
].join('\n\n');

/* Captures the real request the adapter builds: body + headers, exactly as they would hit the wire.
   KEYED BY URL ON PURPOSE. wireStream() calls maybeRewarmCatalog() first, which issues its OWN GET to
   /models with no betas — a single-slot capture is overwritten by it and the /messages headers vanish,
   which cost a debugging detour. Only the POST to /messages is the request under test. */
function capturing() {
  const seen = {};
  const fetchImpl = async (url, init) => {
    if (String(url).indexOf('/messages') >= 0) {
      seen.url = url;
      seen.headers = (init && init.headers) || {};
      seen.body = JSON.parse((init && init.body) || '{}');
    }
    return new Response(SSE, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  };
  return { seen, fetchImpl };
}

async function run(model, reasoningEffort) {
  const { seen, fetchImpl } = capturing();
  const p = makeAnthropicProvider({ fetch: fetchImpl, key: 'k' });
  const req = { model, messages: [{ role: 'user', content: 'hi' }] };
  if (reasoningEffort) req.reasoningEffort = reasoningEffort;
  for await (const _e of p.stream(req)) { /* drain */ }
  return seen;
}

const beta = (seen) => String((seen.headers && (seen.headers['anthropic-beta'] || seen.headers['Anthropic-Beta'])) || '');

(async () => {
  /* ---------- 1. THINKING ON (modern/adaptive): the field rides, and the beta that unlocks it ---------- */
  {
    const seen = await run('claude-sonnet-5-5', 'medium');
    A.eq(seen.body.thinking.type, 'adaptive', 'a modern Claude thinks with type adaptive');
    A.eq(seen.body.thinking.block_binding, { prefix_mismatch_behavior: 'drop_block' },
      'and carries block_binding so the SERVER drops an unbindable block instead of 400ing the run');
    A.ok(/thinking-binding-controls-2026-08-01/.test(beta(seen)),
      'the beta that unlocks the field rides with it — without it the API refuses block_binding outright');
  }

  /* ---------- 2. THINKING ON (legacy/enabled): probe says accepted, so it rides there too ---------- */
  {
    const seen = await run('claude-haiku-4-5-20251001', 'medium');
    A.eq(seen.body.thinking.type, 'enabled', 'a legacy Claude thinks with type enabled + a token budget');
    A.ok(seen.body.thinking.budget_tokens > 0, 'the legacy budget is still set');
    A.eq(seen.body.thinking.block_binding, { prefix_mismatch_behavior: 'drop_block' },
      'legacy accepted block_binding in the live probe (HTTP 200), so it rides there as well');
    A.ok(/thinking-binding-controls-2026-08-01/.test(beta(seen)), 'with the beta');
  }

  /* ---------- 3. THINKING OFF: the field is REFUSED by the API — it must never be sent ---------- */
  {
    // Sonnet 5.5 spells "off" as between_tools; the live probe 400s on between_tools + block_binding.
    const seen = await run('claude-sonnet-5-5', 'none');
    A.eq(seen.body.thinking.type, 'between_tools', 'sonnet-5.5 turns thinking off with between_tools');
    A.eq(seen.body.thinking.block_binding, undefined,
      'and carries NO block_binding — the API refuses it on an off-switch ("Extra inputs are not permitted")');
    A.eq(beta(seen), '',
      'no beta header either: it must not ride on requests that do not carry the field it unlocks');
  }

  /* ---------- 4. A NON-CLAUDE ENDPOINT IS LEFT COMPLETELY ALONE ---------- */
  {
    const seen = await run('some-third-party-model', 'medium');
    A.eq(seen.body.thinking, undefined, 'a third-party Anthropic-compatible model gets no thinking contract');
    A.eq(beta(seen), '', 'and no beta header — an unknown beta could 400 a proxy that never implemented it');
  }

  /* ---------- 5. THE VALUE IS THE ONE THE API ENUMERATED ---------- */
  {
    const seen = await run('claude-sonnet-5-5', 'medium');
    const v = seen.body.thinking.block_binding.prefix_mismatch_behavior;
    A.eq(v, 'drop_block', 'the probed enum is error|drop_block, and only drop_block degrades instead of dying');
    A.ok(v !== 'error', '"error" is the DEFAULT that produced the fatal 400 — sending it would change nothing');
  }

  A.report('anthropic block binding');
})().catch(e => { console.error(e); process.exit(1); });

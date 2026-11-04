/* node test/loop.thinking-scope.test.js — the 2026-10-27 crash:

     400 Invalid signature in thinking block. The block is bound to a different conversation.

   Anthropic binds a thinking block's signature to the provider, the model AND the conversation prefix
   in front of it, then re-validates all three on replay. A mismatch is a hard 400, not a degrade: the
   turn dies. The block that produced the live failure had survived a COMPACTION — the fold swaps the
   earlier history for a summary note while KEEPING the tail's original message objects, so a block
   that was valid a moment earlier ends up sitting in front of a conversation it was never signed
   against.

   test/provider.anthropic.test.js covers the adapter's half (which blocks it refuses). This file
   covers the half the adapter cannot see: that the LOOP stamps every block with where it came from,
   bumps the stamp's epoch on every history rewrite, and that the two halves actually meet — the real
   loop's messages are fed to the real adapter here, not to a hand-written imitation of it.

   Zero network: a hand-rolled provider yields canned events. */
'use strict';
const A = require('./_assert.js');
const events = require('../shared/events.js');
const { makeEmitter } = require('../shared/emitter.js');
const { makeCostEngine } = require('../sidecar/cost.js');
const { runAgentLoop } = require('../sidecar/loop.js');
const { makeRegistry } = require('../sidecar/tools/registry.js');
const { _internals } = require('../sidecar/providers/anthropic.js');

function setup() { const bus = A.makeBus(); const seq = A.collectBus(bus, events.names()); return { seq, emit: makeEmitter(bus, () => {}) }; }
const priceOf = () => ({ in: 1, out: 2 });
const cost = () => makeCostEngine({ priceOf });
const openCtx = () => ({ agentId: 'a', canUse: () => ({ ok: true }), canRun: () => ({ ok: true }) });
function reg() { const r = makeRegistry(); r.register({ name: 'noop', schema: { type: 'object' }, run: async () => 'ok' }); return r; }

// A provider that records every request it is handed, and plays one scripted turn per call.
function recorder(turns) {
  const seen = [];
  const p = {
    priceOf, contextLimit: () => 0,
    stream: (req) => {
      seen.push(req);
      const evs = turns[Math.min(seen.length - 1, turns.length - 1)];
      return (async function* () { for (const ev of evs) yield ev; })();
    }
  };
  return { provider: p, seen };
}

const THINK = { type: 'reasoning', block: { type: 'thinking', thinking: 'let me think', signature: 'sig-abc' } };
// each turn signs distinctly, so "which block reached the wire" is answerable rather than inferred
const thinkAs = (sig) => ({ type: 'reasoning', block: { type: 'thinking', thinking: 'think ' + sig, signature: sig } });
const toolTurn = (id, prompt, sig) => [sig ? thinkAs(sig) : THINK,
  { type: 'tool_start', index: 0, id, name: 'noop' }, { type: 'tool_args', index: 0, chunk: '{}' },
  { type: 'usage', usage: { prompt_tokens: prompt, completion_tokens: 1, total_tokens: prompt + 1 } },
  { type: 'done', finishReason: 'tool_calls' }];
const stopTurn = [{ type: 'text', delta: 'final' }, { type: 'done', finishReason: 'stop' }];

// what the adapter would actually put on the wire for the assistant turns of `messages` under `scope`
const wireThinking = (messages, scope) =>
  _internals.messagesToAnthropic(messages, scope).messages
    .flatMap(m => (Array.isArray(m.content) ? m.content : []))
    .filter(b => b.type === 'thinking' || b.type === 'redacted_thinking');

(async () => {
  // ---- 1. THE LOOP STAMPS EVERY BLOCK, AND THE ADAPTER ACCEPTS ITS OWN ----
  //      No compaction: the block is still in front of the conversation it was signed against, so it
  //      MUST replay. A fix that just dropped thinking blocks would pass section 2 and fail here.
  {
    const { emit } = setup();
    const { provider, seen } = recorder([toolTurn('c1', 10), stopTurn]);
    const R = reg();
    const messages = [{ role: 'user', content: 'go' }];
    const res = await runAgentLoop({ messages, provider, emit, cost: cost(), model: 'claude-sonnet-5-5',
      agentId: 'a', runId: 'run-1', tools: R.wireFormat(), dispatch: (c, c2) => R.dispatch(c, c2), capCtx: openCtx() });

    A.eq(res.reason, 'done', 'run completes');
    A.eq(seen.length, 2, 'two model calls (a tool turn, then the answer)');

    const scope = seen[0].reasoningScope;
    A.ok(scope && typeof scope === 'object', 'the loop puts a reasoningScope on every request');
    A.eq(scope.provider, provider, 'scope names the live provider ADAPTER (identity, not a spoofable string)');
    A.eq(scope.model, 'claude-sonnet-5-5', 'scope names the model');
    A.eq(scope.runId, 'run-1', 'scope names the run');
    A.eq(scope.epoch, 0, 'epoch starts at 0');
    A.eq(scope.tools, '[{"description":"","input_schema":{"type":"object"},"name":"noop"}]', 'scope has tools hash');

    const asst = messages.find(m => m.role === 'assistant' && m.reasoning);
    A.ok(asst, 'the streamed thinking block was parked on the assistant turn');
    A.eq(asst.reasoning[0].signature, 'sig-abc', 'the signature is kept verbatim — a replay is a passthrough');
    A.eq(asst.reasoning[0].__src, scope, 'the block carries the stamp of the request that produced it');
    A.eq(seen[1].reasoningScope.epoch, 0, 'no history rewrite happened, so the epoch did not move');

    const wire = wireThinking(messages, seen[1].reasoningScope);
    A.eq(wire.length, 1, 'the run\'s OWN in-scope block still replays (thinking + tool-use continuation is unaffected)');
    A.eq(wire[0], { type: 'thinking', thinking: 'let me think', signature: 'sig-abc' }, 'it replays byte-identically');
    A.eq(Object.prototype.hasOwnProperty.call(wire[0], '__src'), false, 'the host-only stamp never reaches the wire');
  }

  // ---- 2. THE REPORTED CRASH: a block that survived a COMPACTION is refused ----
  //      The fold rewrites the history, so the epoch moves and every block minted before it is
  //      unreplayable by construction. Before the fix these went to the API verbatim and answered 400.
  {
    const { seq, emit } = setup();
    const { provider, seen } = recorder([toolTurn('c1', 4000, 'sig-turn1'), toolTurn('c2', 4000, 'sig-turn2'), stopTurn]);
    const R = reg();
    /* The fold shape that caused the live crash: the PREFIX is replaced by a summary note while the
       tail keeps its ORIGINAL message objects. Folding the tail away instead would delete the
       dangerous block rather than strand it, and the test would prove nothing — the first draft of
       this test did exactly that and passed section 2 vacuously. */
    const ctx = {
      shouldCompact: () => true,
      estimateMessages: () => 10,                                  // 4000 reported -> 10 estimated: always shrinks
      planCompaction: (arr) => ({ older: arr.slice(0, 1), tail: arr.slice(1) })
    };
    const messages = [{ role: 'user', content: 'u1' }, { role: 'assistant', content: 'a1' }, { role: 'user', content: 'u2' }];
    const res = await runAgentLoop({ messages, provider, emit, cost: cost(), model: 'claude-sonnet-5-5',
      agentId: 'a', runId: 'run-2', tools: R.wireFormat(), dispatch: (c, c2) => R.dispatch(c, c2), capCtx: openCtx(),
      context: ctx, summarize: async () => ({ summary: 'FOLDED', usd: 0, tokens: 0 }) });

    A.eq(res.reason, 'done', 'the run still completes across the fold');
    A.ok(seq.some(e => e.name === 'agent.compact'), 'a compaction actually happened (the test would be vacuous otherwise)');

    const epochs = seen.map(r => r.reasoningScope.epoch);
    A.ok(epochs[epochs.length - 1] > epochs[0], 'the epoch advanced when the history was rewritten: ' + JSON.stringify(epochs));

    // The decisive assertion: blocks minted BEFORE the fold are still sitting in the surviving tail,
    // and under the post-fold scope the adapter refuses every one of them.
    const liveScope = seen[seen.length - 1].reasoningScope;
    const parked = messages.filter(m => m.role === 'assistant' && m.reasoning).flatMap(m => m.reasoning);
    const stale = parked.filter(b => b.__src.epoch < liveScope.epoch);
    A.ok(stale.length >= 1, 'at least one pre-fold thinking block survived the fold in the tail, carrying its old epoch');

    const onWire = wireThinking(messages, liveScope).map(b => b.signature);
    for (const b of stale) {
      A.eq(onWire.indexOf(b.signature), -1,
        'pre-compaction block ' + b.signature + ' (epoch ' + b.__src.epoch + ' vs live ' + liveScope.epoch +
        ') does NOT reach the wire — this is the 400 "bound to a different conversation"');
    }
    A.eq(onWire.length, parked.length - stale.length,
      'exactly the still-in-scope blocks replay: nothing valid was thrown away to achieve this');
  }

  // ---- 3. RECOVERY: a provider/model switch takes the thinking blocks with it ----
  //      Two independent guards have to agree here. loop.js STRIPS `reasoning` outright on a switch,
  //      and the adapter would refuse the blocks anyway because the stamp names the outgoing adapter.
  //      Either alone is sufficient; the run dies if neither holds.
  {
    const { seq, emit } = setup();
    const R = reg();
    let hit = 0;
    const primary = {
      priceOf, contextLimit: () => 0,
      stream: () => (async function* () {
        hit++;
        if (hit === 1) { yield THINK; yield { type: 'text', delta: 'partial' }; }
        const e = new Error('overloaded_error: Overloaded'); e.status = 529; throw e;
      })()
    };
    const { provider: backup, seen: backupSeen } = recorder([[{ type: 'text', delta: 'recovered' }, { type: 'done', finishReason: 'stop' }]]);
    const messages = [{ role: 'user', content: 'go' }];
    const res = await runAgentLoop({ messages, provider: primary, emit, cost: cost(), model: 'claude-sonnet-5-5',
      agentId: 'a', runId: 'run-3', tools: R.wireFormat(), dispatch: (c, c2) => R.dispatch(c, c2), capCtx: openCtx(),
      fallbacks: [{ provider: backup, model: 'claude-haiku-5-5' }], sleep: async () => {} });

    A.eq(res.reason, 'done', 'the run recovered on the fallback provider');
    A.eq(backupSeen.length >= 1, true, 'the fallback provider was actually called');
    const fb = seq.filter(e => e.name === 'provider.fallback');
    A.ok(fb.length >= 1, 'a provider.fallback was emitted');

    // guard 1 — the loop stripped the outgoing provider's blocks out of the history
    A.eq(messages.filter(m => m.role === 'assistant' && m.reasoning).length, 0,
      'no assistant turn still carries `reasoning` after a provider switch');

    // guard 2 — even if one had survived, its stamp names the OUTGOING adapter and model, so the
    // incoming request's scope cannot match it.
    const fbScope = backupSeen[0].reasoningScope;
    A.eq(fbScope.provider, backup, 'the post-switch scope names the INCOMING adapter');
    A.eq(fbScope.model, 'claude-haiku-5-5', 'and the incoming model');
    const survivor = { role: 'assistant', content: 'x', reasoning: [{ type: 'thinking', thinking: 'let me think', signature: 'sig-abc', __src: { provider: primary, model: 'claude-sonnet-5-5', runId: 'run-3', epoch: 0 } }] };
    A.eq(wireThinking([survivor], fbScope).length, 0,
      'a block signed by the outgoing provider/model is refused by the incoming request');
  }

  // ---- 4. A RESUMED RUN CANNOT REPLAY ITS OLD BLOCKS ----
  //      Checkpoints and the run journal JSON-serialize `messages`. A provider adapter is an object of
  //      functions, so it serializes to `{}` and can never === the live adapter again. That is the
  //      intended outcome, not an accident: a resumed history is a different conversation to the API,
  //      and this is the property that makes the gate fail SAFE for every path nobody has written yet.
  {
    const { provider } = recorder([stopTurn]);
    const scope = { provider, model: 'claude-sonnet-5-5', runId: 'run-4', epoch: 0 };
    const live = [{ role: 'assistant', content: 'x', reasoning: [{ type: 'thinking', thinking: 't', signature: 's', __src: scope }] }];
    A.eq(wireThinking(live, scope).length, 1, 'in-process, the block replays');

    const resumed = JSON.parse(JSON.stringify(live));            // what a checkpoint round-trip produces
    A.eq(resumed[0].reasoning[0].__src.provider, {}, 'the adapter serialized to an empty object (no crash, no secret leak)');
    A.eq(wireThinking(resumed, scope).length, 0, 'after a checkpoint round-trip the block is refused, not replayed');
  }

  A.report('loop.thinking-scope.test');
})().catch(e => { console.log('FAIL: loop.thinking-scope.test threw -- ' + (e && e.stack || e)); process.exit(1); });

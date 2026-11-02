/* node test/anthropic-prefill-continuations.test.js — Regression test for the Anthropic prefill fix.

   Root cause (read-only diagnosis): the Anthropic adapter's buildBody() never called
   preserveClaudeContinuations(), so a transcript carrying a leading system block PLUS any
   later host-injected system block was sent to Anthropic verbatim. Anthropic permits only ONE
   leading system block; a second system block is interpreted as an attempt to prefill an
   assistant message and rejected with HTTP 400 "assistant message prefill unsupported".

   OpenRouter (openrouter.js:239) and OpenAI-compatible (openai-compatible.js:412) already apply
   preserveClaudeContinuations(); the native Anthropic adapter did not.

   Fix: anthropic.js buildBody() now wraps prepareWireMessages output through
   preserveClaudeContinuations() before messagesToAnthropic(), collapsing any non-leading
   system block into a user turn.
*/
'use strict';
const A = require('./_assert.js');
const { makeAnthropicProvider, _internals } = require('../sidecar/providers/anthropic.js');

const line = obj => 'data: ' + JSON.stringify(obj);

function sysBlock(text) { return { type: 'text', text: text, cache_control: { type: 'ephemeral' } }; }

(async () => {
  // A. A transcript with a leading system block AND a later host-injected system block must
  //    collapse the later one to user — Anthropic must never see two system blocks.
  {
    let captured = null;
    const fetchImpl = async (url, init) => {
      captured = JSON.parse(init.body);
      return new Response([line({ type: 'message_stop' }), ''].join('\n'),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    };
    const p = makeAnthropicProvider({ fetch: fetchImpl, key: 'k' });
    await (async () => {
      const out = [];
      for await (const e of p.stream({
        model: 'claude-test',
        messages: [
          { role: 'system', content: 'leading system instruction' },
          { role: 'user', content: 'hello' },
          { role: 'assistant', content: 'hi there' },
          { role: 'system', content: 'host-injected reminder mid-conversation' }   // must become user
        ],
        tools: []
      })) { out.push(e); }
    })();
    A.ok(captured, 'a request was sent to Anthropic');
    // System blocks are lifted to body.system (block array with cache_control).
    A.eq(captured.system, [sysBlock('leading system instruction')],
      'only the leading system block reaches body.system (no assistant-prefill trap)');
    // The collapsed host-injected system block rides as a user turn in messages.
    const last = captured.messages[captured.messages.length - 1];
    A.eq(last.role, 'user', 'the later host-injected system block became a user turn');
    A.eq(last.content[0].text, 'host-injected reminder mid-conversation',
      'the collapsed system text is preserved as user content');
    A.ok(last.content[0].cache_control, 'collapsed turn carries the sliding tail anchor');
  }

  // B. A transcript with ONLY a leading system block is unchanged (no false collapse).
  {
    let captured = null;
    const fetchImpl = async (url, init) => {
      captured = JSON.parse(init.body);
      return new Response([line({ type: 'message_stop' }), ''].join('\n'),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    };
    const p = makeAnthropicProvider({ fetch: fetchImpl, key: 'k' });
    await (async () => {
      const out = [];
      for await (const e of p.stream({
        model: 'claude-test',
        messages: [
          { role: 'system', content: 'only system block' },
          { role: 'user', content: 'hello' }
        ],
        tools: []
      })) { out.push(e); }
    })();
    A.eq(captured.system, [sysBlock('only system block')],
      'single leading system block stays in body.system');
    A.eq(captured.messages.length, 1, 'no extra message blocks were created');
    A.eq(captured.messages[0].role, 'user', 'the user turn stays a user turn');
  }

  // C. Non-Claude models through an Anthropic-shaped endpoint are untouched (provider-compat law).
  {
    let captured = null;
    const fetchImpl = async (url, init) => {
      captured = JSON.parse(init.body);
      return new Response([line({ type: 'message_stop' }), ''].join('\n'),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    };
    const p = makeAnthropicProvider({ fetch: fetchImpl, key: 'k', baseUrl: 'https://vendor.example/v1' });
    await (async () => {
      const out = [];
      for await (const e of p.stream({
        model: 'some-vendor/mixtral',
        messages: [
          { role: 'system', content: 'sys one' },
          { role: 'user', content: 'u1' },
          { role: 'system', content: 'sys two' }
        ],
        tools: []
      })) { out.push(e); }
    })();
    // Non-Claude: preserveClaudeContinuations returns messages unchanged, so extractLeadingSystem
    // only lifts the LEADING system block; the second system block stays in messages and is
    // treated as a user turn by messagesToAnthropic (system blocks after the leading one are
    // collapsed into the adjacent user turn).
    A.eq(captured.system, [sysBlock('sys one')], 'non-Claude: only leading system lifted to body.system');
    A.eq(captured.messages.length, 1, 'non-Claude: exactly one user message');
    A.eq(captured.messages[0].role, 'user', 'non-Claude: user turn stays first');
    A.eq(captured.messages[0].content[0].text, 'u1', 'non-Claude: original user text preserved');
    A.eq(captured.messages[0].content[1].text, 'sys two',
      'non-Claude: the non-leading system block was absorbed into the user turn');
  }

  A.report('anthropic-prefill-continuations.test');
})().catch(e => { console.log('FAIL: ' + (e && e.stack || e)); process.exit(1); });

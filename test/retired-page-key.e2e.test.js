/* node test/retired-page-key.e2e.test.js — PHONE PORT 2026-11-27: a page key the Commander REMOVED does not ride a run.

   THE BUG (live, 2026-11-26). A browser page keeps its own provider key in localStorage and sends it in the body of every
   interactive /api/run, and a per-run key wins over the station's (credential-store.js). After the Commander REMOVED the
   page copy at the station (POST /api/providers/engine-key with an empty body -> a tombstone), the page still sent its OLD
   Anthropic key, which Anthropic answered 401, so every page chat fell over to the fallback chain (Haiku on OpenRouter).

   THE FIX (sidecar/index.js handleRun, retiredPageKey). When the body carries a key for provider X, X's station page copy is
   a REMOVE tombstone, and the station's own key for X comes from the environment, the body's key, spare keys and endpoint
   are dropped and the run uses the env key. Saving a key deliberately in any page replaces the tombstone and ends it.

   A REAL sidecar on a throwaway workspace, a recording Anthropic upstream (keys compared by value inside this process; the
   assertions name only which of the test's own fake keys arrived). Rows:
     1. no page copy was ever saved: the page's key rides its run (unchanged behaviour)
     2. page copy saved, then REMOVED, env key present: the page's key never goes upstream; the env key does; said once in the log
     3. a NEW key saved deliberately afterwards: it rides the run again (the tombstone is gone)
     4. a station with NO env key: a tombstone alone changes nothing — the page's key rides (dropping it would leave no key) */
'use strict';
const A = require('./_assert.js');
const http = require('http');
const { SidecarFixture } = require('./helpers/sidecar-fixture.js');

const K = {
  env: 'sk-ant-api03-RETIRED-TEST-ENV-key-0123456789abcdefABCD',
  page: 'sk-ant-api03-RETIRED-TEST-PAGE-only-0123456789abcdefAB',
  old: 'sk-ant-api03-RETIRED-TEST-OLD-removed-0123456789abcdef',
  neu: 'sk-ant-api03-RETIRED-TEST-NEW-saved-0123456789abcdefAB'
};
const nameOf = v => Object.keys(K).find(n => K[n] === v) || (v ? 'other' : 'none');

function recorder() {
  const seen = [];
  const server = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => { raw += c; }); req.on('end', () => {
      if (/\/models/.test(req.url)) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ data: [{ id: 'claude-fable-5-2', type: 'model' }], has_more: false })); }
      if (!/\/messages/.test(req.url)) { res.writeHead(404); return res.end('{}'); }
      let model = ''; try { model = JSON.parse(raw).model || ''; } catch (_) {}
      seen.push({ key: nameOf(String(req.headers['x-api-key'] || '')), model });
      const ev = (n, d) => 'event: ' + n + '\ndata: ' + JSON.stringify(d) + '\n\n';
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(ev('message_start', { type: 'message_start', message: { id: 'msg_' + seen.length, type: 'message', role: 'assistant', model: model || 'claude-fable-5-2', content: [], stop_reason: null, usage: { input_tokens: 5, output_tokens: 1 } } }) +
        ev('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }) +
        ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } }) +
        ev('content_block_stop', { type: 'content_block_stop', index: 0 }) +
        ev('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } }) +
        ev('message_stop', { type: 'message_stop' }));
    });
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ server, seen, base: 'http://127.0.0.1:' + server.address().port })));
}

async function station(label, up, withEnvKey) {
  const env = {
    ANTHROPIC_API_KEY: withEnvKey ? K.env : '', ANTHROPIC_BASE_URL: up.base + '/v1',
    OPENROUTER_API_KEY: '', OPENROUTER_KEY: '', OPENAI_API_KEY: '', GEMINI_API_KEY: '', GOOGLE_API_KEY: '',
    SKYNET_SKILL_REVIEW: '0', SKYNET_SKILL_CURATOR: '0', SKYNET_THREAD_MINE: '0', STARNET_CREDITS_URL: '', SKYNET_CREDITS_URL: ''
  };
  const fx = SidecarFixture.create({ prefix: 'retired-page-key-' + label + '-', timeoutMs: 45000, env });
  await fx.start();
  const roster = [{ agentId: 'agent', name: 'AGENT', system: 'x', provider: 'anthropic', model: 'claude-fable-5-2' }];
  A.eq((await fx.json('POST', '/api/roster', { agents: roster, updatedAt: Date.now() })).status, 200, label + ': roster saved');
  return fx;
}
// one page-shaped run (the body names provider + model and carries the page's key, as harness.js sends it)
async function pageRun(fx, up, key) {
  const from = up.seen.length;
  const r = await fx.request('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentId: 'agent', provider: 'anthropic', model: 'claude-fable-5-2', key, messages: [{ role: 'user', content: 'say ok' }] }) });
  const text = await r.text();
  const end = (text.split('\n').map(l => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean)
    .find(e => e.name === 'agent.run.end') || {}).payload || {};
  return { status: r.status, end, keys: up.seen.slice(from).map(s => s.key), models: up.seen.slice(from).map(s => s.model) };
}
const removedLine = fx => fx.output().split('\n').filter(l => /\[credentials\] a page sent a saved anthropic key/.test(l)).length;

async function main() {
  const up = await recorder();
  let fx = null, bare = null;
  try {
    fx = await station('env', up, true);
    // 1. never saved: the page's own key rides
    let r = await pageRun(fx, up, K.page);
    A.eq(r.status, 200, 'row 1: run answered');
    A.eq(r.end.reason, 'done', 'row 1: run done');
    A.eq(r.keys[0], 'page', 'row 1: no tombstone -> the page key rides its run (unchanged)');

    // 2. saved, then REMOVED (tombstone) beside an env key
    A.eq((await fx.json('POST', '/api/providers/engine-key', { provider: 'anthropic', key: K.old })).body.applied, true, 'row 2: page copy saved');
    const rm = await fx.json('POST', '/api/providers/engine-key', { provider: 'anthropic', key: '', keyPool: [], baseUrl: '' });
    A.eq(rm.body.applied, true, 'row 2: page copy REMOVED');
    A.eq(rm.body.keySource, 'environment', 'row 2: the station key is the environment\'s');
    r = await pageRun(fx, up, K.old);
    A.eq(r.end.reason, 'done', 'row 2: run done');
    A.eq(r.keys[0], 'env', 'row 2: the run went out on the ENV key');
    A.ok(r.keys.length > 0 && r.keys.every(k => k === 'env'), 'row 2: the removed page key never went upstream (' + r.keys.join(',') + ')');
    A.eq(r.models[0], 'claude-fable-5-2', 'row 2: on the model the page asked for (no fallback)');
    r = await pageRun(fx, up, K.old);
    A.ok(r.keys.length > 0 && r.keys.every(k => k === 'env'), 'row 2: a second page run, same');
    A.eq(removedLine(fx), 1, 'row 2: the log says it once per provider per boot (and names no key)');
    A.ok(!fx.output().includes(K.old) && !fx.output().includes(K.env), 'row 2: no key value in the station log');

    // 3. a NEW key saved deliberately: honoured again
    A.eq((await fx.json('POST', '/api/providers/engine-key', { provider: 'anthropic', key: K.neu })).body.applied, true, 'row 3: new page key saved');
    r = await pageRun(fx, up, K.neu);
    A.eq(r.end.reason, 'done', 'row 3: run done');
    A.eq(r.keys[0], 'neu', 'row 3: the newly saved page key rides its run (the tombstone is gone)');

    // 4. no env key: a tombstone alone changes nothing
    bare = await station('bare', up, false);
    await bare.json('POST', '/api/providers/engine-key', { provider: 'anthropic', key: K.old });
    await bare.json('POST', '/api/providers/engine-key', { provider: 'anthropic', key: '', keyPool: [], baseUrl: '' });
    r = await pageRun(bare, up, K.page);
    A.eq(r.end.reason, 'done', 'row 4: run done');
    A.eq(r.keys[0], 'page', 'row 4: no env key -> the page key rides (the rule needs a station key to fall back to)');
    A.eq(removedLine(bare), 0, 'row 4: nothing said');
  } catch (e) {
    A.ok(false, 'threw: ' + ((e && e.stack) || e));
  } finally {
    if (fx) await fx.dispose().catch(() => {});
    if (bare) await bare.dispose().catch(() => {});
    up.server.close();
  }
}
main().then(() => A.report('retired-page-key.e2e'));

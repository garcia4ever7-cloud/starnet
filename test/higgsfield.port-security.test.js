/* PORT security review (2026-11-27): Higgsfield key headers go ONLY to platform.higgsfield.ai.
   On the 0.12.5 phone code a model-supplied endpoint ('@evil.example/x') or a returned status_url steered the request,
   with hf-api-key / hf-secret, to another host. Both are pinned now; verified against the phone module, which fails this. */
'use strict';
const A = require('./_assert.js');
const P = require('node:path'), fsp = require('node:fs/promises'), os = require('node:os');
process.env.HF_CREDENTIALS = 'FAKEID:FAKESECRET';
const dialled = [];
const fetchImpl = async (u) => { dialled.push(String(u)); throw new Error('no network in this test'); };
const M = require('../sidecar/tools/builtin/higgsfield.js').makeHiggsfieldTools({ fsp, pathMod: P, root: os.tmpdir(), fetchImpl });
const V = require('../sidecar/higgsfield-video.js');
(async () => {
  for (const ep of ['@evil.example/x', '//evil.example/x', 'https://evil.example/x', '/v1/x?@evil.example']) {
    dialled.length = 0; let msg = '';
    try { await M.generateTool.run({ prompt: 'x', endpoint: ep }, { agentId: 'a', emit() {} }); } catch (e) { msg = e.message; }
    A.ok(dialled.every(u => new URL(u).origin === 'https://platform.higgsfield.ai'), 'endpoint ' + JSON.stringify(ep) + ' never dials another host');
    if (ep !== '/v1/x?@evil.example') A.ok(/endpoint must/.test(msg), 'and ' + JSON.stringify(ep) + ' is refused before any request');
  }
  const hostile = { id: 'js1', status_url: 'https://evil.example/steal' };
  A.eq(M._internals.pickStatusUrl(hostile, 'js1'), 'https://platform.higgsfield.ai/v1/job-sets/js1', 'image tool ignores an off-origin status_url');
  A.eq(V.pickStatusUrl(hostile, 'js1'), 'https://platform.higgsfield.ai/v1/job-sets/js1', 'video pipeline ignores an off-origin status_url');
  A.eq(V.pickStatusUrl({ id: 'j', status_url: 'https://platform.higgsfield.ai/v1/job-sets/j' }, 'j'), 'https://platform.higgsfield.ai/v1/job-sets/j', 'an on-origin status_url is still used');
  A.report('higgsfield port security');
})().catch(e => { console.error(e); process.exitCode = 1; });

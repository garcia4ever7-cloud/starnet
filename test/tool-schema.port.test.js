/* PHONE PORT (b0dcc0b2c, generic half): `parameters:` fails at registration; a validation error says what is accepted;
   and every tool this build registers declares `schema` (the guard trips on nothing shipped). */
'use strict';
const A = require('./_assert.js');
const { makeTool } = require('../sidecar/tools/tool.js');
const { makeRegistry } = require('../sidecar/tools/registry.js');
A.throws(() => makeTool({ name: 'bad', parameters: { type: 'object', properties: { a: { type: 'string' } } }, run: async () => '' }), 'a def with `parameters:` is refused at registration');
A.notThrows(() => makeTool({ name: 'good', schema: { type: 'object', properties: {} }, run: async () => '' }), 'a def with `schema:` registers');
(async () => {
  const reg = makeRegistry();
  reg.register({ name: 'sized', scope: 'read', impact: 'none', schema: { type: 'object', additionalProperties: false, required: ['size'], properties: { size: { type: 'string', enum: ['8x10', '11x14'] } } }, run: async () => 'ok' });
  const r = await reg.dispatch({ id: 'c1', name: 'sized', args: { size: '9x12' } }, { agentId: 'a', runId: 'r', emit: () => {} });
  const text = JSON.stringify(r);
  A.ok(/invalid arguments for sized/.test(text), 'the bad call is refused');
  A.ok(/This tool accepts — size: \\?"8x10\\?"\|\\?"11x14\\?" \(required\)/.test(text), 'and the error states the accepted arguments');
  A.report('tool schema port (b0dcc0b2c generic)');
})().catch(e => { console.error(e); process.exitCode = 1; });

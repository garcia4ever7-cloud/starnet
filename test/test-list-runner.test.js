'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const A = require('./_assert.js');

(async () => {
  const root = path.resolve(__dirname, '..');
  const runner = await import(pathToFileURL(path.join(root, 'scripts', 'run-test-list.mjs')).href);
  for (const name of ['fast.list', 'http.list']) {
    const steps = runner.readSteps(path.join(__dirname, name));
    A.ok(steps.length > 0, name + ' contains runnable steps');
    A.eq(new Set(steps).size, steps.length, name + ' contains no duplicate suite');
    A.ok(steps.every(step => fs.existsSync(path.join(root, step))), name + ' references only existing files');
  }
  const http = runner.readSteps(path.join(__dirname, 'http.list'));
  A.eq(http[0], 'test/provider-recovery.e2e.test.js', 'provider production-composition proof is part of the HTTP manifest');
  A.ok(http.includes('test/sidecar.http.test.js') && http.includes('test/openai-compat.e2e.test.js'), 'HTTP manifest retains route coverage');
  // qa/bugs/2c50b150: credential-shaped variables never reach a step unless deliberately kept.
  const base = { PATH: '/bin', HOME: '/h', KLING_API_KEY: 'k', ANTHROPIC_AUTH_TOKEN: 't', OPENROUTER_API_KEY: 'o',
    DB_PASSWORD: 'p', CLIENT_SECRET: 's', STARNET_PRODUCTION_ARMED: '1', NODE_OPTIONS: '' };
  const scrubbed = runner.stepEnv(base, { HOME: '/profile' });
  A.eq(Object.keys(scrubbed).sort().join(','), 'HOME,NODE_OPTIONS,PATH,STARNET_PRODUCTION_ARMED', 'step env drops every *KEY/*TOKEN/*SECRET/*PASSWORD variable and keeps the rest');
  A.eq(scrubbed.HOME, '/profile', 'hermetic overrides still apply');
  A.eq(base.KLING_API_KEY, 'k', 'the caller env object is not mutated');
  const kept = runner.stepEnv(Object.assign({ STARNET_TEST_KEEP_CREDENTIALS: '1' }, base), {});
  A.eq(kept.KLING_API_KEY, 'k', 'STARNET_TEST_KEEP_CREDENTIALS=1 keeps credentials for a deliberate live-key run');
  A.report('test-list-runner.test');
})().catch(error => { console.error(error && error.stack || error); process.exit(1); });

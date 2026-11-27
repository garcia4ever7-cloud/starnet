/* PHONE PORT (v0.15.4): the Apify cap is wired at BOTH doors and the manager hands it to every connector tool. */
'use strict';
const A = require('./_assert.js');
const fs = require('node:fs'), path = require('node:path');
const rd = (f) => fs.readFileSync(path.join(__dirname, '..', 'sidecar', f), 'utf8');
const idx = rd('index.js'), man = rd('mcp/manager.js'), web = rd('tools/builtin/web.js'), tr = rd('mcp/translate.js');
A.ok(/const hostQuota = HostQuota\.makeHostQuota\(\{/.test(idx), 'index.js builds ONE station hostQuota');
A.ok(/'\.host-daily-quota\.json'/.test(idx), 'on the 0.12.5 counter file (count carries over)');
A.ok(idx.indexOf('const hostQuota = ') < idx.indexOf('const connectors = makeConnectorManager({'), 'defined before the connector manager reads it');
A.ok(/quota: hostQuota,/.test(idx), 'the connector manager receives it');
A.ok(/hostQuota: hostQuota,/.test(idx), 'the web tools receive it');
A.ok(/const quota = deps\.quota \|\| null;/.test(man) && /timeoutMs: defTimeoutMs, quota: quota \}\)\);/.test(man), 'the manager passes it to every connector tool def');
const runAt = tr.indexOf('run: async function (args, ctx) {');
A.ok(tr.indexOf('o.quota.consumeTool(connectorId, mcpTool.name, ctx && ctx.runId)', runAt) > runAt
  && tr.indexOf('o.quota.consumeTool(', runAt) < tr.indexOf('await call(mcpTool.name', runAt), 'the connector door counts BEFORE the call leaves');
const reqAt = web.indexOf("name: 'web_request'");
const consumeAt = web.indexOf('deps.hostQuota.consume(u.hostname, ctx && ctx.runId)');
A.ok(consumeAt > 0, 'web_request counts the destination host with the host-minted runId');
A.ok(consumeAt < web.indexOf('const secretHeaders = new Set();', consumeAt - 2000) || consumeAt < web.indexOf('fetch', consumeAt), 'before any secret is resolved or the request is sent');
A.report('hostquota port wiring');

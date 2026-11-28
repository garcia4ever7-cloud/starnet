// verify-set.mjs <name>... — for each name: the original + crop, via CENTRAL OUTBOX (/api/artifact + artifact ticket) and DELIVERABLES
// (/api/file + file ticket), fetched the way the page does (ticket, no token header), compared byte-for-byte with the file on disk.
import fs from 'node:fs'; import { createRequire } from 'node:module';
const require = createRequire(process.env.HOME + '/starnet-next/x.js'); const T = require('./sidecar/apitickets.js');
const U = 'http://127.0.0.1:8787', K = process.env.STARNET_API_TOKEN, H = { 'x-starnet-token': K }, W = process.env.HOME + '/.local/share/StarNet/workspaces/webdesigner';
const o = await (await fetch(U + '/api/outbox?agent=agent', { headers: H })).json(); const l = await (await fetch(U + '/api/deliverables?agent=agent', { headers: H })).json();
console.log('CENTRAL OUTBOX rows', o.count, '| DELIVERABLES total', l.total); let bad = 0;
for (const n of process.argv.slice(2)) for (const [rel, id] of [['outbox/litedesignz/seasons/bg-' + n + '-3840x2160.png', 'litedesignz-season-bg-' + n + '-3840x2160'], ['workshop/hf-litedesignz-seasons/' + n + '-original.png', 'litedesignz-season-original-' + n]]) {
  const orig = fs.readFileSync(W + '/' + rel); const r = o.rows.find(x => x.path === rel);
  const ra = await fetch(U + r.retrieve + '&ticket=' + encodeURIComponent(T.mint(K, 'artifact', T.scopeArtifact('agent', r.id), { now: Date.now(), ttlMs: 60000 }))); const ba = Buffer.from(await ra.arrayBuffer());
  const i = l.items.findIndex(x => x.id === id); const d = l.items[i]; const u = new URL(U + d.files[0].openUrl);
  const rf = await fetch(U + d.files[0].openUrl + '&ticket=' + encodeURIComponent(T.mint(K, 'file', T.scopeFile(u.searchParams.get('agent'), u.searchParams.get('path')), { now: Date.now(), ttlMs: 60000 }))); const bf = Buffer.from(await rf.arrayBuffer());
  const okA = ra.status === 200 && Buffer.compare(ba, orig) === 0, okF = rf.status === 200 && Buffer.compare(bf, orig) === 0; if (!okA || !okF) bad++;
  console.log(rel.split('/').pop().padEnd(44), r.width + 'x' + r.height, '| OUTBOX', okA ? 'identical' : 'FAIL ' + ra.status, '| DELIVERABLES #' + (i + 1), okF ? 'identical' : 'FAIL ' + rf.status, '|', orig.length, 'B');
}
console.log(bad ? 'FAILURES: ' + bad : 'ALL IDENTICAL');

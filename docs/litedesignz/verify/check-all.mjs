// check-all.mjs — every LiteDesignz file on disk vs CENTRAL OUTBOX (/api/outbox) and DELIVERABLES (/api/deliverables): is there a row
// pointing at it, and does a page-style ticketed fetch return the exact bytes? Read-only.
import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module';
const require = createRequire(process.env.HOME + '/starnet-next/x.js'); const T = require('./sidecar/apitickets.js');
const U = 'http://127.0.0.1:8787', K = process.env.STARNET_API_TOKEN, H = { 'x-starnet-token': K }, W = process.env.HOME + '/.local/share/StarNet/workspaces';
const dirs = [['webdesigner','outbox/litedesignz'],['webdesigner','outbox/litedesignz/seasons'],['webdesigner','workshop/hf-litedesignz-seasons'],['webdesigner','workshop/hf-litedesignz-redo'],['webdesigner','workshop/claude-code-litedesignz-icon-v3'],['publisher','outbox/litedesignz'],['webdesigner','styles']];
const files = [];
for (const [a, d] of dirs) for (const f of fs.readdirSync(path.join(W, a, d))) {
  const full = path.join(W, a, d, f); if (!fs.statSync(full).isFile() || /\.bak|\.py$|\.sh$|\.mjs$/.test(f)) continue;
  if (d === 'styles' && f !== 'litedesignz-garden-of-memories.md') continue;
  files.push({ agent: a, rel: d + '/' + f, full });
}
const o = await (await fetch(U + '/api/outbox?agent=agent', { headers: H })).json();
const l = await (await fetch(U + '/api/deliverables?agent=agent&limit=1000', { headers: H })).json();
const items = l.items || [];
const ldOut = o.rows.filter(r => r.projectId === 'litedesignz' || /litedesignz/.test(r.path || ''));
const ldLib = items.filter(i => /litedesignz/.test(i.id || '') || (i.files || []).some(f => /litedesignz/.test(f.openUrl || f.path || '')));
console.log('OUTBOX litedesignz rows', ldOut.length, '| DELIVERABLES litedesignz cards', ldLib.length, '| library total', l.total, 'items returned', items.length);
const sha = b => require('crypto').createHash('sha256').update(b).digest('hex');
const libBytes = new Map(); // sha -> card ids (cards may point at byte-identical workshop copies)
for (const it of ldLib) for (const f of (it.files || [])) {
  const u = new URL(U + f.openUrl); const tk = T.mint(K, 'file', T.scopeFile(u.searchParams.get('agent'), u.searchParams.get('path')), { now: Date.now(), ttlMs: 60000 });
  const r = await fetch(U + f.openUrl + '&ticket=' + encodeURIComponent(tk)); const b = Buffer.from(await r.arrayBuffer());
  if (r.status === 200) { const h = sha(b); libBytes.set(h, (libBytes.get(h) || []).concat(it.id)); } else console.log('  LIB FETCH FAIL', it.id, r.status);
}
const out = [];
for (const f of files) {
  const disk = fs.readFileSync(f.full); const h = sha(disk);
  const rows = o.rows.filter(r => (r.owner || r.ownerAgentId) === f.agent && r.path === f.rel);
  let ob = 'MISSING';
  if (rows.length) { const r = rows[0]; const rr = await fetch(U + r.retrieve + '&ticket=' + encodeURIComponent(T.mint(K, 'artifact', T.scopeArtifact('agent', r.id), { now: Date.now(), ttlMs: 60000 })));
    const b = Buffer.from(await rr.arrayBuffer()); ob = rr.status === 200 && sha(b) === h ? 'ok' + (rows.length > 1 ? ' (x' + rows.length + ')' : '') : 'MISMATCH ' + rr.status; }
  const lib = libBytes.get(h); out.push({ rel: f.agent + '/' + f.rel, bytes: disk.length, outbox: ob, deliverables: lib ? 'ok ' + lib.join(',') : 'MISSING' });
}
for (const x of out) console.log((x.outbox.startsWith('ok') && x.deliverables.startsWith('ok') ? '  ' : '! ') + x.rel.padEnd(70), String(x.bytes).padStart(9), '| OUTBOX', x.outbox.padEnd(8), '| DELIV', x.deliverables.slice(0, 60));
const orphanOut = ldOut.filter(r => !files.some(f => f.agent === (r.owner || r.ownerAgentId) && f.rel === r.path)); console.log('outbox rows pointing at no listed file:', orphanOut.map(r => (r.owner || r.ownerAgentId) + '/' + r.path).join(' ') || 'none');

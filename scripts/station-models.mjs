#!/usr/bin/env node
// Model assignment CLI — change which model each agent runs, and get back safely.
//
// WHY THIS EXISTS: changing an agent's model by hand is a three-step dance that fails SILENTLY if
// you miss a step. `agent.save.json` (doc.agents[] — the durable source) and `agent.roster.json`
// (the live mirror the running sidecar uses) must BOTH change, and `doc.updatedAt` must be bumped
// past what the browser last saw or a station tab will quietly push the old models back on its next
// reconcile. This script does all of it, snapshots before every mutation, and verifies afterwards.
//
//   node scripts/station-models.mjs list                      # who runs what, + usable free models
//   node scripts/station-models.mjs snapshot [label]          # save the current assignment
//   node scripts/station-models.mjs snapshots                 # list saved snapshots
//   node scripts/station-models.mjs set <agentId|all> <model> # change (auto-snapshots first)
//   node scripts/station-models.mjs revert                    # undo the most recent change
//   node scripts/station-models.mjs restore <file|label>      # go back to a named snapshot
//
// The station should be RUNNING: the roster push needs the live API. If it is down, the durable
// file is still written and the script says plainly that the live mirror was not updated.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

// Reuse the REAL wire adapter for the post-switch probe below — not a hand-rolled fetch call. Rolling our
// own would drift from the real reasoning-effort clamping (sidecar/providers/openrouter.js) the 2026-10-21
// incident fixed, and silently stop testing what the station actually sends the day that logic next changes.
const require = createRequire(import.meta.url);
const { makeOpenRouterProvider } = require('../sidecar/providers/openrouter.js');

const HOME = os.homedir();
const WORKSPACES = process.env.WORKSPACES
  ? path.resolve(process.env.WORKSPACES)
  : path.join(HOME, '.local', 'share', 'StarNet', 'workspaces');
const SAVE = path.join(WORKSPACES, 'agent.save.json');
const ROSTER = path.join(WORKSPACES, 'agent.roster.json');
const SNAPDIR = path.join(WORKSPACES, 'model-snapshots');
const ENVFILE = process.env.STARNET_ENVFILE || path.join(HOME, '.config', 'starnet', 'env');
const PORT = process.env.STARNET_PORT || process.env.PORT || '8787';
const BASE = 'http://127.0.0.1:' + PORT;

const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const die = m => { console.error('error: ' + m); process.exit(1); };

function usage(code = 1) {
  console.log([
    'StarNet model assignment',
    '',
    '  list                       who runs what, plus the free models that actually work',
    '  snapshot [label]           save the current assignment',
    '  snapshots                  list saved snapshots',
    '  set <agentId|all> <model>  change a model (snapshots first, automatically)',
    '  revert                     undo the most recent change',
    '  restore <file|label>       go back to a named snapshot',
    '',
    'Workspaces: ' + WORKSPACES
  ].join('\n'));
  process.exit(code);
}

// The API token lives in the launcher env file. ~/.config/starnet/.apitoken has drifted stale
// before, so the env file is the source of truth and is read directly rather than trusted second-hand.
function token() {
  if (process.env.STARNET_API_TOKEN) return process.env.STARNET_API_TOKEN.trim();
  try {
    const line = fs.readFileSync(ENVFILE, 'utf8').split('\n')
      .find(l => /^\s*(export\s+)?STARNET_API_TOKEN=/.test(l));
    return line ? line.replace(/^\s*(export\s+)?STARNET_API_TOKEN=/, '').replace(/^["']|["']$/g, '').trim() : '';
  } catch (_) { return ''; }
}

// Same env-file-is-truth rule as token() above, for whichever of the two accepted key names is present.
function openrouterKey() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY.trim();
  if (process.env.OPENROUTER_KEY) return process.env.OPENROUTER_KEY.trim();
  try {
    const line = fs.readFileSync(ENVFILE, 'utf8').split('\n')
      .find(l => /^\s*(export\s+)?OPENROUTER_(API_)?KEY=/.test(l));
    return line ? line.replace(/^\s*(export\s+)?OPENROUTER_(API_)?KEY=/, '').replace(/^["']|["']$/g, '').trim() : '';
  } catch (_) { return ''; }
}

/* POST-SWITCH VERIFICATION (2026-10-21, after a reasoning-effort catalog bug let a bad model assignment
   sit live for hours before anyone noticed). ONE tiny real request through the real adapter, 'low' effort
   to keep it cheap on a paid model (free models cost $0 either way) and bounded to 30s so a hung endpoint
   can't hang the CLI. Returns the EXACT error text the adapter raised — the whole point is that a silent
   failure must become a loud, specific one. */
async function probeModel(model) {
  const key = openrouterKey();
  if (!key) return { ok: false, skipped: true, error: 'no OPENROUTER_API_KEY/OPENROUTER_KEY found in ' + ENVFILE + ' or environment — cannot verify, leaving the change unverified' };
  const provider = makeOpenRouterProvider({ key, fetch, reasoningEffort: 'low', referer: 'http://127.0.0.1' });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    let answered = false;
    for await (const ev of provider.stream({ model, reasoningEffort: 'low', messages: [{ role: 'user', content: 'Reply with exactly: OK' }], signal: ctrl.signal })) {
      if (ev && ((ev.type === 'text' && ev.delta) || ev.type === 'done')) answered = true;
    }
    if (!answered) return { ok: false, error: 'the model accepted the request but returned no response' };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: ctrl.signal.aborted ? 'verification request timed out after 30s' : String((e && e.message) || e) };
  } finally { clearTimeout(timer); }
}

async function api(route, body) {
  const res = await fetch(BASE + route, {
    method: body === undefined ? 'GET' : 'POST',
    headers: Object.assign({ 'x-starnet-token': token() }, body === undefined ? {} : { 'Content-Type': 'application/json' }),
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000)
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch (_) {}
  return { ok: res.ok, status: res.status, json, text };
}

function currentAssignment() {
  const doc = readJson(SAVE).doc;
  return doc.agents.map(a => ({ agentId: a.id, name: a.name || a.id, provider: a.provider || 'openrouter', model: a.model }));
}

function writeSnapshot(label) {
  fs.mkdirSync(SNAPDIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safe = String(label || 'auto').replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 40);
  const file = path.join(SNAPDIR, stamp + '__' + safe + '.json');
  fs.writeFileSync(file, JSON.stringify({ savedAt: Date.now(), label: safe, agents: currentAssignment() }, null, 2) + '\n');
  return file;
}

function listSnapshots() {
  if (!fs.existsSync(SNAPDIR)) return [];
  return fs.readdirSync(SNAPDIR).filter(f => f.endsWith('.json')).sort();
}

function resolveSnapshot(ref) {
  if (!ref) return null;
  if (fs.existsSync(ref)) return path.resolve(ref);
  const all = listSnapshots();
  if (ref === 'last') return all.length ? path.join(SNAPDIR, all[all.length - 1]) : null;
  const hit = all.filter(f => f.includes(ref));
  if (!hit.length) return null;
  return path.join(SNAPDIR, hit[hit.length - 1]);
}

/* THE WHOLE POINT OF THIS FILE. `assign` is a Map of agentId -> model; anything absent is left
   alone. Both files get the SAME `updatedAt`, which is also what the roster push is stamped with —
   the sidecar refuses a stamp older than the one it last accepted, and the browser adopts whichever
   copy has the newer stamp. Miss the bump and a station tab silently undoes you. */
async function applyAssignment(assign, { label, verify = true }) {
  const before = currentAssignment();
  const unknown = [...assign.keys()].filter(id => !before.some(a => a.agentId === id));
  if (unknown.length) die('no such agent: ' + unknown.join(', ') + ' (have: ' + before.map(a => a.agentId).join(', ') + ')');

  const snapFile = writeSnapshot(label);
  const stamp = Date.now();
  for (const f of [SAVE, ROSTER]) fs.copyFileSync(f, f + '.bak-' + stamp);

  const save = readJson(SAVE), doc = save.doc;
  const changed = [];
  for (const a of doc.agents) {
    if (!assign.has(a.id)) continue;
    const next = assign.get(a.id);
    if (a.model !== next) changed.push({ agentId: a.id, from: a.model, to: next });
    a.model = next; a.provider = 'openrouter';
  }
  // doc.agent is the hero singleton and is a real second copy — missing it leaves the station
  // disagreeing with itself about what the Commander runs.
  if (doc.agent && typeof doc.agent === 'object' && assign.has(doc.agent.id || 'agent')) {
    doc.agent.model = assign.get(doc.agent.id || 'agent'); doc.agent.provider = 'openrouter';
  }
  doc.updatedAt = stamp;
  doc._saveRevision = (Number(doc._saveRevision) || 0) + 1;
  save.updatedAt = stamp;
  fs.writeFileSync(SAVE, JSON.stringify(save));

  const roster = readJson(ROSTER);
  for (const a of roster.agents) if (assign.has(a.agentId)) { a.model = assign.get(a.agentId); a.provider = 'openrouter'; }

  let live = 'not pushed';
  try {
    const r = await api('/api/roster', { agents: roster.agents, updatedAt: stamp });
    if (r.ok && r.json && r.json.ok) live = 'pushed to live sidecar (' + r.json.count + ' agents)';
    else if (r.json && r.json.stale) live = 'REFUSED AS STALE — something newer already landed; re-run list';
    else live = 'push failed: HTTP ' + r.status + ' ' + (r.text || '').slice(0, 120);
  } catch (e) {
    live = 'push failed (' + ((e && e.message) || e) + ') — station may be down; the durable file IS written, so it takes effect on next boot';
  }

  console.log('snapshot: ' + snapFile);
  console.log('backups:  ' + path.basename(SAVE) + '.bak-' + stamp + ', ' + path.basename(ROSTER) + '.bak-' + stamp);
  if (!changed.length) console.log('no change — already assigned that way');
  for (const c of changed) console.log('  ' + c.agentId.padEnd(13) + c.from + '  ->  ' + c.to);
  console.log('live:     ' + live);

  // POST-SWITCH VERIFICATION: one tiny real request per newly-assigned model (deduped — "set all x" probes
  // x once, not five times). A failure here means the SAME failure would hit a real scheduled run later,
  // silently, hours from now — so it reverts immediately instead of leaving a known-bad model live.
  if (changed.length && verify) {
    const toVerify = [...new Set(changed.map(c => c.to))];
    console.log('\nverifying ' + toVerify.length + ' newly assigned model(s) with a tiny live request...');
    const failures = [];
    for (const m of toVerify) {
      const r = await probeModel(m);
      if (r.ok) console.log('  OK      ' + m);
      else { console.log('  ' + (r.skipped ? 'SKIPPED ' : 'FAILED  ') + m + ' — ' + r.error); if (!r.skipped) failures.push({ model: m, error: r.error }); }
    }
    if (failures.length) {
      console.log('\n' + failures.length + ' model(s) failed verification — reverting to the pre-change snapshot automatically...');
      const revertAssign = new Map(before.map(a => [a.agentId, a.model]));
      await applyAssignment(revertAssign, { label: 'auto-revert-after-failed-verify', verify: false });
      console.log('\nREVERTED — the exact error(s) that caused it:');
      for (const f of failures) console.log('  ' + f.model + ': ' + f.error);
      process.exitCode = 1;
      return changed;
    }
  }

  if (changed.length) console.log('\nReload any open StarNet browser tab — the frontend owns the roster and a stale tab can push the old models back.');
  return changed;
}

async function cmdList() {
  const cur = currentAssignment();
  console.log('ASSIGNED');
  for (const a of cur) console.log('  ' + a.agentId.padEnd(13) + a.name.padEnd(15) + a.model);
  const r = await api('/api/models/openrouter');
  if (!r.ok || !r.json) { console.log('\n(catalog unavailable — station down? HTTP ' + r.status + ')'); return; }
  const list = r.json.models || r.json.data || [];
  const free = list.filter(m => /:free$/.test(m.id) && m.supportsTools)
    .sort((a, b) => (b.context_length || 0) - (a.context_length || 0));
  console.log('\nFREE MODELS WITH TOOL SUPPORT (' + free.length + ')');
  for (const m of free) console.log('  ' + String(m.context_length || 0).padStart(8) + '  ' + m.id);
  console.log('\nBenchmarked 2026-10-20 — fastest first: minimax/minimax-m3.1-flash:free (7-14s),');
  console.log('nemotron-3.5-lightning (16-49s), nemotron-3-ultra-550b (27-55s). Vision: nemotron-3.5-super-vl.');
  console.log('KNOWN BAD on this key: thinkingmachines/inkling*:free (HTTP 403), google/gemma-4-31b-it:free (429).');
}

const argv = process.argv.slice(2);
const cmd = argv[0];

if (!cmd || cmd === 'help' || cmd === '--help') usage(0);
if (!fs.existsSync(SAVE)) die('no agent.save.json at ' + SAVE);

if (cmd === 'list') {
  await cmdList();
} else if (cmd === 'snapshot') {
  console.log('saved: ' + writeSnapshot(argv[1] || 'manual'));
} else if (cmd === 'snapshots') {
  const all = listSnapshots();
  if (!all.length) { console.log('no snapshots yet (' + SNAPDIR + ')'); }
  else for (const f of all) {
    const s = readJson(path.join(SNAPDIR, f));
    console.log('  ' + f + '\n      ' + s.agents.map(a => a.agentId + '=' + String(a.model).split('/').pop()).join(', '));
  }
} else if (cmd === 'set') {
  const who = argv[1], model = argv[2];
  if (!who || !model) usage();
  const cur = currentAssignment();
  const assign = new Map();
  if (who === 'all') for (const a of cur) assign.set(a.agentId, model);
  else assign.set(who, model);
  await applyAssignment(assign, { label: 'before-set-' + (who === 'all' ? 'all' : who) });
} else if (cmd === 'revert' || cmd === 'restore') {
  // `revert` means "undo the last change", so it restores the snapshot taken BEFORE that change —
  // which is the most recent file on disk, because every mutation snapshots first.
  const ref = cmd === 'revert' ? 'last' : argv[1];
  if (cmd === 'restore' && !ref) usage();
  const file = resolveSnapshot(ref);
  if (!file) die(cmd === 'revert' ? 'no snapshots to revert to' : 'no snapshot matching: ' + ref);
  const snap = readJson(file);
  console.log('restoring from ' + path.basename(file) + ' (saved ' + new Date(snap.savedAt).toISOString() + ')');
  const assign = new Map(snap.agents.map(a => [a.agentId, a.model]));
  await applyAssignment(assign, { label: 'before-restore' });
} else {
  usage();
}

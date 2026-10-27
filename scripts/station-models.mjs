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
// Go through the FACTORY, not one adapter: the station now runs agents on more than one provider
// (openrouter + the local omniroute router), and the probe must exercise whichever adapter the
// assignment actually selects — otherwise "verified" means "verified on a provider we did not switch to".
const { selectProvider } = require('../sidecar/providers/factory.js');
const { getProviderProfile, normalizeProviderId, providerIds } = require('../sidecar/providers/registry.js');

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
    '  set <agentId|all> <model> [--provider <id>]',
    '                             change a model (snapshots first, automatically).',
    '                             --provider also moves the agent to that provider;',
    '                             omit it and each agent KEEPS its current provider.',
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

// Same env-file-is-truth rule as token() above, for whichever of a provider's accepted key names is
// present. The NAMES come from the registry profile (keyEnv), so a provider added there is probeable
// here without touching this function — the vocabulary stays in one place.
function providerKeyFor(providerId) {
  const profile = getProviderProfile(providerId);
  const names = (profile && Array.isArray(profile.keyEnv)) ? profile.keyEnv : [];
  for (const n of names) {
    if (process.env[n] && String(process.env[n]).trim()) return String(process.env[n]).trim();
  }
  try {
    const lines = fs.readFileSync(ENVFILE, 'utf8').split('\n');
    for (const n of names) {
      const re = new RegExp('^\\s*(export\\s+)?' + n + '=');
      const line = lines.find(l => re.test(l));
      if (line) {
        const v = line.replace(re, '').replace(/^["']|["']$/g, '').trim();
        if (v) return v;
      }
    }
  } catch (_) { /* no env file — fall through to "no key" */ }
  return '';
}

/* POST-SWITCH VERIFICATION (2026-10-21, after a reasoning-effort catalog bug let a bad model assignment
   sit live for hours before anyone noticed). ONE tiny real request through the real adapter, 'low' effort
   to keep it cheap on a paid model (free models cost $0 either way) and bounded to 30s so a hung endpoint
   can't hang the CLI. Returns the EXACT error text the adapter raised — the whole point is that a silent
   failure must become a loud, specific one. */
async function probeModel(model, providerId) {
  const id = normalizeProviderId(providerId || 'openrouter', '') || 'openrouter';
  const profile = getProviderProfile(id);
  if (!profile) return { ok: false, skipped: true, error: 'unknown provider "' + id + '" — not in sidecar/providers/registry.js' };
  const key = providerKeyFor(id);
  if (!key && profile.keyRequired !== false) {
    return { ok: false, skipped: true, error: 'no ' + (profile.keyEnv || []).join('/') + ' found in ' + ENVFILE + ' or environment — cannot verify, leaving the change unverified' };
  }
  let provider;
  try {
    provider = selectProvider({ provider: id, key, fetch, reasoningEffort: 'low', referer: 'http://127.0.0.1' });
  } catch (e) {
    return { ok: false, error: 'could not construct the ' + id + ' adapter: ' + String((e && e.message) || e) };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    let answered = false;
    for await (const ev of provider.stream({ model, reasoningEffort: 'low', messages: [{ role: 'user', content: 'Reply with exactly: OK' }], signal: ctrl.signal })) {
      // adapters differ on the text field name (openrouter: delta, openai-compatible: text); `done`
      // alone also counts, since a tool-only reply is still proof the endpoint accepted the model.
      if (ev && ((ev.type === 'text' && (ev.delta || ev.text)) || ev.type === 'done')) answered = true;
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
    if (a.model !== next.model || (a.provider || 'openrouter') !== next.provider) {
      changed.push({ agentId: a.id, from: a.model, fromProvider: a.provider || 'openrouter', to: next.model, toProvider: next.provider });
    }
    a.model = next.model; a.provider = next.provider;
  }
  // doc.agent is the hero singleton and is a real second copy — missing it leaves the station
  // disagreeing with itself about what the Commander runs.
  if (doc.agent && typeof doc.agent === 'object' && assign.has(doc.agent.id || 'agent')) {
    const next = assign.get(doc.agent.id || 'agent');
    doc.agent.model = next.model; doc.agent.provider = next.provider;
  }
  doc.updatedAt = stamp;
  doc._saveRevision = (Number(doc._saveRevision) || 0) + 1;
  save.updatedAt = stamp;
  fs.writeFileSync(SAVE, JSON.stringify(save));

  const roster = readJson(ROSTER);
  for (const a of roster.agents) if (assign.has(a.agentId)) { const n = assign.get(a.agentId); a.model = n.model; a.provider = n.provider; }

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
  for (const c of changed) {
    const moved = c.fromProvider !== c.toProvider ? '  [' + c.fromProvider + ' -> ' + c.toProvider + ']' : '';
    console.log('  ' + c.agentId.padEnd(13) + c.from + '  ->  ' + c.to + moved);
  }
  console.log('live:     ' + live);

  // POST-SWITCH VERIFICATION: one tiny real request per newly-assigned model (deduped — "set all x" probes
  // x once, not five times). A failure here means the SAME failure would hit a real scheduled run later,
  // silently, hours from now — so it reverts immediately instead of leaving a known-bad model live.
  if (changed.length && verify) {
    // dedupe on provider+model: the same slug on two providers is two different things to verify.
    const toVerify = [...new Map(changed.map(c => [c.toProvider + '' + c.to, { model: c.to, provider: c.toProvider }])).values()];
    console.log('\nverifying ' + toVerify.length + ' newly assigned model(s) with a tiny live request...');
    const failures = [];
    for (const t of toVerify) {
      const label = t.provider + ' ' + t.model;
      const r = await probeModel(t.model, t.provider);
      if (r.ok) console.log('  OK      ' + label);
      else { console.log('  ' + (r.skipped ? 'SKIPPED ' : 'FAILED  ') + label + ' — ' + r.error); if (!r.skipped) failures.push({ model: label, error: r.error }); }
    }
    if (failures.length) {
      console.log('\n' + failures.length + ' model(s) failed verification — reverting to the pre-change snapshot automatically...');
      const revertAssign = new Map(before.map(a => [a.agentId, { model: a.model, provider: a.provider }]));
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
  for (const a of cur) console.log('  ' + a.agentId.padEnd(13) + a.name.padEnd(15) + (a.provider || 'openrouter').padEnd(11) + a.model);

  // show the catalog for every provider the roster is ACTUALLY on, not just openrouter
  const inUse = [...new Set(cur.map(a => a.provider || 'openrouter'))];
  const fb = await api('/api/fallback/chain');
  if (fb.ok && fb.json && Array.isArray(fb.json.chain)) {
    console.log('\nFALLBACK CHAIN (' + fb.json.chain.length + ', tried in order when a run fails over)');
    for (const m of fb.json.chain) console.log('  ' + m);
    if (!fb.json.chain.length) console.log('  (empty — no model fallback configured)');
  }

  for (const pid of inUse) {
    const r = await api('/api/models/' + pid);
    if (!r.ok || !r.json) { console.log('\n(' + pid + ' catalog unavailable — station down? HTTP ' + r.status + ')'); continue; }
    const list = r.json.models || r.json.data || [];
    if (pid === 'openrouter') {
      const free = list.filter(m => /:free$/.test(m.id) && m.supportsTools)
        .sort((a, b) => (b.context_length || 0) - (a.context_length || 0));
      console.log('\nOPENROUTER — FREE MODELS WITH TOOL SUPPORT (' + free.length + ')');
      for (const m of free) console.log('  ' + String(m.context_length || 0).padStart(8) + '  ' + m.id);
    } else {
      console.log('\n' + pid.toUpperCase() + ' — CATALOG (' + list.length + ' ids)');
      console.log('  (capability is NOT published by this endpoint — measure before trusting a name:');
      console.log('   node scripts/probe-omniroute-models.mjs)');
    }
  }
  console.log('\nOmniRoute free models measured tool-capable 2026-10-24 (fastest first):');
  console.log('  cf/@cf/meta/llama-4-scout-17b-16e-instruct, cf/@cf/openai/gpt-oss-20b,');
  console.log('  cf/@cf/meta/llama-3.3-70b-instruct-fp8-fast, cf/@cf/nvidia/nemotron-3-120b-a12b.');
  console.log('KNOWN BAD on this Cloudflare account: glm-5.x, deepseek-v4*, kimi-k2* (all HTTP 403 — not entitled).');
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
  const flagIdx = argv.indexOf('--provider');
  const flagVal = flagIdx >= 0 ? argv[flagIdx + 1] : null;
  const positional = argv.filter((_, i) => i !== flagIdx && i !== flagIdx + 1);
  const who = positional[1], model = positional[2];
  if (!who || !model) usage();
  if (flagIdx >= 0 && !flagVal) die('--provider needs a value (e.g. --provider omniroute)');
  const cur = currentAssignment();
  // No --provider = keep each agent on the provider it is already on. Changing a model must never
  // silently move an agent to a different (possibly PAID) provider as a side effect.
  const pick = a => {
    const id = flagVal ? normalizeProviderId(flagVal, '') : (a.provider || 'openrouter');
    if (flagVal && !getProviderProfile(id)) {
      die('unknown provider: ' + flagVal + ' (known: ' + (providerIds ? providerIds().join(', ') : 'see sidecar/providers/registry.js') + ')');
    }
    return { model, provider: id };
  };
  const assign = new Map();
  if (who === 'all') for (const a of cur) assign.set(a.agentId, pick(a));
  else {
    const a = cur.find(x => x.agentId === who) || { agentId: who, provider: 'openrouter' };
    assign.set(who, pick(a));
  }
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
  // older snapshots predate per-agent provider capture; default them to openrouter, which is what
  // every assignment written before that change actually was.
  const assign = new Map(snap.agents.map(a => [a.agentId, { model: a.model, provider: a.provider || 'openrouter' }]));
  await applyAssignment(assign, { label: 'before-restore' });
} else {
  usage();
}

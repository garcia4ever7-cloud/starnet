#!/usr/bin/env node
// agent-config-integrity.mjs — READ-ONLY check that agent.save.json and agent.roster.json agree on CONTENT.
//
// Why content, not timestamps: the browser writes the two files with separate requests, and each stamps its
// own Date.now(). persist() runs on almost every station change; pushRoster() runs only when the roster
// shape changes (frontend/app/app.js persist / pushRoster). So save.doc.updatedAt is normally seconds to
// hours AHEAD of roster.updatedAt, and nothing in the harness compares the two stamps — reconcile() only
// compares the browser copy against GET /api/save, gated by _saveRevision (frontend/app/cloudsave.js).
// A timestamp delta by itself is therefore not a defect, and "syncing" the stamps fixes nothing.
//
// What CAN go wrong, and what this checks:
//   1. A roster entry without a valid agentId — replaceAgentRoster() (sidecar/index.js) silently skips it,
//      so the next sidecar boot loads a roster missing that agent (or an empty roster).
//   2. The two files listing different agents, or either listing one agent twice.
//   3. The two files disagreeing on a field the running sidecar acts on (model, provider, approvalMode, ...),
//      judged AFTER the same normalization the sidecar applies, so a legal save is never a false alarm.
//   4. A save doc whose _saveRevision is not a finite number — the guard that protects out-of-band edits.
//
// Workspace: resolved exactly like the sidecar (STARNET_WORKSPACES / SKYNET_WORKSPACES, else XDG_DATA_HOME or
// ~/.local/share → StarNet/workspaces, falling back to a legacy Skynet/workspaces in place). `--workspaces <dir>`
// overrides. A bare WORKSPACES that disagrees with that resolution is refused (exit 2) rather than guessed.
//
// Usage:  node scripts/agent-config-integrity.mjs [--json] [--workspaces <dir>]
// Exit:   0 consistent · 1 divergence found · 2 a file could not be read, or the workspace is ambiguous
// Changes nothing. Never prints an agent's system prompt or any credential.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// The sidecar's OWN normalizers — not copies — so this check cannot drift from what boot actually loads.
const providerRegistry = require('../sidecar/providers/registry.js');
const executionProfiles = require('../sidecar/execution-profiles.js');

const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;   // mirrors replaceAgentRoster()'s accept rule
// Fields pushRoster() projects from the saved agent into the roster and the running sidecar acts on.
// NOT compared: `system` — the roster's copy is the browser's runtime a.systemPrompt (persona + specialty),
// which is never persisted in the save, so a save/roster difference there is by design.
export const COMPARED_FIELDS = ['name', 'model', 'provider', 'approvalMode', 'executionProfile', 'workshop', 'skills', 'reasoningEffort'];

/* Project one agent record to what the sidecar would hold after replaceAgentRoster(), applying the
   browser's pushRoster() projection first (it is idempotent on an already-projected roster record):
     pushRoster:          approvalMode 'full'|'ask'; executionProfileOf() → unknown id becomes 'station-gear';
                          workshop → boolean; name falls back to the id.
     replaceAgentRoster:  name.slice(0,40); provider via normalizeProviderId; executionProfile via
                          execution-profiles normalizeId; skills trimmed, deduped, capped at 40.
   An empty provider is returned as null: pushRoster fills it with the station default, which this
   offline check cannot know, so an unpinned side is never compared. */
export function sidecarView(a, id) {
  a = a || {};
  const approvalMode = a.approvalMode === 'full' ? 'full' : 'ask';
  const rawProvider = String(a.provider || '').trim();
  const provider = rawProvider ? (providerRegistry.normalizeProviderId(rawProvider, '') || rawProvider) : null;
  const skills = Array.isArray(a.skills)
    ? [...new Set(a.skills.map(s => String(s || '').trim()).filter(Boolean))].slice(0, 40).sort()
    : [];
  return {
    name: String(a.name || id).slice(0, 40),
    model: a.model ? String(a.model) : null,
    provider,
    approvalMode,
    executionProfile: executionProfiles.normalizeId(a.executionProfile, { approvalMode }),
    workshop: !!a.workshop,
    skills,
    reasoningEffort: a.reasoningEffort ? String(a.reasoningEffort) : null,
  };
}

function isRevision(v) { return typeof v === 'number' && Number.isFinite(v); }

/** Pure comparison. `save` is the parsed agent.save.json envelope, `roster` the parsed agent.roster.json. */
export function compareAgentConfig(save, roster) {
  const problems = [];
  const doc = save && save.doc;
  const saveAgents = doc && Array.isArray(doc.agents) ? doc.agents : null;
  const rosterAgents = roster && Array.isArray(roster.agents) ? roster.agents : null;
  if (!saveAgents) problems.push({ kind: 'save-shape', detail: 'agent.save.json has no doc.agents[] array' });
  if (!rosterAgents) problems.push({ kind: 'roster-shape', detail: 'agent.roster.json has no agents[] array' });
  if (!saveAgents || !rosterAgents) return { ok: false, problems, info: {} };

  if (!isRevision(doc._saveRevision)) {
    problems.push({ kind: 'save-revision', detail: 'doc._saveRevision is missing or not a finite number (got ' + JSON.stringify(doc._saveRevision) + ')' });
  }

  const rosterById = new Map();
  rosterAgents.forEach((a, i) => {
    const id = a && a.agentId != null ? String(a.agentId) : '';
    if (!ID_RE.test(id)) {
      const hint = a && a.id ? ' (has `id`=' + JSON.stringify(String(a.id)).slice(0, 44) + ' — save-shaped record written into the roster)' : '';
      problems.push({ kind: 'roster-agentId', detail: 'roster entry #' + i + ' has no valid agentId; the sidecar drops it at boot' + hint });
      return;
    }
    if (rosterById.has(id)) problems.push({ kind: 'roster-duplicate', detail: 'agentId ' + id + ' appears more than once in the roster' });
    rosterById.set(id, a);
  });

  const saveById = new Map();
  saveAgents.forEach((a, i) => {
    const id = a && a.id != null ? String(a.id) : '';
    if (!id) { problems.push({ kind: 'save-id', detail: 'save agent #' + i + ' has no id' }); return; }
    if (saveById.has(id)) problems.push({ kind: 'save-duplicate', detail: 'id ' + id + ' appears more than once in the save; only one copy can win' });
    saveById.set(id, a);
  });

  for (const id of saveById.keys()) if (!rosterById.has(id)) problems.push({ kind: 'missing-in-roster', detail: id });
  for (const id of rosterById.keys()) if (!saveById.has(id)) problems.push({ kind: 'missing-in-save', detail: id });

  for (const [id, s] of saveById) {
    const r = rosterById.get(id);
    if (!r) continue;
    const sv = sidecarView(s, id), rv = sidecarView(r, id);
    for (const f of COMPARED_FIELDS) {
      if (f === 'provider' && (sv.provider === null || rv.provider === null)) continue;
      const a = JSON.stringify(sv[f]), b = JSON.stringify(rv[f]);
      if (a !== b) problems.push({ kind: 'field', detail: id + '.' + f + ': save=' + a.slice(0, 80) + ' roster=' + b.slice(0, 80) });
    }
  }

  const saveTs = Number(doc.updatedAt), rosterTs = Number(roster.updatedAt);
  const info = {
    agents: saveById.size,
    saveRevision: doc._saveRevision,
    saveUpdatedAt: Number.isFinite(saveTs) ? saveTs : null,
    rosterUpdatedAt: Number.isFinite(rosterTs) ? rosterTs : null,
    deltaMs: Number.isFinite(saveTs) && Number.isFinite(rosterTs) ? saveTs - rosterTs : null,
  };
  return { ok: problems.length === 0, problems, info };
}

/* Resolve the workspace the way sidecar/index.js does: ENV('WORKSPACES') (STARNET_ wins, else SKYNET_),
   else defaultWorkspaces(). Returns { dir, source } or { error }. Pure given its inputs (testable). */
export function resolveWorkspaces({ env = process.env, platform = process.platform, homedir = os.homedir(), exists = fs.existsSync, override = '' } = {}) {
  if (override) return { dir: path.resolve(override), source: '--workspaces' };
  const scoped = ('STARNET_WORKSPACES' in env) ? env.STARNET_WORKSPACES : env.SKYNET_WORKSPACES;
  let dir, source;
  if (scoped) { dir = path.resolve(scoped); source = ('STARNET_WORKSPACES' in env) ? 'STARNET_WORKSPACES' : 'SKYNET_WORKSPACES'; }
  else if (platform === 'darwin') { dir = path.join(homedir || '.', 'Library', 'Application Support', 'ai.skynet.harness', 'workspaces'); source = 'default (darwin)'; }
  else {
    const base = env.LOCALAPPDATA || env.APPDATA || env.XDG_DATA_HOME || path.join(homedir || '.', '.local', 'share');
    const neu = path.join(base, 'StarNet', 'workspaces'), old = path.join(base, 'Skynet', 'workspaces');
    let useOld = false;
    try { useOld = !exists(neu) && exists(old); } catch (_) {}
    dir = useOld ? old : neu; source = useOld ? 'default (legacy Skynet dir)' : 'default';
  }
  // A bare WORKSPACES (scripts/station-models.mjs convention) is NOT read by the sidecar. If it points
  // somewhere else, the operator's intent is ambiguous — refuse rather than report on the wrong station.
  if (env.WORKSPACES && path.resolve(env.WORKSPACES) !== dir) {
    return { error: 'WORKSPACES=' + path.resolve(env.WORKSPACES) + ' disagrees with the sidecar\'s workspace ' + dir
      + ' (' + source + '). The sidecar ignores bare WORKSPACES; set STARNET_WORKSPACES, or pass --workspaces <dir>.' };
  }
  return { dir, source };
}

/* True when this module is the script node was asked to run — compared by REAL path, so a symlinked
   invocation (e.g. /data/user/0/… vs /data/data/… on Android) still runs main() instead of exiting 0 silently. */
export function isMainModule(argv1, moduleUrl) {
  if (!argv1) return false;
  const real = (p) => { try { return fs.realpathSync(p); } catch (_) { return path.resolve(p); } };
  return real(argv1) === real(fileURLToPath(moduleUrl));
}

function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const wi = args.indexOf('--workspaces');
  const override = wi >= 0 ? String(args[wi + 1] || '') : '';
  const out = (obj, text, code) => { if (json) console.log(JSON.stringify(obj, null, 2)); else console[code === 2 ? 'error' : 'log'](text); process.exit(code); };
  if (wi >= 0 && !override) out({ ok: false, error: '--workspaces needs a directory' }, '--workspaces needs a directory', 2);

  const ws = resolveWorkspaces({ override });
  if (ws.error) out({ ok: false, error: ws.error }, ws.error, 2);
  const read = (f) => JSON.parse(fs.readFileSync(path.join(ws.dir, f), 'utf8'));
  let save, roster;
  try { save = read('agent.save.json'); roster = read('agent.roster.json'); } catch (e) {
    const msg = 'cannot read agent config in ' + ws.dir + ': ' + e.message;
    out({ ok: false, error: msg }, msg, 2);
  }
  const res = compareAgentConfig(save, roster);
  if (json) out(Object.assign({ workspaces: ws.dir, source: ws.source }, res), '', res.ok ? 0 : 1);
  const i = res.info;
  console.log('Workspaces: ' + ws.dir + '  [' + ws.source + ']');
  console.log('Agents: ' + i.agents + ' · save _saveRevision ' + i.saveRevision);
  if (i.deltaMs != null) {
    console.log('Timestamps (informational only — not a defect by itself): save ' + (i.deltaMs >= 0 ? 'newer' : 'OLDER') + ' than roster by ' + Math.abs(i.deltaMs) + ' ms');
  }
  if (res.ok) { console.log('CONSISTENT — every agent agrees on ' + COMPARED_FIELDS.join(', ')); process.exit(0); }
  console.log('DIVERGENT — ' + res.problems.length + ' problem(s):');
  for (const p of res.problems) console.log('  [' + p.kind + '] ' + p.detail);
  process.exit(1);
}

if (isMainModule(process.argv[1], import.meta.url)) main();

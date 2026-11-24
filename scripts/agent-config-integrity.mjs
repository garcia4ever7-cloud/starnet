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
//   2. The two files listing different agents.
//   3. The two files disagreeing on a field the running sidecar acts on (model, provider, approvalMode, ...).
//   4. A save doc with no numeric _saveRevision — the guard that actually protects out-of-band edits.
//
// Usage:  node scripts/agent-config-integrity.mjs [--json]
// Exit:   0 consistent · 1 divergence found · 2 a file could not be read/parsed
// Changes nothing. Never prints an agent's system prompt or any credential.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;   // mirrors replaceAgentRoster()'s accept rule
// Fields pushRoster() (frontend/app/app.js) projects from the saved agent into the roster, and the running
// sidecar acts on. Normalized the way pushRoster/replaceAgentRoster do: approvalMode anything-but-'full' is
// 'ask'; workshop is a boolean. NOT compared: `system` — the roster's copy is the browser's runtime
// a.systemPrompt (persona + specialty), which is never persisted in the save, so a save/roster length
// difference there is by design.
export const COMPARED_FIELDS = ['name', 'model', 'provider', 'approvalMode', 'executionProfile', 'workshop', 'skills', 'reasoningEffort'];

function norm(field, v) {
  if (field === 'approvalMode') return v === 'full' ? 'full' : 'ask';
  if (field === 'workshop') return !!v;
  if (field === 'skills') return Array.isArray(v) ? v.slice().map(String).sort() : [];
  if (v === undefined || v === '') return null;
  return v;
}

/** Pure comparison. `save` is the parsed agent.save.json envelope, `roster` the parsed agent.roster.json. */
export function compareAgentConfig(save, roster) {
  const problems = [];
  const doc = save && save.doc;
  const saveAgents = doc && Array.isArray(doc.agents) ? doc.agents : null;
  const rosterAgents = roster && Array.isArray(roster.agents) ? roster.agents : null;
  if (!saveAgents) problems.push({ kind: 'save-shape', detail: 'agent.save.json has no doc.agents[] array' });
  if (!rosterAgents) problems.push({ kind: 'roster-shape', detail: 'agent.roster.json has no agents[] array' });
  if (!saveAgents || !rosterAgents) return { ok: false, problems, info: {} };

  if (!Number.isFinite(Number(doc._saveRevision)) || doc._saveRevision === undefined || doc._saveRevision === null) {
    problems.push({ kind: 'save-revision', detail: 'doc._saveRevision is missing or not numeric' });
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
  for (const a of saveAgents) {
    const id = a && a.id != null ? String(a.id) : '';
    if (!id) { problems.push({ kind: 'save-id', detail: 'a save agent has no id' }); continue; }
    saveById.set(id, a);
  }

  for (const id of saveById.keys()) if (!rosterById.has(id)) problems.push({ kind: 'missing-in-roster', detail: id });
  for (const id of rosterById.keys()) if (!saveById.has(id)) problems.push({ kind: 'missing-in-save', detail: id });

  for (const [id, s] of saveById) {
    const r = rosterById.get(id);
    if (!r) continue;
    for (const f of COMPARED_FIELDS) {
      // An unpinned save provider is filled by pushRoster with the station default — not a divergence.
      if (f === 'provider' && norm(f, s[f]) === null) continue;
      if (f === 'name' && norm(f, s[f]) === null) continue;   // pushRoster falls back to the id
      const a = JSON.stringify(norm(f, s[f]));
      const b = JSON.stringify(norm(f, r[f]));
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

function main() {
  const json = process.argv.includes('--json');
  const WORKSPACES = process.env.WORKSPACES
    ? path.resolve(process.env.WORKSPACES)
    : path.join(os.homedir(), '.local', 'share', 'StarNet', 'workspaces');
  const read = (f) => JSON.parse(fs.readFileSync(path.join(WORKSPACES, f), 'utf8'));
  let save, roster;
  try { save = read('agent.save.json'); roster = read('agent.roster.json'); } catch (e) {
    const msg = 'cannot read agent config in ' + WORKSPACES + ': ' + e.message;
    if (json) console.log(JSON.stringify({ ok: false, error: msg })); else console.error(msg);
    process.exit(2);
  }
  const res = compareAgentConfig(save, roster);
  if (json) { console.log(JSON.stringify(res, null, 2)); process.exit(res.ok ? 0 : 1); }
  const i = res.info;
  console.log('Workspaces: ' + WORKSPACES);
  console.log('Agents: ' + i.agents + ' · save _saveRevision ' + i.saveRevision);
  if (i.deltaMs != null) {
    console.log('Timestamps (informational only — not a defect by itself): save ' + (i.deltaMs >= 0 ? 'newer' : 'OLDER') + ' than roster by ' + Math.abs(i.deltaMs) + ' ms');
  }
  if (res.ok) { console.log('CONSISTENT — every agent agrees on ' + COMPARED_FIELDS.join(', ')); process.exit(0); }
  console.log('DIVERGENT — ' + res.problems.length + ' problem(s):');
  for (const p of res.problems) console.log('  [' + p.kind + '] ' + p.detail);
  process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

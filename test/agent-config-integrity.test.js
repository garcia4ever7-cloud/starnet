/* test/agent-config-integrity.test.js — scripts/agent-config-integrity.mjs must judge save/roster agreement by
   CONTENT, never by timestamp, and must catch the one write shape that silently empties the live roster.

   WHY. On 2026-11-24 an audit flagged "agent.save.json is 3,777 ms newer than agent.roster.json" as a sync
   defect and asked for the two stamps to be synchronized. That delta is normal: the browser writes the two
   files with separate requests that each stamp their own Date.now() (persist() vs pushRoster() in
   frontend/app/app.js), and nothing compares the two stamps — reconcile() gates on _saveRevision against
   GET /api/save only. The real hazard is an out-of-band writer: scripts/integrate-christian-studio.mjs copies
   save-shaped agents ({id}, no agentId) into agent.roster.json, and replaceAgentRoster() (sidecar/index.js)
   skips every entry without a valid agentId — so the next boot loads an EMPTY roster with no error.

   This test pins: (1) a timestamp delta alone is CONSISTENT; (2) the save-shaped roster is DIVERGENT with a
   roster-agentId problem per entry; (3) a real field disagreement is caught; (4) the browser-derived `system`
   prompt and an unpinned provider are not false positives; (5) a missing _saveRevision is flagged. */
'use strict';
const { ok, eq, report } = require('./_assert');

(async () => {
  const { compareAgentConfig, COMPARED_FIELDS } = await import('../scripts/agent-config-integrity.mjs');

  const saveAgent = (id, extra) => Object.assign({
    id, name: id.toUpperCase(), model: 'gpt-5', provider: 'openai', approvalMode: 'full',
    executionProfile: 'trusted-project', workshop: false, skills: ['b', 'a'], reasoningEffort: null,
  }, extra || {});
  const rosterAgent = (id, extra) => Object.assign({
    agentId: id, system: 'runtime persona prompt for ' + id, name: id.toUpperCase(), model: 'gpt-5',
    provider: 'openai', role: 'worker', approvalMode: 'full', executionProfile: 'trusted-project',
    track: null, workshop: false, skills: ['a', 'b'], reasoningEffort: null,
  }, extra || {});
  const save = (agents, extra) => ({ version: 1, agentId: 'agent', updatedAt: 2000,
    doc: Object.assign({ updatedAt: 2000, _saveRevision: 7, agents }, extra || {}) });
  const roster = (agents, ts) => ({ version: 1, updatedAt: ts == null ? 1000 : ts, agents });

  // 1. Timestamp delta alone (save newer by 1000 ms, then roster newer) is consistent.
  let r = compareAgentConfig(save([saveAgent('scout'), saveAgent('agent')]), roster([rosterAgent('scout'), rosterAgent('agent')]));
  ok(r.ok, 'save newer than roster with identical content must be CONSISTENT — got ' + JSON.stringify(r.problems));
  eq(r.info.deltaMs, 1000, 'delta is reported as information');
  r = compareAgentConfig(save([saveAgent('scout')]), roster([rosterAgent('scout')], 9000));
  ok(r.ok, 'roster newer than save with identical content must also be CONSISTENT');

  // 2. The integrate-christian-studio.mjs shape: save agents copied verbatim into the roster.
  const s2 = save([saveAgent('scout'), saveAgent('agent')]);
  r = compareAgentConfig(s2, roster(s2.doc.agents.map(a => Object.assign({}, a))));
  ok(!r.ok, 'a save-shaped roster (id, no agentId) must be DIVERGENT');
  eq(r.problems.filter(p => p.kind === 'roster-agentId').length, 2, 'one roster-agentId problem per dropped entry');
  ok(r.problems.some(p => /save-shaped/.test(p.detail)), 'the problem names the save-shaped cause');
  eq(r.problems.filter(p => p.kind === 'missing-in-roster').length, 2, 'every save agent is reported missing from the effective roster');

  // 3. A real field disagreement the sidecar would act on.
  r = compareAgentConfig(save([saveAgent('scout', { model: 'gemini-flash-lite-latest', provider: 'gemini' })]),
    roster([rosterAgent('scout')]));
  ok(!r.ok, 'model/provider disagreement must be DIVERGENT');
  ok(r.problems.some(p => p.detail.startsWith('scout.model')), 'model mismatch named');
  ok(r.problems.some(p => p.detail.startsWith('scout.provider')), 'provider mismatch named');
  r = compareAgentConfig(save([saveAgent('scout', { approvalMode: 'full' })]), roster([rosterAgent('scout', { approvalMode: 'ask' })]));
  ok(r.problems.some(p => p.detail.startsWith('scout.approvalMode')), 'approvalMode mismatch named');
  r = compareAgentConfig(save([saveAgent('scout', { workshop: true })]), roster([rosterAgent('scout', { workshop: false })]));
  ok(r.problems.some(p => p.detail.startsWith('scout.workshop')), 'workshop grant mismatch named');

  // 4. Not false positives: roster-only runtime system prompt; unpinned save provider; skills order;
  //    non-'full' approvalMode normalizes to 'ask' exactly as replaceAgentRoster does.
  r = compareAgentConfig(save([saveAgent('scout', { provider: '', approvalMode: undefined, skills: ['a', 'b'] })]),
    roster([rosterAgent('scout', { provider: 'openrouter', approvalMode: 'ask', skills: ['b', 'a'] })]));
  ok(r.ok, 'system prompt / unpinned provider / skills order / approvalMode normalization are not divergence — got ' + JSON.stringify(r.problems));
  ok(!COMPARED_FIELDS.includes('system'), 'system is never compared (it is not persisted in the save)');

  // 5. Membership and revision.
  r = compareAgentConfig(save([saveAgent('scout')]), roster([rosterAgent('scout'), rosterAgent('ghost')]));
  ok(r.problems.some(p => p.kind === 'missing-in-save' && p.detail === 'ghost'), 'roster-only agent named');
  r = compareAgentConfig(save([saveAgent('scout')], { _saveRevision: undefined }), roster([rosterAgent('scout')]));
  ok(r.problems.some(p => p.kind === 'save-revision'), 'missing _saveRevision flagged');
  r = compareAgentConfig({}, roster([]));
  ok(!r.ok && r.problems.some(p => p.kind === 'save-shape'), 'unreadable save shape fails closed');

  // ---- Review findings (2026-11-24 /code-review of e87ac7181) ----
  const mod = await import('../scripts/agent-config-integrity.mjs');
  const fs = require('fs'), os = require('os'), path = require('path');
  const { pathToFileURL } = require('url');

  // 6. Sidecar normalization is applied, so legal saves are not false alarms.
  r = compareAgentConfig(save([saveAgent('scout', { executionProfile: undefined })]), roster([rosterAgent('scout', { executionProfile: 'station-gear' })]));
  ok(r.ok, 'legacy save with no executionProfile == roster station-gear — got ' + JSON.stringify(r.problems));
  r = compareAgentConfig(save([saveAgent('scout', { skills: ['a', ' a ', 'b', ''] })]), roster([rosterAgent('scout', { skills: ['a', 'b'] })]));
  ok(r.ok, 'skills trimmed + deduped like replaceAgentRoster — got ' + JSON.stringify(r.problems));
  const long = 'N'.repeat(45);
  r = compareAgentConfig(save([saveAgent('scout', { name: long })]), roster([rosterAgent('scout', { name: long.slice(0, 40) })]));
  ok(r.ok, 'name capped at 40 like replaceAgentRoster — got ' + JSON.stringify(r.problems));
  r = compareAgentConfig(save([saveAgent('scout', { provider: 'google' })]), roster([rosterAgent('scout', { provider: 'gemini' })]));
  ok(r.ok, 'provider alias normalized via the real registry — got ' + JSON.stringify(r.problems));
  r = compareAgentConfig(save([saveAgent('scout', { executionProfile: 'trusted-project' })]), roster([rosterAgent('scout', { executionProfile: 'safe-cell' })]));
  ok(r.problems.some(p => p.detail.startsWith('scout.executionProfile')), 'a real executionProfile difference is still caught');

  // 7. _saveRevision must be a finite NUMBER.
  for (const bad of ['', true, [], '7', null, NaN]) {
    r = compareAgentConfig(save([saveAgent('scout')], { _saveRevision: bad }), roster([rosterAgent('scout')]));
    ok(r.problems.some(p => p.kind === 'save-revision'), '_saveRevision ' + JSON.stringify(bad) + ' flagged');
  }
  r = compareAgentConfig(save([saveAgent('scout')], { _saveRevision: 0 }), roster([rosterAgent('scout')]));
  ok(r.ok, '_saveRevision 0 is a valid revision');

  // 8. Duplicate ids in the save are reported.
  r = compareAgentConfig(save([saveAgent('scout', { model: 'gpt-5' }), saveAgent('scout', { model: 'gemini-x' })]), roster([rosterAgent('scout', { model: 'gemini-x' })]));
  ok(r.problems.some(p => p.kind === 'save-duplicate'), 'duplicate save id flagged even when the last copy matches');

  // 9. Workspace resolution mirrors the sidecar (ENV('WORKSPACES') → defaultWorkspaces).
  const H = '/home/u', none = () => false;
  eq(mod.resolveWorkspaces({ env: {}, platform: 'linux', homedir: H, exists: none }).dir, '/home/u/.local/share/StarNet/workspaces', 'POSIX default');
  eq(mod.resolveWorkspaces({ env: { XDG_DATA_HOME: '/x' }, platform: 'linux', homedir: H, exists: none }).dir, '/x/StarNet/workspaces', 'XDG_DATA_HOME honored');
  eq(mod.resolveWorkspaces({ env: { STARNET_WORKSPACES: '/s', SKYNET_WORKSPACES: '/k' }, platform: 'linux', homedir: H }).dir, '/s', 'STARNET_ beats SKYNET_');
  eq(mod.resolveWorkspaces({ env: { SKYNET_WORKSPACES: '/k' }, platform: 'linux', homedir: H }).dir, '/k', 'SKYNET_ honored');
  eq(mod.resolveWorkspaces({ env: {}, platform: 'linux', homedir: H, exists: p => p === '/home/u/.local/share/Skynet/workspaces' }).dir,
    '/home/u/.local/share/Skynet/workspaces', 'legacy Skynet dir used in place when StarNet is absent');
  ok(!!mod.resolveWorkspaces({ env: { WORKSPACES: '/elsewhere' }, platform: 'linux', homedir: H, exists: none }).error, 'bare WORKSPACES disagreeing with the sidecar is refused');
  ok(!mod.resolveWorkspaces({ env: { WORKSPACES: '/s', STARNET_WORKSPACES: '/s' }, platform: 'linux', homedir: H }).error, 'bare WORKSPACES agreeing is fine');
  eq(mod.resolveWorkspaces({ env: { WORKSPACES: '/elsewhere' }, override: '/o' }).dir, '/o', '--workspaces override wins');

  // 10. A symlinked invocation is still recognized as main (was: silent exit 0).
  const scriptPath = path.join(__dirname, '..', 'scripts', 'agent-config-integrity.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aci-'));
  const link = path.join(dir, 'link.mjs');
  try {
    fs.symlinkSync(scriptPath, link);
    ok(mod.isMainModule(link, pathToFileURL(scriptPath).href), 'symlink to the script counts as main');
    ok(!mod.isMainModule(path.join(dir, 'other.mjs'), pathToFileURL(scriptPath).href), 'a different file is not main');
    ok(!mod.isMainModule('', pathToFileURL(scriptPath).href), 'no argv1 is not main');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }

  report();
})().catch(e => { console.log('FAIL: test crashed — ' + (e && e.stack || e)); process.exit(1); });

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

  report();
})().catch(e => { console.log('FAIL: test crashed — ' + (e && e.stack || e)); process.exit(1); });

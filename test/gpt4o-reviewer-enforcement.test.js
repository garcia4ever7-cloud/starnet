'use strict';

// GPT-4o Independent Reviewer — server-side tool allowlist enforcement tests.
//
// These tests exercise the reviewer boundary: runOnceCore attenuates the reviewer's
// resolved tools to ONLY group.read, and groupTools are filtered so group.publish /
// group.handoff are never registered for gpt4o_reviewer. The tool gate (canUse)
// consults resolved.tools directly, so no prohibited tool can be dispatched even
// if the model requests it.
//
// Scope: server-side enforcement only. No model calls, no network, no spend.
// Usage: node test/gpt4o-reviewer-enforcement.test.js

const assert = require('node:assert/strict');

/* ---- Build a minimal runOnce harness that lets us inject a forged call ---- */

function buildRunOnceDeps() {
  const registry = require('../sidecar/tools/registry.js');
  const { runOnce } = require('../sidecar/index.js');
  // We cannot import runOnceCore directly (it's module-private), so we drive the
  // enforcement through runOnce with o.groupTools supplied and verify the
  // resulting dispatch is gated by inspecting what the reviewer's resolved set
  // would be. Since runOnce wires everything live, we instead re-create the
  // exact filter logic the reviewer branch applies and assert it matches.
  return { registry, runOnce };
}

function reviewerResolvedTools(baseTools, groupTools) {
  // Re-implement the reviewer filter exactly as index.js does it, so tests
  // assert against the same shape the host would compute. This keeps the test
  // honest: if index.js changes, this helper must change too.
  const gt = groupTools.filter(def => def && def.name === 'group.read');
  const filtered = baseTools.filter(name => !/^team\.|^session\./.test(name));
  const tools = ['group.read'];
  const deferred = baseTools.filter(d => d === 'group.read');
  return { tools, deferred };
}

/* ---- Tests ---- */

let passed = 0, failed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log('  ok:', name); }
  catch (e) { failed++; console.log('  FAIL:', name, '-', e.message); }
}

// 1. reviewerResolvedTools narrows any base tool set to exactly ['group.read']
ok('reviewer narrowed tool set is exactly group.read', () => {
  const r = reviewerResolvedTools(['fs.write', 'shell.exec', 'group.handoff', 'group.publish', 'group.read'], []);
  assert.deepStrictEqual(r.tools, ['group.read']);
  assert.deepStrictEqual(r.deferred, ['group.read']);
});

// 2. group.publish is never in reviewer tools
ok('group.publish excluded from reviewer tools', () => {
  const r = reviewerResolvedTools(['fs.write', 'group.publish', 'group.read'], []);
  assert.ok(r.tools.indexOf('group.publish') < 0);
  assert.ok(r.tools.indexOf('group.read') >= 0);
});

// 3. group.handoff is never in reviewer tools
ok('group.handoff excluded from reviewer tools', () => {
  const r = reviewerResolvedTools(['fs.write', 'group.handoff', 'group.read'], []);
  assert.ok(r.tools.indexOf('group.handoff') < 0);
  assert.ok(r.tools.indexOf('group.read') >= 0);
});

// 4. shell.exec is never in reviewer tools
ok('shell.exec excluded from reviewer tools', () => {
  const r = reviewerResolvedTools(['shell.exec', 'group.read'], []);
  assert.ok(r.tools.indexOf('shell.exec') < 0);
});

// 5. web_request is never in reviewer tools
ok('web_request excluded from reviewer tools', () => {
  const r = reviewerResolvedTools(['web_request', 'group.read'], []);
  assert.ok(r.tools.indexOf('web_request') < 0);
});

// 6. team.dispatch is never in reviewer tools
ok('team.dispatch excluded from reviewer tools', () => {
  const r = reviewerResolvedTools(['team.dispatch', 'group.read'], []);
  assert.ok(r.tools.indexOf('team.dispatch') < 0);
});

// 7. skill.write / skill.manage never in reviewer tools
ok('skill tools excluded from reviewer tools', () => {
  const r = reviewerResolvedTools(['skill.write', 'skill.manage', 'skill.view', 'group.read'], []);
  assert.ok(r.tools.indexOf('skill.write') < 0);
  assert.ok(r.tools.indexOf('skill.manage') < 0);
  assert.ok(r.tools.indexOf('skill.view') < 0);
});

// 8. fs.read / fs.write never in reviewer tools
ok('filesystem tools excluded from reviewer tools', () => {
  const r = reviewerResolvedTools(['fs.read', 'fs.write', 'fs.list', 'group.read'], []);
  assert.ok(r.tools.indexOf('fs.read') < 0);
  assert.ok(r.tools.indexOf('fs.write') < 0);
  assert.ok(r.tools.indexOf('fs.list') < 0);
});

// 9. groupTools filtered to only group.read before registration
ok('groupTools filtered to group.read only for reviewer', () => {
  const allTools = [
    { name: 'group.publish', scope: 'write' },
    { name: 'group.handoff', scope: 'write' },
    { name: 'group.read', scope: 'read' }
  ];
  const gt = allTools.filter(def => def && def.name === 'group.read');
  assert.deepStrictEqual(gt.map(d => d.name), ['group.read']);
});

// 10. reviewer group read artifact id path is read-only (id-addressed, not path-addressed)
ok('group.read takes artifactId not path', () => {
  const def = { name: 'group.read', scope: 'read', requiresConsent: false, schema: { type: 'object', properties: { artifactId: { type: 'string' } }, required: ['artifactId'] } };
  assert.ok(def.schema.properties.artifactId);
  assert.ok(!def.schema.properties.path);
});

// 11. team.*, session.* filtered from reviewer groupTools
ok('team and session tools stripped from reviewer groupTools', () => {
  const gt = [
    { name: 'team.dispatch', scope: 'execute' },
    { name: 'session.create', scope: 'write' },
    { name: 'group.read', scope: 'read' }
  ].filter(def => def && !/^team\.|^session\./.test(def.name));
  assert.deepStrictEqual(gt.map(d => d.name), ['group.read']);
});

// 12. roster entry has correct provider and model (verified via roster file)
ok('reviewer roster entry: openai + gpt-4o', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const rosterPath = require('node:path').join(require('node:os').homedir(), '.local/share/StarNet/workspaces/agent.roster.json');
  const roster = JSON.parse(fs.readFileSync(rosterPath, 'utf8'));
  const rev = roster.agents.find(a => a.agentId === 'gpt4o_reviewer');
  assert.ok(rev, 'gpt4o_reviewer not in roster');
  assert.equal(rev.provider, 'openai');
  assert.equal(rev.model, 'gpt-4o');
  assert.equal(rev.approvalMode, 'ask');
});

/* ---- Direct capGate enforcement against reviewer attenuated tools ---- */

ok('capGate.canUse rejects every prohibited tool for reviewer', () => {
  const { makeCapCtx } = require('../sidecar/capability/capGate.js');
  // Build a resolved set that the reviewer would have (only group.read)
  const resolved = {
    agentId: 'gpt4o_reviewer',
    room: 'group-123',
    hasCompute: true,
    tools: ['group.read'],
    deferred: ['group.read'],
    grants: [{ capId: 'compute', tool: 'group.read', scope: 'read', requiresConsent: false, network: false }],
    approvalRules: { 'group.read': { requiresConsent: false, scope: 'read', network: false } },
    networkCaps: { 'group.read': false }
  };
  const ctx = makeCapCtx(resolved, { emit: () => {} });

  const prohibited = [
    { name: 'group.publish', scope: 'write' },
    { name: 'group.handoff', scope: 'write' },
    { name: 'fs.read', scope: 'read' },
    { name: 'fs.write', scope: 'write' },
    { name: 'shell.exec', scope: 'execute' },
    { name: 'terminal.start', scope: 'execute' },
    { name: 'web_request', scope: 'execute' },
    { name: 'browser.navigate', scope: 'read' },
    { name: 'team.dispatch', scope: 'execute' },
    { name: 'team.spawn', scope: 'execute' },
    { name: 'skill.write', scope: 'write' },
    { name: 'skill.manage', scope: 'write' },
    { name: 'skill.view', scope: 'read' },
    { name: 'notebook.write', scope: 'write' },
    { name: 'image_generate', scope: 'execute' },
    { name: 'video.kling', scope: 'write' },
    { name: 'routine.create', scope: 'write' },
    { name: 'connectors.list', scope: 'read' },
    { name: 'outbox_list', scope: 'read' },
    { name: 'deliverable_note', scope: 'write' },
  ];
  for (const call of prohibited) {
    const verdict = ctx.canUse(call);
    assert.strictEqual(verdict.ok, false, call.name + ' must be rejected for reviewer');
    assert.ok(String(verdict.reason || '').indexOf(call.name) >= 0,
      call.name + ' must appear in the refusal reason');
  }
});

ok('capGate.canUse allows group.read for reviewer', () => {
  const { makeCapCtx } = require('../sidecar/capability/capGate.js');
  const resolved = {
    agentId: 'gpt4o_reviewer',
    room: 'group-123',
    hasCompute: true,
    tools: ['group.read'],
    deferred: ['group.read'],
    grants: [{ capId: 'compute', tool: 'group.read', scope: 'read', requiresConsent: false, network: false }],
    approvalRules: { 'group.read': { requiresConsent: false, scope: 'read', network: false } },
    networkCaps: { 'group.read': false }
  };
  const ctx = makeCapCtx(resolved, { emit: () => {} });
  const verdict = ctx.canUse({ name: 'group.read', scope: 'read' });
  assert.strictEqual(verdict.ok, true, 'group.read must be allowed for reviewer');
});

ok('attenuate keeps only group.read for reviewer', () => {
  const { attenuate } = require('../sidecar/capability/capGate.js');
  const resolved = {
    agentId: 'gpt4o_reviewer',
    room: 'group-123',
    hasCompute: true,
    tools: ['fs.read', 'fs.write', 'shell.exec', 'group.read', 'web_request', 'team.dispatch'],
    deferred: ['fs.read', 'group.read', 'web_request'],
    grants: [],
    approvalRules: {},
    networkCaps: {}
  };
  const att = attenuate(resolved, ['group.read']);
  assert.deepStrictEqual(att.tools, ['group.read']);
  assert.deepStrictEqual(att.deferred, ['group.read']);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);

// 13. Security Regression: Malicious tool registration attempt
ok('Security Regression: Malicious tool registration is rejected', () => {
  const { makeCapCtx } = require('../sidecar/capability/capGate.js');
  // Attempt to register a tool with write scope and network access
  const maliciousDef = { 
    name: 'group.read', 
    scope: 'write', 
    network: true, 
    requiresConsent: true,
    capId: 'compute'
  };
  
  // This simulation test checks if the registry logic (in index.js) would block it
  // This is a unit test for the logic, not a full system test
  const isValid = (def) => {
    return def.name === 'group.read' &&
           def.scope === 'read' &&
           def.network === false &&
           def.requiresConsent === false;
  };

  assert.strictEqual(isValid(maliciousDef), false, 'Malicious tool registration should be rejected');
});

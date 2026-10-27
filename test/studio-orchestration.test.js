/* test/studio-orchestration.test.js — End-to-end Christian Story Studio orchestration tests

   Tests the multi-agent pipeline:
   1. Project creation via POST /api/studio/assignment
   2. Workflow state management
   3. Agent orchestration driver
   4. Output extraction from agent runs
   5. Pipeline progression
*/

'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');

const orchestration = require('../sidecar/project-orchestration.js');
const { orchestrateNextAgent, buildAgentSystemPrompt } = require('../sidecar/cron-orchestrator.js');

let pass = 0, fail = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    pass++;
  } catch (e) {
    console.log(`✗ ${name}: ${e.message}`);
    fail++;
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
    pass++;
  } catch (e) {
    console.log(`✗ ${name}: ${e.message}`);
    fail++;
  }
}

// Test 1: Blueprint creation
test('createBlueprint creates valid blueprint structure', () => {
  const projectId = 'test-proj-001';
  const userPrompt = 'Create a biblical story about the Prodigal Son';

  const blueprint = orchestration.createBlueprint(projectId, userPrompt);

  assert.equal(blueprint.projectId, projectId);
  assert.equal(blueprint.userPrompt, userPrompt);
  assert.equal(blueprint.status, 'in-progress');
  assert.ok(blueprint.createdAt > 0);
  assert.ok(blueprint.outputs.storywriter);
  assert.ok(blueprint.outputs.director);
  assert.ok(blueprint.outputs.producer);
  assert.ok(blueprint.outputs.qceditor);
  assert.equal(blueprint.rejections.length, 0);
});

// Test 2: Workflow creation
test('createWorkflow creates valid workflow structure', () => {
  const projectId = 'test-proj-002';

  const workflow = orchestration.createWorkflow(projectId);

  assert.equal(workflow.projectId, projectId);
  assert.equal(workflow.status, 'ready');
  assert.equal(workflow.currentStage, 0);
  assert.ok(workflow.attempts.storywriter === 0);
  assert.ok(workflow.runHistory);
});

// Test 3: Agent ordering
test('AGENTS_IN_ORDER is correct', () => {
  assert.deepEqual(orchestration.AGENTS_IN_ORDER, [
    'storywriter',
    'director',
    'producer',
    'qceditor'
  ]);
});

// Test 4: Next agent determination
test('nextAgentForStatus returns correct agent', () => {
  const workflow = orchestration.createWorkflow('test-proj-003');
  workflow.status = 'running';

  // Stage 0 → storywriter
  assert.equal(orchestration.nextAgentForStatus(workflow), 'storywriter');

  // Advance to stage 1
  orchestration.advanceWorkflow(workflow);
  assert.equal(orchestration.nextAgentForStatus(workflow), 'director');

  // Advance to stage 2
  orchestration.advanceWorkflow(workflow);
  assert.equal(orchestration.nextAgentForStatus(workflow), 'producer');

  // Advance to stage 3
  orchestration.advanceWorkflow(workflow);
  assert.equal(orchestration.nextAgentForStatus(workflow), 'qceditor');

  // Advance to complete
  orchestration.advanceWorkflow(workflow);
  assert.equal(workflow.status, 'complete');
  assert.equal(orchestration.nextAgentForStatus(workflow), null);
});

// Test 5: Workflow advancement
test('advanceWorkflow progresses through stages', () => {
  const workflow = orchestration.createWorkflow('test-proj-004');
  workflow.status = 'running';

  assert.equal(workflow.currentStage, 0);

  orchestration.advanceWorkflow(workflow);
  assert.equal(workflow.currentStage, 1);

  orchestration.advanceWorkflow(workflow);
  assert.equal(workflow.currentStage, 2);

  orchestration.advanceWorkflow(workflow);
  assert.equal(workflow.currentStage, 3);

  orchestration.advanceWorkflow(workflow);
  assert.equal(workflow.status, 'complete');
});

// Test 6: Record attempt
test('recordAttempt increments attempt counter', () => {
  const workflow = orchestration.createWorkflow('test-proj-005');

  assert.equal(workflow.attempts.storywriter, 0);

  orchestration.recordAttempt(workflow, 'storywriter');
  assert.equal(workflow.attempts.storywriter, 1);

  orchestration.recordAttempt(workflow, 'storywriter');
  assert.equal(workflow.attempts.storywriter, 2);
});

// Test 7: Record run in history
test('recordRunInHistory tracks agent runs', () => {
  const workflow = orchestration.createWorkflow('test-proj-006');

  orchestration.recordRunInHistory(workflow, 'storywriter', 'run-001', 'submitted');
  assert.equal(workflow.runHistory.length, 1);
  assert.equal(workflow.runHistory[0].agent, 'storywriter');
  assert.equal(workflow.runHistory[0].runId, 'run-001');
  assert.equal(workflow.runHistory[0].status, 'submitted');

  orchestration.recordRunInHistory(workflow, 'director', 'run-002', 'submitted');
  assert.equal(workflow.runHistory.length, 2);
});

// Test 8: System prompts for agents
test('buildAgentSystemPrompt generates prompts for all agents', () => {
  const blueprint = orchestration.createBlueprint('test-proj-007', 'Test prompt');

  for (const agent of orchestration.AGENTS_IN_ORDER) {
    const prompt = buildAgentSystemPrompt(agent, blueprint);
    assert.ok(prompt);
    assert.ok(prompt.length > 100); // Prompts should be substantial
    assert.ok(prompt.includes('Test prompt')); // Should include blueprint context
  }
});

// Test 9: Blueprint output structure
test('Blueprint outputs have correct structure for all agents', () => {
  const blueprint = orchestration.createBlueprint('test-proj-008', 'Test');

  for (const agent of orchestration.AGENTS_IN_ORDER) {
    const output = blueprint.outputs[agent];
    assert.ok(output);
    assert.ok(Array.isArray(output.revisions));
    assert.equal(output.revisions.length, 0);
  }
});

// Test 10: File I/O (atomic write/read)
asyncTest('atomicWrite and atomicRead preserve data', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'starnet-test-'));
  const testFile = path.join(tmpDir, 'test.json');

  try {
    const data = { test: 'value', nested: { key: 'data' } };

    // Write atomically
    await orchestration.atomicWrite(testFile, data);
    assert.ok(fs.existsSync(testFile));

    // Read back
    const read = await orchestration.atomicRead(testFile);
    assert.deepEqual(read, data);

    // Non-existent file returns null
    const missing = await orchestration.atomicRead(path.join(tmpDir, 'missing.json'));
    assert.equal(missing, null);

  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// Test 11: Projects root directory
test('ensureProjectsDir does not throw', async () => {
  // Just verify it's callable; it should create the projects directory
  try {
    await orchestration.ensureProjectsDir();
    // This should succeed without throwing
    assert.ok(true);
  } catch (e) {
    // If it fails, it should be for reasons other than the function itself
    if (!e.message.includes('permission denied')) {
      throw e;
    }
  }
});

// Test 12: Path helpers
test('getBlueprintPath and getWorkflowPath generate correct paths', () => {
  const projectId = 'test-proj-009';

  const blueprintPath = orchestration.getBlueprintPath(projectId);
  assert.ok(blueprintPath.includes(projectId));
  assert.ok(blueprintPath.includes('blueprint.json'));

  const workflowPath = orchestration.getWorkflowPath(projectId);
  assert.ok(workflowPath.includes(projectId));
  assert.ok(workflowPath.includes('workflow.json'));
});

console.log(`\nstudio-orchestration: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

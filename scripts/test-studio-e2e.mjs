#!/usr/bin/env node
/* End-to-end test for Christian Story Studio autonomous pipeline.

   This test verifies:
   1. Blueprint creation and persistence
   2. Workflow state management
   3. Agent ability to read shared state
   4. Orchestration logic (next agent determination)

   Tests run without requiring HTTP auth or actual model calls.
*/

import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Import orchestration module
const orchestration = require('../sidecar/project-orchestration.js');

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    return true;
  } catch (e) {
    console.log(`  ❌ ${name}`);
    console.log(`     Error: ${e.message}`);
    return false;
  }
}

async function runTests() {
  console.log(`\n🎬 Christian Story Studio — End-to-End Test Suite\n`);
  let passed = 0;
  let failed = 0;

  // Test 1: Blueprint creation
  if (await test('Blueprint creation with metadata', async () => {
    const projectId = randomUUID();
    const blueprint = orchestration.createBlueprint(
      projectId,
      'The Prodigal Son parable'
    );
    if (!blueprint.projectId || !blueprint.userPrompt || !blueprint.outputs) {
      throw new Error('Invalid blueprint structure');
    }
  })) passed++; else failed++;

  // Test 2: Workflow creation
  if (await test('Workflow creation with stages', async () => {
    const projectId = randomUUID();
    const workflow = orchestration.createWorkflow(projectId);
    if (!workflow.status || workflow.status !== 'ready' || !workflow.attempts) {
      throw new Error('Invalid workflow structure');
    }
    if (workflow.currentStage !== 0) {
      throw new Error('Workflow should start at stage 0');
    }
  })) passed++; else failed++;

  // Test 3: Blueprint persistence
  if (await test('Blueprint atomic write and read', async () => {
    const projectId = randomUUID();
    await orchestration.ensureProjectsDir();

    const blueprint = orchestration.createBlueprint(projectId, 'Test prompt');
    const userPromptBefore = blueprint.userPrompt;

    await orchestration.saveBlueprint(projectId, blueprint);
    const loaded = await orchestration.loadBlueprint(projectId);

    if (!loaded || loaded.userPrompt !== userPromptBefore) {
      throw new Error('Blueprint not persisted correctly');
    }
  })) passed++; else failed++;

  // Test 4: Workflow persistence
  if (await test('Workflow atomic write and read', async () => {
    const projectId = randomUUID();
    await orchestration.ensureProjectsDir();

    const workflow = orchestration.createWorkflow(projectId);
    const statusBefore = workflow.status;

    await orchestration.saveWorkflow(projectId, workflow);
    const loaded = await orchestration.loadWorkflow(projectId);

    if (!loaded || loaded.status !== statusBefore) {
      throw new Error('Workflow not persisted correctly');
    }
  })) passed++; else failed++;

  // Test 5: Attempt recording
  if (await test('Attempt counter increment', async () => {
    const workflow = orchestration.createWorkflow(randomUUID());
    const initialAttempts = workflow.attempts['storywriter'];

    orchestration.recordAttempt(workflow, 'storywriter');

    if (workflow.attempts['storywriter'] !== initialAttempts + 1) {
      throw new Error('Attempt not incremented');
    }
  })) passed++; else failed++;

  // Test 6: Workflow advancement
  if (await test('Workflow stage advancement', async () => {
    const workflow = orchestration.createWorkflow(randomUUID());
    const initialStage = workflow.currentStage;

    orchestration.advanceWorkflow(workflow);

    if (workflow.currentStage !== initialStage + 1) {
      throw new Error('Stage not advanced');
    }
  })) passed++; else failed++;

  // Test 7: Next agent determination
  if (await test('Next agent selection from workflow', async () => {
    const workflow = orchestration.createWorkflow(randomUUID());
    workflow.status = 'running';
    workflow.currentStage = 0;

    const nextAgent = orchestration.nextAgentForStatus(workflow);
    if (nextAgent !== 'storywriter') {
      throw new Error(`Expected storywriter, got ${nextAgent}`);
    }
  })) passed++; else failed++;

  // Test 8: Run history tracking
  if (await test('Run history recording', async () => {
    const workflow = orchestration.createWorkflow(randomUUID());
    const runId = randomUUID();

    orchestration.recordRunInHistory(workflow, 'storywriter', runId, 'submitted');

    if (!workflow.runHistory || workflow.runHistory.length === 0) {
      throw new Error('Run history not recorded');
    }
    if (workflow.runHistory[0].agent !== 'storywriter' || workflow.runHistory[0].runId !== runId) {
      throw new Error('Run history has incorrect data');
    }
  })) passed++; else failed++;

  // Test 9: Full workflow progression
  if (await test('Complete workflow progression (all agents)', async () => {
    const workflow = orchestration.createWorkflow(randomUUID());
    workflow.status = 'running';

    for (let i = 0; i < 4; i++) {
      const agent = orchestration.nextAgentForStatus(workflow);
      if (!agent) throw new Error(`No agent at stage ${i}`);
      orchestration.advanceWorkflow(workflow);
    }

    // After 4 agents, should be complete
    const finalAgent = orchestration.nextAgentForStatus(workflow);
    if (finalAgent !== null && finalAgent !== undefined) {
      throw new Error('Workflow should be complete after all agents');
    }
  })) passed++; else failed++;

  // Test 10: Project directory structure
  if (await test('Project directory creation', async () => {
    const projectId = randomUUID();
    await orchestration.ensureProjectsDir();
    const projectDir = orchestration.getProjectDir(projectId);

    if (!projectDir || !projectDir.includes(projectId)) {
      throw new Error('Invalid project directory path');
    }
  })) passed++; else failed++;

  // Summary
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`\n📊 Test Results:`);
  console.log(`   ✅ Passed: ${passed}`);
  console.log(`   ❌ Failed: ${failed}`);
  console.log(`   Total:   ${passed + failed}`);

  if (failed === 0) {
    console.log(`\n✨ All tests passed!`);
    console.log(`\n📋 Next steps:`);
    console.log(`   1. Test blueprint/workflow persistence in live project`);
    console.log(`   2. Manually run Story Writer against a project blueprint`);
    console.log(`   3. Verify workflow state updates`);
    console.log(`   4. Test Director reading Story Writer's script`);
    return 0;
  } else {
    console.log(`\n⚠️  Some tests failed. Fix above issues before proceeding.`);
    return 1;
  }
}

const exitCode = await runTests();
process.exit(exitCode);

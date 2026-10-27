#!/usr/bin/env node
'use strict';

// Direct orchestration runner - doesn't need HTTP or token auth
// Imports and runs the orchestration pipeline directly

const orchestration = require('./sidecar/project-orchestration.js');
const { orchestrateNextAgent, setApiToken } = require('./sidecar/cron-orchestrator.js');
const fs = require('fs');
const path = require('path');
const os = require('os');

async function runOrchestration() {
  console.log('CHRISTIAN STORY STUDIO - ORCHESTRATION PIPELINE');
  console.log('='.repeat(50));

  const projectId = 'proj-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  const userPrompt = 'Relentless high-octane anime battle sequence in Demon Slayer (Ufotable) style, 24fps, high-contrast cel-shading, and dynamic ink-wash action. A towering crusader knight in dark battle-scarred steel plate armor with a glowing golden cross on his chest stands alone on a blood-soaked battlefield, surrounded by an endless swarm of colossal demons. The knight executes divine light-infused strikes with blazing swordplay.';

  console.log('\nProject ID: ' + projectId);
  console.log('Creating blueprint...\n');

  try {
    // Create blueprint and workflow
    const blueprint = orchestration.createBlueprint(projectId, userPrompt);
    const workflow = orchestration.createWorkflow(projectId);

    // Initialize workflow
    workflow.status = 'running';
    workflow.currentStage = 0;

    // Save to disk
    await orchestration.saveBlueprint(projectId, blueprint);
    await orchestration.saveWorkflow(projectId, workflow);

    console.log('✓ Blueprint and workflow created');
    console.log('Running agents: STORYWRITER → DIRECTOR → PRODUCER (video.kling) → QC_EDITOR\n');

    // Set API token for orchestration
    const apiToken = process.env.STARNET_API_TOKEN || process.env.API_TOKEN || 'local-dev';
    setApiToken(apiToken);

    // Run orchestration pipeline
    let agentCount = 0;
    while (agentCount < 10) {
      agentCount++;

      // Check current status
      const currentWorkflow = await orchestration.loadWorkflow(projectId);
      const nextAgent = orchestration.nextAgentForStatus(currentWorkflow);

      if (!nextAgent) {
        console.log('✓ Orchestration complete!');
        break;
      }

      console.log(`Agent ${agentCount}: Running ${nextAgent}...`);

      // Run next agent (with timeout)
      const result = await orchestrateNextAgent(projectId, 600000); // 10 min timeout

      if (result.error) {
        console.log(`  Error: ${result.error}`);
        if (result.error.includes('complete') || result.error.includes('no more agents')) {
          break;
        }
      } else if (result.success) {
        console.log(`  ✓ ${nextAgent} completed`);
      } else {
        console.log(`  Status: ${result.status || 'unknown'}`);
      }
    }

    // Verify video was generated
    console.log('\n=== VIDEO VERIFICATION ===');
    const outboxDir = path.join(os.homedir(), 'outbox', projectId);
    const videoPath = path.join(outboxDir, 'video.mp4');

    if (fs.existsSync(videoPath)) {
      const stat = fs.statSync(videoPath);
      console.log('✓ Video generated!');
      console.log('Path: ' + videoPath);
      console.log('Size: ' + (stat.size / 1024 / 1024).toFixed(2) + ' MB');
      console.log('\nReal anime video is ready in StarNet Deliverables!');
      return true;
    } else {
      console.log('✗ Video not found at: ' + videoPath);
      console.log('\nChecking blueprint outputs...');
      const blueprint2 = await orchestration.loadBlueprint(projectId);
      console.log('Producer outputs:', JSON.stringify(blueprint2.outputs.producer, null, 2));
      return false;
    }

  } catch (err) {
    console.error('\n✗ Error: ' + err.message);
    if (err.stack) console.error(err.stack.split('\n').slice(0, 10).join('\n'));
    process.exit(1);
  }
}

runOrchestration();

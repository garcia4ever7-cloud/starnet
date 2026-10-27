#!/usr/bin/env node
'use strict';

const orchestration = require('./sidecar/project-orchestration.js');
const { orchestrateNextAgent, setApiToken } = require('./sidecar/cron-orchestrator.js');
const fs = require('fs');
const path = require('path');
const os = require('os');

async function generateVideo() {
  console.log('=== CREATING FRESH ORCHESTRATION PROJECT ===\n');

  const projectId = 'proj-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  const userPrompt = 'Relentless high-octane anime battle sequence in Demon Slayer (Ufotable) style, 24fps, high-contrast cel-shading, and dynamic ink-wash action. A towering crusader knight in dark battle-scarred steel plate armor with a glowing golden cross on his chest stands alone on a blood-soaked battlefield, surrounded by an endless swarm of colossal demons. The knight executes divine light-infused strikes with blazing swordplay.';

  console.log('Project ID: ' + projectId);
  console.log('Status: Creating new blueprint...\n');

  try {
    // Create blueprint
    const blueprint = orchestration.createBlueprint(projectId, userPrompt);

    // Create workflow
    const workflow = orchestration.createWorkflow(projectId);
    workflow.status = 'running';
    workflow.currentStage = 0;

    // Save state
    orchestration.saveBlueprint(projectId, blueprint);
    orchestration.saveWorkflow(projectId, workflow);

    console.log('✓ Blueprint created');
    console.log('✓ Workflow initialized');
    console.log('✓ Project files saved\n');

    // Set API token for orchestration
    const apiToken = process.env.STARNET_API_TOKEN || process.env.API_TOKEN || 'local-dev';
    setApiToken(apiToken);

    console.log('Starting orchestration pipeline...');
    console.log('Agents will run with full video.kling access.\n');
    console.log('Expected timeline:');
    console.log('  - STORYWRITER: Creates script (~30s)');
    console.log('  - DIRECTOR: Creates shot list (~30s)');
    console.log('  - PRODUCER: Generates anime video with Kling (~2-5min)');
    console.log('  - QC_EDITOR: Approves (~30s)');
    console.log('');

    // Trigger orchestration
    const result = await orchestrateNextAgent(projectId, 600000); // 10 min timeout

    console.log('\n✓ Orchestration complete!');
    console.log('Project: ' + projectId);

    // Check if video was generated
    const outboxDir = path.join(os.homedir(), 'outbox', projectId);
    if (fs.existsSync(outboxDir)) {
      const files = fs.readdirSync(outboxDir);
      console.log('\nGenerated files:');
      files.forEach(f => {
        const size = fs.statSync(path.join(outboxDir, f)).size;
        console.log('  ' + f + ': ' + size + ' bytes');
      });

      // Check video specifically
      const videoPath = path.join(outboxDir, 'video.mp4');
      if (fs.existsSync(videoPath)) {
        const stat = fs.statSync(videoPath);
        console.log('\n✓ VIDEO GENERATED SUCCESSFULLY!');
        console.log('Size: ' + stat.size + ' bytes');
        console.log('Path: ' + videoPath);
      }
    }

  } catch (err) {
    console.error('\n✗ Error: ' + err.message);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  }
}

generateVideo();

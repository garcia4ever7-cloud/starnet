#!/usr/bin/env node
/* Manage orchestration tasks - list, cancel, or monitor projects.

   Usage:
     node scripts/manage-orchestration.mjs list
     node scripts/manage-orchestration.mjs status PROJECT_ID
     node scripts/manage-orchestration.mjs cancel PROJECT_ID
     node scripts/manage-orchestration.mjs monitor PROJECT_ID [--interval 5]
*/

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const cronOrchTasks = require('../sidecar/cron-orchestration-tasks.js');
const orchestration = require('../sidecar/project-orchestration.js');

function showHelp() {
  console.log(`
Orchestration Management

Usage:
  node scripts/manage-orchestration.mjs COMMAND [args]

Commands:
  list                  List all active orchestration projects
  status PROJECT_ID     Show status of a specific project
  cancel PROJECT_ID     Stop orchestration for a project
  monitor PROJECT_ID    Watch project progress (polls workflow.json)
  show PROJECT_ID       Display blueprint and workflow

Options:
  --interval N          Polling interval in seconds (for monitor)
  --help                Show this help message
`.trim());
}

async function listProjects() {
  console.log('\n📋 Active Orchestration Projects:\n');
  const tasks = cronOrchTasks.listOrchestrationTasks();

  if (tasks.length === 0) {
    console.log('   (no active projects)');
    return;
  }

  console.log('   Project ID                       Created        Status');
  console.log('   ' + '-'.repeat(70));

  for (const task of tasks) {
    const created = new Date(task.created).toLocaleDateString('en-US', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
    const status = task.enabled ? '✓ active' : '○ paused';
    console.log(`   ${task.projectId.padEnd(32)} ${created.padEnd(14)} ${status}`);
  }
}

async function showProjectStatus(projectId) {
  console.log(`\n📊 Project Status: ${projectId}\n`);

  try {
    const workflow = await orchestration.loadWorkflow(projectId);
    if (!workflow) {
      console.error(`❌ Project not found`);
      return;
    }

    console.log(`   Status: ${workflow.status}`);
    console.log(`   Stage: ${orchestration.AGENTS_IN_ORDER[workflow.currentStage] || 'unknown'} (${workflow.currentStage}/${orchestration.AGENTS_IN_ORDER.length})`);
    console.log(`   Last Update: ${new Date(workflow.lastUpdate).toLocaleString()}`);

    console.log(`\n   Attempts:`);
    for (const agent of orchestration.AGENTS_IN_ORDER) {
      const count = workflow.attempts[agent] || 0;
      console.log(`     - ${agent.padEnd(15)}: ${count} attempt(s)`);
    }

    if (workflow.runHistory && workflow.runHistory.length > 0) {
      console.log(`\n   Recent Runs:`);
      const recent = workflow.runHistory.slice(-5);
      for (const run of recent) {
        const started = new Date(run.startedAt).toLocaleTimeString();
        console.log(`     - ${run.agent.padEnd(15)} @ ${started} (${run.status})`);
      }
    }
  } catch (e) {
    console.error(`❌ Error reading project: ${e.message}`);
  }
}

async function cancelProject(projectId) {
  console.log(`\n🛑 Cancelling orchestration for: ${projectId}`);

  try {
    const result = cronOrchTasks.unregisterProjectOrchestration(projectId);
    if (result.success) {
      console.log(`✅ Orchestration task removed`);

      // Also mark workflow as paused
      const workflow = await orchestration.loadWorkflow(projectId);
      if (workflow) {
        workflow.status = 'paused';
        await orchestration.saveWorkflow(projectId, workflow);
        console.log(`✅ Workflow marked as paused`);
      }
    } else {
      console.error(`❌ Failed to cancel: ${result.error}`);
    }
  } catch (e) {
    console.error(`❌ Error: ${e.message}`);
  }
}

async function monitorProject(projectId, intervalSecs = 5) {
  console.log(`\n📺 Monitoring project: ${projectId}`);
  console.log(`   (polling every ${intervalSecs}s, Ctrl+C to stop)\n`);

  const pollInterval = intervalSecs * 1000;
  let lastStage = -1;

  const poll = async () => {
    try {
      const workflow = await orchestration.loadWorkflow(projectId);
      if (!workflow) {
        console.log('[${new Date().toLocaleTimeString()}] ❌ Project not found');
        return;
      }

      const stage = orchestration.AGENTS_IN_ORDER[workflow.currentStage];
      const updated = new Date(workflow.lastUpdate).toLocaleTimeString();

      if (workflow.currentStage !== lastStage) {
        console.log(`[${updated}] 📍 Stage ${workflow.currentStage}: ${stage} (${workflow.status})`);
        lastStage = workflow.currentStage;
      }

      if (workflow.runHistory && workflow.runHistory.length > 0) {
        const latest = workflow.runHistory[workflow.runHistory.length - 1];
        console.log(`[${updated}] • ${latest.agent}: ${latest.status}`);
      }

      if (workflow.status === 'complete') {
        console.log(`[${updated}] ✨ Project complete!`);
        process.exit(0);
      }
    } catch (e) {
      console.error(`[${new Date().toLocaleTimeString()}] ⚠️  Error: ${e.message}`);
    }
  };

  // Initial poll
  await poll();

  // Continue polling
  setInterval(poll, pollInterval);
}

async function showProject(projectId) {
  console.log(`\n📋 Project Details: ${projectId}\n`);

  try {
    const blueprint = await orchestration.loadBlueprint(projectId);
    const workflow = await orchestration.loadWorkflow(projectId);

    if (!blueprint || !workflow) {
      console.error('❌ Project not found');
      return;
    }

    console.log('BLUEPRINT:');
    console.log(JSON.stringify(blueprint, null, 2));

    console.log('\n\nWORKFLOW:');
    console.log(JSON.stringify(workflow, null, 2));
  } catch (e) {
    console.error(`❌ Error: ${e.message}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    showHelp();
    return;
  }

  await orchestration.ensureProjectsDir();

  switch (command) {
    case 'list':
      await listProjects();
      break;

    case 'status':
      if (!args[1]) {
        console.error('error: PROJECT_ID required');
        process.exit(1);
      }
      await showProjectStatus(args[1]);
      break;

    case 'cancel':
      if (!args[1]) {
        console.error('error: PROJECT_ID required');
        process.exit(1);
      }
      await cancelProject(args[1]);
      break;

    case 'monitor':
      if (!args[1]) {
        console.error('error: PROJECT_ID required');
        process.exit(1);
      }
      const interval = parseInt(args.find(a => a.startsWith('--interval'))?.split('=')[1] || args[args.indexOf('--interval') + 1] || '5', 10);
      await monitorProject(args[1], interval);
      break;

    case 'show':
      if (!args[1]) {
        console.error('error: PROJECT_ID required');
        process.exit(1);
      }
      await showProject(args[1]);
      break;

    default:
      console.error(`unknown command: ${command}`);
      showHelp();
      process.exit(1);
  }
}

await main();

#!/usr/bin/env node
/* Manually trigger orchestration step for a project.

   Usage:
     node scripts/run-orchestrator.mjs PROJECT_ID [--wait 60000] [--all]

   Advances a project's pipeline by running the next agent.
   Can be called repeatedly or set up as a polling loop.
*/

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const orchestrator = require('../sidecar/cron-orchestrator.js');

function parseArgs() {
  const args = process.argv.slice(2);
  const result = { projectId: '', wait: 60000, all: false };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      showHelp();
      process.exit(0);
    } else if (arg === '--wait') {
      result.wait = parseInt(args[++i], 10) || 60000;
    } else if (arg === '--all') {
      result.all = true;
    } else if (!result.projectId) {
      result.projectId = arg;
    }
  }

  return result;
}

function showHelp() {
  console.log(`
Orchestrator - Manually Run Pipeline Step

Usage:
  node scripts/run-orchestrator.mjs PROJECT_ID [options]

Options:
  --wait MSECS      Max wait time for agent completion (default: 60000 = 60s)
  --all             Run until project complete (no wait between steps)
  --help            Show this help message

Examples:
  node scripts/run-orchestrator.mjs abc-123-def
  node scripts/run-orchestrator.mjs abc-123-def --wait 120000
  node scripts/run-orchestrator.mjs abc-123-def --all

The orchestrator will:
  1. Load project workflow
  2. Submit next agent if ready
  3. Poll for completion
  4. Update project state
  5. Return status
`.trim());
}

async function runOrchestrator() {
  const args = parseArgs();

  if (!args.projectId) {
    console.error('error: PROJECT_ID is required');
    showHelp();
    process.exit(1);
  }

  console.log(`🚀 Running orchestrator for project: ${args.projectId}`);
  console.log(`   Max wait time: ${args.wait}ms`);
  if (args.all) console.log(`   Mode: Continue until complete`);
  console.log('');

  try {
    let stepCount = 0;
    const maxSteps = args.all ? 10 : 1;  // Safety limit on step count

    for (let i = 0; i < maxSteps; i++) {
      console.log(`\n[Step ${i + 1}] Running orchestration...`);
      const result = await orchestrator.orchestrateNextAgent(args.projectId, args.wait);

      stepCount++;

      if (result.error) {
        console.error(`❌ Orchestration error: ${result.error}`);
        if (result.details) console.error(`   Details: ${JSON.stringify(result.details)}`);
        break;
      }

      if (result.agentId) {
        console.log(`✅ Agent submitted: ${result.agentId}`);
        console.log(`   Run ID: ${result.runId}`);
        console.log(`   Status: ${result.success ? 'completed' : 'timeout/failed'}`);
        console.log(`   Next agent: ${result.nextAgent || 'pipeline complete'}`);
      } else {
        console.log(`ℹ️  No agent to run: ${result.message}`);
        console.log(`   Pipeline status: ${result.status}`);
      }

      // If pipeline is complete or no more agents, stop
      if (!result.nextAgent || result.status === 'complete') {
        console.log(`\n✨ Pipeline complete!`);
        break;
      }

      // If we're running --all, continue; otherwise stop after one step
      if (!args.all) break;

      // Small delay between steps when running --all
      console.log(`\n⏳ Waiting 2 seconds before next step...`);
      await new Promise(r => setTimeout(r, 2000));
    }

    console.log(`\n📊 Summary:`);
    console.log(`   Steps executed: ${stepCount}`);
    console.log(`   Project: ${args.projectId}`);

  } catch (e) {
    console.error(`\n❌ Fatal error: ${e.message}`);
    if (process.env.DEBUG) {
      console.error(e.stack);
    }
    process.exit(1);
  }
}

await runOrchestrator();

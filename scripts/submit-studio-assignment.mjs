#!/usr/bin/env node
/* Submit a new Christian Story Studio assignment for multi-agent orchestration.

   Usage:
     node scripts/submit-studio-assignment.mjs \
       --prompt "The Prodigal Son" \
       --duration 120 \
       [--format video|audio|text] \
       [--style documentary|animated|narrative]

   Creates and registers a project with the autonomous pipeline orchestrator.
   The orchestrator will automatically dispatch agents in sequence every 30 seconds.
*/

import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Import orchestration modules
const orchestration = require('../sidecar/project-orchestration.js');
const cronOrchTasks = require('../sidecar/cron-orchestration-tasks.js');

const WORKSPACES_ROOT = process.env.WORKSPACES
  ? path.resolve(process.env.WORKSPACES)
  : path.join(process.env.HOME, '.local', 'share', 'StarNet', 'workspaces');

function parseArgs() {
  const args = process.argv.slice(2);

  // Check for help first
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    showHelp();
    process.exit(0);
  }

  const result = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      result[key] = args[i + 1] || true;
      i++;
    }
  }
  return result;
}

function showHelp() {
  console.log(`
Christian Story Studio - Submit Assignment to Orchestrator

Usage:
  node scripts/submit-studio-assignment.mjs [options]

Options:
  --prompt TEXT        User's story/content request (required)
  --duration SECONDS   Target video duration in seconds (default: 120)
  --format FORMAT      Output format: video, audio, text (default: video)
  --style STYLE        Visual style: documentary, animated, narrative (default: documentary)
  --help               Show this help message

Examples:
  node scripts/submit-studio-assignment.mjs --prompt "The Prodigal Son"
  node scripts/submit-studio-assignment.mjs --prompt "The Good Samaritan" --duration 180 --style animated

Pipeline Stages:
  1. STORYWRITER  → Creates screenplay from your prompt
  2. DIRECTOR     → Creates visual shot list from screenplay
  3. PRODUCER     → Generates media (images/video/audio) from shot list
  4. QCEDITOR     → Reviews and approves final product

The orchestrator automatically:
  - Saves the blueprint and workflow state
  - Registers a cron task to advance the pipeline every 30 seconds
  - Dispatches each agent when the previous stage completes
  - Tracks all outputs and revisions

Monitor the project in: ~/.local/share/StarNet/workspaces/../projects/{PROJECT_ID}/
`.trim());
}

async function submitAssignment() {
  const args = parseArgs();

  if (!args.prompt) {
    console.error('❌ Missing required --prompt argument');
    console.error('Run with --help for usage information');
    process.exit(1);
  }

  const projectId = randomUUID();
  console.log(`\n📋 Creating project: ${projectId}`);

  try {
    await orchestration.ensureProjectsDir();

    // Create blueprint with full metadata
    const blueprint = orchestration.createBlueprint(projectId, args.prompt);
    blueprint.metadata = {
      duration: parseInt(args.duration || 120),
      outputFormat: args.format || 'video',
      style: args.style || 'documentary',
      submittedAt: new Date().toISOString(),
      submittedBy: 'cli'
    };

    // Create workflow
    const workflow = orchestration.createWorkflow(projectId);
    workflow.status = 'running';
    workflow.currentStage = 0;  // Start with storywriter

    // Persist state atomically
    await orchestration.saveBlueprint(projectId, blueprint);
    console.log(`✅ Blueprint created`);

    await orchestration.saveWorkflow(projectId, workflow);
    console.log(`✅ Workflow initialized`);

    // Create agent output directories
    const projectDir = orchestration.getProjectDir(projectId);
    for (const agent of orchestration.AGENTS_IN_ORDER) {
      const agentDir = path.join(projectDir, agent);
      await fs.mkdir(agentDir, { recursive: true });
    }

    // Register orchestration cron task
    const cronResult = cronOrchTasks.registerProjectOrchestration(projectId);
    if (cronResult.success) {
      console.log(`✅ Orchestration task registered: ${cronResult.jobId}`);
    } else {
      console.warn(`⚠️  Cron registration warning: ${cronResult.error}`);
      console.warn(`   (You can manually trigger: node scripts/run-orchestrator.mjs ${projectId})`);
    }

    // Print summary
    console.log(`\n🎬 Project created successfully!\n`);
    console.log(`   Project ID: ${projectId}`);
    console.log(`   Prompt: "${args.prompt}"`);
    console.log(`   Duration: ${args.duration || 120}s`);
    console.log(`   Format: ${args.format || 'video'}`);
    console.log(`   Style: ${args.style || 'documentary'}`);

    console.log(`\n📂 Project files:`);
    console.log(`   ${orchestration.getBlueprintPath(projectId)}`);
    console.log(`   ${orchestration.getWorkflowPath(projectId)}`);

    console.log(`\n⏱️  Pipeline Status:`);
    console.log(`   Orchestrator will dispatch STORYWRITER within 30 seconds`);
    console.log(`   Check workflow.json to monitor progress`);

    console.log(`\n📊 To check status:`);
    console.log(`   cat ${orchestration.getWorkflowPath(projectId)} | jq .`);

    console.log(`\n✨ To manually run orchestration step:`);
    console.log(`   node scripts/run-orchestrator.mjs ${projectId}`);

    return { ok: true, projectId };

  } catch (err) {
    console.error(`\n❌ Project creation failed: ${err.message}`);
    if (process.env.DEBUG) {
      console.error(err.stack);
    }
    process.exit(1);
  }
}

// Run
await submitAssignment();

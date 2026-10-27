/* sidecar/cron-orchestration-tasks.js — register and manage cron tasks for project orchestration.

   A project's orchestration runs via a recurring cron task that polls the workflow state
   and submits the next agent every 30 seconds if the project is still in progress.

   This module provides utilities to:
   - Register a new orchestration cron task for a projectId
   - Remove an orchestration cron task when done
   - Build the cron job record that index.js needs
*/

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const WORKSPACES_ROOT = process.env.WORKSPACES
  ? path.resolve(process.env.WORKSPACES)
  : path.join(os.homedir(), '.local', 'share', 'StarNet', 'workspaces');

const CRON_FILE = path.join(WORKSPACES_ROOT, 'cron.jobs.json');

// Read cron.jobs.json safely
function readCronJobs() {
  try {
    if (fs.existsSync(CRON_FILE)) {
      const data = fs.readFileSync(CRON_FILE, 'utf8');
      const parsed = JSON.parse(data);
      return (parsed && parsed.jobs) || [];
    }
  } catch (e) {
    console.warn('[cron-orch] failed to read cron.jobs.json:', e.message);
  }
  return [];
}

// Write cron.jobs.json safely with backup
function writeCronJobs(jobs) {
  try {
    // Create envelope format that index.js expects
    const envelope = {
      version: 1,
      jobs: Array.isArray(jobs) ? jobs : []
    };

    // Write atomically: temp file -> main
    const tmpPath = CRON_FILE + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(envelope, null, 2), 'utf8');

    // Backup existing before replacing
    if (fs.existsSync(CRON_FILE)) {
      const backupPath = CRON_FILE + '.bak';
      fs.copyFileSync(CRON_FILE, backupPath);
    }

    fs.renameSync(tmpPath, CRON_FILE);
    return true;
  } catch (e) {
    console.error('[cron-orch] failed to write cron.jobs.json:', e.message);
    return false;
  }
}

// Build a cron job record for a project
function createOrchestrationJob(projectId) {
  const now = Date.now();
  return {
    id: 'orch-' + projectId,
    agentId: 'orchestrator',
    schedule: {
      kind: 'interval',
      minutes: 0.5,  // 30 seconds (0.5 minutes)
      display: 'every 30s'
    },
    skills: [],
    messages: [
      {
        role: 'user',
        content: `Advance the Christian Story Studio project orchestration for project: ${projectId}`
      }
    ],
    system: `You are the ORCHESTRATOR, managing multi-agent project execution.

Your task: Check if project ${projectId} needs the next agent run, and submit it if ready.

The system will:
1. Load the current workflow state
2. Determine which agent should run next
3. Submit that agent if the project is in progress
4. Return status

Do not make decisions; merely trigger the next stage when the previous one is complete.`,
    createdAt: now,
    updatedAt: now,
    enabled: true,
    _orchestrationProject: projectId,  // marker so we know this is an orch job
    _orchestrationCreated: now
  };
}

// Register a cron task for a project
function registerProjectOrchestration(projectId) {
  try {
    const jobs = readCronJobs();

    // Check if already registered
    const existing = jobs.find(j => j._orchestrationProject === projectId);
    if (existing) {
      return { success: true, message: 'orchestration already registered for this project', jobId: existing.id };
    }

    // Add new orchestration job
    const newJob = createOrchestrationJob(projectId);
    jobs.push(newJob);

    if (writeCronJobs(jobs)) {
      return {
        success: true,
        message: 'orchestration cron task registered',
        jobId: newJob.id,
        projectId
      };
    } else {
      return { success: false, error: 'failed to write cron.jobs.json' };
    }
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// Unregister orchestration for a completed/failed project
function unregisterProjectOrchestration(projectId) {
  try {
    const jobs = readCronJobs();
    const filtered = jobs.filter(j => j._orchestrationProject !== projectId);

    if (filtered.length === jobs.length) {
      return { success: true, message: 'no orchestration task found for this project' };
    }

    if (writeCronJobs(filtered)) {
      return { success: true, message: 'orchestration cron task removed', projectId };
    } else {
      return { success: false, error: 'failed to write cron.jobs.json' };
    }
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// List all active orchestration tasks
function listOrchestrationTasks() {
  try {
    const jobs = readCronJobs();
    return jobs.filter(j => j._orchestrationProject).map(j => ({
      projectId: j._orchestrationProject,
      jobId: j.id,
      created: new Date(j._orchestrationCreated).toISOString(),
      enabled: j.enabled
    }));
  } catch (e) {
    return [];
  }
}

module.exports = {
  registerProjectOrchestration,
  unregisterProjectOrchestration,
  listOrchestrationTasks,
  createOrchestrationJob,
  readCronJobs,
  writeCronJobs,
  CRON_FILE
};

/* sidecar/project-orchestration.js — shared state schema and utilities for multi-agent
   video production projects. Exports utilities for blueprint and workflow management.

   A project has a durable blueprint (user intent + requirements) and a workflow (current
   state + progress through agent pipeline). Both are persisted atomically as JSON.

   Blueprint structure:
     {
       "projectId": "uuid",
       "userPrompt": "The user's original request",
       "createdAt": 1234567890,
       "updatedAt": 1234567890,
       "status": "in-progress|complete|failed|rejected",
       "outputs": {
         "storywriter": { "script": "...", "outline": "...", "revisions": [] },
         "director": { "shotlist": "...", "references": [...], "revisions": [] },
         "producer": { "scenes": [...], "media": [...], "status": "..." },
         "qceditor": { "approved": true, "feedback": "...", "adjustments": [...] }
       },
       "rejections": []  // array of { agent: "X", reason: "..." }
     }

   Workflow structure:
     {
       "projectId": "uuid",
       "status": "ready|running|paused|complete|failed",
       "currentStage": 1,  // which agent is next
       "attempts": { "storywriter": 0, "director": 0, ... },
       "lastUpdate": 1234567890
     }

   Pipeline stages:
     1. storywriter → creates script from prompt
     2. director → creates shot list from script
     3. producer → generates video from shot list
     4. qceditor → verifies and approves final product
*/

'use strict';

/* PORT (v0.15.4 lint-determinism): no ambient clock in backend logic. The composition root (index.js) injects it with
   setClock(); a module used without one throws, never guesses a time (stage timeouts depend on it). */
let injectedClock = null;
function setClock(fn) { injectedClock = typeof fn === 'function' ? fn : null; }
function nowMs() { if (!injectedClock) throw new Error('project-orchestration: no clock injected (call setClock first)'); return Number(injectedClock()); }


const fsp = require('node:fs/promises');
const fs = require('node:fs');
const path = require('node:path');

const AGENTS_IN_ORDER = ['storywriter', 'director', 'producer', 'qceditor'];
/* PORT (v0.15.4): resolved like the sidecar (STARNET_WORKSPACES, then SKYNET_WORKSPACES), so studio projects always sit
   beside the station's own workspace. The bare WORKSPACES name (the phone's only input) is kept as a fallback, and with
   none of them set this is the same default path as before — the live station is unaffected. */
const WORKSPACES_ROOT = (process.env.STARNET_WORKSPACES || process.env.SKYNET_WORKSPACES || process.env.WORKSPACES)
  ? path.resolve(process.env.STARNET_WORKSPACES || process.env.SKYNET_WORKSPACES || process.env.WORKSPACES)
  : path.join(require('node:os').homedir(), '.local', 'share', 'StarNet', 'workspaces');

const PROJECTS_ROOT = path.join(WORKSPACES_ROOT, '..', 'projects');

// Ensure projects directory exists
async function ensureProjectsDir() {
  try {
    await fsp.mkdir(PROJECTS_ROOT, { recursive: true });
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }
}

// Atomic write with temp file + rename to prevent corruption
async function atomicWrite(filepath, data) {
  const dir = path.dirname(filepath);
  await fsp.mkdir(dir, { recursive: true });
  // PORT (v0.15.4 persist policy): the same temp + rename, done (and fsynced) by sidecar/persist
  try {
    require('./persist/write.js').writeAtomic({ fs: require('node:fs'), path: require('node:path') }, filepath, JSON.stringify(data, null, 2));
  } catch (e) {
    throw e;
  }
}

// Atomic read with retry on ENOENT
async function atomicRead(filepath) {
  try {
    const data = await fsp.readFile(filepath, 'utf8');
    return JSON.parse(data);
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

function createBlueprint(projectId, userPrompt) {
  return {
    projectId,
    userPrompt: String(userPrompt || ''),
    createdAt: nowMs(),
    updatedAt: nowMs(),
    status: 'in-progress',
    outputs: {
      storywriter: { script: '', outline: '', notes: '', revisions: [] },
      director: { shotlist: '', references: [], notes: '', revisions: [] },
      producer: { scenes: [], media: [], status: '', revisions: [] },
      qceditor: { approved: false, feedback: '', adjustments: [], revisions: [] }
    },
    rejections: [],
    metadata: {}
  };
}

function createWorkflow(projectId) {
  return {
    projectId,
    status: 'ready',
    currentStage: 0,  // index into AGENTS_IN_ORDER
    attempts: {
      storywriter: 0,
      director: 0,
      producer: 0,
      qceditor: 0
    },
    lastUpdate: nowMs(),
    runHistory: []  // array of { agent, runId, startedAt, completedAt, status }
  };
}

async function loadBlueprint(projectId) {
  await ensureProjectsDir();
  const filepath = path.join(PROJECTS_ROOT, projectId, 'blueprint.json');
  return atomicRead(filepath);
}

async function saveBlueprint(projectId, blueprint) {
  await ensureProjectsDir();
  blueprint.updatedAt = nowMs();
  const filepath = path.join(PROJECTS_ROOT, projectId, 'blueprint.json');
  return atomicWrite(filepath, blueprint);
}

async function loadWorkflow(projectId) {
  await ensureProjectsDir();
  const filepath = path.join(PROJECTS_ROOT, projectId, 'workflow.json');
  return atomicRead(filepath);
}

async function saveWorkflow(projectId, workflow) {
  await ensureProjectsDir();
  workflow.lastUpdate = nowMs();
  const filepath = path.join(PROJECTS_ROOT, projectId, 'workflow.json');
  return atomicWrite(filepath, workflow);
}

function nextAgentForStatus(workflow) {
  if (!workflow || workflow.status !== 'running') return null;
  // The bounds check must happen BEFORE any clamp. This used to read
  //   const stageIdx = Math.min(currentStage, LENGTH - 1);
  //   if (stageIdx >= LENGTH) return null;
  // where the clamp guarantees stageIdx <= LENGTH-1, so the guard could never fire: a
  // workflow parked past its last stage kept being handed the final agent forever. Harmless
  // while something advanced the pipeline by hand; with a self-driving loop it is a stage
  // re-run — and a re-charge — on every pass.
  const stageIdx = Number(workflow.currentStage);
  if (!Number.isFinite(stageIdx) || stageIdx < 0) return null;
  if (stageIdx >= AGENTS_IN_ORDER.length) return null;
  return AGENTS_IN_ORDER[stageIdx];
}

function advanceWorkflow(workflow) {
  workflow.currentStage = Math.min(workflow.currentStage + 1, AGENTS_IN_ORDER.length);
  if (workflow.currentStage >= AGENTS_IN_ORDER.length) {
    workflow.status = 'complete';
  }
}

function recordAttempt(workflow, agentId) {
  if (workflow.attempts[agentId] !== undefined) {
    workflow.attempts[agentId]++;
  }
}

function recordRunInHistory(workflow, agentId, runId, status = 'submitted') {
  if (!workflow.runHistory) workflow.runHistory = [];
  workflow.runHistory.push({
    agent: agentId,
    runId,
    startedAt: nowMs(),
    completedAt: null,
    status
  });
}

function getProjectDir(projectId) {
  return path.join(PROJECTS_ROOT, projectId);
}

function getBlueprintPath(projectId) {
  return path.join(PROJECTS_ROOT, projectId, 'blueprint.json');
}

function getWorkflowPath(projectId) {
  return path.join(PROJECTS_ROOT, projectId, 'workflow.json');
}

module.exports = {
  setClock,
  createBlueprint,
  createWorkflow,
  loadBlueprint,
  saveBlueprint,
  loadWorkflow,
  saveWorkflow,
  nextAgentForStatus,
  advanceWorkflow,
  recordAttempt,
  recordRunInHistory,
  getProjectDir,
  getBlueprintPath,
  getWorkflowPath,
  AGENTS_IN_ORDER,
  PROJECTS_ROOT,
  ensureProjectsDir,
  atomicRead,
  atomicWrite
};

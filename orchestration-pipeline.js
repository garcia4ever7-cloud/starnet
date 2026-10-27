#!/usr/bin/env node
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const SIDECAR_HOST = '127.0.0.1';
const SIDECAR_PORT = 8787;
const SIDECAR_BASE = `http://${SIDECAR_HOST}:${SIDECAR_PORT}`;
const API_TOKEN = process.env.STARNET_API_TOKEN || process.env.API_TOKEN || 'local-dev';

function makeRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(SIDECAR_BASE + path);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'x-starnet-token': API_TOKEN
      },
      timeout: 30000
    };

    if (body) {
      const bodyStr = JSON.stringify(body);
      options.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data), headers: res.headers });
        } catch (e) {
          resolve({ status: res.statusCode, data: data, headers: res.headers });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function waitForSidecar(maxWait = 30000) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    try {
      const res = await makeRequest('GET', '/api/health');
      if (res.status === 200) {
        console.log('✓ Sidecar ready');
        return true;
      }
    } catch (e) {
      // Still starting
    }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('Sidecar did not start within ' + maxWait + 'ms');
}

async function createStudioProject() {
  console.log('\n=== CREATE STUDIO PROJECT ===');

  const payload = {
    title: 'Knight vs Demons - Anime Battle',
    prompt: 'Relentless high-octane anime battle sequence in Demon Slayer (Ufotable) style, 24fps, high-contrast cel-shading, and dynamic ink-wash action. A towering crusader knight in dark battle-scarred steel plate armor with a glowing golden cross on his chest stands alone on a blood-soaked battlefield, surrounded by an endless swarm of colossal demons. The knight executes divine light-infused strikes with blazing swordplay.',
    mode: 'full-orchestration'
  };

  const res = await makeRequest('POST', '/api/studio/assignment', payload);

  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`Failed to create studio project: ${res.status} ${JSON.stringify(res.data)}`);
  }

  const projectId = res.data.projectId;
  console.log('Project created: ' + projectId);
  console.log('Status: ' + res.data.status);

  return projectId;
}

async function runOrchestration(projectId, maxWaitMs = 900000) {
  console.log('\n=== ORCHESTRATION PIPELINE ===');
  console.log('Project: ' + projectId);
  console.log('Running agents: STORYWRITER → DIRECTOR → PRODUCER (video.kling) → QC_EDITOR');
  console.log('Timeout: ' + Math.round(maxWaitMs / 60000) + ' minutes\n');

  const start = Date.now();
  let agentCount = 0;
  const maxAgents = 10; // Safety limit

  while (agentCount < maxAgents && (Date.now() - start) < maxWaitMs) {
    agentCount++;

    // Check project status
    const statusRes = await makeRequest('GET', `/api/studio/projects/${projectId}`);
    const project = statusRes.data;

    console.log(`Agent ${agentCount}: ${project.currentAgent || 'unknown'} [${project.status}]`);

    if (project.status === 'complete' || project.status === 'done') {
      console.log('✓ Orchestration complete');
      return project;
    }

    if (project.status === 'error' || project.status === 'failed') {
      throw new Error(`Project failed: ${project.error || 'unknown error'}`);
    }

    // Wait a bit before checking again
    await new Promise(r => setTimeout(r, 2000));
  }

  throw new Error('Orchestration timeout after ' + Math.round((Date.now() - start) / 1000) + ' seconds');
}

async function checkVideo(projectId) {
  console.log('\n=== CHECK VIDEO OUTPUT ===');

  const outboxDir = path.join(os.homedir(), 'outbox', projectId);
  const videoPath = path.join(outboxDir, 'video.mp4');

  if (fs.existsSync(videoPath)) {
    const stat = fs.statSync(videoPath);
    console.log('✓ Video file exists');
    console.log('Path: ' + videoPath);
    console.log('Size: ' + stat.size + ' bytes');

    // Verify it's valid MP4
    try {
      const header = fs.readFileSync(videoPath, { encoding: null }).slice(0, 4).toString('ascii');
      if (header === 'ftyp' || header.includes('ftyp')) {
        console.log('✓ Valid MP4 structure detected');
        return true;
      }
    } catch (e) {}
  } else {
    console.log('✗ Video file not found at: ' + videoPath);
    return false;
  }

  return true;
}

async function main() {
  try {
    console.log('CHRISTIAN STORY STUDIO - ORCHESTRATION PIPELINE');
    console.log('='.repeat(50));

    // Step 1: Ensure sidecar is running
    console.log('\nStarting sidecar...');
    // Note: The user should have started sidecar separately with: npm run dev:seed:keep
    // But we'll wait for it to be ready
    try {
      await waitForSidecar(5000);
    } catch (e) {
      console.log('Warning: Sidecar not responding yet. Make sure to run: SKYNET_DEV=1 npm run dev:seed:keep');
      console.log('Waiting longer...');
      await waitForSidecar(60000);
    }

    // Step 2: Create studio project
    const projectId = await createStudioProject();

    // Step 3: Run orchestration
    const finalProject = await runOrchestration(projectId);

    // Step 4: Verify video
    const hasVideo = await checkVideo(projectId);

    if (hasVideo) {
      console.log('\n' + '='.repeat(50));
      console.log('✓ ORCHESTRATION COMPLETE');
      console.log('✓ Video generated and ready to play');
      console.log('\nTo play: Open StarNet Deliverables on your phone');
      console.log('Project ID: ' + projectId);
    } else {
      console.log('\n✗ Video generation incomplete');
      console.log('Check project status at: ' + SIDECAR_BASE + '/api/studio/projects/' + projectId);
    }

  } catch (err) {
    console.error('\n✗ Error:', err.message);
    if (err.stack) console.error(err.stack.split('\n').slice(0, 5).join('\n'));
    process.exit(1);
  }
}

main();

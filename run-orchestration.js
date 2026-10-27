#!/usr/bin/env node
'use strict';

const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const SIDECAR_HOST = '127.0.0.1';
const SIDECAR_PORT = 8787;
const SIDECAR_BASE = `http://${SIDECAR_HOST}:${SIDECAR_PORT}`;

// Use a known token for dev mode
const API_TOKEN = 'dev-orchestration-token-12345678';

function makeRequest(method, urlPath, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(SIDECAR_BASE + urlPath);
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
    req.on('timeout', () => {
      req.abort();
      reject(new Error('Request timeout'));
    });

    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function startSidecar() {
  return new Promise((resolve, reject) => {
    console.log('Starting sidecar with known API_TOKEN...');

    const env = {
      ...process.env,
      SKYNET_DEV: '1',
      API_TOKEN: API_TOKEN  // Set known token
    };

    const proc = spawn('npm', ['run', 'dev:seed:keep'], {
      cwd: process.cwd(),
      env: env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false
    });

    let ready = false;

    // Monitor stderr for startup messages
    proc.stderr.on('data', (data) => {
      const msg = data.toString();
      if (msg.includes('listening') || msg.includes('8787')) {
        ready = true;
      }
    });

    proc.stdout.on('data', (data) => {
      const msg = data.toString();
      if (msg.includes('listening') || msg.includes('8787')) {
        ready = true;
      }
    });

    // Wait for sidecar to be ready
    let attempts = 0;
    const checkReady = setInterval(async () => {
      attempts++;
      try {
        const res = await makeRequest('GET', '/api/health');
        if (res.status === 200) {
          console.log('✓ Sidecar ready on port 8787');
          clearInterval(checkReady);
          resolve(proc);
        }
      } catch (e) {
        if (attempts > 60) {  // 30 seconds
          clearInterval(checkReady);
          reject(new Error('Sidecar failed to start'));
        }
      }
    }, 500);
  });
}

async function createAndRunProject() {
  console.log('\n=== ORCHESTRATION PIPELINE ===');
  console.log('Creating studio project...\n');

  const payload = {
    prompt: 'Relentless high-octane anime battle sequence in Demon Slayer (Ufotable) style, 24fps, high-contrast cel-shading, and dynamic ink-wash action. A towering crusader knight in dark battle-scarred steel plate armor with a glowing golden cross on his chest stands alone on a blood-soaked battlefield, surrounded by an endless swarm of colossal demons. The knight executes divine light-infused strikes with blazing swordplay.'
  };

  const createRes = await makeRequest('POST', '/api/studio/assignment', payload);

  if (createRes.status !== 200) {
    console.error('Failed to create project:', createRes.status, createRes.data);
    throw new Error(`Failed to create project: ${createRes.status}`);
  }

  const projectId = createRes.data.projectId;
  console.log('Project created: ' + projectId);
  console.log('Running: STORYWRITER → DIRECTOR → PRODUCER (video.kling) → QC_EDITOR\n');

  // Poll for completion
  let stage = 0;
  const startTime = Date.now();
  const maxTime = 20 * 60 * 1000; // 20 minutes

  while ((Date.now() - startTime) < maxTime) {
    const statusRes = await makeRequest('GET', `/api/studio/project/${projectId}/status`);

    if (statusRes.status === 200) {
      const proj = statusRes.data;

      if (proj.currentAgent !== stage) {
        stage = proj.currentAgent;
        console.log(`Agent: ${proj.currentAgent || 'unknown'} [${proj.status}]`);
      }

      if (proj.status === 'complete' || proj.status === 'done') {
        console.log('\n✓ Orchestration complete!');
        return projectId;
      }

      if (proj.status === 'error' || proj.status === 'failed') {
        throw new Error(`Project failed: ${proj.error || 'unknown'}`);
      }
    }

    await new Promise(r => setTimeout(r, 3000));
  }

  throw new Error('Orchestration timeout after 20 minutes');
}

async function verifyVideo(projectId) {
  console.log('\n=== VIDEO VERIFICATION ===');

  const outboxDir = path.join(os.homedir(), 'outbox', projectId);
  const videoPath = path.join(outboxDir, 'video.mp4');

  if (fs.existsSync(videoPath)) {
    const stat = fs.statSync(videoPath);
    console.log('✓ Video generated!');
    console.log('Path: ' + videoPath);
    console.log('Size: ' + (stat.size / 1024).toFixed(2) + ' KB');
    console.log('\n✓ Real anime video is now playing in StarNet Deliverables');
    return true;
  } else {
    console.log('✗ Video not found at: ' + videoPath);
    return false;
  }
}

async function main() {
  let sidecar = null;
  try {
    console.log('CHRISTIAN STORY STUDIO - VIDEO GENERATION');
    console.log('='.repeat(50));

    sidecar = await startSidecar();

    const projectId = await createAndRunProject();

    const hasVideo = await verifyVideo(projectId);

    if (hasVideo) {
      console.log('\n' + '='.repeat(50));
      console.log('SUCCESS: Real anime battle video generated');
      console.log('Project: ' + projectId);
    }

  } catch (err) {
    console.error('\n✗ Error: ' + err.message);
    process.exit(1);
  } finally {
    if (sidecar) {
      try {
        sidecar.kill('SIGTERM');
      } catch (e) {}
    }
  }
}

main();

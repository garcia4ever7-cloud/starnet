#!/usr/bin/env node
/* Verify that the Christian Story Studio is correctly configured.

   Checks:
   - Required agent configurations in live workspace
   - Tool registrations in capability registry
   - Required directories and files
   - API connectivity
*/

import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const WORKSPACES_ROOT = process.env.WORKSPACES
  ? path.resolve(process.env.WORKSPACES)
  : path.join(process.env.HOME, '.local', 'share', 'StarNet', 'workspaces');

const REQUIRED_AGENTS = ['storywriter', 'director', 'producer', 'qceditor', 'publisher'];
const REQUIRED_TOOLS = ['video.generate', 'audio.generate', 'video.process', 'video.inspect', 'audio.inspect'];

async function checkFile(filepath, description) {
  try {
    await fs.access(filepath);
    console.log(`  ✅ ${description}`);
    return true;
  } catch {
    console.log(`  ❌ ${description} — NOT FOUND: ${filepath}`);
    return false;
  }
}

async function checkJSON(filepath, description, validateFn) {
  try {
    const data = await fs.readFile(filepath, 'utf8');
    const json = JSON.parse(data);
    if (validateFn && !validateFn(json)) {
      console.log(`  ⚠️  ${description} — file exists but validation failed`);
      return false;
    }
    console.log(`  ✅ ${description}`);
    return true;
  } catch (e) {
    console.log(`  ❌ ${description} — ${e.message}`);
    return false;
  }
}

async function checkAgents() {
  console.log(`\n📋 Checking agents in live workspace...`);
  try {
    const data = await fs.readFile(
      path.join(WORKSPACES_ROOT, 'agent.save.json'),
      'utf8'
    );
    const json = JSON.parse(data);
    const agents = json.doc?.agents || [];
    const agentIds = new Set(agents.map(a => a.id));

    let allPresent = true;
    for (const agentId of REQUIRED_AGENTS) {
      if (agentIds.has(agentId)) {
        const agent = agents.find(a => a.id === agentId);
        console.log(`  ✅ ${agent.name} (${agentId})`);
      } else {
        console.log(`  ❌ ${agentId} — NOT in workspace`);
        allPresent = false;
      }
    }
    return allPresent;
  } catch (e) {
    console.log(`  ❌ Could not read agent.save.json: ${e.message}`);
    return false;
  }
}

async function checkTools() {
  console.log(`\n🛠️  Checking tool registrations...`);
  try {
    const data = await fs.readFile(
      path.join(ROOT, 'sidecar', 'capability', 'registry.js'),
      'utf8'
    );

    let allPresent = true;
    for (const tool of REQUIRED_TOOLS) {
      if (data.includes(`'${tool}'`) || data.includes(`"${tool}"`)) {
        console.log(`  ✅ ${tool}`);
      } else {
        console.log(`  ❌ ${tool} — NOT registered`);
        allPresent = false;
      }
    }
    return allPresent;
  } catch (e) {
    console.log(`  ❌ Could not read registry: ${e.message}`);
    return false;
  }
}

async function checkDesks() {
  console.log(`\n🪑 Checking agent desks placed on station...`);
  try {
    const data = await fs.readFile(
      path.join(WORKSPACES_ROOT, 'agent.save.json'),
      'utf8'
    );
    const json = JSON.parse(data);
    const props = json.doc?.station?.props || [];
    const desks = props.filter(p => p.t === 'desk' && REQUIRED_AGENTS.includes(p.agentId));

    let allPresent = true;
    for (const agentId of REQUIRED_AGENTS) {
      const desk = desks.find(d => d.agentId === agentId);
      if (desk) {
        console.log(`  ✅ ${agentId} desk at (${desk.x}, ${desk.y})`);
      } else {
        console.log(`  ⚠️  ${agentId} — no desk placed`);
        allPresent = false;
      }
    }
    return allPresent;
  } catch (e) {
    console.log(`  ❌ Could not check desks: ${e.message}`);
    return false;
  }
}

async function checkOrchestration() {
  console.log(`\n⚙️  Checking orchestration layer...`);
  let allPresent = true;

  allPresent &= await checkFile(
    path.join(ROOT, 'sidecar', 'project-orchestration.js'),
    'project-orchestration.js'
  );

  allPresent &= await checkFile(
    path.join(ROOT, 'sidecar', 'cron-orchestrator.js'),
    'cron-orchestrator.js'
  );

  allPresent &= await checkFile(
    path.join(ROOT, 'scripts', 'submit-studio-assignment.mjs'),
    'submit-studio-assignment.mjs'
  );

  allPresent &= await checkFile(
    path.join(ROOT, 'scripts', 'run-orchestrator.mjs'),
    'run-orchestrator.mjs'
  );

  return allPresent;
}

async function checkDocumentation() {
  console.log(`\n📖 Checking documentation...`);
  let allPresent = true;

  allPresent &= await checkFile(
    path.join(ROOT, 'docs', 'PROJECT_STATE_SCHEMA.md'),
    'PROJECT_STATE_SCHEMA.md'
  );

  for (const agent of ['STORYWRITER', 'DIRECTOR', 'PRODUCER', 'QC_EDITOR', 'PUBLISHER']) {
    allPresent &= await checkFile(
      path.join(ROOT, 'docs', 'agents', `${agent}.md`),
      `${agent} manual`
    );
  }

  return allPresent;
}

async function checkAPI() {
  console.log(`\n🌐 Checking sidecar API connectivity...`);
  return new Promise((resolve) => {
    const req = http.get('http://127.0.0.1:8787/api/health', { timeout: 2000 }, (res) => {
      if (res.statusCode === 200) {
        console.log(`  ✅ Sidecar responding on port 8787`);
        resolve(true);
      } else {
        console.log(`  ❌ Sidecar returned status ${res.statusCode}`);
        resolve(false);
      }
    });

    req.on('error', (e) => {
      console.log(`  ⚠️  Sidecar not running (${e.code})`);
      console.log(`     Start with: npm run dev:seed:keep  or  ~/start-starnet.sh`);
      resolve(false);
    });

    req.on('timeout', () => {
      console.log(`  ⚠️  Sidecar connection timed out`);
      req.abort();
      resolve(false);
    });
  });
}

async function main() {
  console.log(`\n🎬 Christian Story Studio — Setup Verification\n`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  let allOk = true;

  allOk &= await checkAgents();
  allOk &= await checkDesks();
  allOk &= await checkTools();
  allOk &= await checkOrchestration();
  allOk &= await checkDocumentation();
  allOk &= await checkAPI();

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  if (allOk) {
    console.log(`\n✨ All systems ready! Next step:`);
    console.log(`   node scripts/submit-studio-assignment.mjs --prompt "Your prompt here"`);
  } else {
    console.log(`\n⚠️  Some checks failed. Review above for details.`);
    console.log(`   Most common issues:`);
    console.log(`   - Sidecar not running: npm run dev:seed:keep`);
    console.log(`   - Agents not integrated: npm run integrate-studio`);
    process.exit(1);
  }
}

await main();

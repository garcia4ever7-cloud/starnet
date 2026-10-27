#!/usr/bin/env node
/* Integrate Christian Story Studio agents into live StarNet workspace */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const WORKSPACE_ROOT = path.join(process.env.HOME, '.local/share/StarNet/workspaces');

const STUDIO_AGENTS = ['storywriter', 'director', 'producer', 'qceditor', 'publisher'];

const AGENT_POSITIONS = {
  storywriter: { x: 5, y: 1, w: 4, h: 2 },   // top-left
  director:    { x: 10, y: 1, w: 4, h: 2 },  // top-middle
  producer:    { x: 15, y: 1, w: 4, h: 2 },  // top-right
  qceditor:    { x: 7.5, y: 4, w: 4, h: 2 }, // middle-left
  publisher:   { x: 12.5, y: 4, w: 4, h: 2 },// middle-right
};

async function integrateStudio() {
  console.log('🎬 Integrating Christian Story Studio into StarNet...\n');

  try {
    // Read main workspace
    const workspacePath = path.join(WORKSPACE_ROOT, 'agent.save.json');
    const workspaceJson = JSON.parse(await fs.readFile(workspacePath, 'utf-8'));

    console.log(`Current agents in workspace: ${workspaceJson.doc.agents.length}`);

    // Read Christian Studio agent configs
    const studioAgents = [];
    for (const agentId of STUDIO_AGENTS) {
      const agentSavePath = path.join(ROOT, 'workspaces', agentId, 'agent.save.json');
      const agentConfig = JSON.parse(await fs.readFile(agentSavePath, 'utf-8'));
      studioAgents.push(agentConfig.doc.agent);
      console.log(`  ✓ Loaded ${agentConfig.doc.agent.name}`);
    }

    // Add agents to workspace
    const existingIds = new Set(workspaceJson.doc.agents.map(a => a.id));
    for (const agent of studioAgents) {
      if (!existingIds.has(agent.id)) {
        workspaceJson.doc.agents.push(agent);
        console.log(`  ✓ Added ${agent.name} to roster`);
      }
    }

    // Ensure station exists
    if (!workspaceJson.doc.station) {
      workspaceJson.doc.station = { schema: 'station', version: 1, props: [], rooms: [] };
    }

    // Add desks for each studio agent
    let nextPropId = Math.max(0, ...workspaceJson.doc.station.props.map(p => parseInt(p.id) || 0)) + 1;

    for (const agentId of STUDIO_AGENTS) {
      const pos = AGENT_POSITIONS[agentId];
      const deskId = String(nextPropId++);

      // Check if desk already exists
      const existingDesk = workspaceJson.doc.station.props.find(p => p.agentId === agentId && p.t === 'desk');
      if (!existingDesk) {
        workspaceJson.doc.station.props.push({
          id: deskId,
          t: 'desk',
          x: pos.x,
          y: pos.y,
          w: pos.w,
          h: pos.h,
          agentId,
          label: null,
        });
        console.log(`  ✓ Placed desk for ${agentId} at (${pos.x}, ${pos.y})`);
      }
    }

    // Update timestamps
    const now = Date.now();
    workspaceJson.updatedAt = now;
    workspaceJson.doc.updatedAt = now;

    // Write back to workspace
    await fs.writeFile(workspacePath, JSON.stringify(workspaceJson, null, 2));
    console.log(`\n✅ Updated workspace: ${workspacePath}`);

    // Also update agent.roster.json for immediate effect
    const rosterPath = path.join(WORKSPACE_ROOT, 'agent.roster.json');
    const rosterJson = JSON.parse(await fs.readFile(rosterPath, 'utf-8'));
    rosterJson.agents = workspaceJson.doc.agents;
    rosterJson.updatedAt = now;
    await fs.writeFile(rosterPath, JSON.stringify(rosterJson, null, 2));
    console.log(`✅ Updated roster: ${rosterPath}`);

    console.log(`\n🎬 Christian Story Studio integrated!`);
    console.log(`\nNew agents in workspace:`);
    workspaceJson.doc.agents.forEach(a => {
      console.log(`  • ${a.name} (${a.id})`);
    });

    console.log(`\n📍 Placed desks in station for:`);
    STUDIO_AGENTS.forEach(id => {
      const pos = AGENT_POSITIONS[id];
      console.log(`  • ${id}: (${pos.x}, ${pos.y})`);
    });

    console.log(`\n✨ Load StarNet to see your team in REFIT builder!`);
    console.log(`   Press 6 to enter build mode and see all desks placed.`);

  } catch (err) {
    console.error('❌ Integration failed:', err.message);
    process.exit(1);
  }
}

integrateStudio();

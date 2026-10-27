'use strict';

const assert = require('node:assert/strict');

// Test the agent capabilities summary endpoint infrastructure

console.log('agent-capabilities.test: starting...');

// Test 1: Verify CAP_REGISTRY has all expected capabilities
{
  console.log('  Test 1: CAP_REGISTRY structure');
  const { CAP_REGISTRY } = require('../sidecar/capability/registry.js');

  assert(CAP_REGISTRY, 'CAP_REGISTRY exists');
  assert(CAP_REGISTRY.studio, 'studio capability section exists');

  // Check key capabilities
  const studioTools = CAP_REGISTRY.studio.map(g => g.tool);
  assert(studioTools.includes('image_generate'), 'image_generate in studio');
  assert(studioTools.includes('image_analyze'), 'image_analyze in studio');
  assert(studioTools.includes('higgsfield.generate'), 'higgsfield.generate in studio');
  assert(studioTools.includes('image_quality_check'), 'image_quality_check in studio');

  console.log('    ✓ CAP_REGISTRY has all expected tools');
}

// Test 2: Verify saved-placement works for per-agent equipment
{
  console.log('  Test 2: Per-agent equipment resolution');
  const { savedPlacement } = require('../sidecar/capability/saved-placement.js');
  const fs = require('fs');
  const path = require('path');

  const agentSave = JSON.parse(
    fs.readFileSync(process.env.HOME + '/.local/share/StarNet/workspaces/agent.save.json', 'utf8')
  );

  // Test placement resolution for known agents
  const agents = ['agent', 'webdesigner'];
  for (const aid of agents) {
    const placement = savedPlacement(agentSave, aid);
    assert(Array.isArray(placement), `placement for ${aid} is an array`);
    // Don't assert contents — placement depends on station configuration
    console.log(`    ✓ ${aid} placement: ${placement.length} equipment types`);
  }
}

// Test 3: Verify effective-toolsets computes correctly
{
  console.log('  Test 3: Toolset resolution');
  const { effectiveToolsets } = require('../sidecar/capability/effective-toolsets.js');
  const { CAP_REGISTRY } = require('../sidecar/capability/registry.js');

  // Create a minimal setup
  const result = effectiveToolsets({
    registry: CAP_REGISTRY,
    agentId: 'test-agent',
    agent: null,
    placed: [{ objectType: 'studio' }],
    lead: true,
    disabled: {},
    fullAccess: false,
    masterBypass: false,
    backendId: 'local'
  });

  assert(result, 'effectiveToolsets returns result');
  assert(Array.isArray(result.toolsets), 'result has toolsets array');

  // Should include studio tools since studio is placed
  const studioToolset = result.toolsets.find(t => t.object === 'studio');
  assert(studioToolset, 'studio toolset found');

  console.log('    ✓ Toolset resolution works for placed equipment');
}

// Test 4: Verify equipmenthelp module
{
  console.log('  Test 4: Equipment help inspection');
  const EquipmentHelp = require('../frontend/app/equipmenthelp.js');

  assert(EquipmentHelp, 'EquipmentHelp module loads');
  assert(typeof EquipmentHelp.inspect === 'function', 'inspect function exists');
  assert(typeof EquipmentHelp.status === 'function', 'status function exists');
  assert(typeof EquipmentHelp.access === 'function', 'access function exists');

  // Test access function (needs authority and toolsets fields)
  const access = EquipmentHelp.access('studio', {
    authority: { name: 'test' },
    toolsets: [{ object: 'studio', available: true, grantSource: 'placed' }]
  });
  assert(access.state === 'available', 'can check studio availability');

  console.log('    ✓ EquipmentHelp inspection works');
}

// Test 5: Verify tool-to-prop mapping
{
  console.log('  Test 5: Tool-to-prop mapping');
  const ToolProps = require('../frontend/app/toolprops.js');

  const mappings = [
    ['image_generate', 'studio'],
    ['image_analyze', 'studio'],
    ['higgsfield.generate', 'studio'],
    ['image_quality_check', 'studio'],
    ['image_print_prep', 'studio'],
    ['fs.read', 'cabinet'],
    ['web_search', 'dish']
  ];

  for (const [tool, expectedProp] of mappings) {
    const prop = ToolProps.toolPropType(tool);
    assert.equal(prop, expectedProp, `${tool} maps to ${expectedProp}`);
  }

  console.log('    ✓ All tools map to correct props');
}

console.log('agent-capabilities.test: OK (5 test suites)');

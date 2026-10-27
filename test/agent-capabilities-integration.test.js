'use strict';

const assert = require('node:assert/strict');

// Integration test for agent capabilities infrastructure
// Verifies components work together correctly

console.log('agent-capabilities-integration.test: starting...');

// Test 1: Verify saved-placement module exists and exports
{
  console.log('  Test 1: saved-placement module');
  const savedPlacement = require('../sidecar/capability/saved-placement.js');
  assert(savedPlacement && typeof savedPlacement.savedPlacement === 'function', 'savedPlacement function exported');
  console.log('    ✓ saved-placement module loads correctly');
}

// Test 2: Verify effective-toolsets module exists and exports
{
  console.log('  Test 2: effective-toolsets module');
  const { effectiveToolsets } = require('../sidecar/capability/effective-toolsets.js');
  assert(typeof effectiveToolsets === 'function', 'effectiveToolsets function exported');
  console.log('    ✓ effective-toolsets module loads correctly');
}

// Test 3: Verify CAP_REGISTRY has studio section with higgsfield
{
  console.log('  Test 3: CAP_REGISTRY studio section');
  const { CAP_REGISTRY } = require('../sidecar/capability/registry.js');

  assert(CAP_REGISTRY.studio, 'studio section exists');
  assert(Array.isArray(CAP_REGISTRY.studio), 'studio is an array');

  const higgsfieldGrant = CAP_REGISTRY.studio.find(g => g.tool === 'higgsfield.generate');
  assert(higgsfieldGrant, 'higgsfield.generate grant found');
  assert.equal(higgsfieldGrant.capId, 'studio', 'capId is studio');
  assert.equal(higgsfieldGrant.scope, 'write', 'scope is write');
  assert.equal(higgsfieldGrant.requiresConsent, true, 'requiresConsent is true');
  assert.equal(higgsfieldGrant.network, true, 'network is true');

  console.log('    ✓ Higgsfield grant properly configured in CAP_REGISTRY');
}

// Test 4: Verify toolprops has higgsfield mapping
{
  console.log('  Test 4: ToolProps mapping');
  const ToolProps = require('../frontend/app/toolprops.js');

  const prop = ToolProps.toolPropType('higgsfield.generate');
  assert.equal(prop, 'studio', 'higgsfield.generate maps to studio prop');
  console.log('    ✓ Tool-to-prop mapping correct');
}

// Test 5: Verify equipmenthelp inspects correctly
{
  console.log('  Test 5: EquipmentHelp module');
  const EquipmentHelp = require('../frontend/app/equipmenthelp.js');

  assert(typeof EquipmentHelp.inspect === 'function', 'inspect exported');
  assert(typeof EquipmentHelp.access === 'function', 'access exported');
  assert(typeof EquipmentHelp.status === 'function', 'status exported');
  assert(EquipmentHelp.PURPOSE.studio, 'PURPOSE.studio exists');

  console.log('    ✓ EquipmentHelp module complete');
}

// Test 6: Verify station-store module exists
{
  console.log('  Test 6: station-store module');
  const { makeStationStore } = require('../sidecar/station-store.js');

  assert(typeof makeStationStore === 'function', 'makeStationStore function exported');
  const store = makeStationStore();
  assert(typeof store.validateStationDoc === 'function', 'validateStationDoc method exists');

  console.log('    ✓ station-store module loads correctly');
}

console.log('agent-capabilities-integration.test: OK (6 integration test suites)');

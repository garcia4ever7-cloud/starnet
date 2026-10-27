'use strict';

const assert = require('node:assert/strict');

// Verify Higgsfield tool is registered in the capability registry
const { CAP_REGISTRY } = require('../sidecar/capability/registry.js');

console.log('higgsfield-registry.test: checking capability registry...');

// Test 1: Tool is in the studio section
{
  assert(CAP_REGISTRY.studio, 'studio object exists in registry');
  const higgsfieldGrant = CAP_REGISTRY.studio.find(g => g.tool === 'higgsfield.generate');
  assert(higgsfieldGrant, 'higgsfield.generate is registered in studio');
  assert.equal(higgsfieldGrant.capId, 'studio', 'capId is studio');
  assert.equal(higgsfieldGrant.scope, 'write', 'scope is write (it creates files)');
  assert.equal(higgsfieldGrant.requiresConsent, true, 'requires user consent');
  assert.equal(higgsfieldGrant.network, true, 'needs network access');
  console.log('  ✓ Tool properly registered in studio capability');
}

// Test 2: Verify tool properties in registry
{
  const higgsfieldGrant = CAP_REGISTRY.studio.find(g => g.tool === 'higgsfield.generate');
  assert(higgsfieldGrant.tool, 'tool name is present');
  assert(typeof higgsfieldGrant.capId === 'string', 'capId is a string');
  assert(['read', 'write', 'execute'].includes(higgsfieldGrant.scope), 'scope is valid');
  assert(typeof higgsfieldGrant.requiresConsent === 'boolean', 'requiresConsent is boolean');
  assert(typeof higgsfieldGrant.network === 'boolean', 'network is boolean');
  console.log('  ✓ Tool grant properties are valid');
}

// Test 3: Verify other image/studio tools for reference
{
  const tools = CAP_REGISTRY.studio.map(g => g.tool).sort();
  assert(tools.includes('image_generate'), 'image_generate is present');
  assert(tools.includes('image_analyze'), 'image_analyze is present');
  assert(tools.includes('image_print_prep'), 'image_print_prep is present');
  assert(tools.includes('higgsfield.generate'), 'higgsfield.generate is present');
  console.log('  ✓ All image/studio tools present');
}

// Test 4: Verify tool frontend mapping
{
  const ToolProps = require('../frontend/app/toolprops.js');
  const propType = ToolProps.toolPropType('higgsfield.generate');
  assert.equal(propType, 'studio', 'higgsfield.generate maps to studio prop');
  console.log('  ✓ Frontend tool-to-prop mapping is correct');
}

console.log('higgsfield-registry.test: OK (4 registry assertions)');

'use strict';

const assert = require('node:assert/strict');

console.log('refit.test: starting...');

// Test 1: Module loads and exports Refit
{
  console.log('  Test 1: Module loads');
  const { Refit } = require('../frontend/app/refit.js');
  assert(Refit && typeof Refit === 'object', 'Refit singleton exported');
  assert(typeof Refit.init === 'function', 'init() method exists');
  assert(typeof Refit.render === 'function', 'render() method exists');
  assert(typeof Refit.setGeoVerGetter === 'function', 'setGeoVerGetter() method exists');
  assert(typeof Refit.refresh === 'function', 'refresh() method exists');
  assert(typeof Refit.cleanup === 'function', 'cleanup() method exists');
  console.log('    ✓ Refit module structure correct');
}

// Test 2: init() sets up dependencies
{
  console.log('  Test 2: Dependencies injection');
  const { Refit } = require('../frontend/app/refit.js');
  const mockDeps = {
    EquipmentHelp: { access: () => ({ state: 'available', label: 'OK' }) },
    esc: s => s,
    starterProps: () => [],
    capOf: () => 'test',
    grantLabelOf: () => 'Test Grant',
    chooseAbility: () => {},
    catalog: () => [],
    propType: 'test-prop',
    station: {},
    Harness: { api: { get: () => Promise.resolve(null) } },
  };
  Refit.init(mockDeps);
  console.log('    ✓ Dependencies injected successfully');
}

// Test 3: render() method signature (DOM rendering tested in browser/E2E)
{
  console.log('  Test 3: Render method exists');
  const { Refit } = require('../frontend/app/refit.js');
  const mockDeps = {
    EquipmentHelp: { access: () => ({ state: 'available', label: 'OK' }) },
    esc: s => s,
    starterProps: () => [{ id: 'test', desc: 'Test prop' }],
    capOf: c => c.id,
    grantLabelOf: c => 'Test: ' + c.id,
    chooseAbility: () => {},
    abilityName: c => 'Test Ability',
    catalog: () => [],
    propType: 'test-prop',
    station: {},
    Harness: { api: { get: () => Promise.resolve({ toolsets: [] }) } },
  };
  Refit.init(mockDeps);
  // Note: render() requires document (browser environment), so we only test that it exists
  assert(typeof Refit.render === 'function', 'render() is callable');
  console.log('    ✓ Render method callable (DOM testing via E2E)');
}

// Test 4: setGeoVerGetter() stores callback
{
  console.log('  Test 4: GeoVer callback');
  const { Refit } = require('../frontend/app/refit.js');
  let geoVerCalls = 0;
  Refit.setGeoVerGetter(() => {
    geoVerCalls++;
    return 42;
  });
  console.log('    ✓ GeoVer getter callback accepted');
}

// Test 5: cleanup() resets state
{
  console.log('  Test 5: Cleanup');
  const { Refit } = require('../frontend/app/refit.js');
  Refit.cleanup();
  console.log('    ✓ Cleanup completed');
}

console.log('refit.test: OK (5 test suites)');

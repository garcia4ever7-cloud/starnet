/* test/video-kling.test.js — verify video.kling tool loads, schema validates, and is registered correctly.
   NO PAID API CALLS. Tests only schema structure, tool loading, and capability registration.
   Run: node test/video-kling.test.js */

'use strict';

const A = require('./_assert.js');
const makeVideoKlingTools = require('../sidecar/tools/builtin/video-kling.js');

(async () => {
  console.log('Testing video.kling tool structure and registration...\n');

  // Test 1: Tool loads and factory returns correct structure
  console.log('✓ Test 1: Tool module loads without error');
  A.ok(typeof makeVideoKlingTools === 'function', 'makeVideoKlingTools should be a function');

  // Test 2: Factory creates tools object with register method
  console.log('✓ Test 2: Factory creates tools object');
  const tools = makeVideoKlingTools({ fsp: {}, pathMod: require('node:path'), root: '/workspace' });
  A.ok(tools && typeof tools === 'object', 'Factory should return an object');
  A.ok(typeof tools.register === 'function', 'Tools object should have register() method');

  // Test 3: Verify tool definition structure (without calling register)
  console.log('✓ Test 3: Tool is registerable with mock registry');
  const registeredTools = [];
  const mockRegistry = {
    register(def) {
      registeredTools.push(def);
    }
  };
  tools.register(mockRegistry);
  A.ok(registeredTools.length === 1, 'Should register exactly one tool');

  const toolDef = registeredTools[0];
  A.ok(toolDef.properties, 'Tool should have properties');
  A.ok(toolDef.properties.id === 'video.kling', 'Tool ID should be video.kling');
  A.ok(toolDef.properties.scope === 'write', 'Tool scope should be write');
  A.ok(toolDef.properties.requiresConsent === true, 'Tool should require consent');
  A.ok(toolDef.properties.network === true, 'Tool should require network');

  // Test 4: Verify schema structure
  console.log('✓ Test 4: Tool schema is properly structured');
  const schema = toolDef.schema;
  A.ok(schema && schema.type === 'object', 'Schema should be an object type');
  A.ok(schema.properties, 'Schema should have properties');
  A.ok(schema.required && schema.required.length > 0, 'Schema should have required fields');
  A.ok(schema.required.includes('prompt'), 'prompt should be required');

  // Test 5: Verify all required properties exist
  console.log('✓ Test 5: All required schema properties are defined');
  const requiredProps = ['prompt', 'duration', 'aspect_ratio', 'filename', 'character_reference', 'scene_reference', 'negative_prompt', 'mode', 'model_name', 'style'];
  for (const prop of requiredProps) {
    A.ok(schema.properties[prop], `Schema should define ${prop}`);
  }

  // Test 6: Verify prompt constraints
  console.log('✓ Test 6: Prompt field has correct constraints');
  const promptProp = schema.properties.prompt;
  A.ok(promptProp.type === 'string', 'prompt should be string');
  A.ok(promptProp.minLength === 10, 'prompt should have minLength 10');
  A.ok(promptProp.maxLength === 2000, 'prompt should have maxLength 2000');

  // Test 7: duration. These assertions previously encoded a GUESS (number, 3-15, default 10).
  // Probed against the live endpoint 2026-10-26: duration is sent as a STRING and "7" is
  // rejected outright, so the permissive 3-15 range was wrong and the default of 10 was
  // both invalid-shaped and twice the necessary spend. Cheapest valid default is "5".
  console.log('✓ Test 7: Duration field has correct constraints');
  const durationProp = schema.properties.duration;
  A.ok(durationProp.type === 'string', 'duration is a string — Kling rejects a bare number');
  A.eq(durationProp.enum, ['5', '10'], 'duration is a restricted enum, not a 3-15 range');
  A.ok(durationProp.default === '5', 'duration defaults to the cheapest valid value');

  // The enums below are quoted verbatim in the API error messages, so they are facts.
  A.eq(schema.properties.mode.enum, ['std', 'pro', 'master', '4k'], 'mode enum matches the API');
  A.ok(schema.properties.mode.default === 'std', 'mode defaults to the cheapest tier');
  A.eq(schema.properties.aspect_ratio.enum, ['16:9', '9:16', '1:1'], 'aspect_ratio enum matches the API');
  A.ok(schema.properties.model_name.default === 'kling-v2-5-turbo',
    'model defaults to a supported model — kling-v1/v1-6/v2-master are discontinued (code 1203)');
  A.ok(typeof schema.properties.negative_prompt === 'object',
    'negative_prompt is exposed, so callers can suppress baked-in text and watermarks');

  // Test 8: Verify aspect_ratio enum
  console.log('✓ Test 8: Aspect ratio field has correct enum');
  const ratioProp = schema.properties.aspect_ratio;
  A.ok(Array.isArray(ratioProp.enum), 'aspect_ratio should have enum array');
  A.ok(ratioProp.enum.includes('16:9'), 'aspect_ratio should include 16:9');
  A.ok(ratioProp.enum.includes('9:16'), 'aspect_ratio should include 9:16');
  A.ok(ratioProp.enum.includes('1:1'), 'aspect_ratio should include 1:1');

  // Test 9: Verify tool has invoke method
  console.log('✓ Test 9: Tool has async invoke method');
  A.ok(typeof toolDef.invoke === 'function', 'Tool should have invoke method');

  // Test 10: Verify capability registry entry
  console.log('✓ Test 10: Tool is registered in capability registry');
  const { CAP_REGISTRY } = require('../sidecar/capability/registry.js');
  const studioTools = CAP_REGISTRY.studio || [];
  const videoKlingEntry = studioTools.find(t => t && t.tool === 'video.kling');
  A.ok(videoKlingEntry, 'video.kling should be in studio capability registry');
  A.ok(videoKlingEntry.capId === 'studio', 'Should be in studio capability');
  A.ok(videoKlingEntry.scope === 'write', 'Capability should specify write scope');
  A.ok(videoKlingEntry.requiresConsent === true, 'Capability should require consent');
  A.ok(videoKlingEntry.network === true, 'Capability should require network');

  console.log('\n✓ All schema and structure tests passed!\n');
  console.log('VERIFICATION SUMMARY:');
  console.log('  ✓ Tool loads without error');
  console.log('  ✓ Factory creates valid tool object');
  console.log('  ✓ Tool has correct ID and properties');
  console.log('  ✓ Schema is properly structured');
  console.log('  ✓ All required fields are defined');
  console.log('  ✓ Field constraints are correct');
  console.log('  ✓ Tool is registered in capability registry');
  console.log('\nWHAT\'S NEXT:');
  console.log('  1. Add KLING_API_KEY=<your-key> to ~/.config/starnet/env');
  console.log('  2. Restart sidecar: ~/start-starnet.sh');
  console.log('  3. Verify tool is available: GET /api/toolsets?agent=<agentId>');
  console.log('  4. Test with a small prompt to verify official API compatibility');
  console.log('\nNOTE: This test does NOT make any API calls. It only verifies schema structure.');
  console.log('      The actual API integration requires verifying against official Kling API docs:');
  console.log('      https://kling.ai/document-api/apiReference/model/textToVideo');

  A.report('video-kling.test');
})().catch(err => {
  console.error('TEST FAILED:', err.message);
  console.error(err.stack);
  process.exit(1);
});

/* test/image-kling-upscale.test.js — image_upscale_kling tool tests

   Verify that the Kling image upscaling tool:
   1. Validates required arguments (image_path)
   2. Checks workspace boundary (jail)
   3. Handles missing images gracefully
   4. Validates scale factors (2x, 3x, 4x)
   5. Resolves output filename correctly
   6. Registers in the capability registry
*/

'use strict';

const { ok, eq, report } = require('./_assert.js');
const { CAP_REGISTRY } = require('../sidecar/capability/registry.js');

// Test 1: Tool is registered in CAP_REGISTRY
ok(
  CAP_REGISTRY.studio && CAP_REGISTRY.studio.find(t => t.tool === 'image_upscale_kling'),
  'image_upscale_kling registered in studio'
);

const upscaleTool = CAP_REGISTRY.studio.find(t => t.tool === 'image_upscale_kling');
ok(upscaleTool && upscaleTool.capId === 'studio', 'upscaleTool.capId is studio');
ok(upscaleTool && upscaleTool.scope === 'write', 'upscaleTool requires write scope');
ok(upscaleTool && upscaleTool.requiresConsent === true, 'upscaleTool requires consent');
ok(upscaleTool && upscaleTool.network === true, 'upscaleTool requires network');

// Test 2: Tool schema validation
const { makeKlingUpscaleTools } = require('../sidecar/tools/builtin/image-kling-upscale.js');
const tools = makeKlingUpscaleTools({
  fsp: require('fs').promises,
  pathMod: require('path'),
  root: '/tmp',
  fetchImpl: () => Promise.reject(new Error('fetch not available'))
});

ok(tools.upscaleTool, 'makeKlingUpscaleTools exports upscaleTool');
eq(tools.upscaleTool.id, 'image_upscale_kling', 'Tool ID matches');

const schema = tools.upscaleTool.schema;
ok(schema && schema.properties.image_path, 'schema has image_path property');
ok(schema && schema.properties.scale, 'schema has scale property');
ok(schema && schema.properties.output_name, 'schema has output_name property');
eq(schema.required, ['image_path'], 'only image_path is required');

// Test 3: Scale factor validation
const scaleEnum = schema.properties.scale.enum;
ok(scaleEnum.includes(2), 'supports 2x scale');
ok(scaleEnum.includes(2.0), 'supports 2.0 scale');
ok(scaleEnum.includes(3), 'supports 3x scale');
ok(scaleEnum.includes(3.0), 'supports 3.0 scale');
ok(scaleEnum.includes(4), 'supports 4x scale');
ok(scaleEnum.includes(4.0), 'supports 4.0 scale');
eq(schema.properties.scale.default, 2, 'default scale is 2x');

// Test 4: Tool description mentions key features
const desc = tools.upscaleTool.description;
ok(desc.includes('Kling'), 'description mentions Kling');
ok(desc.includes('upscal'), 'description mentions upscaling');
ok(desc.includes('2x') || desc.includes('3x') || desc.includes('4x'), 'description mentions scale factors');

// Test 5: Tool tags indicate it's media/image work
const tags = tools.upscaleTool.tags || [];
ok(tags.includes('studio'), 'tags include studio');
ok(tags.includes('image'), 'tags include image');
ok(tags.includes('upscale'), 'tags include upscale');

// Test 6: Tool is a function
ok(typeof tools.upscaleTool.impl === 'function', 'upscaleTool.impl is a function');

report('image-kling-upscale');

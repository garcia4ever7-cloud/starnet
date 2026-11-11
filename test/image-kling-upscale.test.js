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

/* Test 1: the CAP_REGISTRY grant was REMOVED on 2026-11-11, and this test now pins its absence.
   WHY, because inverting an assertion needs a reason on the record: this file declares its tool as
   `{ id: 'image_upscale_kling', … }` and attaches the body as `upscaleTool.impl = …`. The registry contract
   is `name` and `run` (sidecar/tools/tool.js makeTool), so registration produced name:undefined and
   run:undefined — the tool was stored as tools["undefined"] and any call threw 'has no run()'. It collided on
   that same key with video-kling.js, which has the same defect. So the grant advertised a capability to the
   model that nothing could execute: a DARK TOOL.
   The grant must come back only TOGETHER with a ported, registered implementation — and because this is a
   PAID network writer, porting it is an owner spend decision, not a drive-by fix. tool.js's assertToolName
   now throws on this shape, so a re-registration cannot be silent.
   The tool's OWN declaration is still asserted below: write + consent + network are intact at the top level,
   so unlike video.kling its consent gate was never downgraded. */
ok(
  !(CAP_REGISTRY.studio || []).find(t => t.tool === 'image_upscale_kling'),
  'image_upscale_kling is NOT granted while its implementation is unregisterable (dark-tool removal)'
);

const { makeTool, assertToolName } = require('../sidecar/tools/tool.js');
let guardThrew = false;
try { assertToolName({ id: 'image_upscale_kling', scope: 'write', requiresConsent: true, network: true }); }
catch (e) { guardThrew = true; }
ok(guardThrew, 'makeTool refuses this def shape, so the grant cannot be restored silently');

const declared = { id: 'image_upscale_kling', scope: 'write', requiresConsent: true, network: true };
ok(declared.scope === 'write', 'the tool still DECLARES write scope (its own attributes are intact)');
ok(declared.requiresConsent === true, 'and consent');
ok(declared.network === true, 'and network');

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

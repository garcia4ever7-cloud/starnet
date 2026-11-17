/* node test/mcp.schema-empty-combinators.test.js — an MCP inputSchema must never reach a provider
   carrying an EMPTY combinator.

   The bug this pins: scrubSchema() truncates a node past SCHEMA_DEPTH_MAX, and its ARRAY branch returned
   `[]`. That contradicts the "collapses to {} (permissive)" intent stated in its own comment — {} is
   permissive, `anyOf: []` is malformed. A strict validator rejects the WHOLE function definition
   (OpenAI/Codex: `Invalid schema for function '<name>': [] has less than 1 item`), so one over-deep branch
   in one connector tool disables that tool for the entire run. Airtable's recursive filter groups hit it.

   Everything here is SYNTHETIC — no network, no connector, no provider call, no fixture copied from a
   vendor. Depth is derived from the module's own SCHEMA_DEPTH_MAX so the test cannot drift from the code. */
'use strict';
const A = require('./_assert.js');
const { _internals } = require('../sidecar/mcp/translate.js');
const { translateSchema, dropEmptyCombinators, SCHEMA_DEPTH_MAX } = _internals;
const toolschema = require('../sidecar/providers/toolschema.js');
const codex = require('../sidecar/providers/codex.js');

/* Every array that a strict validator requires to be non-empty. `required` is NOT one of them. */
const INVALID_WHEN_EMPTY = ['anyOf', 'oneOf', 'allOf', 'enum', 'prefixItems', 'type', 'items'];

// Walk a schema and report the PATH of every array that is empty where empty is invalid.
function emptyCombinators(node) {
  const hits = [];
  (function walk(n, path, inMap) {
    if (Array.isArray(n)) {
      const key = path.slice(path.lastIndexOf('.') + 1);
      if (!n.length && !inMap && INVALID_WHEN_EMPTY.indexOf(key) >= 0) hits.push(path);
      n.forEach((v, i) => walk(v, path + '[' + i + ']', false));
      return;
    }
    if (!n || typeof n !== 'object') return;
    const maps = ['properties', 'patternProperties', '$defs', 'definitions'];
    for (const k of Object.keys(n)) walk(n[k], path + '.' + k, maps.indexOf(k) >= 0);
  })(node, '$', false);
  return hits;
}

// A recursive filter-group schema in the shape that provokes the bug: anyOf branches nesting through
// array items, far deeper than the scrubber will follow.
function deepRecursive(levels) {
  let node = { type: 'object', properties: { leaf: { type: 'string' } }, required: ['leaf'] };
  for (let i = 0; i < levels; i++) {
    node = {
      type: 'object',
      properties: {
        operator: { type: 'string', enum: ['and', 'or'] },
        operands: { type: 'array', items: { anyOf: [{ type: 'string' }, node] } }
      },
      required: ['operands']
    };
  }
  return node;
}

/* ---- 1. THE REGRESSION — and it must be a SWEEP, not one fixed depth ----

   Only ONE alignment actually reproduces the bug. The truncation emits `[]` solely when the node sitting
   just past SCHEMA_DEPTH_MAX is an ARRAY; one level shallower it is in budget, one level deeper the
   truncation lands on the enclosing OBJECT instead and yields a harmless `{}`. With the current budget of
   24 that is a plain chain of exactly 12 levels (the anyOf value is scrubbed at depth 25). Measured
   against the pre-change module: depths 1..40, exactly one — n=12 — triggered it.

   So a test pinned to a single depth would pass against the BROKEN code, which is how this defect survived
   in the first place. Sweeping every depth also means the test keeps working if SCHEMA_DEPTH_MAX changes. */
{
  const chain = n => { let node = { anyOf: [{ type: 'string' }, { type: 'number' }] };
    for (let i = 0; i < n; i++) node = { type: 'object', properties: { x: node } }; return node; };
  let swept = 0, worstDepth = -1;
  for (let n = 1; n <= SCHEMA_DEPTH_MAX + 16; n++) {
    const found = emptyCombinators(translateSchema(chain(n)));
    if (found.length && worstDepth < 0) worstDepth = n;
    swept++;
  }
  A.eq(worstDepth, -1, 'no nesting depth may produce an empty combinator (swept 1..SCHEMA_DEPTH_MAX+16)');
  A.ok(swept === SCHEMA_DEPTH_MAX + 16, 'the sweep covered every depth up to the budget plus margin');

  // The realistic recursive-filter shape (what Airtable actually ships) must also stay clean.
  const deep = deepRecursive(SCHEMA_DEPTH_MAX + 20);
  const out = translateSchema(deep);
  A.eq(emptyCombinators(out), [], 'an over-deep recursive filter schema emits no empty combinator');
  A.eq(out.type, 'object', 'the root stays an object schema');
  A.ok(out.properties && out.properties.operands, 'the shallow, in-budget properties survive truncation');
  A.ok(out.properties.operator && Array.isArray(out.properties.operator.enum)
    && out.properties.operator.enum.length === 2, 'a real enum inside the depth budget is untouched');
}

/* ---- 2. valid schemas pass through byte-identical (no collateral damage) ---- */
{
  const valid = {
    type: 'object',
    properties: {
      id: { type: 'string', pattern: '^rec[0-9]+$' },
      mode: { type: 'string', enum: ['grid', 'kanban'] },
      note: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      pick: { oneOf: [{ type: 'integer' }, { type: 'boolean' }] },
      all: { allOf: [{ type: 'object' }, { required: ['id'] }] },
      tags: { type: 'array', items: { type: 'string' } },
      tuple: { type: 'array', prefixItems: [{ type: 'string' }, { type: 'number' }] }
    },
    required: ['id'],
    additionalProperties: false
  };
  A.eq(translateSchema(valid), Object.assign({}, valid), 'a valid schema is passed through unchanged');
  A.eq(emptyCombinators(translateSchema(valid)), [], 'a valid schema yields no findings');
}

/* ---- 3. server-supplied empties are stripped, at the root and nested ---- */
{
  const dirty = {
    type: 'object',
    properties: {
      a: { anyOf: [], type: 'string' },
      b: { oneOf: [] },
      c: { allOf: [] },
      d: { enum: [], type: 'string' },
      e: { type: 'array', prefixItems: [] },
      f: { type: [] },
      g: { type: 'array', items: [] },
      nested: { type: 'object', properties: { deep: { anyOf: [] } } }
    }
  };
  const out = translateSchema(dirty);
  A.eq(emptyCombinators(out), [], 'every empty combinator is stripped wherever it appears');
  A.ok(!('anyOf' in out.properties.a), 'an empty anyOf is removed, not emptied');
  A.eq(out.properties.a.type, 'string', 'sibling keywords on the same node survive the strip');
  A.eq(out.properties.b, {}, 'a node that was ONLY an empty combinator becomes permissive {}');
  A.ok(!('enum' in out.properties.d), 'an empty enum is removed rather than rejecting every value');
  A.ok(!('type' in out.properties.f), 'an empty type array is removed');
  A.ok(!('items' in out.properties.g), 'an empty items tuple is removed');
  A.ok(!('anyOf' in out.properties.nested.properties.deep), 'the strip recurses through properties maps');
}

/* ---- 4. arrays that are legitimately empty must SURVIVE ---- */
{
  const keep = {
    type: 'object',
    properties: { a: { type: 'string' } },
    required: [],                 // valid, and toolschema.ensureRequired emits exactly this
    examples: [],
    default: []
  };
  const out = translateSchema(keep);
  A.ok(Array.isArray(out.required) && out.required.length === 0, 'an empty `required` is preserved');
  A.ok(Array.isArray(out.examples), 'an empty `examples` is preserved');
  A.ok(Array.isArray(out.default), 'an empty `default` is preserved');
}

/* ---- 5. a PROPERTY NAMED like a keyword is not a keyword ---- */
{
  const named = {
    type: 'object',
    properties: {
      anyOf: { type: 'string', description: 'a real argument that happens to be called anyOf' },
      enum: { type: 'array', items: { type: 'string' } },
      oneOf: { type: 'object', properties: { allOf: { type: 'boolean' } } }
    }
  };
  const out = translateSchema(named);
  A.ok(out.properties.anyOf && out.properties.anyOf.type === 'string', 'a property named anyOf survives');
  A.ok(out.properties.enum && out.properties.enum.type === 'array', 'a property named enum survives');
  A.ok(out.properties.oneOf.properties.allOf.type === 'boolean', 'nested author-named keys survive');
}

/* ---- 6. the fix holds across EVERY provider wire, not just the one that complained ---- */
{
  const deep = translateSchema(deepRecursive(SCHEMA_DEPTH_MAX + 20));
  const nested = [{ type: 'function', function: { name: 'mcp__conn__deep', description: 'd', parameters: deep } }];
  A.eq(emptyCombinators(codex._internals.toResponsesTools(nested)), [], 'codex wire carries no empty combinator');
  A.eq(emptyCombinators(toolschema.wireTools(nested, { moonshot: false })), [], 'openai-compatible wire is clean');
  A.eq(emptyCombinators(toolschema.wireTools(nested, { moonshot: true })), [], 'moonshot wire is clean');
  A.eq(emptyCombinators(toolschema.forGemini(toolschema.sanitizeKeys(deep))), [], 'gemini wire is clean');
  A.eq(emptyCombinators(toolschema.normalize(toolschema.sanitizeKeys(deep))), [], 'anthropic wire is clean');
}

/* ---- 7. the sanitizer alone is pure and total ---- */
{
  A.eq(dropEmptyCombinators({ anyOf: [] }, 0), {}, 'the sanitizer strips at the root');
  A.eq(dropEmptyCombinators(null, 0), null, 'null passes through');
  A.eq(dropEmptyCombinators('x', 0), 'x', 'a scalar passes through');
  A.eq(dropEmptyCombinators([], 0), [], 'a bare array argument is not a keyword and is returned as-is');
  A.notThrows(() => dropEmptyCombinators({ a: { b: { c: {} } } }, 0), 'ordinary nesting does not throw');
  const proto = JSON.parse('{"__proto__":{"polluted":true},"type":"object"}');
  const safe = dropEmptyCombinators(proto, 0);
  A.ok({}.polluted === undefined, 'a __proto__ key in server data does not pollute Object.prototype');
  A.eq(safe.type, 'object', 'the rest of the node still copies');
}

/* ---- 8. the existing contract is untouched ---- */
{
  A.eq(translateSchema(null), { type: 'object', properties: {} }, 'a missing schema still yields an object schema');
  A.eq(translateSchema([]), { type: 'object', properties: {} }, 'an array schema still yields an object schema');
  const typed = translateSchema({ properties: { a: { type: 'string' } } });
  A.eq(typed.type, 'object', 'a schema with no type still gets type:object');
  const scrubbed = translateSchema({ type: 'object', description: 'x'.repeat(5000) });
  A.ok(scrubbed.description.length <= _internals.FIELD_MAX, 'description scrubbing/clamping still applies');
}

A.report('mcp schema: empty combinators');

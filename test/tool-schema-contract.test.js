/* test/tool-schema-contract.test.js — a tool's declared schema must be real, enforced, and survive the wire.
 *
 * WHY IT EXISTS / THE BUG (2026-11-10).
 * Four builtins — image_print_prep, vector_export, image_stock_fetch, image_quality_check — declared their
 * arguments under `parameters:`. makeTool() reads `def.schema` and drops unknown keys silently, so all four
 * fell back to `{type:'object',properties:{}}`. One misspelling disabled TWO independent layers at once:
 *
 *   1. MODEL-FACING. The empty schema says "this tool takes no arguments". On Gemini it is worse than that:
 *      providers/toolschema.js isEmptyObjectSchema() makes gemini.js omit `parameters` from the function
 *      declaration entirely, because Gemini 400s an empty OBJECT schema.
 *   2. HOST-SIDE. shared/schema.js is explicit that "a missing/empty schema imposes no constraint", so the
 *      validate() call in registry.dispatch() — which is correctly placed BEFORE run() — passed everything.
 *
 * The damage was not a provider rejection. Nothing on this station ever logged an HTTP 400 about schemas.
 * It was wasted turns: STATION_FIELD_NOTES §3 records four different wrong argument shapes arriving in a
 * row, each costing a turn, until the agent gave up on the tool and shelled out instead.
 *
 * The subtle trap, pinned by section 5: image_quality_check's OLD block was itself wrong. It declared a
 * strict array-of-objects while run() deliberately absorbs five key aliases and six value shapes (the
 * 2026-10-20 hardening). Renaming the key verbatim would have switched validation ON against the strict
 * shape and rejected the tolerated calls at the gate — silently deleting that hardening. Its schema is
 * therefore written to DESCRIBE the contract (anyOf, which Gemini and Anthropic honour) without
 * CONSTRAINING it (anyOf, which shared/schema.js ignores).
 *
 * What must stay true:
 *  - no builtin ever declares `parameters:` again; makeTool refuses it loudly
 *  - every one of the four exposes a non-empty schema naming the arguments run() actually reads
 *  - invalid arguments are rejected BEFORE run() is called, never after
 *  - every argument shape the image-qc hardening supports still passes validation
 *  - the rejection message tells the model what the tool accepts, so it can self-correct
 *  - the schemas survive translation to Anthropic, Gemini and OpenAI-compatible wires
 *
 * Run standalone: node test/tool-schema-contract.test.js */
'use strict';
const A = require('./_assert.js');
const fsp = require('node:fs/promises');
const P = require('node:path');

const { makeTool } = require('../sidecar/tools/tool.js');
const { makeRegistry } = require('../sidecar/tools/registry.js');
const schemaLite = require('../shared/schema.js');
const toolschema = require('../sidecar/providers/toolschema.js');

const DEPS = { fsp, pathMod: P, root: '/tmp/starnet-test-ws', fetchImpl: async () => ({ ok: false }), env: {}, now: () => 0 };

function instantiate(file, factoryName) {
  const mod = require('../sidecar/tools/builtin/' + file + '.js');
  const out = {};
  mod[factoryName](DEPS).register({ register: d => { out[d.name] = d; } });
  return out;
}

(async () => {
  const tools = Object.assign({},
    instantiate('print-prep', 'makePrintPrepTools'),
    instantiate('vector-export', 'makeVectorExportTools'),
    instantiate('stock-image', 'makeStockImageTools'),
    instantiate('image-qc', 'makeImageQcTools'));

  const FOUR = ['image_print_prep', 'vector_export', 'image_stock_fetch', 'image_quality_check'];

  /* ---------- 1. THE FOUR TOOLS DECLARE A REAL SCHEMA ---------- */
  {
    for (const name of FOUR) {
      const t = tools[name];
      A.ok(t, name + ' is registered');
      A.ok(t.schema && t.schema.type === 'object', name + ' declares an object schema');
      const props = Object.keys((t.schema && t.schema.properties) || {});
      A.ok(props.length > 0, name + ' declares at least one property (an empty schema is the bug)');
      A.ok(t.parameters === undefined, name + ' carries no `parameters` key on the normalized tool');
      /* The exact failure mode: an empty object schema. Gemini would drop `parameters` entirely for it. */
      A.ok(!toolschema.isEmptyObjectSchema(t.schema),
        name + ' schema is not empty — otherwise Gemini advertises it as taking no arguments');
    }
  }

  /* ---------- 2. THE SCHEMAS NAME WHAT run() ACTUALLY READS ---------- */
  {
    const pp = tools.image_print_prep.schema;
    A.eq(pp.required, ['image'], 'print_prep requires image');
    A.ok(pp.properties.sizes.items.enum.includes('11x14'), 'print_prep sizes carry the real preset enum');

    const ve = tools.vector_export.schema;
    A.eq(ve.required, ['svg'], 'vector_export requires svg');
    A.eq(ve.properties.formats.items.enum, ['png', 'pdf'], 'vector_export formats enum matches what run() accepts');
    A.eq(ve.properties.sizes.items.enum, ['8x10', '11x14', '16x20'], 'vector_export sizes enum matches run()');

    const sf = tools.image_stock_fetch.schema;
    A.eq(sf.required, ['query'], 'stock_fetch requires query');
    A.ok(sf.properties.source.enum.includes('auto'), 'stock_fetch source enum includes auto');
    /* run() does `|| 'auto'`. The old block documented "commons" as the default — a contradiction that
       renaming the key verbatim would have shipped to the model as truth. */
    A.ok(/DEFAULT/.test(sf.properties.source.description) && /auto/.test(sf.properties.source.description),
      'stock_fetch documents auto as the default, matching run()');

    const qc = tools.image_quality_check.schema;
    A.ok(qc.required === undefined, 'image_quality_check declares NO top-level required — five alias keys satisfy it');
    for (const alias of ['images', 'image', 'files', 'file', 'paths', 'path']) {
      A.ok(qc.properties[alias], 'image_quality_check declares the ' + alias + ' key the hardening accepts');
    }
  }

  /* ---------- 3. makeTool REFUSES THE MISSPELLING ---------- */
  {
    A.throws(() => makeTool({ name: 'bad', parameters: { type: 'object' } }),
      'makeTool throws when arguments are declared as `parameters`');
    let msg = '';
    try { makeTool({ name: 'bad', parameters: {} }); } catch (e) { msg = e.message; }
    A.ok(/schema/.test(msg) && /parameters/.test(msg), 'the error names both spellings so it is self-diagnosing');
    A.ok(/bad/.test(msg), 'the error names the offending tool');
    /* Both present is still a mistake: the def is ambiguous and `parameters` would be dead weight. */
    A.throws(() => makeTool({ name: 'bad2', parameters: {}, schema: { type: 'object' } }),
      'declaring both is refused rather than silently preferring one');
    const good = makeTool({ name: 'ok', schema: { type: 'object', properties: { a: { type: 'string' } } } });
    A.eq(good.schema.properties.a.type, 'string', 'a correctly-declared schema survives untouched');
    A.eq(makeTool({ name: 'noargs' }).schema, { type: 'object', properties: {} },
      'a genuinely argument-free tool still defaults to an empty schema');
  }

  /* ---------- 4. INVALID ARGUMENTS NEVER REACH run() ---------- */
  {
    const reg = makeRegistry();
    let ran = 0;
    reg.register({
      name: 'probe', capability: 'studio', scope: 'write',
      schema: tools.image_print_prep.schema,
      run: async () => { ran++; return 'ok'; },
    });
    const ctx = { agentId: 'agent', canUse: () => ({ ok: true }) };
    const call = args => reg.dispatch({ name: 'probe', args }, ctx);

    const ok = await call({ image: 'a.png' });
    A.ok(!ok.isError, 'a valid call is accepted');
    A.eq(ran, 1, 'and reaches run()');

    for (const [label, args, needle] of [
      ['missing required', {}, '$.image: required'],
      ['wrong type', { image: 123 }, 'expected string, got number'],
      ['bad enum value', { image: 'a.png', sizes: ['9x12'] }, 'not in enum'],
      ['wrong container type', { image: 'a.png', sizes: '8x10' }, 'expected array, got string'],
    ]) {
      const res = await call(args);
      A.ok(res.isError, label + ' is rejected');
      A.ok(String(res.content).includes(needle), label + ' reports the real reason (' + needle + ')');
    }
    A.eq(ran, 1, 'NOT ONE invalid call reached run() — validation precedes execution');

    /* Backward compatibility: no tool here rejects unknown keys, and adding additionalProperties:false
       would break live callers. An extra key must still be accepted. */
    const extra = await call({ image: 'a.png', somethingNew: 1 });
    A.ok(!extra.isError, 'an unknown key is still tolerated — no tool declares additionalProperties:false');
    A.eq(ran, 2, 'and it does reach run()');
  }

  /* ---------- 5. THE image-qc HARDENING SURVIVES VALIDATION ---------- */
  {
    const qc = tools.image_quality_check.schema;
    const shapes = [
      ['declared array of objects', { images: [{ path: 'a.png' }] }],
      ['bare path string', { images: 'a.png' }],
      ['JSON-encoded array string', { images: '[{"path":"a.png"}]' }],
      ['single {path} object', { images: { path: 'a.png' } }],
      ['{item:…} wrapper', { images: { item: { path: 'a.png' } } }],
      ['numeric-keyed pseudo-array', { images: { 0: { path: 'a.png' } } }],
      ['mixed string/object array', { images: ['a.png', { path: 'b.png' }] }],
      ['singular alias', { image: 'a.png' }],
      ['file alias', { file: 'a.png' }],
      ['files alias', { files: ['a.png'] }],
      ['paths alias', { paths: ['a.png'] }],
      ['args ARE the entry', { path: 'a.png' }],
      ['entry with claimed dims', { images: [{ path: 'a.png', claimedWidth: 4800, claimedHeight: 6000 }] }],
    ];
    for (const [label, args] of shapes) {
      const v = schemaLite.validate(qc, args);
      A.ok(v.ok, 'image-qc accepts: ' + label + (v.ok ? '' : ' -> ' + v.errors.join('; ')));
    }
    /* The one thing it SHOULD still catch: a non-string in the single-entry `path` slot. */
    A.ok(!schemaLite.validate(qc, { path: 42 }).ok, 'image-qc rejects a non-string bare path');
  }

  /* ---------- 6. ACTIONABLE ERRORS ---------- */
  {
    const reg = makeRegistry();
    reg.register({ name: 'probe2', capability: 'studio', scope: 'write', schema: tools.vector_export.schema, run: async () => 'ok' });
    const res = await reg.dispatch({ name: 'probe2', args: {} }, { agentId: 'agent', canUse: () => ({ ok: true }) });
    const text = String(res.content);
    A.ok(res.isError, 'a missing required argument is an error');
    A.ok(text.includes('This tool accepts'), 'the error states what the tool accepts');
    A.ok(text.includes('svg: string (required)'), 'it marks the required argument');
    A.ok(text.includes('"png"|"pdf"'), 'it lists enum values so the model can pick a legal one');
    A.ok(text.length < 900, 'the hint stays bounded (' + text.length + ' chars)');
  }

  /* ---------- 7. THE SCHEMAS SURVIVE EVERY PROVIDER WIRE ---------- */
  {
    for (const name of FOUR) {
      const s = tools[name].schema;

      // Anthropic: normalize(sanitizeKeys(...)) — anthropic.js:378
      const anth = toolschema.normalize(toolschema.sanitizeKeys(s));
      A.ok(anth && anth.type === 'object' && Object.keys(anth.properties || {}).length > 0,
        name + ' survives the Anthropic input_schema conversion with its properties intact');

      // Gemini: forGemini(sanitizeKeys(...)), then omitted if empty — gemini.js:176
      const gem = toolschema.forGemini(toolschema.sanitizeKeys(s));
      A.ok(!toolschema.isEmptyObjectSchema(gem), name + ' keeps its Gemini `parameters` (not dropped as empty)');
      for (const k of Object.keys(gem)) {
        A.ok(toolschema._internals.GEMINI_FIELDS.includes(k), name + ': Gemini root keeps only documented fields (saw ' + k + ')');
      }

      // OpenAI-compatible: wireTools passes through, only key-grammar repair — openai-compatible.js:427
      const wire = toolschema.wireTools([{ type: 'function', function: { name, description: '', parameters: s } }], {});
      A.eq(wire[0].function.parameters, s, name + ' is passed through the OpenAI wire unchanged');
    }

    /* The pre-existing Gemini defence must keep working for genuinely argument-free tools. */
    A.ok(toolschema.isEmptyObjectSchema({ type: 'object', properties: {} }),
      'an empty object schema is still recognised, so a no-arg tool omits `parameters` on Gemini');
  }

  /* ---------- 8. NO BUILTIN REGRESSES TO `parameters:` ---------- */
  {
    const fs = require('node:fs');
    const dir = P.join(__dirname, '..', 'sidecar', 'tools', 'builtin');
    const offenders = [];
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.js') || f.includes('.bak')) continue;
      const src = fs.readFileSync(P.join(dir, f), 'utf8');
      /* A tool-def key sits at 4-8 spaces of indent; a `parameters` PROPERTY inside a schema's
         `properties` block is legitimate (cua-computer.js declares one), so match the def level only
         and require that the file does not also declare `schema:` on the same object. */
      const m = src.match(/\n {4,8}parameters\s*:\s*\{\s*\n\s*type:\s*'object'[\s\S]{0,80}?properties\s*:/);
      if (m && !/\n {4,8}schema\s*:\s*\{/.test(src)) offenders.push(f);
    }
    A.eq(offenders, [], 'no builtin declares its arguments as `parameters` (makeTool would now throw)');
  }

  /* ---------- 9. NO SCHEMA MISMATCH AGAINST THE SHAPES THE REAL TESTS USE ----------
     The four tools' own suites call run() DIRECTLY, bypassing dispatch and therefore validation.
     That means a schema which is too strict would leave those suites green while breaking every
     real model call — the exact mismatch this section exists to rule out. Every shape below is
     lifted verbatim from print-prep/vector-export/stock-image/image-qc .test.js.

     Note deliberately that a jail-escaping path VALIDATES: the schema's job is SHAPE, the path
     jail's job is SAFETY, and the jail's error ("path escapes workspace") is the useful one. A
     schema that tried to police paths would produce worse diagnostics and duplicate a control
     that is already proven. */
  {
    const cases = [
      ['image_print_prep', { image: 'outbox/whatever.png' }, true],
      ['image_print_prep', { image: 'o/s.png', sizes: ['8x10', '16x20'] }, true],
      ['image_print_prep', { image: '../../etc/passwd' }, true],   // jail rejects, not the schema
      ['image_print_prep', { image: '' }, true],                   // run() rejects empty, not the schema
      ['vector_export', { svg: 'art/mark.svg', sizes: ['8x10'], formats: ['png', 'pdf'] }, true],
      ['vector_export', { svg: 'art/nope.svg' }, true],
      ['vector_export', { svg: 'art/mark.svg', sizes: ['A4'] }, false],  // enum now catches it at the gate
      ['image_stock_fetch', { query: 'watercolor texture', count: 3, destDir: 'stock' }, true],
      ['image_stock_fetch', { query: 'watercolor texture', destDir: '../../../etc' }, true],
      ['image_quality_check', { image: 'outbox/source.png', sizes: ['8x10'] }, true],
      ['image_quality_check', { images: [{ path: 'o/s.png', targetInchesWidth: 8, targetInchesHeight: 10 }] }, true],
      ['image_quality_check', { images: [{ path: 'o/m.png', claimedWidth: 4800, claimedHeight: 6000 }] }, true],
    ];
    for (const [name, args, shouldPass] of cases) {
      const v = schemaLite.validate(tools[name].schema, args);
      A.eq(v.ok, shouldPass, name + ' ' + (shouldPass ? 'accepts' : 'rejects') + ' ' + JSON.stringify(args).slice(0, 56)
        + (v.ok ? '' : ' [' + v.errors.join('; ') + ']'));
    }
  }

  A.report('tool-schema-contract');
})().catch(e => { console.error(e); process.exit(1); });

/* registry-producedfiles.test.js — dispatch must FORWARD a tool's `producedFiles` to the caller.

   THE BUG (2026-11-03). registry.dispatch rebuilds every successful result through okResult(), which takes an
   explicit field list (content, summary, control, parked, images, lengths, mutationReceipt, hostCap). Any other
   field a tool returned was silently dropped — `taintedBy` is carried across by a deliberate line for exactly
   that reason. `producedFiles` had no such line, so it never survived dispatch.

   WHY IT MATTERED. sidecar/artifacts.js has a generic `result.producedFiles` escape hatch (2026-10-22) so tools
   whose names are not in its allowlist still get their real writes into run.artifacts — vector_export,
   image_print_prep, image_stock_fetch, mockup_compose all return it. sidecar/index.js registers the central
   Outbox from that same artifact list. With the field dropped, a DESIGNER print deliverable existed on disk and
   was invisible to PUBLISHER, whose only sanctioned way to reach another agent's file IS the Outbox. So the
   DESIGNER -> PUBLISHER handoff was broken with no error anywhere.

   This test pins the forwarding AND the bounds, so a future result-shaping change cannot quietly undo it. */
'use strict';
const assert = require('./_assert.js');
const { makeRegistry } = require('../sidecar/tools/registry.js');

let passed = 0;
const ok = (c, m) => { assert.ok(c, m); passed++; };
const eq = (a, b, m) => { assert.eq(a, b, m); passed++; };

function reg(tool) {
  const r = makeRegistry();
  r.register(Object.assign({ capability: 'studio', scope: 'write', schema: { type: 'object', properties: {} } }, tool));
  return r;
}
const ctx = { agentId: 'webdesigner', toolNames: ['t'] };
const call = (name, args) => ({ id: 'c1', name, args: args || {} });

(async () => {
  /* 1. THE REGRESSION: producedFiles survives dispatch. */
  {
    const r = reg({ name: 't', async run() { return { content: 'exported', summary: 's', producedFiles: [{ path: 'outbox/p/a-8x10-300ppi.png', bytes: 38459 }] }; } });
    const out = await r.dispatch(call('t'), ctx);
    eq(out.isError, false, 'tool succeeded');
    ok(Array.isArray(out.producedFiles), 'producedFiles is forwarded (THE BUG: was dropped by okResult)');
    eq(out.producedFiles.length, 1, 'one produced file');
    eq(out.producedFiles[0].path, 'outbox/p/a-8x10-300ppi.png', 'path preserved verbatim');
    eq(out.producedFiles[0].bytes, 38459, 'byte count preserved');
  }

  /* 2. The forwarded value is what sidecar/artifacts.js actually consumes. Proving the two halves agree is the
        point — each was individually correct while the pair was broken. */
  {
    const { makeArtifactCollector } = require('../sidecar/artifacts.js');
    const r = reg({ name: 't', async run() { return { content: 'x', producedFiles: [{ path: 'outbox/p/a.pdf', bytes: 24224 }, { path: 'outbox/p/b-300ppi.png', bytes: 1 }] }; } });
    const out = await r.dispatch(call('t'), ctx);
    const c = makeArtifactCollector();
    c.observe({ toolName: 't', args: {}, result: out });
    const list = c.list();
    eq(list.length, 2, 'collector records both produced files end-to-end');
    eq(list.filter(a => a.kind === 'image').length, 1, 'png classified as image');
    eq(list.filter(a => a.kind === 'file').length, 1, 'pdf classified as file');
  }

  /* 3. BOUNDS — host-shaped, never trusted verbatim. */
  {
    const many = []; for (let i = 0; i < 80; i++) many.push({ path: 'o/f' + i + '.png', bytes: i });
    const r = reg({ name: 't', async run() { return { content: 'x', producedFiles: many }; } });
    const out = await r.dispatch(call('t'), ctx);
    eq(out.producedFiles.length, 50, 'capped at 50 entries');
  }
  {
    const r = reg({ name: 't', async run() { return { content: 'x', producedFiles: [{ path: 'a'.repeat(900) + '.png' }] }; } });
    const out = await r.dispatch(call('t'), ctx);
    eq(out.producedFiles[0].path.length, 400, 'path clipped to 400 chars');
    eq('bytes' in out.producedFiles[0], false, 'absent byte count stays absent rather than becoming 0');
  }
  {
    const r = reg({ name: 't', async run() { return { content: 'x', producedFiles: [{ bytes: 5 }, { path: '' }, { path: 'ok.png', bytes: -3 }, { path: 'n.png', bytes: 'x' }] }; } });
    const out = await r.dispatch(call('t'), ctx);
    eq(out.producedFiles.length, 2, 'pathless and empty-path entries dropped');
    eq('bytes' in out.producedFiles[0], false, 'negative byte count rejected, not stored');
    eq('bytes' in out.producedFiles[1], false, 'non-numeric byte count rejected');
  }

  /* 4. Absent / wrong-typed / empty -> the key is not invented. A caller must be able to tell "this tool
        reported no writes" from "this tool reported an empty list". */
  for (const [label, val] of [['absent', undefined], ['not an array', { path: 'x' }], ['empty array', []], ['null', null]]) {
    const r = reg({ name: 't', async run() { return val === undefined ? { content: 'x' } : { content: 'x', producedFiles: val }; } });
    const out = await r.dispatch(call('t'), ctx);
    eq('producedFiles' in out, false, 'no producedFiles key when ' + label);
  }

  /* 5. An UNSHAPED return (a bare string, not {content}) must not grow the field either. */
  {
    const r = reg({ name: 't', async run() { return 'plain string'; } });
    const out = await r.dispatch(call('t'), ctx);
    eq('producedFiles' in out, false, 'unshaped return carries no producedFiles');
  }

  /* 6. A REFUSED call reports nothing — a denied tool produced no files, and artifacts.js also ignores
        isError results. Both layers must agree or a blocked write could look like a deliverable. */
  {
    const r = reg({ name: 't', async run() { throw new Error('boom'); } });
    const out = await r.dispatch(call('t'), ctx);
    eq(out.isError, true, 'throw becomes an error result');
    eq('producedFiles' in out, false, 'a failed tool reports no produced files');
  }
  {
    const r = reg({ name: 'nope', async run() { return { content: 'x', producedFiles: [{ path: 'a.png' }] }; } });
    const out = await r.dispatch(call('unknown-tool-name'), ctx);
    eq(out.isError, true, 'unknown tool is an error');
    eq('producedFiles' in out, false, 'unknown tool reports no produced files');
  }

  /* 7. taintedBy — the sibling field whose explicit forwarding this fix mirrors — still works. The two must
        not be able to displace each other. */
  {
    const r = reg({ name: 't', async run() { return { content: 'x', taintedBy: 'web page', producedFiles: [{ path: 'a.png', bytes: 2 }] }; } });
    const out = await r.dispatch(call('t'), ctx);
    eq(out.taintedBy, 'web page', 'taintedBy still forwarded alongside');
    eq(out.producedFiles.length, 1, 'producedFiles forwarded alongside taintedBy');
  }

  assert.report('registry producedFiles forwarding');
})().catch(e => { console.error(e); process.exit(1); });

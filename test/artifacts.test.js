/* node test/artifacts.test.js — the per-run ARTIFACTS collector (work-visibility slice 1).
   Pure, headless: feeds the collector observations shaped EXACTLY like the real tool results
   (sidecar/tools/builtin/fs.js + image.js) and proves detection, failure/unknown-tool ignoring,
   dedupe (last bytes win), MCP channel-send matching (target = server label only), and the caps. */
'use strict';
const A = require('./_assert.js');
const { makeArtifactCollector, _internals } = require('../sidecar/artifacts.js');

// the REAL result shapes, copied from the tools' own return statements
const wrote = (path, bytes) => ({ ok: true, isError: false, content: 'Wrote ' + path + ' (' + bytes + ' bytes).', summary: 'wrote ' + path + ' (0.1 KB)' });
const appended = (path, added, total) => ({ ok: true, isError: false, content: 'Appended to ' + path + ' (+' + added + ' bytes, now ' + total + ').', summary: 'appended ' + path });
const edited = (path) => ({ ok: true, isError: false, content: 'Edited ' + path + ' (1 replacement).', summary: 'edited ' + path + ' (1x)' });
const patched = (n) => ({ ok: true, isError: false, content: 'Applied patch: ' + n + ' files changed.', summary: 'patched ' + n + ' files' });
const imaged = (rel) => ({ ok: true, isError: false, content: 'Generated and saved ' + rel + ' (12 KB, image/png, model m).\nView: /api/file?x', summary: 'image → ' + rel });
const okr = { ok: true, isError: false, content: 'ok', summary: 'ok' };

// ---- A. fs.write -> { kind:'file', path, bytes } (bytes = the UTF-8 length of what was written) ----
{
  const c = makeArtifactCollector();
  c.observe({ toolName: 'fs.write', args: { path: 'report.md', content: 'hello' }, result: wrote('report.md', 5) });
  A.eq(c.list(), [{ kind: 'file', path: 'report.md', bytes: 5 }], 'fs.write recorded with byte count');
  A.eq(_internals.utf8Len('héllo — ✓'), Buffer.byteLength('héllo — ✓', 'utf8'), 'utf8Len matches Buffer.byteLength on multibyte text');
}

// ---- B. failed / denied calls and unknown tools produce NOTHING ----
{
  const c = makeArtifactCollector();
  c.observe({ toolName: 'fs.write', args: { path: 'x.txt', content: 'x' }, result: { ok: false, isError: true, content: 'consent denied for fs.write' } });
  c.observe({ toolName: 'web_search', args: { query: 'q' }, result: okr });
  c.observe({ toolName: 'fs.read', args: { path: 'x.txt' }, result: okr });
  c.observe({ toolName: 'shell.exec', args: { command: 'ls' }, result: okr });
  c.observe({ toolName: 'fs.write', args: { path: 'y.txt', content: 'y' }, result: undefined });
  A.eq(c.count(), 0, 'failed writes, reads, unknown tools and missing results are all ignored');
}

// ---- C. dedupe: repeated writes to the same path keep the LAST bytes; order is insertion order ----
{
  const c = makeArtifactCollector();
  c.observe({ toolName: 'fs.write', args: { path: 'a.txt', content: '12345' }, result: wrote('a.txt', 5) });
  c.observe({ toolName: 'fs.write', args: { path: 'b.txt', content: '1' }, result: wrote('b.txt', 1) });
  c.observe({ toolName: 'fs.write', args: { path: 'a.txt', content: '123456789' }, result: wrote('a.txt', 9) });
  A.eq(c.list(), [{ kind: 'file', path: 'a.txt', bytes: 9 }, { kind: 'file', path: 'b.txt', bytes: 1 }], 'same-path rewrite folds into one record, last bytes win');
}

// ---- D. fs.append parses the file's REAL total from the result; fs.edit records the path (no bytes) ----
{
  const c = makeArtifactCollector();
  c.observe({ toolName: 'fs.append', args: { path: 'log.txt', content: 'zz' }, result: appended('log.txt', 2, 42) });
  c.observe({ toolName: 'fs.edit', args: { path: 'src.js', find: 'a', replace: 'b' }, result: edited('src.js') });
  A.eq(c.list(), [{ kind: 'file', path: 'log.txt', bytes: 42 }, { kind: 'file', path: 'src.js' }], 'append total parsed; edit path-only');
}

// ---- E. fs.patch: written paths come from the V4A envelope (the result names no paths) ----
{
  const patch = [
    '*** Begin Patch',
    '*** Add File: docs/new.md',
    '+hello',
    '*** Update File: src/app.js',
    '@@ hunk',
    '-old',
    '+new',
    '*** Delete File: junk.tmp',
    '*** Update File: src/moved.js',
    '*** Move to: src/renamed.js',
    '@@',
    '-x',
    '+y',
    '*** Move File: a.txt -> b/c.txt',
    '*** End Patch'
  ].join('\n');
  A.eq(_internals.patchWrites(patch), ['docs/new.md', 'src/app.js', 'src/renamed.js', 'b/c.txt'], 'patch writes: add + update + move-dest, delete excluded');
  const c = makeArtifactCollector();
  c.observe({ toolName: 'fs.patch', args: { patch }, result: patched(4) });
  A.eq(c.list().map(a => a.path), ['docs/new.md', 'src/app.js', 'src/renamed.js', 'b/c.txt'], 'fs.patch records one file record per written path');
  A.ok(c.list().every(a => a.kind === 'file'), 'patched files are kind:file');
}

// ---- F. image_generate: the SAVED path is parsed from the tool's own summary/content ----
{
  const c = makeArtifactCollector();
  c.observe({ toolName: 'image_generate', args: { prompt: 'a cat' }, result: imaged('images/gen-ab12cd34ef56.png') });
  A.eq(c.list(), [{ kind: 'image', path: 'images/gen-ab12cd34ef56.png' }], 'generated image recorded from the summary path');
  A.eq(_internals.imagePathFrom({ content: 'Generated and saved images/x y.png (3 KB, image/png, model m).' }), 'images/x y.png', 'content-sentence fallback tolerates spaces');
}

// ---- F2. result.producedFiles: the generic escape hatch for tool names the branches above don't match ----
// (mockup_compose, image_print_prep, vector_export, image_stock_fetch — shapes copied from their own
// return statements, 2026-10-22. Before this branch existed, their real output was invisible to run.artifacts.)
{
  A.eq(_internals.producedFileKind('a/b-hero-mockup.jpg'), 'image', 'jpg classified as image');
  A.eq(_internals.producedFileKind('outbox/room-2.json'), 'file', 'json classified as file');

  // mockup_compose: result.producedFiles from its own `results` array (path/bytes already real)
  const c1 = makeArtifactCollector();
  c1.observe({
    toolName: 'mockup_compose', args: { print_file: 'outbox/isaiah-40-31-4k-kit/isaiah-40-31-ratio-4x5-4800x6000.jpg', product_name: 'Isaiah 40:31' },
    result: {
      ok: true, isError: false, content: 'mockup_compose from ... :\nhero-mockup -> ... (2000x2000, 480 KB)',
      summary: 'mockup_compose -> 5 listing photo(s) for Isaiah 40:31',
      producedFiles: [
        { path: 'outbox/isaiah-40-31-4k-kit/listing-photos/isaiah-40-31-ratio-4x5-4800x6000-hero-mockup.jpg', bytes: 491520 },
        { path: 'outbox/isaiah-40-31-4k-kit/listing-photos/isaiah-40-31-ratio-4x5-4800x6000-print-alone.jpg', bytes: 450000 },
        { path: 'outbox/isaiah-40-31-4k-kit/listing-photos/isaiah-40-31-ratio-4x5-4800x6000-sizes-chart.jpg', bytes: 300000 },
        { path: 'outbox/isaiah-40-31-4k-kit/listing-photos/isaiah-40-31-ratio-4x5-4800x6000-lettering-closeup.jpg', bytes: 200000 },
        { path: 'outbox/isaiah-40-31-4k-kit/listing-photos/isaiah-40-31-ratio-4x5-4800x6000-what-you-get.jpg', bytes: 250000 }
      ]
    }
  });
  A.eq(c1.count(), 5, 'all 5 mockup_compose listing photos recorded despite the tool name matching no branch');
  A.ok(c1.list().every(a => a.kind === 'image'), 'mockup_compose jpgs classified as image');

  // image_print_prep: result.producedFiles from its own `results` array
  const c2 = makeArtifactCollector();
  c2.observe({
    toolName: 'image_print_prep', args: { image: 'be-still.png' },
    result: {
      ok: true, isError: false, content: 'Print-prep from be-still.png ...', summary: 'print-prep -> 3 size(s): 8x10, 11x14, 16x20',
      producedFiles: [
        { path: 'be-still-8x10-300ppi.png', bytes: 1200000 },
        { path: 'be-still-11x14-300ppi.png', bytes: 1800000 },
        { path: 'be-still-16x20-300ppi.png', bytes: 2400000 }
      ]
    }
  });
  A.eq(c2.list().map(a => a.path), ['be-still-8x10-300ppi.png', 'be-still-11x14-300ppi.png', 'be-still-16x20-300ppi.png'], 'image_print_prep files recorded');

  // vector_export: result.producedFiles mixes png (image) and pdf (file)
  const c3 = makeArtifactCollector();
  c3.observe({
    toolName: 'vector_export', args: { path: 'logo.svg' },
    result: {
      ok: true, isError: false, content: 'Exported logo.svg to 2 files ...', summary: 'vector_export → 2 files',
      producedFiles: [{ path: 'logo-a4-300ppi.png', bytes: 900000 }, { path: 'logo-a4.pdf', bytes: 150000 }]
    }
  });
  A.eq(c3.list(), [{ kind: 'image', path: 'logo-a4-300ppi.png', bytes: 900000 }, { kind: 'file', path: 'logo-a4.pdf', bytes: 150000 }], 'vector_export png is image, pdf is file');

  // image_stock_fetch: result.producedFiles includes the image PLUS its .license.json provenance doc
  const c4 = makeArtifactCollector();
  c4.observe({
    toolName: 'image_stock_fetch', args: { query: 'watercolor paper texture' },
    result: {
      ok: true, isError: false, content: 'Saved 1 of 1 requested ...', summary: 'image_stock_fetch → 1 saved, 0 refused on licence',
      producedFiles: [{ path: 'stock/texture-1.jpg', bytes: 300000 }, { path: 'stock/texture-1.jpg.license.json' }]
    }
  });
  A.eq(c4.list(), [{ kind: 'image', path: 'stock/texture-1.jpg', bytes: 300000 }, { kind: 'file', path: 'stock/texture-1.jpg.license.json' }], 'stock image + its license record both recorded');

  // producedFiles wins over a name-matched branch if a result somehow carried both (defensive, not expected live)
  const c5 = makeArtifactCollector();
  c5.observe({ toolName: 'fs.write', args: { path: 'ignored.txt', content: 'x' }, result: Object.assign(wrote('ignored.txt', 1), { producedFiles: [{ path: 'real.txt', bytes: 2 }] }) });
  A.eq(c5.list(), [{ kind: 'file', path: 'real.txt', bytes: 2 }], 'producedFiles is checked first and takes priority');

  // a failed call with producedFiles still records nothing (the isError gate runs before this branch)
  const c6 = makeArtifactCollector();
  c6.observe({ toolName: 'mockup_compose', args: {}, result: { ok: false, isError: true, content: 'consent denied', producedFiles: [{ path: 'should-not-appear.jpg', bytes: 1 }] } });
  A.eq(c6.count(), 0, 'a failed/denied call never records producedFiles either');
}

// ---- G. MCP channel sends -> { kind:'message', target:<server label only> } — never args/content ----
{
  A.eq(_internals.mcpMessageTarget('mcp__telegram__send_message'), 'telegram', 'send_message matches');
  A.eq(_internals.mcpMessageTarget('mcp__slack__postMessage'), 'slack', 'camelCase postMessage matches');
  A.eq(_internals.mcpMessageTarget('mcp__discord__send'), 'discord', 'bare send matches');
  A.eq(_internals.mcpMessageTarget('mcp__gmail__send_email'), 'gmail', 'send_email matches');
  A.eq(_internals.mcpMessageTarget('mcp__postgres__query'), '', 'a query tool is not a send');
  A.eq(_internals.mcpMessageTarget('mcp__github__create_issue'), '', 'create_issue is not a send');
  A.eq(_internals.mcpMessageTarget('fs.write'), '', 'non-mcp names never match');
  const c = makeArtifactCollector();
  c.observe({ toolName: 'mcp__telegram__send_message', args: { chat_id: 12345, text: 'SECRET CONTENT' }, result: okr });
  c.observe({ toolName: 'mcp__telegram__send_message', args: { chat_id: 999, text: 'again' }, result: okr });
  A.eq(c.list(), [{ kind: 'message', target: 'telegram' }], 'one message record per channel; no chat id, no content');
  A.ok(JSON.stringify(c.list()).indexOf('SECRET') < 0 && JSON.stringify(c.list()).indexOf('12345') < 0, 'nothing from args enters the ledger');
}

// ---- H. host-side add() rides the same sanitize/dedupe path ----
{
  const c = makeArtifactCollector();
  c.add({ kind: 'message', target: 'telegram' });
  c.add({ kind: 'message', target: 'telegram' });
  c.add({ kind: 'file', path: 'out.txt', bytes: 7 });
  c.add({ kind: 'bogus', path: 'x' });
  c.add(null);
  A.eq(c.list(), [{ kind: 'message', target: 'telegram' }, { kind: 'file', path: 'out.txt', bytes: 7 }], 'add() sanitizes kind, dedupes, ignores garbage');
}

// ---- I. caps: max entries bound the ledger; long paths are cut ----
{
  const c = makeArtifactCollector({ maxEntries: 3 });
  for (let i = 0; i < 10; i++) c.observe({ toolName: 'fs.write', args: { path: 'f' + i + '.txt', content: 'x' }, result: wrote('f' + i + '.txt', 1) });
  A.eq(c.count(), 3, 'entry cap enforced (overflow dropped, no throw)');
  c.observe({ toolName: 'fs.write', args: { path: 'f1.txt', content: 'xxxx' }, result: wrote('f1.txt', 4) });
  A.eq(c.list()[1], { kind: 'file', path: 'f1.txt', bytes: 4 }, 'a full ledger still folds a rewrite into its existing record');
  const c2 = makeArtifactCollector();
  c2.observe({ toolName: 'fs.write', args: { path: 'p/'.repeat(300) + 'x.txt', content: 'x' }, result: okr });
  A.ok(c2.list()[0].path.length <= _internals.STR_MAX, 'path capped at ' + _internals.STR_MAX + ' chars');
  A.eq(_internals.MAX_ENTRIES, 50, 'default cap is 50 records');
}

// ---- J. list() returns clones — a caller cannot mutate the ledger ----
{
  const c = makeArtifactCollector();
  c.observe({ toolName: 'fs.write', args: { path: 'a.txt', content: 'x' }, result: wrote('a.txt', 1) });
  c.list()[0].path = 'HACKED';
  A.eq(c.list()[0].path, 'a.txt', 'list() clones records');
}

A.report('artifacts.test');

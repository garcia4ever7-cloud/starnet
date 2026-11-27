/* node test/stock-image.test.js — the STUDIO sourcing skill: image_stock_fetch. Offline + deterministic.

   The network is stubbed (an injected fetchImpl), so this never touches Wikimedia or the Smithsonian
   and is safe in the merge gate. What it actually proves is the part that matters legally: the licence
   allowlist FAILS CLOSED. This station sells the products these assets end up in, so a CC BY-SA file
   reaching the workspace is a real commercial problem, not a style issue — and "cc-by-sa-4.0" starts
   with the letters "cc", which is exactly how a loose prefix test would wave it through. */
'use strict';
const A = require('./_assert.js');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { makeStockImageTools, licenseVerdict, buildLicenseRecord, safeName } = require('../sidecar/tools/builtin/stock-image.js');

const ROOT = path.join(os.tmpdir(), 'starnet-stock-image-test-' + process.pid);
const AID = 'webdesigner';
function ctx() { return { agentId: AID }; }

let canvasLib;
try { canvasLib = require('@napi-rs/canvas'); } catch (_) { canvasLib = null; }

// A real, decodable PNG so the download path handles genuine bytes rather than a sentinel string.
async function pngBytes(w, h) {
  if (!canvasLib) return Buffer.from('89504e470d0a1a0a', 'hex');
  const cv = canvasLib.createCanvas(w, h);
  const g = cv.getContext('2d');
  g.fillStyle = '#4477aa'; g.fillRect(0, 0, w, h);
  return await cv.encode('png');
}

// Two Commons hits: one CC0 (must be saved), one CC BY-SA 4.0 (must be refused, by name).
function commonsPayload() {
  return {
    query: {
      pages: [
        {
          title: 'File:Good CC0 Texture.jpg',
          imageinfo: [{
            thumburl: 'https://upload.example/thumb/good.png', url: 'https://upload.example/orig/good.tif',
            thumbwidth: 2400, thumbheight: 3000, width: 4000, height: 5000, mime: 'image/png',
            descriptionurl: 'https://commons.wikimedia.org/wiki/File:Good_CC0_Texture.jpg',
            extmetadata: {
              License: { value: 'cc0' },
              LicenseShortName: { value: 'CC0' },
              LicenseUrl: { value: 'http://creativecommons.org/publicdomain/zero/1.0/' },
              Artist: { value: '<a href="/wiki/User:Someone">Someone</a>' },
              AttributionRequired: { value: 'false' }
            }
          }]
        },
        {
          title: 'File:Trap ShareAlike Texture.jpg',
          imageinfo: [{
            thumburl: 'https://upload.example/thumb/trap.png', url: 'https://upload.example/orig/trap.jpg',
            thumbwidth: 2400, thumbheight: 3000, mime: 'image/png',
            descriptionurl: 'https://commons.wikimedia.org/wiki/File:Trap_ShareAlike_Texture.jpg',
            extmetadata: {
              License: { value: 'cc-by-sa-4.0' },
              LicenseShortName: { value: 'CC BY-SA 4.0' },
              LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0' },
              Artist: { value: 'PsychicKatie' },
              AttributionRequired: { value: 'true' }
            }
          }]
        }
      ]
    }
  };
}

function makeFetch(imageBuf, log) {
  return async function stubFetch(url, opts) {
    log.push(url);
    const ua = ((opts && opts.headers) || {})['User-Agent'] || '';
    if (/commons\.wikimedia\.org/.test(url)) {
      if (!ua) throw new Error('Wikimedia requires a User-Agent and none was sent');
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => commonsPayload() };
    }
    if (/api\.si\.edu/.test(url)) {
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ response: { rows: [] } }) };
    }
    if (/upload\.example/.test(url)) {
      return { ok: true, status: 200, headers: { get: () => 'image/png' }, arrayBuffer: async () => imageBuf.buffer.slice(imageBuf.byteOffset, imageBuf.byteOffset + imageBuf.byteLength) };
    }
    return { ok: false, status: 404, headers: { get: () => '' }, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
  };
}

(async () => {
  try { await fsp.rm(ROOT, { recursive: true, force: true }); } catch (_) {}
  await fsp.mkdir(ROOT, { recursive: true });

  // ---- A. the licence gate, as pure logic ----
  A.ok(licenseVerdict('cc0', 'CC0').allowed, 'CC0 is allowed');
  A.ok(licenseVerdict('pd', 'Public domain').allowed, 'public domain is allowed');
  A.ok(licenseVerdict('', 'PD-old-100').allowed, 'a PD-* short name is allowed even with no machine code');

  // The headline case: share-alike must NOT slip through a "starts with cc" style test.
  {
    const v = licenseVerdict('cc-by-sa-4.0', 'CC BY-SA 4.0');
    A.ok(!v.allowed, 'CC BY-SA 4.0 is REFUSED');
    A.ok(/share-alike/i.test(v.reason), 'the CC BY-SA refusal says why in commercial terms: ' + v.reason);
  }
  A.ok(!licenseVerdict('cc-by-nc-2.0', 'CC BY-NC 2.0').allowed, 'CC BY-NC is refused');
  A.ok(!licenseVerdict('cc-by-nd-4.0', 'CC BY-ND 4.0').allowed, 'CC BY-ND is refused');
  A.ok(!licenseVerdict('cc-by-4.0', 'CC BY 4.0').allowed, 'plain CC BY is refused (attribution would have to travel on the product)');
  A.ok(!licenseVerdict('some-new-thing', 'Some New Thing').allowed, 'an unrecognised licence fails CLOSED, not open');
  {
    const v = licenseVerdict('', '');
    A.ok(!v.allowed, 'a file with no licence metadata at all is refused');
    A.ok(/cannot be proven/.test(v.reason), 'the no-metadata refusal explains itself: ' + v.reason);
  }

  // ---- B. the provenance record ----
  {
    const rec = buildLicenseRecord({ file: 'stock/a.png', source: 'wikimedia-commons', license: 'CC0', retrievedAt: '2026-10-20T00:00:00.000Z' });
    A.eq(rec.file, 'stock/a.png', 'record carries the file path');
    A.eq(rec.license, 'CC0', 'record carries the licence');
    A.eq(rec.retrievedAt, '2026-10-20T00:00:00.000Z', 'retrievedAt is passed in, not read from a clock (keeps the helper pure)');
    A.ok(/commercial use/i.test(rec.usageNote), 'record states the commercial-use position in plain words');
  }
  A.eq(safeName('File:Some Messy  NAME!.jpg'), 'some-messy-name', 'safeName slugs a Commons title');

  // ---- C. end to end, network stubbed ----
  const img = await pngBytes(64, 80);
  const log = [];
  // Clock is injected (test/lint-determinism.js bans an ambient one in the backend), so the
  // provenance timestamp is exactly reproducible rather than "whenever the suite happened to run".
  const FIXED_MS = 1792540800000;   // 2026-10-20T00:00:00.000Z
  const { stockTool, _internals } = makeStockImageTools({
    fsp, pathMod: path, root: ROOT, fetchImpl: makeFetch(img, log), env: {}, now: () => FIXED_MS
  });

  A.eq(stockTool.name, 'image_stock_fetch', 'tool name');
  A.eq(stockTool.capability, 'studio', 'granted by the studio object, like the other image tools');
  A.eq(stockTool.scope, 'write', 'write scope — it publishes files into the workspace');
  A.eq(stockTool.requiresConsent, true, 'consent-gated, same as image_generate');
  A.eq(stockTool.network, true, 'declared as reaching the network');

  {
    const r = await stockTool.run({ query: 'watercolor texture', count: 3, destDir: 'stock' }, ctx());
    A.ok(/Saved 1 of 3/.test(r.content), 'only the single CC0 candidate was saved: ' + r.content.slice(0, 160));
    A.ok(/Trap ShareAlike/.test(r.content) && /share-alike/i.test(r.content), 'the refused BY-SA file is named with its reason, not silently dropped');
    A.ok(!/trap/i.test(await fsp.readdir(path.join(ROOT, AID, 'stock')).then(f => f.join(','))), 'no BY-SA file reached the disk');

    const saved = path.join(ROOT, AID, 'stock', 'good-cc0-texture.png');
    const stat = await fsp.stat(saved);
    A.ok(stat.size > 0, 'the CC0 image was written with real bytes');

    const rec = JSON.parse(await fsp.readFile(saved + '.license.json', 'utf8'));
    A.eq(rec.license, 'CC0', 'the licence record states CC0');
    A.eq(rec.source, 'wikimedia-commons', 'the licence record names the source');
    A.eq(rec.creator, 'Someone', 'the Artist HTML was stripped to plain text');
    A.eq(rec.sourcePage, 'https://commons.wikimedia.org/wiki/File:Good_CC0_Texture.jpg', 'the licence record links the source page');
    A.eq(rec.query, 'watercolor texture', 'the licence record keeps the query that found it');
    A.eq(rec.retrievedAt, new Date(FIXED_MS).toISOString(), 'the licence record is timestamped from the INJECTED clock, not an ambient one');
    A.ok(/do not list/i.test(r.content), 'the output warns these are source assets, not sellable art');
  }

  // ---- D. Smithsonian tier is skipped honestly when no key is in the environment ----
  {
    const r = await stockTool.run({ query: 'anything', count: 5, destDir: 'stock2' }, ctx());
    A.ok(/SMITHSONIAN_API_KEY is not set/.test(r.content), 'a missing key is reported as a skipped tier, never as "no results": ' + r.content.slice(-240));
  }

  // ---- E. jail safety ----
  {
    let threw = false;
    try { await stockTool.run({ query: 'watercolor texture', destDir: '../../../etc' }, ctx()); }
    catch (_) { threw = true; }
    const escaped = await fsp.stat(path.join(os.tmpdir(), 'etc')).then(() => true).catch(() => false);
    A.ok(threw || !escaped, 'a destDir escape attempt does not write outside the agent jail');
  }

  // ---- F. no candidates is reported as such, not as a crash ----
  {
    const empty = makeStockImageTools({
      fsp, pathMod: path, root: ROOT, env: {},
      fetchImpl: async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ query: { pages: [] } }) })
    }).stockTool;
    const r = await empty.run({ query: 'zzzz no such thing' }, ctx());
    A.ok(/No candidates found/.test(r.content), 'an empty search reports cleanly: ' + r.content.slice(0, 120));
  }

  A.ok(typeof _internals.licenseVerdict === 'function', 'the licence gate is exposed for independent testing');

  try { await fsp.rm(ROOT, { recursive: true, force: true }); } catch (_) {}
  console.log('stock-image.test: all checks passed');
  A.report('stock-image.test');
})().catch(e => { console.error(e); process.exitCode = 1; });

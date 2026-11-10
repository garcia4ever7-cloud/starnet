/* sidecar/tools/builtin/stock-image.js — STUDIO capability: image_stock_fetch(query, ...)

   Fetches genuinely reusable source imagery (backgrounds, textures, mockup backdrops) into the
   agent's workspace from CC0 / public-domain collections, and writes a provenance record beside
   every single file it saves.

   WHY CC0-ONLY AND NOT PEXELS/PIXABAY: Pexels' and Pixabay's licences both forbid selling their
   content on a "Standalone" basis — explicitly naming prints, posters and merchandise — unless
   meaningful creative effort has been applied. That is a permanent per-asset judgement call sitting
   inside a product pipeline that sells printables. CC0 and public-domain works carry no such clause,
   so the question never has to be asked. This tool therefore REFUSES anything that is not CC0/PD,
   including CC BY-SA (share-alike would reach into the derived product) and CC BY-NC/ND. A rejected
   candidate is reported with its actual licence, never silently skipped.

   WHY NOT OPENVERSE: it is the obvious aggregator (800M+ openly-licensed works, anonymous access)
   but api.openverse.org is UNREACHABLE from this station — three probes on 2026-10-20 timed out at
   30s/30s/40s while Wikimedia answered in 0.75s on the same connection. Documented so nobody
   "fixes" this by reaching for it again.

   SOURCES, in order:
     1. Wikimedia Commons  — NO API KEY AT ALL. Licence facts come from the file's own extmetadata.
     2. Smithsonian Open Access — needs a free api.data.gov key in SMITHSONIAN_API_KEY; every asset
        it exposes with usage.access === 'CC0' is CC0. Skipped with an honest note if no key is set.

   Keys are read from the sidecar process environment ONLY (the providers/registry.js pattern), never
   from the browser and never from the servicekeys store — servicekeys' resolveForRequest() reads the
   stored KEYS list and never process.env, so an exported shell variable is invisible to it.

   makeStockImageTools({ fsp, pathMod, root, fetchImpl?, env? })
     -> { stockTool, register(reg), _internals }   // _internals: pure licence/record helpers
*/
'use strict';
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./fs.js'));
  else { root.SK = root.SK || {}; root.SK.tools = root.SK.tools || {}; (root.SK.tools.builtin = root.SK.tools.builtin || {}).stockImage = factory(root.SK.tools.builtin.fs); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (fsMod) {
  'use strict';

  const MAX_BYTES = 25 * 1024 * 1024;        // a Commons original can be a 100MB TIFF; we only ever take renders
  const MAX_RESULTS = 5;                      // per call — this is a design aid, not a scraper
  const DEFAULT_WIDTH = 2400;                 // 8in at 300 PPI: enough to composite a print background from
  const FETCH_TIMEOUT_MS = 30000;
  // Wikimedia's API policy requires a descriptive User-Agent; a generic one gets throttled or blocked.
  const USER_AGENT = 'StarNet-Harness/0.12 (station studio stock-image tool; +https://github.com/androoAGI/starnet)';

  const EXT_BY_MIME = {
    'image/png': '.png', 'image/jpeg': '.jpg', 'image/jpg': '.jpg',
    'image/webp': '.webp', 'image/gif': '.gif', 'image/tiff': '.tif'
  };

  /* ---------------- licence gate (pure) ----------------
     The ONLY place that decides whether bytes are allowed to land in the workspace. Deliberately an
     allowlist: an unrecognised licence string fails closed. Commons exposes both a machine-readable
     `License` ("cc0", "pd", "cc-by-sa-4.0") and a human `LicenseShortName` ("CC0", "Public domain");
     either may be missing on an old file description, so both are consulted and the absence of both
     is itself a rejection — an unlicensed-looking file never ships. */
  const ALLOW_MACHINE = /^(cc0|pd|pdm|public[-_ ]?domain)/i;
  const ALLOW_HUMAN = /^(cc0|public domain|pd-|no known copyright)/i;
  // Named explicitly so the rejection message can say WHY, instead of a generic "not allowed".
  const KNOWN_BLOCKED = [
    { re: /share[-_ ]?alike|\bsa\b|by-sa/i, why: 'share-alike — the licence would reach into any product derived from it' },
    { re: /\bnc\b|non[-_ ]?commercial|by-nc/i, why: 'non-commercial — cannot be used in a product that is sold' },
    { re: /\bnd\b|no[-_ ]?deriv|by-nd/i, why: 'no-derivatives — cannot be edited or composited' },
    { re: /^cc[-_ ]?by/i, why: 'CC BY — commercial use is allowed but attribution must travel on the product itself; out of scope for this pipeline' },
    { re: /fair[-_ ]?use|non[-_ ]?free|copyright/i, why: 'not a free licence' }
  ];

  function licenseVerdict(machine, human) {
    const m = String(machine || '').trim();
    const h = String(human || '').trim();
    if (!m && !h) return { allowed: false, license: null, reason: 'no licence metadata on the file — refusing to save an asset whose licence cannot be proven' };
    const label = h || m;
    // Blocked checks run FIRST: "cc-by-sa-4.0" must not be caught by a loose CC0 prefix test.
    for (const b of KNOWN_BLOCKED) {
      if (b.re.test(m) || b.re.test(h)) return { allowed: false, license: label, reason: label + ' — ' + b.why };
    }
    if (ALLOW_MACHINE.test(m) || ALLOW_HUMAN.test(h)) return { allowed: true, license: label, reason: null };
    return { allowed: false, license: label, reason: label + ' — not on the CC0/public-domain allowlist (this tool fails closed on any licence it does not positively recognise)' };
  }

  // Strip the HTML Commons puts in Artist/Credit fields. Keeps the text, drops the markup.
  function plain(v) {
    return String(v == null ? '' : v).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  }

  function extField(ext, name) {
    const row = ext && ext[name];
    return row && typeof row === 'object' ? row.value : row;
  }

  /* The per-asset provenance record. Written beside every file as <file>.license.json so the licence
     travels with the bytes — a workspace folder of images with no provenance is worthless to a
     listing review six weeks later. `retrievedAt` is passed in, never read from a clock here, so the
     function stays pure and testable. */
  function buildLicenseRecord(o) {
    return {
      file: o.file,
      source: o.source,
      sourceId: o.sourceId || null,
      title: o.title || null,
      creator: o.creator || null,
      license: o.license,
      licenseUrl: o.licenseUrl || null,
      attributionRequired: o.attributionRequired === true,
      attributionText: o.attributionText || null,
      sourcePage: o.sourcePage || null,
      fileUrl: o.fileUrl || null,
      pixels: o.pixels || null,
      query: o.query || null,
      retrievedAt: o.retrievedAt,
      usageNote: 'CC0 / public domain: free for commercial use, including sale, with no attribution ' +
        'required. Attribution is still recorded here as a courtesy and an audit trail. Verify the ' +
        'source page before shipping if the work depicts identifiable people, trademarks, or modern art.'
    };
  }

  function safeName(s) {
    return String(s || '').replace(/^File:/i, '').replace(/\.[a-z0-9]+$/i, '')
      .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 60) || 'asset';
  }

  function makeStockImageTools(deps) {
    deps = deps || {};
    const fsp = deps.fsp, P = deps.pathMod, ROOT = deps.root;
    if (!fsp || !P || !ROOT) throw new Error('stock-image.js requires { fsp, pathMod, root }');
    const ENV = deps.env || process.env;
    const doFetch = deps.fetchImpl || globalThis.fetch;
    // Injected clock, per the determinism gate (test/lint-determinism.js): the backend never reads an
    // ambient clock. Defaults to 0 so a caller that forgets to wire one produces an obviously-wrong
    // 1970 timestamp in the provenance record rather than a plausible-looking undetectable one.
    const now = typeof deps.now === 'function' ? deps.now : (() => 0);
    const jail = fsMod.makeFsTools({ fsp, pathMod: P, root: ROOT })._internals;
    let publicationSequence = 0;

    async function getJson(url) {
      const res = await doFetch(url, { headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) throw new Error('HTTP ' + res.status + ' from ' + new URL(url).host);
      return await res.json();
    }

    async function getBytes(url) {
      const res = await doFetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) throw new Error('HTTP ' + res.status + ' downloading the image');
      const mime = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.length) throw new Error('downloaded 0 bytes');
      if (buf.length > MAX_BYTES) throw new Error('image is ' + Math.round(buf.length / 1048576) + 'MB, over the ' + Math.round(MAX_BYTES / 1048576) + 'MB cap');
      if (!/^image\//.test(mime)) throw new Error('server returned ' + (mime || 'an unknown content-type') + ', not an image');
      return { buf, mime };
    }

    /* ---------------- source 1: Wikimedia Commons (no key) ----------------
       generator=search over the File: namespace, pulling imageinfo + extmetadata in the SAME request
       (one round trip for both the candidate list and its licence facts), and iiurlwidth to get a
       rendered JPEG/PNG at a usable width — which also sidesteps Commons' giant TIFF originals. */
    async function searchCommons(query, width) {
      const u = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&formatversion=2' +
        '&generator=search&gsrsearch=' + encodeURIComponent('filetype:bitmap ' + query) +
        '&gsrnamespace=6&gsrlimit=' + MAX_RESULTS * 4 +
        '&prop=imageinfo&iiprop=url%7Csize%7Cmime%7Cextmetadata&iiurlwidth=' + width;
      const j = await getJson(u);
      const pages = (j && j.query && j.query.pages) || [];
      return (Array.isArray(pages) ? pages : Object.values(pages)).map(p => {
        const ii = (p.imageinfo || [])[0];
        if (!ii) return null;
        const ext = ii.extmetadata || {};
        const verdict = licenseVerdict(extField(ext, 'License'), extField(ext, 'LicenseShortName'));
        return {
          source: 'wikimedia-commons',
          sourceId: p.title,
          title: plain(p.title).replace(/^File:/i, ''),
          creator: plain(extField(ext, 'Artist')) || null,
          verdict,
          licenseUrl: extField(ext, 'LicenseUrl') || null,
          attributionRequired: String(extField(ext, 'AttributionRequired') || '') === 'true',
          attributionText: plain(extField(ext, 'Attribution')) || null,
          sourcePage: ii.descriptionurl || null,
          // thumburl is the rendered copy at our requested width; url is the original. MediaWiki does
          // not upscale, so a small source simply yields a smaller thumb — reported, never faked.
          downloadUrl: ii.thumburl || ii.url,
          pixels: ii.thumbwidth ? (ii.thumbwidth + 'x' + ii.thumbheight) : (ii.width ? ii.width + 'x' + ii.height : null)
        };
      }).filter(Boolean);
    }

    /* ---------------- source 2: Smithsonian Open Access (free api.data.gov key) ----------------
       Every media row carrying usage.access === 'CC0' is CC0 by the Smithsonian's own declaration, so
       the licence fact is structural rather than parsed out of free text. No key -> the tier is
       skipped with a note; it is never treated as "no results". */
    async function searchSmithsonian(query, apiKey) {
      const u = 'https://api.si.edu/openaccess/api/v1.0/search?q=' +
        encodeURIComponent(query + ' AND online_media_type:"Images"') +
        '&rows=' + MAX_RESULTS * 4 + '&api_key=' + encodeURIComponent(apiKey);
      const j = await getJson(u);
      const rows = (j && j.response && j.response.rows) || [];
      const out = [];
      for (const row of rows) {
        const dnr = ((row.content || {}).descriptiveNonRepeating) || {};
        const media = ((dnr.online_media || {}).media) || [];
        for (const m of media) {
          if (String(m.type || '') !== 'Images' || !m.content) continue;
          const access = String(((m.usage || {}).access) || '');
          const verdict = access.toUpperCase() === 'CC0'
            ? { allowed: true, license: 'CC0', reason: null }
            : { allowed: false, license: access || 'unstated', reason: (access || 'unstated') + ' — Smithsonian asset is not marked CC0' };
          out.push({
            source: 'smithsonian-open-access',
            sourceId: row.id || null,
            title: plain(row.title) || null,
            creator: plain(row.unitCode) || null,
            verdict,
            licenseUrl: verdict.allowed ? 'https://creativecommons.org/publicdomain/zero/1.0/' : null,
            attributionRequired: false,
            attributionText: null,
            sourcePage: dnr.record_link || m.guid || null,
            downloadUrl: m.content,
            pixels: null
          });
          break;   // one representative image per record, not every scan of the same object
        }
      }
      return out;
    }

    async function saveOne(aid, cand, destDir, query, retrievedAt, ctx) {
      const { buf, mime } = await getBytes(cand.downloadUrl);
      const ext = EXT_BY_MIME[mime] || '.jpg';
      const rel = String(destDir).replace(/\/+$/, '') + '/' + safeName(cand.title || cand.sourceId) + ext;
      const { abs } = await jail.resolveInside(aid, rel);
      await fsp.mkdir(P.dirname(abs), { recursive: true });
      // Stage then rename, same as image.js: an abort mid-write must never leave a half file in place.
      const staging = abs + '.pending-' + process.pid + '-' + (++publicationSequence);
      try {
        await fsp.writeFile(staging, buf, { flag: 'wx' });
        require('node:fs').renameSync(staging, abs);
      } finally {
        // ENOENT is the normal path (the rename already consumed the staging file); anything else is a
        // real cleanup failure and gets tallied rather than silently dropped — same as image.js.
        await fsp.unlink(staging).catch(e => {
          if (!e || e.code !== 'ENOENT') require('../../failopen.js').note('stock-image.staging-cleanup', e);
        });
      }
      const record = buildLicenseRecord({
        file: rel, source: cand.source, sourceId: cand.sourceId, title: cand.title, creator: cand.creator,
        license: cand.verdict.license, licenseUrl: cand.licenseUrl, attributionRequired: cand.attributionRequired,
        attributionText: cand.attributionText, sourcePage: cand.sourcePage, fileUrl: cand.downloadUrl,
        pixels: cand.pixels, query, retrievedAt
      });
      const { abs: recAbs } = await jail.resolveInside(aid, rel + '.license.json');
      await fsp.writeFile(recAbs, JSON.stringify(record, null, 2) + '\n');
      if (ctx && typeof ctx.emit === 'function') {
        const d = { id: 'img_' + rel.replace(/[^A-Za-z0-9_.-]/g, '_'), agentId: aid, kind: 'image', title: rel };
        if (ctx.room) d.room = ctx.room;
        ctx.emit('deliverable', d);
      }
      return { rel, bytes: buf.length, mime, record };
    }

    const stockTool = {
      name: 'image_stock_fetch', capability: 'studio', scope: 'write', requiresConsent: true, network: true, timeoutMs: 120000,
      description: 'Search CC0 / public-domain collections (Wikimedia Commons, and the Smithsonian when a key ' +
        'is configured) and save matching images into the workspace for use as BACKGROUNDS, TEXTURES and ' +
        'MOCKUP BACKDROPS. Every saved file gets a <file>.license.json provenance record beside it. Only CC0 ' +
        'and public-domain works are saved: CC BY-SA, CC BY-NC, CC BY-ND and even plain CC BY are refused, ' +
        'with the reason reported, because this station sells the products these assets go into. This is ' +
        'source material to composite with — not finished art, and never something to list for sale as-is.',
      /* `schema`, NOT `parameters` — see the note in print-prep.js. Fixed 2026-11-10.
         The `source` default was ALSO wrong: it documented "commons" while run() has always defaulted to
         "auto". Renaming the key verbatim would have shipped that contradiction to the model as fact.
         count/width are CLAMPED by run(), not rejected, so they carry no minimum/maximum — declaring
         bounds would make a strict provider reject a value the tool is happy to clamp. */
      schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'what to look for, e.g. "watercolor paper texture" or "botanical illustration fern"' },
          count: { type: 'number', description: 'how many images to save; clamped to 1-' + MAX_RESULTS + ' (default 1)' },
          width: { type: 'number', description: 'target pixel width of the saved render; clamped to 200-6000 (default ' + DEFAULT_WIDTH + '; the source is never upscaled, so a smaller original yields a smaller file and says so)' },
          destDir: { type: 'string', description: 'workspace-relative folder to save into (default "stock")' },
          source: { type: 'string', enum: ['auto', 'commons', 'smithsonian'], description: '"auto" (DEFAULT) tries Commons then Smithsonian; "commons" needs no key; "smithsonian" needs SMITHSONIAN_API_KEY' }
        },
        required: ['query']
      },
      async run(args, ctx) {
        const aid = (ctx && ctx.agentId) || 'agent';
        const query = String((args && args.query) || '').trim();
        if (!query) throw new Error('query is required');
        const want = Math.max(1, Math.min(MAX_RESULTS, Number(args && args.count) || 1));
        const width = Math.max(200, Math.min(6000, Number(args && args.width) || DEFAULT_WIDTH));
        const destDir = String((args && args.destDir) || 'stock').trim() || 'stock';
        const source = String((args && args.source) || 'auto').toLowerCase();
        const retrievedAt = new Date(now()).toISOString();
        const siKey = String(ENV.SMITHSONIAN_API_KEY || '').trim();

        const notes = [];
        let candidates = [];
        if (source === 'commons' || source === 'auto') {
          try { candidates = candidates.concat(await searchCommons(query, width)); }
          catch (e) { notes.push('Wikimedia Commons search failed: ' + ((e && e.message) || e)); }
        }
        if (source === 'smithsonian' || (source === 'auto' && candidates.filter(c => c.verdict.allowed).length < want)) {
          if (!siKey) notes.push('Smithsonian tier skipped: SMITHSONIAN_API_KEY is not set in the sidecar environment (free key at api.data.gov).');
          else {
            try { candidates = candidates.concat(await searchSmithsonian(query, siKey)); }
            catch (e) { notes.push('Smithsonian search failed: ' + ((e && e.message) || e)); }
          }
        }
        if (!candidates.length) {
          return { content: 'No candidates found for "' + query + '".' + (notes.length ? '\n' + notes.join('\n') : ''), summary: 'image_stock_fetch → 0 found' };
        }

        const rejected = candidates.filter(c => !c.verdict.allowed);
        const allowed = candidates.filter(c => c.verdict.allowed);
        const saved = [], failed = [];
        for (const cand of allowed) {
          if (saved.length >= want) break;
          try { saved.push(await saveOne(aid, cand, destDir, query, retrievedAt, ctx)); }
          catch (e) { failed.push((cand.title || cand.sourceId) + ': ' + ((e && e.message) || e)); }
        }

        const lines = [];
        lines.push('Saved ' + saved.length + ' of ' + want + ' requested (' + allowed.length + ' of ' + candidates.length + ' candidates passed the CC0/public-domain gate).');
        for (const s of saved) {
          lines.push('\n' + s.rel + '  (' + (s.bytes / 1024).toFixed(0) + ' KB, ' + s.mime + (s.record.pixels ? ', ' + s.record.pixels : '') + ')' +
            '\n  licence: ' + s.record.license + (s.record.licenseUrl ? ' <' + s.record.licenseUrl + '>' : '') +
            '\n  creator: ' + (s.record.creator || 'not stated') +
            '\n  source:  ' + (s.record.sourcePage || s.record.source) +
            '\n  record:  ' + s.rel + '.license.json' +
            '\n  view:    /api/file?agent=' + encodeURIComponent(aid) + '&path=' + encodeURIComponent(s.rel));
        }
        if (rejected.length) {
          lines.push('\nRefused on licence (' + rejected.length + ') — not saved:');
          for (const r of rejected.slice(0, 8)) lines.push('  - ' + (r.title || r.sourceId) + ': ' + r.verdict.reason);
          if (rejected.length > 8) lines.push('  …and ' + (rejected.length - 8) + ' more');
        }
        if (failed.length) { lines.push('\nDownload failures (' + failed.length + '):'); for (const f of failed) lines.push('  - ' + f); }
        if (notes.length) { lines.push('\nNotes:'); for (const n of notes) lines.push('  - ' + n); }
        if (saved.length) lines.push('\nThese are SOURCE assets to composite with. Do not list any of them for sale unaltered.');

        return {
          content: lines.join('\n'), summary: 'image_stock_fetch → ' + saved.length + ' saved, ' + rejected.length + ' refused on licence',
          // Lets sidecar/artifacts.js's observe() record these into run.artifacts (its tool-name allowlist has no
          // entry for image_stock_fetch) so the Deliverables panel's file list is never empty for real output.
          // The .license.json sidecar is real provenance documentation, not scratch — included too.
          producedFiles: saved.flatMap(s => [{ path: s.rel, bytes: s.bytes }, { path: s.rel + '.license.json' }])
        };
      }
    };

    return {
      stockTool,
      register(reg) { reg.register(stockTool); return reg; },
      _internals: { licenseVerdict, buildLicenseRecord, safeName, plain, extField, searchCommons, searchSmithsonian, MAX_RESULTS, DEFAULT_WIDTH, MAX_BYTES, USER_AGENT }
    };
  }

  return { makeStockImageTools, licenseVerdict, buildLicenseRecord, safeName };
});

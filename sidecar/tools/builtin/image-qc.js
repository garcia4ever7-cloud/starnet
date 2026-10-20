/* sidecar/tools/builtin/image-qc.js — STUDIO capability: image_quality_check(images)

   Independent, local, zero-cost verification of PNG deliverables BEFORE they ship in a listing:
   real pixel dimensions, real DPI (from the pHYs chunk, not a filename), print-size suitability
   at a given target inches, and file integrity (valid PNG signature/chunk structure, readable,
   non-zero). This is deliberately NOT a re-statement of whatever the generating tool (image_generate
   / image_print_prep) already claimed — it re-reads the actual bytes on disk, so a stale or
   mislabeled file (a filename promising 4800x6000 that is actually 928x1152, the exact defect
   found in the Philippians 4:6-7 product on 2026-10-19) fails here even if nothing upstream caught it.

   Pure PNG chunk parsing — no @napi-rs/canvas decode needed for dimensions/DPI/integrity (cheaper
   and works even if canvas fails to load on this platform), but canvas IS used, if available, for
   one real pixel-decode sanity pass (catches a PNG whose header parses but whose compressed image
   data is corrupt — a header-only check cannot).

   makeImageQcTools({ fsp, pathMod, root })
     -> { qcTool, register(reg), _internals }   // _internals: parsePng, checkOne — pure, unit-testable
*/
'use strict';
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./fs.js'));
  else { root.SK = root.SK || {}; root.SK.tools = root.SK.tools || {}; (root.SK.tools.builtin = root.SK.tools.builtin || {}).imageQc = factory(root.SK.tools.builtin.fs); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (fsMod) {
  'use strict';

  const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const METERS_PER_INCH = 0.0254;
  function pixelsPerMeterToPpi(ppm) { return Math.round(ppm * METERS_PER_INCH); }

  // Walk every chunk once: validates the signature, IHDR-first rule, that each chunk's declared
  // length doesn't run past the buffer (a truncated/corrupt file), that IEND is actually present
  // (a file cut off mid-write has no IEND), and collects IHDR + pHYs along the way. This is the
  // "file integrity" layer — it does not decode pixels, it proves the container is well-formed.
  function parsePng(buf) {
    const out = { ok: false, error: null, width: 0, height: 0, bitDepth: 0, colorType: 0, ppiX: null, ppiY: null, hasIend: false, bytes: buf ? buf.length : 0, chunks: [] };
    if (!buf || buf.length < 8) { out.error = 'file is empty or too small to be a PNG'; return out; }
    if (!buf.slice(0, 8).equals(PNG_SIGNATURE)) { out.error = 'not a PNG (bad signature)'; return out; }
    let offset = 8;
    let sawIhdr = false;
    while (offset + 8 <= buf.length) {
      const len = buf.readUInt32BE(offset);
      const type = buf.toString('ascii', offset + 4, offset + 8);
      const dataStart = offset + 8;
      const dataEnd = dataStart + len;
      const chunkEnd = dataEnd + 4;   // + CRC
      if (len < 0 || dataEnd > buf.length || chunkEnd > buf.length) { out.error = 'truncated/corrupt PNG: ' + type + ' chunk declares ' + len + ' bytes past end of file'; return out; }
      out.chunks.push(type);
      if (offset === 8 && type !== 'IHDR') { out.error = 'not a valid PNG (first chunk is ' + type + ', not IHDR)'; return out; }
      if (type === 'IHDR') {
        sawIhdr = true;
        out.width = buf.readUInt32BE(dataStart);
        out.height = buf.readUInt32BE(dataStart + 4);
        out.bitDepth = buf.readUInt8(dataStart + 8);
        out.colorType = buf.readUInt8(dataStart + 9);
        if (out.width <= 0 || out.height <= 0) { out.error = 'invalid IHDR: non-positive dimensions'; return out; }
      } else if (type === 'pHYs') {
        const unit = buf.readUInt8(dataStart + 8);
        if (unit === 1) { out.ppiX = pixelsPerMeterToPpi(buf.readUInt32BE(dataStart)); out.ppiY = pixelsPerMeterToPpi(buf.readUInt32BE(dataStart + 4)); }
      } else if (type === 'IEND') {
        out.hasIend = true;
        offset = chunkEnd;
        break;
      }
      offset = chunkEnd;
    }
    if (!sawIhdr) { out.error = 'no IHDR chunk found'; return out; }
    if (!out.hasIend) { out.error = 'no IEND chunk found — file is truncated or was never finished writing'; return out; }
    out.ok = true;
    return out;
  }

  // Print-size suitability: at the PNG's own pHYs DPI if present, else the industry-standard
  // "effective DPI" from pixels/inches if the caller states a target size — never invents a DPI
  // the file doesn't actually declare or imply. 300 is the conventional print-shop floor; below
  // ~150 a home inkjet print visibly softens.
  function suitability(widthPx, heightPx, targetInchesW, targetInchesH) {
    if (!targetInchesW || !targetInchesH) return null;
    const dpiX = widthPx / targetInchesW, dpiY = heightPx / targetInchesH;
    const dpi = Math.min(dpiX, dpiY);
    let grade;
    if (dpi >= 300) grade = 'print-shop quality (>=300 DPI)';
    else if (dpi >= 150) grade = 'home-inkjet quality (150-299 DPI) — visible softening at close viewing distance';
    else grade = 'screen/preview quality only (<150 DPI) — not suitable to print at this size';
    return { targetInchesW, targetInchesH, effectiveDpiX: Math.round(dpiX), effectiveDpiY: Math.round(dpiY), grade };
  }

  /* ARGUMENT COERCION — the `images` parameter arrives in whatever shape the model's provider emitted,
     and "reject anything that isn't a real array" cost a live run three wasted turns on 2026-10-20
     (minimax-m3.1-flash via OpenRouter) before the agent gave up on the tool entirely and shelled out
     to read the PNG header by hand. Shapes seen in the wild, all of them unambiguous in intent:
       [{path}]                              a real array          (the declared contract)
       "[{\"path\":...}]"                    JSON-encoded array    (claude-sonnet-5, 2026-10-19)
       "outbox/x.png"                        a bare path string    (minimax, 2026-10-20)
       {path: "..."}                         a single unwrapped entry
       {item: {...}} / {images: [...]}       a wrapper object      (minimax, 2026-10-20)
       {"0": {...}, "1": {...}}              numeric-keyed pseudo-array
     Every one of these states a clear intent, so honouring them is not sloppiness — refusing them
     just makes the agent invent a worse workaround. A genuinely empty/garbage value still fails with
     the same clear required-field error; nothing is silently swallowed. Pure + unit-tested. */
  const NOT_JSON = Symbol('not-json');   // sentinel: distinguishes "parsed to undefined" from "did not parse"
  function coerceEntry(e) {
    if (typeof e === 'string') { const s = e.trim(); return s ? { path: s } : null; }
    if (e && typeof e === 'object' && !Array.isArray(e)) return e;
    return null;
  }
  function coerceImages(raw, depth) {
    depth = depth || 0;
    if (raw == null || depth > 4) return [];
    if (typeof raw === 'string') {
      const s = raw.trim();
      if (!s) return [];
      if (/^[[{]/.test(s)) {
        // A string that LOOKS like JSON but does not parse is not an error here: it falls through and
        // is treated as a path, same as any other string. The catch assigns rather than staying empty
        // so the fail-open ratchet can see the silence is deliberate and bounded.
        let parsed = NOT_JSON;
        try { parsed = JSON.parse(s); } catch (e) { parsed = NOT_JSON; }
        if (parsed !== NOT_JSON) return coerceImages(parsed, depth + 1);
      }
      return [{ path: s }];
    }
    if (Array.isArray(raw)) return raw.map(coerceEntry).filter(Boolean);
    if (typeof raw === 'object') {
      if (typeof raw.path === 'string') return [raw];                       // a single unwrapped entry
      for (const k of ['item', 'items', 'images', 'files', 'list', 'value']) {
        if (Object.prototype.hasOwnProperty.call(raw, k)) return coerceImages(raw[k], depth + 1);
      }
      const nums = Object.keys(raw).filter(k => /^\d+$/.test(k));
      if (nums.length) return coerceImages(nums.sort((a, b) => Number(a) - Number(b)).map(k => raw[k]), depth + 1);
    }
    return [];
  }

  function makeImageQcTools(deps) {
    deps = deps || {};
    const fsp = deps.fsp, P = deps.pathMod, ROOT = deps.root;
    if (!fsp || !P || !ROOT) throw new Error('image-qc.js requires { fsp, pathMod, root }');
    let canvasLib = null;
    try { canvasLib = require('@napi-rs/canvas'); } catch (_) { canvasLib = null; }
    const jail = fsMod.makeFsTools({ fsp, pathMod: P, root: ROOT })._internals;

    // Decode sanity pass: proves the compressed IDAT stream actually inflates to real pixels, not
    // just that the container header parses. Best-effort — if canvas isn't available on this
    // platform, the header/integrity checks above still ran and are reported; this layer is simply
    // marked 'skipped', never silently treated as a pass.
    async function decodeSanity(buf, expectW, expectH) {
      if (!canvasLib) return { checked: false, ok: null, note: 'canvas unavailable on this platform — pixel-decode layer skipped, header/integrity checks above still apply' };
      try {
        const img = await new Promise((resolve, reject) => {
          const im = new canvasLib.Image();
          im.onload = () => resolve(im);
          im.onerror = (e) => reject(new Error((e && e.message) || 'decode failed'));
          im.src = buf;
        });
        const ok = img.width === expectW && img.height === expectH;
        return { checked: true, ok, note: ok ? 'decoded pixel data matches header dimensions' : ('decoded as ' + img.width + 'x' + img.height + ', header said ' + expectW + 'x' + expectH + ' — corrupt or mismatched file') };
      } catch (e) { return { checked: true, ok: false, note: 'pixel decode failed: ' + ((e && e.message) || e) }; }
    }

    async function checkOne(aid, entry) {
      const relPath = String((entry && entry.path) || '').trim();
      const result = { path: relPath, ok: false };
      if (!relPath) { result.error = 'path is required'; return result; }
      let abs;
      try { ({ abs } = await jail.resolveInside(aid, relPath)); }
      catch (e) { result.error = 'invalid path: ' + ((e && e.message) || e); return result; }
      let buf;
      try { buf = await fsp.readFile(abs); }
      catch (e) { result.error = e && e.code === 'ENOENT' ? 'no such file in workspace: ' + relPath : ('could not read file: ' + ((e && e.message) || e)); return result; }

      const png = parsePng(buf);
      result.bytes = png.bytes;
      result.integrity = png.ok ? 'PASS — well-formed PNG container (signature, IHDR, chunk chain, IEND all present)' : ('FAIL — ' + png.error);
      if (!png.ok) return result;

      result.width = png.width;
      result.height = png.height;
      result.dpiFromMetadata = (png.ppiX && png.ppiY && png.ppiX === png.ppiY) ? png.ppiX : (png.ppiX || png.ppiY ? { x: png.ppiX, y: png.ppiY } : null);

      const decode = await decodeSanity(buf, png.width, png.height);
      result.pixelDecode = decode.checked ? (decode.ok ? 'PASS — ' + decode.note : 'FAIL — ' + decode.note) : ('SKIPPED — ' + decode.note);

      const claimedW = Number(entry.claimedWidth) || null;
      const claimedH = Number(entry.claimedHeight) || null;
      if (claimedW && claimedH) {
        const match = png.width === claimedW && png.height === claimedH;
        result.claimCheck = match
          ? 'PASS — actual ' + png.width + 'x' + png.height + ' matches the claimed ' + claimedW + 'x' + claimedH
          : 'FAIL — claimed ' + claimedW + 'x' + claimedH + ' but the file is ACTUALLY ' + png.width + 'x' + png.height + ' (do not ship under the claimed label)';
      }

      const targetW = Number(entry.targetInchesWidth) || null;
      const targetH = Number(entry.targetInchesHeight) || null;
      if (targetW && targetH) result.printSuitability = suitability(png.width, png.height, targetW, targetH);

      result.ok = png.ok && (decode.checked ? decode.ok !== false : true) && (result.claimCheck ? result.claimCheck.indexOf('PASS') === 0 : true);
      return result;
    }

    const qcTool = {
      name: 'image_quality_check', capability: 'studio', scope: 'read', requiresConsent: false, network: false, timeoutMs: 30000,
      description: 'Independently verify one or more PNG files already in the workspace: file integrity (valid ' +
        'PNG container, not truncated/corrupt), real pixel dimensions, real DPI from the file\'s own pHYs ' +
        'metadata (never from a filename), an optional claimed-vs-actual dimension check (catches a mislabeled ' +
        'file — e.g. a filename promising 4800x6000 that is actually a small screen render), and print-size ' +
        'suitability at an optional target inches. This re-reads the actual bytes on disk — it does not trust ' +
        'what image_generate or image_print_prep reported about their own output. Use this for the independent ' +
        'quality-check step of the Etsy pipeline validation stage, never as a restatement of Designer\'s own claim.',
      parameters: {
        type: 'object',
        properties: {
          images: {
            type: 'array', minItems: 1, maxItems: 20,
            items: {
              type: 'object',
              properties: {
                path: { type: 'string', description: 'workspace-relative path to the PNG file' },
                claimedWidth: { type: 'number', description: 'optional — the pixel width this file is SUPPOSED to be (e.g. from its filename or a prior report); checked against the real decoded width' },
                claimedHeight: { type: 'number', description: 'optional — the pixel height this file is SUPPOSED to be' },
                targetInchesWidth: { type: 'number', description: 'optional — intended print width in inches, to report effective DPI and a print-quality grade' },
                targetInchesHeight: { type: 'number', description: 'optional — intended print height in inches' }
              },
              required: ['path']
            }
          }
        },
        required: ['images']
      },
      async run(args, ctx) {
        const aid = (ctx && ctx.agentId) || 'agent';
        // See coerceImages above for the catalogue of real provider shapes this absorbs. Also accept the
        // whole argument object being the entry (`{path: ...}` with no `images` key at all), which is the
        // other way a model "obviously means" one file.
        // Key aliases, same reasoning as the value shapes: models reach for the singular `image` and for
        // `file`/`files` about as often as the declared `images` (singular seen live 2026-10-20). The
        // declared name wins when more than one is present; `path` last, meaning "the args ARE the entry".
        let rawImages = null;
        for (const k of ['images', 'image', 'files', 'file', 'paths']) {
          if (args && args[k] != null) { rawImages = args[k]; break; }
        }
        if (rawImages == null && args && typeof args.path === 'string') rawImages = args;
        const images = coerceImages(rawImages).slice(0, 20);
        if (!images.length) throw new Error('images is required: give at least one file, e.g. images: [{"path": "outbox/art.png"}]. A plain path string or a single {path} object also works.');
        const results = [];
        for (const entry of images) results.push(await checkOne(aid, entry));

        const lines = results.map(r => {
          if (r.error) return r.path + ': ERROR — ' + r.error;
          const parts = [r.integrity];
          if (r.width) parts.push(r.width + 'x' + r.height + 'px' + (r.dpiFromMetadata ? (typeof r.dpiFromMetadata === 'number' ? ', ' + r.dpiFromMetadata + ' DPI (from file metadata)' : ', DPI metadata present but X/Y differ: ' + JSON.stringify(r.dpiFromMetadata)) : ', no DPI metadata in file'));
          if (r.pixelDecode) parts.push(r.pixelDecode);
          if (r.claimCheck) parts.push(r.claimCheck);
          if (r.printSuitability) parts.push('at ' + r.printSuitability.targetInchesW + 'x' + r.printSuitability.targetInchesH + 'in: ' + r.printSuitability.effectiveDpiX + ' effective DPI — ' + r.printSuitability.grade);
          return r.path + ': ' + (r.ok ? 'PASS' : 'FAIL') + '\n  ' + parts.join('\n  ');
        });
        const failCount = results.filter(r => r.error || !r.ok).length;
        return {
          content: 'Independent image QC (' + results.length + ' file' + (results.length === 1 ? '' : 's') + ', ' + failCount + ' failed):\n\n' + lines.join('\n\n'),
          summary: 'image_quality_check -> ' + (results.length - failCount) + '/' + results.length + ' passed'
        };
      }
    };

    return {
      qcTool,
      register(reg) { reg.register(qcTool); return reg; },
      _internals: { parsePng, suitability, pixelsPerMeterToPpi, PNG_SIGNATURE, coerceImages, coerceEntry }
    };
  }

  return { makeImageQcTools };
});

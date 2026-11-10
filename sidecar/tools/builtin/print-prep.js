/* sidecar/tools/builtin/print-prep.js — STUDIO capability: image_print_prep(image, sizes?)

   Turns an EXISTING workspace image (typically an image_generate output) into genuine print-ready
   files at real pixel dimensions for 300 PPI output, with a correct PNG pHYs metadata chunk so any
   downstream tool (print shop RIP, Photoshop, a photo kiosk) reads the file at its true physical
   size instead of guessing 72/96 DPI.

   WHY @napi-rs/canvas AND NOT sharp: `sharp` (already a package.json dependency, used by this same
   image.js's fitToSize()) has NO prebuilt android-arm64 binding — `require('sharp')` throws
   "Could not load the sharp module using the android-arm64 runtime" on this exact station. That is
   the undocumented reason image_generate's own width/height fitting silently falls back to
   "image resizer unavailable" on this platform. @napi-rs/canvas DOES ship an android-arm64
   prebuild (already installed — the same library CLAUDE.md's "Verses for Hard Days" 300 DPI
   print pages were rendered through) and is verified working here. No new dependency, no network
   call, no cost.

   HONESTY CONTRACT (do not violate): this is a pixel-interpolation upscale (Skia's high-quality
   image smoothing), not a neural/AI upscaler — it cannot restore detail the 928x1152 source never
   had. Every tool result and the deliverable note this feeds must say "upscaled via interpolation"
   and must never claim restored or added detail. For a source/target aspect mismatch (the KJV
   brief's 11x14 case), the source is letterboxed onto a matching-background-color canvas — never
   stretched (which would distort the art) and never cropped (which could cut off scripture text).

   makePrintPrepTools({ fsp, pathMod, root })
     -> { prepTool, register(reg), _internals }   // _internals: pHYs chunk helpers, pure + unit-testable
*/
'use strict';
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./fs.js'));
  else { root.SK = root.SK || {}; root.SK.tools = root.SK.tools || {}; (root.SK.tools.builtin = root.SK.tools.builtin || {}).printPrep = factory(root.SK.tools.builtin.fs); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (fsMod) {
  'use strict';

  const PPI = 300;
  const METERS_PER_INCH = 0.0254;
  const PIXELS_PER_METER = Math.round(PPI / METERS_PER_INCH);   // 11811 — the standard "300 DPI" pHYs value

  // ETSY FILE-SIZE LAW (2026-10-22): Etsy rejects any digital-download file over 20 MB. A full-bleed
  // 300-PPI PNG at these pixel counts routinely lands 20-35 MB (confirmed live, 5 real KJV print kits) —
  // every print file now ships as JPEG instead, which the same real kits showed lands 3-6 MB at these
  // same dimensions, comfortably under the cap. 19.5 MB (not 20) is the target so a few KB of JPEG/EXIF
  // overhead can never tip a file over Etsy's real line. Quality only ever steps DOWN from a high floor
  // (92) — never shrinks pixel dimensions to hit the budget, matching print-prep's existing "upscale
  // honesty" contract: the shipped WxH is always exactly what was promised.
  const MAX_PRINT_BYTES = Math.floor(19.5 * 1024 * 1024);
  const JPEG_QUALITY_START = 95;
  const JPEG_QUALITY_FLOOR = 90;
  const JPEG_QUALITY_STEP = 2;

  // inches -> exact pixel dims at 300 PPI. Fixed presets, not computed per-call, so the shipped
  // numbers always match the brief exactly (2400x3000 / 3300x4200 / 4800x6000) regardless of any
  // future rounding-rule change elsewhere.
  const SIZE_PRESETS = {
    '8x10':  { label: '8x10in',  w: 2400, h: 3000 },
    '11x14': { label: '11x14in', w: 3300, h: 4200 },
    '16x20': { label: '16x20in', w: 4800, h: 6000 }
  };
  const DEFAULT_SIZES = ['8x10', '11x14', '16x20'];
  // image_generate's actual delivered pixels (928x1152 = 29:36 ≈ 0.8056) are NOT bit-exact 4:5 (0.8) —
  // a ~0.69% deviation, almost certainly the provider's own internal rounding, not a deliberate aspect.
  // 8x10/16x20 (0.8 exactly) sit inside that noise band; 11x14 (0.7857) is a real ~2.46% mismatch.
  // 0.01 cleanly separates "effectively the same ratio" from "genuinely different ratio" for this source.
  const ASPECT_MATCH_TOLERANCE = 0.01;

  function crc32(buf) {
    const zlib = require('node:zlib');
    if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0;   // Node 20.12+/21+
    // Pure-JS fallback table (standard PNG/zlib polynomial 0xEDB88320) for older Node.
    let table = crc32._table;
    if (!table) {
      table = crc32._table = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        table[n] = c >>> 0;
      }
    }
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function pngChunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crc]);
  }

  // Insert a pHYs chunk (pixels-per-meter X/Y + unit=meter) right after IHDR, the position the PNG
  // spec requires (before PLTE/IDAT). pngBuffer must be a real, already-encoded PNG (8-byte
  // signature + IHDR first) — the exact shape canvas.toBuffer('image/png') always produces.
  function injectPhys(pngBuffer, pixelsPerMeter) {
    if (pngBuffer.readUInt32BE(8 + 4) !== 0x49484452) throw new Error('not a PNG (no leading IHDR)');   // 'IHDR'
    const ihdrDataLen = pngBuffer.readUInt32BE(8);
    const ihdrEnd = 8 + 4 + 4 + ihdrDataLen + 4;   // sig + (len+type+data+crc) of IHDR
    const physData = Buffer.alloc(9);
    physData.writeUInt32BE(pixelsPerMeter, 0);
    physData.writeUInt32BE(pixelsPerMeter, 4);
    physData.writeUInt8(1, 8);   // 1 = meter
    return Buffer.concat([pngBuffer.slice(0, ihdrEnd), pngChunk('pHYs', physData), pngBuffer.slice(ihdrEnd)]);
  }

  // Read back a pHYs chunk for verification (own output, or anyone else's PNG). null if absent.
  function readPhys(pngBuffer) {
    let offset = 8;
    while (offset + 8 <= pngBuffer.length) {
      const len = pngBuffer.readUInt32BE(offset);
      const type = pngBuffer.toString('ascii', offset + 4, offset + 8);
      if (type === 'pHYs') {
        const d = offset + 8;
        return { x: pngBuffer.readUInt32BE(d), y: pngBuffer.readUInt32BE(d + 4), unit: pngBuffer.readUInt8(d + 8) };
      }
      if (type === 'IDAT' || type === 'IEND') break;   // pHYs must precede image data — stop scanning
      offset += 4 + 4 + len + 4;
    }
    return null;
  }

  function pixelsPerMeterToPpi(ppm) { return Math.round(ppm * METERS_PER_INCH); }

  // JPEG's equivalent of the PNG pHYs chunk: the JFIF APP0 segment's density fields. @napi-rs/canvas's
  // 'jpeg' encoder always emits a bare JFIF APP0 as the FIRST segment (no thumbnail) at this exact fixed
  // byte layout — verified against this build's actual output, same "prove it, don't assume it" contract
  // the PNG path already follows. Throws rather than silently skipping if that layout ever changes
  // upstream, exactly like injectPhys refuses to guess at a PNG that isn't shaped as expected.
  function injectJfifDpi(jpegBuffer, dpi) {
    if (jpegBuffer[0] !== 0xFF || jpegBuffer[1] !== 0xD8) throw new Error('not a JPEG (no SOI marker)');
    if (jpegBuffer[2] !== 0xFF || jpegBuffer[3] !== 0xE0) throw new Error('not a bare JFIF APP0 as the first segment');
    if (jpegBuffer.toString('ascii', 6, 10) !== 'JFIF' || jpegBuffer[10] !== 0) throw new Error('APP0 segment is not JFIF');
    const out = Buffer.from(jpegBuffer);   // copy — never mutate the caller's buffer
    out.writeUInt8(1, 13);                 // units = 1 (dots per inch)
    out.writeUInt16BE(dpi, 14);
    out.writeUInt16BE(dpi, 16);
    return out;
  }
  // Read back the JFIF density fields for verification (own output, or anyone else's JPEG). null if the
  // file isn't a bare-JFIF-first-segment JPEG (e.g. one that carries EXIF/APP1 first instead).
  function readJfifDpi(jpegBuffer) {
    if (jpegBuffer[0] !== 0xFF || jpegBuffer[1] !== 0xD8 || jpegBuffer[2] !== 0xFF || jpegBuffer[3] !== 0xE0) return null;
    if (jpegBuffer.toString('ascii', 6, 10) !== 'JFIF' || jpegBuffer[10] !== 0) return null;
    return { unit: jpegBuffer.readUInt8(13), x: jpegBuffer.readUInt16BE(14), y: jpegBuffer.readUInt16BE(16) };
  }

  function makePrintPrepTools(deps) {
    deps = deps || {};
    const fsp = deps.fsp, P = deps.pathMod, ROOT = deps.root;
    if (!fsp || !P || !ROOT) throw new Error('print-prep.js requires { fsp, pathMod, root }');
    let canvasLib = null, canvasLoadError = '';
    try { canvasLib = require('@napi-rs/canvas'); } catch (e) { canvasLoadError = (e && e.message) || String(e); }
    const jail = fsMod.makeFsTools({ fsp, pathMod: P, root: ROOT })._internals;
    let seq = 0;

    function emitDeliverable(ctx, aid, rel) {
      if (!ctx || typeof ctx.emit !== 'function') return;
      const d = { id: 'img_' + String(rel).replace(/[^A-Za-z0-9_.-]/g, '_'), agentId: aid, kind: 'image', title: String(rel) };
      if (ctx.room) d.room = ctx.room;
      ctx.emit('deliverable', d);
    }

    // @napi-rs/canvas's Image reports width/height synchronously but the pixel buffer isn't ready
    // for drawImage until 'load' fires (verified empirically on this build — a sync drawImage right
    // after `.src =` silently draws nothing, no error). Always wait for it.
    function loadImage(buf) {
      return new Promise((resolve, reject) => {
        const img = new canvasLib.Image();
        img.onload = () => resolve(img);
        img.onerror = (e) => reject(new Error('could not decode source image: ' + ((e && e.message) || e)));
        img.src = buf;
      });
    }

    // The 11x14 letterbox fill: sample the source's own corner pixel (not a guessed/hardcoded
    // color) so the pad matches THIS artwork's actual background, not an assumption about it.
    function sampleCornerColor(image) {
      const probe = canvasLib.createCanvas(image.width, image.height);
      const pctx = probe.getContext('2d');
      pctx.drawImage(image, 0, 0);
      const [r, g, b, a] = pctx.getImageData(2, 2, 1, 1).data;
      return `rgba(${r},${g},${b},${(a / 255).toFixed(3)})`;
    }

    async function renderOneSize(image, srcW, srcH, preset) {
      const canvas = canvasLib.createCanvas(preset.w, preset.h);
      const cctx = canvas.getContext('2d');
      cctx.imageSmoothingEnabled = true;
      if ('imageSmoothingQuality' in cctx) cctx.imageSmoothingQuality = 'high';
      const srcRatio = srcW / srcH, targetRatio = preset.w / preset.h;
      const ratioDelta = Math.abs(srcRatio - targetRatio);
      let padded = false, padColor = null;
      if (ratioDelta <= ASPECT_MATCH_TOLERANCE) {
        // ratios match within tolerance (8x10, 16x20 are both exactly 4:5; this source is 29:36 ≈
        // 0.69% off bit-exact 4:5 — almost certainly the image model's own rounding, not a deliberate
        // aspect choice). Full-bleed upscale; the sub-1% non-uniform correction is imperceptible but
        // real, so it is reported honestly rather than claimed as an exact-ratio match.
        cctx.drawImage(image, 0, 0, preset.w, preset.h);
      } else {
        // aspect mismatch (11x14 = 0.7857 vs source's 0.8) — fit WITHOUT cropping or stretching;
        // pad the remainder with the artwork's own sampled background so it reads as a deliberate
        // mat border, not a cut corner. Never upscale PAST 'contain' to fill the canvas (that would
        // silently crop) and never stretch non-uniformly (that would distort type/line-art).
        padColor = sampleCornerColor(image);
        cctx.fillStyle = padColor;
        cctx.fillRect(0, 0, preset.w, preset.h);
        const scale = Math.min(preset.w / srcW, preset.h / srcH);
        const dw = Math.round(srcW * scale), dh = Math.round(srcH * scale);
        const dx = Math.round((preset.w - dw) / 2), dy = Math.round((preset.h - dh) / 2);
        cctx.drawImage(image, dx, dy, dw, dh);
        padded = true;
      }
      // Quality only ever steps DOWN to fit the budget — pixel dimensions never shrink (see
      // MAX_PRINT_BYTES above). Alpha is flattened to white first: JPEG has no alpha channel, and
      // letting the encoder silently drop it would risk a black background on some decoders.
      if (padded) { cctx.globalCompositeOperation = 'destination-over'; cctx.fillStyle = '#ffffff'; cctx.fillRect(0, 0, preset.w, preset.h); cctx.globalCompositeOperation = 'source-over'; }
      let q = JPEG_QUALITY_START, buf = await canvas.encode('jpeg', q);
      while (buf.length > MAX_PRINT_BYTES && q > JPEG_QUALITY_FLOOR) {
        q -= JPEG_QUALITY_STEP;
        buf = await canvas.encode('jpeg', q);
      }
      buf = injectJfifDpi(buf, PPI);
      return { buf, quality: q, underBudget: buf.length <= MAX_PRINT_BYTES, padded, padColor, upscaleX: preset.w / srcW, upscaleY: preset.h / srcH, ratioDelta };
    }

    const prepTool = {
      name: 'image_print_prep', capability: 'studio', scope: 'write', requiresConsent: true, timeoutMs: 45000,
      description: 'Turn an existing OUTBOX/workspace image into genuine 300-PPI print-ready files at real pixel ' +
        'dimensions: 8x10in (2400x3000), 11x14in (3300x4200), 16x20in (4800x6000) by default — pass "sizes" ' +
        '(array of "8x10"/"11x14"/"16x20") to produce a subset. Required "image": a workspace-relative path to an ' +
        'already-generated PNG (e.g. from image_generate). This is a PIXEL-INTERPOLATION upscale with correct DPI ' +
        'metadata, not an AI detail-restoration tool — never claim the output has more real detail than the ' +
        'source. 11x14 does not share the source\'s aspect ratio: that size is letterboxed onto a canvas padded in ' +
        'the artwork\'s own sampled background color (never stretched, never cropped) — say so plainly when ' +
        'reporting it. Each output is saved next to the source as "<name>-<size>-300ppi.jpg" — JPEG, not PNG: ' +
        'Etsy rejects any digital-download file over 20 MB and a full-bleed 300-PPI PNG at these dimensions ' +
        'routinely exceeds that; this tool always ships JPEG (quality 90-95, verified under 19.5 MB) instead.',
      /* `schema`, NOT `parameters` — makeTool() reads def.schema and silently drops unknown keys, so the
         misspelling shipped an EMPTY schema: the model was told this tool takes no arguments, and
         shared/schema.js ("a missing/empty schema imposes no constraint") stopped validating. Fixed 2026-11-10. */
      schema: {
        type: 'object',
        properties: {
          image: { type: 'string', description: 'workspace-relative path to the source image, e.g. outbox/my-design.png' },
          sizes: { type: 'array', items: { type: 'string', enum: Object.keys(SIZE_PRESETS) }, description: 'subset of sizes to produce; default is all three' }
        },
        required: ['image']
      },
      async run(args, ctx) {
        if (!canvasLib) throw new Error('print prep is unavailable on this station: @napi-rs/canvas failed to load (' + canvasLoadError + '). No files were produced — do not report sizes as delivered.');
        const aid = (ctx && ctx.agentId) || 'agent';
        const src = String((args && args.image) || '').trim();
        if (!src) throw new Error('image is required (a workspace-relative path to an existing PNG)');
        const requested = Array.isArray(args && args.sizes) && args.sizes.length ? args.sizes.filter(s => SIZE_PRESETS[s]) : DEFAULT_SIZES;
        if (!requested.length) throw new Error('no valid "sizes" given — use 8x10, 11x14, and/or 16x20');

        const { abs: srcAbs } = await jail.resolveInside(aid, src);   // throws on jail escape / abs / '..'
        let srcBuf;
        try { srcBuf = await fsp.readFile(srcAbs); }
        catch (e) { if (e && e.code === 'ENOENT') throw new Error('no such file in workspace: ' + src); throw e; }

        const image = await loadImage(srcBuf);
        const srcW = image.width, srcH = image.height;
        if (!srcW || !srcH) throw new Error('could not decode source image: ' + src);

        const base = P.basename(src, P.extname(src));
        const dir = P.dirname(src);
        const results = [];
        for (const key of requested) {
          const preset = SIZE_PRESETS[key];
          const { buf, quality, underBudget, padded, padColor, upscaleX, upscaleY, ratioDelta } = await renderOneSize(image, srcW, srcH, preset);

          // Verify our own output before publishing it: re-decode, re-check dimensions, re-read the DPI
          // metadata we just wrote, AND re-check the actual byte size. A silent encoder bug — or a file
          // that quality-stepping still couldn't bring under budget — must fail the tool, never ship an
          // unverified or oversized file (the exact mistake that reached Etsy-ready products before this).
          const check = await loadImage(buf);
          const dpiCheck = readJfifDpi(buf);
          if (check.width !== preset.w || check.height !== preset.h) throw new Error(key + ': encoded file decoded at ' + check.width + 'x' + check.height + ', expected ' + preset.w + 'x' + preset.h + ' — refusing to publish a mismatched file');
          if (!dpiCheck || dpiCheck.x !== PPI || dpiCheck.y !== PPI || dpiCheck.unit !== 1) throw new Error(key + ': JFIF DPI metadata missing or wrong after writing — refusing to publish a file without verified 300 PPI metadata');
          if (!underBudget) throw new Error(key + ': ' + (buf.length / 1048576).toFixed(1) + ' MB even at quality ' + JPEG_QUALITY_FLOOR + ' (Etsy\'s 20 MB cap) — refusing to publish an oversized file; the source art may need to be simpler or lower-resolution');

          const rel = (dir && dir !== '.' ? dir + '/' : '') + base + '-' + key + '-300ppi.jpg';
          const { abs } = await jail.resolveInside(aid, rel);
          await fsp.mkdir(P.dirname(abs), { recursive: true });
          const staging = abs + '.pending-' + process.pid + '-' + (++seq);
          try {
            await fsp.writeFile(staging, buf, { flag: 'wx' });
            require('node:fs').renameSync(staging, abs);
            emitDeliverable(ctx, aid, rel);
          } finally {
            await fsp.unlink(staging).catch(e => { if (!e || e.code !== 'ENOENT') require('../../failopen.js').note('print-prep.staging-cleanup', e); });
          }

          results.push({
            // JFIF density with unit=1 IS dots-per-inch directly — no conversion needed (unlike the PNG
            // path's pixels-per-meter, which pixelsPerMeterToPpi existed to convert).
            size: key, path: rel, width: preset.w, height: preset.h, ppi: dpiCheck.x,
            quality, padded, padColor, upscaleFactor: Math.max(upscaleX, upscaleY), ratioDelta, bytes: buf.length
          });
        }

        const lines = results.map(r =>
          r.size + ' -> ' + r.path + ' (' + r.width + 'x' + r.height + 'px, verified ' + r.ppi + ' PPI, ' +
          (r.upscaleFactor).toFixed(2) + 'x interpolated upscale' + (r.padded
            ? ', letterboxed to fit — source aspect does not match this size (Δratio ' + (r.ratioDelta * 100).toFixed(1) + '%), padded in the artwork\'s own background color, nothing cropped or stretched'
            : ', full-bleed — ratio matches the source to within ' + (r.ratioDelta * 100).toFixed(2) + '% (no visible distortion)') +
          ', ' + (r.bytes / 1048576).toFixed(1) + ' MB JPEG q' + r.quality + ' (Etsy limit 20 MB)' + ')'
        );
        return {
          content: 'Print-prep from ' + src + ' (source ' + srcW + 'x' + srcH + 'px). This is a pixel-interpolation ' +
            'upscale (Skia high-quality resampling) — it does NOT restore or add real detail beyond the source\'s ' +
            'actual resolution; inspect the output yourself before calling it print-ready. Every file below is ' +
            'JPEG, verified under 19.5 MB (Etsy rejects anything over 20 MB).\n' + lines.join('\n'),
          summary: 'print-prep -> ' + results.length + ' size(s): ' + results.map(r => r.size).join(', '),
          // Lets sidecar/artifacts.js's observe() record these into run.artifacts (its tool-name allowlist has no
          // entry for image_print_prep) so the Deliverables panel's file list is never empty for real output.
          producedFiles: results.map(r => ({ path: r.path, bytes: r.bytes }))
        };
      }
    };

    return {
      prepTool,
      register(reg) { reg.register(prepTool); return reg; },
      _internals: { crc32, pngChunk, injectPhys, readPhys, injectJfifDpi, readJfifDpi, pixelsPerMeterToPpi, PIXELS_PER_METER, PPI, SIZE_PRESETS, ASPECT_MATCH_TOLERANCE, MAX_PRINT_BYTES, JPEG_QUALITY_START, JPEG_QUALITY_FLOOR }
    };
  }

  return { makePrintPrepTools };
});

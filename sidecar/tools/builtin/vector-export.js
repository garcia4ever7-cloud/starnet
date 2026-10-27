/* sidecar/tools/builtin/vector-export.js — STUDIO capability: vector_export(svg, sizes, formats)

   Turns a workspace SVG into genuine print deliverables: 300-PPI PNGs (with a correct pHYs chunk, so
   a print shop reads 300 DPI from the file itself) and single-page PDFs sized in real inches.

   THE NON-OBVIOUS PART — @napi-rs/canvas rasterises an SVG at its DECLARED width/height and then
   bilinearly upscales it when you draw it larger. Measured on this device 2026-10-20: a 10x10 SVG
   drawn into an 800x800 canvas produced 224 partially-grey pixels along the mid-scanline (a blurred
   ramp), while the same artwork declared at 800x800 produced 0 (a sharp edge). Naively drawing an
   SVG onto a big canvas therefore yields an UPSCALED BLUR that is 300 PPI only in its metadata —
   exactly the kind of "file claims a size it does not really have" defect image_quality_check exists
   to catch. So this tool rewrites the root <svg> element's width/height to the target pixel size
   (synthesising a viewBox from the original dimensions when one is missing) BEFORE rasterising, and
   then draws 1:1. That is the whole reason this is a separate tool rather than a flag on
   image_print_prep, which is a raster upscaler by design.

   NO NEW DEPENDENCY. CONTRIBUTING.md states the sidecar has no runtime npm dependencies and must
   start with a bare `node sidecar/index.js`; print-prep.js already honours that for @napi-rs/canvas
   with an optional require and an honest hard failure. pdf-lib would have been the first runtime dep
   in the sidecar, svg2pdf.js needs a real DOM, and resvg-js is a native binding with the same
   android-arm64 risk that forced `sharp` out — so the PDF here is written byte-by-byte against the
   PDF 1.4 spec: a Flate-compressed DeviceRGB image XObject on a single correctly-sized page.
   Transparency is composited onto WHITE, because these are files destined for paper.

   makeVectorExportTools({ fsp, pathMod, root })
     -> { exportTool, register(reg), _internals }   // _internals: retargetSvg, buildPdf — pure
*/
'use strict';
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./fs.js'), require('./print-prep.js'));
  else { root.SK = root.SK || {}; root.SK.tools = root.SK.tools || {}; (root.SK.tools.builtin = root.SK.tools.builtin || {}).vectorExport = factory(root.SK.tools.builtin.fs, root.SK.tools.builtin.printPrep); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (fsMod, printPrepMod) {
  'use strict';

  const zlib = require('node:zlib');
  const PPI = 300;
  const POINTS_PER_INCH = 72;              // PDF user-space unit
  const MAX_PIXELS = 60e6;                 // 16x20in at 300 PPI is 28.8MP; this is a sane ceiling above it
  const DEFAULT_SIZES = ['8x10', '11x14', '16x20'];

  /* Force the root <svg> to an exact pixel size so the rasteriser works at full resolution.
     Preserves geometry by guaranteeing a viewBox: if the document has none, one is synthesised from
     its original width/height. A document with neither is rejected rather than guessed at — scaling
     an SVG with no intrinsic size and no viewBox would be inventing a coordinate system. */
  function retargetSvg(svgText, widthPx, heightPx) {
    const src = String(svgText || '');
    const m = src.match(/<svg\b[^>]*>/i);
    if (!m) throw new Error('not an SVG document (no <svg> root element found)');
    let tag = m[0];
    const attrNum = (name) => {
      const r = tag.match(new RegExp('\\b' + name + '\\s*=\\s*["\']\\s*([0-9.]+)\\s*(px)?\\s*["\']', 'i'));
      return r ? parseFloat(r[1]) : null;
    };
    if (!/\bviewBox\s*=/i.test(tag)) {
      const ow = attrNum('width'), oh = attrNum('height');
      if (!ow || !oh) throw new Error('this SVG has no viewBox and no numeric width/height — cannot scale it without inventing a coordinate system');
      tag = tag.replace(/<svg\b/i, '<svg viewBox="0 0 ' + ow + ' ' + oh + '"');
    }
    tag = tag.replace(/\s\b(width|height)\s*=\s*"[^"]*"/gi, '').replace(/\s\b(width|height)\s*=\s*'[^']*'/gi, '');
    tag = tag.replace(/<svg\b/i, '<svg width="' + widthPx + '" height="' + heightPx + '"');
    return src.replace(m[0], tag);
  }

  /* ---------------- minimal PDF writer (pure) ----------------
     One page, one image, drawn edge to edge. `rgb` is tightly packed 8-bit RGB (no alpha, no row
     padding) of widthPx*heightPx*3 bytes. Object offsets are tracked as real byte positions into the
     assembled buffer, because an xref table that is wrong by one byte produces a file that some
     readers silently repair and others reject outright. */
  function buildPdf(rgb, widthPx, heightPx, widthInches, heightInches, title) {
    if (!Buffer.isBuffer(rgb) || rgb.length !== widthPx * heightPx * 3) {
      throw new Error('buildPdf expected ' + (widthPx * heightPx * 3) + ' bytes of packed RGB, got ' + (rgb ? rgb.length : 0));
    }
    const wPt = +(widthInches * POINTS_PER_INCH).toFixed(4);
    const hPt = +(heightInches * POINTS_PER_INCH).toFixed(4);
    const img = zlib.deflateSync(rgb, { level: 9 });
    const content = Buffer.from('q ' + wPt + ' 0 0 ' + hPt + ' 0 0 cm /Im0 Do Q\n', 'latin1');
    const esc = (s) => String(s || '').replace(/[\\()]/g, '\\$&').replace(/[^\x20-\x7e]/g, '');

    const objects = [
      Buffer.from('<< /Type /Catalog /Pages 2 0 R >>', 'latin1'),
      Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>', 'latin1'),
      Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + wPt + ' ' + hPt + '] ' +
        '/Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>', 'latin1'),
      Buffer.concat([Buffer.from('<< /Length ' + content.length + ' >>\nstream\n', 'latin1'), content, Buffer.from('\nendstream', 'latin1')]),
      Buffer.concat([Buffer.from('<< /Type /XObject /Subtype /Image /Width ' + widthPx + ' /Height ' + heightPx +
        ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ' + img.length + ' >>\nstream\n', 'latin1'),
        img, Buffer.from('\nendstream', 'latin1')]),
      Buffer.from('<< /Producer (StarNet vector_export) /Title (' + esc(title) + ') >>', 'latin1')
    ];

    const chunks = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
    let offset = chunks[0].length;
    const offsets = [];
    objects.forEach((body, i) => {
      const head = Buffer.from((i + 1) + ' 0 obj\n', 'latin1');
      const tail = Buffer.from('\nendobj\n', 'latin1');
      offsets.push(offset);
      const full = Buffer.concat([head, body, tail]);
      chunks.push(full);
      offset += full.length;
    });
    const xrefAt = offset;
    let xref = 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n';
    for (const off of offsets) xref += String(off).padStart(10, '0') + ' 00000 n \n';
    xref += 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R /Info ' + objects.length + ' 0 R >>\n' +
      'startxref\n' + xrefAt + '\n%%EOF\n';
    chunks.push(Buffer.from(xref, 'latin1'));
    return Buffer.concat(chunks);
  }

  // RGBA (canvas) -> packed RGB over a white matte. These files are going on paper; an un-flattened
  // alpha channel would either be dropped by the RIP or print as black, both silently wrong.
  function flattenToRgb(rgba, widthPx, heightPx) {
    const out = Buffer.allocUnsafe(widthPx * heightPx * 3);
    for (let i = 0, o = 0; i < rgba.length; i += 4, o += 3) {
      const a = rgba[i + 3] / 255;
      out[o] = Math.round(rgba[i] * a + 255 * (1 - a));
      out[o + 1] = Math.round(rgba[i + 1] * a + 255 * (1 - a));
      out[o + 2] = Math.round(rgba[i + 2] * a + 255 * (1 - a));
    }
    return out;
  }

  function makeVectorExportTools(deps) {
    deps = deps || {};
    const fsp = deps.fsp, P = deps.pathMod, ROOT = deps.root;
    if (!fsp || !P || !ROOT) throw new Error('vector-export.js requires { fsp, pathMod, root }');
    let canvasLib = null, canvasLoadError = '';
    try { canvasLib = require('@napi-rs/canvas'); } catch (e) { canvasLoadError = (e && e.message) || String(e); }
    const jail = fsMod.makeFsTools({ fsp, pathMod: P, root: ROOT })._internals;
    // Reuse print-prep's verified pHYs machinery rather than owning a second copy of the chunk logic.
    const prep = printPrepMod.makePrintPrepTools({ fsp, pathMod: P, root: ROOT })._internals;
    const SIZE_PRESETS = prep.SIZE_PRESETS;
    let publicationSequence = 0;

    async function rasterise(svgText, widthPx, heightPx) {
      const retargeted = retargetSvg(svgText, widthPx, heightPx);
      const img = await new Promise((resolve, reject) => {
        const im = new canvasLib.Image();
        im.onload = () => resolve(im);
        im.onerror = (e) => reject(new Error('SVG failed to rasterise: ' + ((e && e.message) || e)));
        im.src = Buffer.from(retargeted, 'utf8');
      });
      const canvas = canvasLib.createCanvas(widthPx, heightPx);
      const g = canvas.getContext('2d');
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, widthPx, heightPx);
      // Drawn 1:1 — the rasteriser already worked at full resolution, so there is no resampling here.
      g.drawImage(img, 0, 0, widthPx, heightPx);
      return { canvas, ctx: g, intrinsic: img.width + 'x' + img.height };
    }

    async function writeFileAtomic(abs, buf) {
      await fsp.mkdir(P.dirname(abs), { recursive: true });
      const staging = abs + '.pending-' + process.pid + '-' + (++publicationSequence);
      try {
        await fsp.writeFile(staging, buf, { flag: 'wx' });
        require('node:fs').renameSync(staging, abs);
      } finally {
        // ENOENT is the normal path (the rename already consumed the staging file); anything else is a
        // real cleanup failure and gets tallied rather than silently dropped — same as image.js.
        await fsp.unlink(staging).catch(e => {
          if (!e || e.code !== 'ENOENT') require('../../failopen.js').note('vector-export.staging-cleanup', e);
        });
      }
    }

    const exportTool = {
      name: 'vector_export', capability: 'studio', scope: 'write', requiresConsent: true, network: false, timeoutMs: 180000,
      description: 'Export a workspace SVG to real print deliverables: 300-PPI PNG files (with correct pHYs DPI ' +
        'metadata) and single-page PDFs sized in true inches. The SVG is re-rasterised at the full target ' +
        'resolution, so the output is a genuine vector render rather than an upscaled blur — unlike ' +
        'image_print_prep, which upscales existing raster art. Runs entirely locally: no network, no provider ' +
        'credential, no cost. Transparency is flattened onto white because these are files destined for paper.',
      parameters: {
        type: 'object',
        properties: {
          svg: { type: 'string', description: 'workspace-relative path to the source .svg file' },
          sizes: { type: 'array', items: { type: 'string' }, description: 'print sizes to produce, any of "8x10", "11x14", "16x20" (default all three)' },
          formats: { type: 'array', items: { type: 'string' }, description: '"png", "pdf", or both (default both)' },
          destDir: { type: 'string', description: 'workspace-relative output folder (default: alongside the source SVG)' }
        },
        required: ['svg']
      },
      async run(args, ctx) {
        const aid = (ctx && ctx.agentId) || 'agent';
        if (!canvasLib) throw new Error('vector export is unavailable on this station: @napi-rs/canvas failed to load (' + canvasLoadError + '). No files were produced — do not report sizes as delivered.');
        const rel = String((args && args.svg) || '').trim();
        if (!rel) throw new Error('svg is required (a workspace-relative path to an .svg file)');

        const { abs } = await jail.resolveInside(aid, rel);
        let svgText;
        try { svgText = await fsp.readFile(abs, 'utf8'); }
        catch (e) { throw new Error(e && e.code === 'ENOENT' ? 'no such file in workspace: ' + rel : 'could not read ' + rel + ': ' + ((e && e.message) || e)); }
        if (!/<svg\b/i.test(svgText)) throw new Error(rel + ' does not contain an <svg> element — vector_export only accepts SVG source');

        let sizes = Array.isArray(args && args.sizes) && args.sizes.length ? args.sizes.map(String) : DEFAULT_SIZES;
        const unknown = sizes.filter(s => !SIZE_PRESETS[s]);
        if (unknown.length) throw new Error('unknown size(s): ' + unknown.join(', ') + '. Available: ' + Object.keys(SIZE_PRESETS).join(', '));
        let formats = Array.isArray(args && args.formats) && args.formats.length ? args.formats.map(s => String(s).toLowerCase()) : ['png', 'pdf'];
        const badFmt = formats.filter(f => f !== 'png' && f !== 'pdf');
        if (badFmt.length) throw new Error('unknown format(s): ' + badFmt.join(', ') + '. Available: png, pdf');

        const baseName = P.basename(rel).replace(/\.svg$/i, '');
        const dir = String((args && args.destDir) || P.dirname(rel)).replace(/^\.$|\/+$/g, '');
        const written = [];

        for (const key of sizes) {
          const preset = SIZE_PRESETS[key];
          if (preset.w * preset.h > MAX_PIXELS) throw new Error(key + ' exceeds the ' + (MAX_PIXELS / 1e6) + 'MP ceiling');
          const { canvas, ctx: g, intrinsic } = await rasterise(svgText, preset.w, preset.h);

          if (formats.includes('png')) {
            const raw = canvas.toBuffer('image/png');
            const withDpi = prep.injectPhys(raw, prep.PIXELS_PER_METER);
            const check = prep.readPhys(withDpi);
            if (!check || check.x !== prep.PIXELS_PER_METER || check.unit !== 1) {
              throw new Error(key + ': pHYs metadata missing or wrong after writing — refusing to publish a file without verified 300 PPI metadata');
            }
            const outRel = (dir ? dir + '/' : '') + baseName + '-' + key + '-300ppi.png';
            const { abs: outAbs } = await jail.resolveInside(aid, outRel);
            await writeFileAtomic(outAbs, withDpi);
            written.push({ rel: outRel, bytes: withDpi.length, note: preset.w + 'x' + preset.h + 'px, 300 PPI (pHYs verified)' });
          }

          if (formats.includes('pdf')) {
            const rgba = g.getImageData(0, 0, preset.w, preset.h).data;
            const pdf = buildPdf(flattenToRgb(rgba, preset.w, preset.h), preset.w, preset.h,
              preset.w / PPI, preset.h / PPI, baseName + ' ' + preset.label);
            const outRel = (dir ? dir + '/' : '') + baseName + '-' + key + '.pdf';
            const { abs: outAbs } = await jail.resolveInside(aid, outRel);
            await writeFileAtomic(outAbs, pdf);
            written.push({ rel: outRel, bytes: pdf.length, note: preset.label + ' page at 300 PPI (' + preset.w + 'x' + preset.h + 'px image)' });
          }

          if (ctx && typeof ctx.emit === 'function') {
            ctx.emit('deliverable', { id: 'vec_' + (baseName + '-' + key).replace(/[^A-Za-z0-9_.-]/g, '_'), agentId: aid, kind: 'image', title: baseName + ' ' + preset.label });
          }
          written.intrinsic = intrinsic;
        }

        const lines = written.map(w => '  ' + w.rel + '  (' + (w.bytes / 1024).toFixed(0) + ' KB) — ' + w.note +
          '\n    view: /api/file?agent=' + encodeURIComponent(aid) + '&path=' + encodeURIComponent(w.rel));
        return {
          content: 'Exported ' + rel + ' to ' + written.length + ' file' + (written.length === 1 ? '' : 's') +
            ' (re-rasterised from vector at each target size, not upscaled):\n' + lines.join('\n'),
          summary: 'vector_export → ' + written.length + ' files',
          // Lets sidecar/artifacts.js's observe() record these into run.artifacts (its tool-name allowlist has no
          // entry for vector_export) so the Deliverables panel's file list is never empty for real output.
          producedFiles: written.map(w => ({ path: w.rel, bytes: w.bytes }))
        };
      }
    };

    return {
      exportTool,
      register(reg) { reg.register(exportTool); return reg; },
      _internals: { retargetSvg, buildPdf, flattenToRgb, rasterise, SIZE_PRESETS, DEFAULT_SIZES, PPI, POINTS_PER_INCH }
    };
  }

  return { makeVectorExportTools, retargetSvg, buildPdf, flattenToRgb };
});

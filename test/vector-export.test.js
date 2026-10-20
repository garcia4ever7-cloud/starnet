/* node test/vector-export.test.js — the STUDIO export skill: vector_export. Offline + deterministic.

   The load-bearing test here is the SHARPNESS one. @napi-rs/canvas rasterises an SVG at its DECLARED
   width/height and bilinearly upscales from there, so drawing a small SVG onto a big canvas yields a
   blur that carries perfectly correct 300-PPI metadata — a file that lies about itself in exactly the
   way image_quality_check was built to catch. If someone later "simplifies" retargetSvg away, every
   other assertion in this file still passes and only the edge-sharpness check fails. Keep it.

   Also verifies the hand-written PDF: the sidecar has no runtime npm dependencies (CONTRIBUTING.md),
   so the PDF is assembled byte by byte and its xref offsets must be real byte positions. */
'use strict';
const A = require('./_assert.js');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { makeVectorExportTools, retargetSvg, buildPdf, flattenToRgb } = require('../sidecar/tools/builtin/vector-export.js');
const { makeImageQcTools } = require('../sidecar/tools/builtin/image-qc.js');

const ROOT = path.join(os.tmpdir(), 'starnet-vector-export-test-' + process.pid);
const AID = 'webdesigner';
function ctx() { return { agentId: AID }; }

let canvasLib;
try { canvasLib = require('@napi-rs/canvas'); } catch (_) { canvasLib = null; }

const SMALL_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10">' +
  '<rect width="10" height="10" fill="#ffffff"/><circle cx="5" cy="5" r="4" fill="#000000"/></svg>';

(async () => {
  try { await fsp.rm(ROOT, { recursive: true, force: true }); } catch (_) {}
  await fsp.mkdir(path.join(ROOT, AID, 'art'), { recursive: true });
  await fsp.writeFile(path.join(ROOT, AID, 'art', 'mark.svg'), SMALL_SVG);

  // ---- A. retargetSvg (pure) ----
  {
    const out = retargetSvg(SMALL_SVG, 2400, 3000);
    A.ok(/width="2400"/.test(out) && /height="3000"/.test(out), 'the root <svg> is resized to the target pixels');
    A.ok(/viewBox="0 0 10 10"/.test(out), 'the original viewBox is preserved so geometry still scales');
    // scoped to the ROOT tag — the inner <rect width="10"> legitimately keeps its own dimensions
    A.ok(!/width="10"/.test(out.match(/<svg\b[^>]*>/i)[0]), 'the old root width attribute is gone, not duplicated');
  }
  {
    const noViewBox = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20"/></svg>';
    const out = retargetSvg(noViewBox, 800, 400);
    A.ok(/viewBox="0 0 40 20"/.test(out), 'a missing viewBox is synthesised from the original width/height');
  }
  A.throws(() => retargetSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>', 100, 100),
    'an SVG with neither viewBox nor numeric dimensions is rejected rather than guessed at');
  A.throws(() => retargetSvg('not markup at all', 100, 100), 'a non-SVG input is rejected');

  // ---- B. THE anti-blur regression (see header) ----
  if (canvasLib) {
    const N = 600;
    const measure = async (svgText) => {
      const img = await new Promise((res, rej) => { const i = new canvasLib.Image(); i.onload = () => res(i); i.onerror = rej; i.src = Buffer.from(svgText, 'utf8'); });
      const cv = canvasLib.createCanvas(N, N), g = cv.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, N, N);
      g.drawImage(img, 0, 0, N, N);
      const d = g.getImageData(0, N / 2, N, 1).data;
      let partial = 0;
      for (let x = 0; x < N; x++) { const v = d[x * 4]; if (v > 8 && v < 247) partial++; }
      return partial;
    };
    const naive = await measure(SMALL_SVG);                       // what a drawImage-only implementation produces
    const fixed = await measure(retargetSvg(SMALL_SVG, N, N));    // what this tool actually does
    A.ok(naive > 40, 'sanity: drawing the un-retargeted SVG really does blur (' + naive + ' partial-grey px) — if this ever drops, the upscale behaviour changed and the fix may be moot');
    A.ok(fixed < 10, 'retargeting yields a genuinely sharp vector render (' + fixed + ' partial-grey px, was ' + naive + ')');
  }

  // ---- C. the hand-written PDF ----
  {
    const w = 4, h = 3;
    const rgb = Buffer.alloc(w * h * 3, 0x80);
    const pdf = buildPdf(rgb, w, h, 2, 1.5, 'Test (title) \\ with specials');
    const s = pdf.toString('latin1');
    A.ok(s.startsWith('%PDF-1.4'), 'PDF header');
    A.ok(s.trimEnd().endsWith('%%EOF'), 'PDF trailer');
    A.ok(/\/MediaBox \[0 0 144 108\]/.test(s), '2 x 1.5 inches becomes a 144 x 108 point MediaBox');
    A.ok(/\/Width 4 \/Height 3/.test(s), 'the image XObject carries real pixel dimensions');
    A.ok(/\/Filter \/FlateDecode/.test(s), 'image data is Flate-compressed');

    // xref offsets must be true byte positions — walk them and confirm each lands on "<n> 0 obj".
    const startxref = parseInt(s.slice(s.lastIndexOf('startxref') + 9).trim(), 10);
    A.ok(s.slice(startxref, startxref + 4) === 'xref', 'startxref points at the real xref table');
    const rows = s.slice(startxref).split('\n').filter(l => /^\d{10} \d{5} n/.test(l));
    A.eq(rows.length, 6, 'six objects are indexed');
    rows.forEach((row, i) => {
      const off = parseInt(row.slice(0, 10), 10);
      A.ok(s.slice(off).startsWith((i + 1) + ' 0 obj'), 'xref entry ' + (i + 1) + ' points at the real object header');
    });
    A.throws(() => buildPdf(Buffer.alloc(5), 4, 3, 2, 1.5, 'x'), 'a mis-sized pixel buffer is rejected rather than written as a corrupt PDF');
  }

  // ---- D. alpha flattening ----
  {
    const rgba = Buffer.from([0, 0, 0, 0, 0, 0, 0, 255]);   // fully transparent black, then opaque black
    const rgb = flattenToRgb(rgba, 2, 1);
    A.eq(rgb[0], 255, 'a transparent pixel flattens to white (these files go on paper)');
    A.eq(rgb[3], 0, 'an opaque black pixel stays black');
  }

  if (!canvasLib) {
    console.log('vector-export.test: @napi-rs/canvas unavailable — pure-logic checks only');
    A.report('vector-export.test');
    return;
  }

  // ---- E. end to end ----
  const { exportTool, _internals } = makeVectorExportTools({ fsp, pathMod: path, root: ROOT });
  A.eq(exportTool.name, 'vector_export', 'tool name');
  A.eq(exportTool.capability, 'studio', 'granted by the studio object');
  A.eq(exportTool.scope, 'write', 'write scope');
  A.eq(exportTool.requiresConsent, true, 'consent-gated — it publishes files');
  A.eq(exportTool.network, false, 'declared local: no network, no provider credential, no cost');

  {
    const r = await exportTool.run({ svg: 'art/mark.svg', sizes: ['8x10'], formats: ['png', 'pdf'] }, ctx());
    A.ok(/mark-8x10-300ppi\.png/.test(r.content), 'the PNG is named with its size and PPI: ' + r.content.slice(0, 200));
    A.ok(/mark-8x10\.pdf/.test(r.content), 'the PDF is produced too');

    // The PNG must survive the station's own independent QC at the claimed size and DPI.
    const { qcTool } = makeImageQcTools({ fsp, pathMod: path, root: ROOT });
    const qc = await qcTool.run({ images: [{ path: 'art/mark-8x10-300ppi.png', claimedWidth: 2400, claimedHeight: 3000, targetInchesWidth: 8, targetInchesHeight: 10 }] }, ctx());
    A.ok(/PASS/.test(qc.content) && !/FAIL/.test(qc.content), 'the exported PNG passes independent image_quality_check: ' + qc.content.slice(0, 300));
    A.ok(/300 DPI \(from file metadata\)/.test(qc.content), 'QC reads a real 300 DPI out of the file itself, not from the filename');

    const pdfBuf = await fsp.readFile(path.join(ROOT, AID, 'art', 'mark-8x10.pdf'));
    A.ok(pdfBuf.slice(0, 8).toString('latin1') === '%PDF-1.4', 'the written PDF really is a PDF');
    A.ok(/\/MediaBox \[0 0 576 720\]/.test(pdfBuf.toString('latin1')), '8x10in becomes a 576 x 720 point page');
  }

  // ---- F. honest errors ----
  {
    let m = '';
    try { await exportTool.run({ svg: 'art/nope.svg' }, ctx()); } catch (e) { m = e.message; }
    A.ok(/no such file/.test(m), 'a missing source file errors clearly: ' + m);
  }
  {
    let m = '';
    try { await exportTool.run({ svg: 'art/mark.svg', sizes: ['A4'] }, ctx()); } catch (e) { m = e.message; }
    A.ok(/unknown size/.test(m) && /8x10/.test(m), 'an unknown size names the available ones: ' + m);
  }
  {
    await fsp.writeFile(path.join(ROOT, AID, 'art', 'notsvg.svg'), 'just text');
    let m = '';
    try { await exportTool.run({ svg: 'art/notsvg.svg' }, ctx()); } catch (e) { m = e.message; }
    A.ok(/does not contain an <svg>/.test(m), 'a file that is not really SVG is refused: ' + m);
  }
  {
    let m = '';
    try { await exportTool.run({ svg: '../../../etc/passwd' }, ctx()); } catch (e) { m = e.message; }
    A.ok(m && !/root:/.test(m), 'a jail escape is refused: ' + m);
  }

  A.ok(typeof _internals.retargetSvg === 'function', 'retargetSvg is exposed for independent testing');

  try { await fsp.rm(ROOT, { recursive: true, force: true }); } catch (_) {}
  console.log('vector-export.test: all checks passed');
  A.report('vector-export.test');
})().catch(e => { console.error(e); process.exitCode = 1; });

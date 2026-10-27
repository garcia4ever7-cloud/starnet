/* sidecar/tools/builtin/mockup-compose.js — STUDIO capability: mockup_compose(kit_dir, print_file, ...)

   Produces the full etsy-rules §5 listing-photo set from an ALREADY-FINISHED print file and a
   pre-made room template, with ZERO network calls and ZERO per-use cost: a hero wall mockup, the
   print alone, a "5 sizes included" chart, a lettering close-up, and a "what you get" graphic.

   WHY @napi-rs/canvas AND NOT sharp: same reason as print-prep.js — `sharp` has no android-arm64
   binding on this station; @napi-rs/canvas is the proven, already-installed, working library.

   HOW THE HERO MOCKUP STAYS HONEST ("no AI repainting of the art"): a room template is a ONE-TIME,
   pre-made photo (made by image_generate, calibrated once by a human/Claude Code, never regenerated
   per use) with a blank rectangle where the frame goes, plus its 3 pixel corners (top-left,
   top-right, bottom-left) saved alongside it. At compose time this tool computes a 3-point AFFINE
   transform (no neural network, no re-generation) that maps the print file's own 4 corners onto
   those 3 calibrated points, then `drawImage`s the print file through that transform — the art
   pixels are never sent to a model again, only geometrically placed. The room template's OWN
   painted shadow/glass-glare (rendered once, by the model, around the blank rectangle) stays
   visible after compositing, which is what gives the result a natural look without any runtime
   shadow synthesis. A 3-point affine (not a true 4-point projective warp) is an approximation —
   accurate for the GENTLE camera angles room templates are deliberately generated with; see
   webdesigner/outbox/mockup-templates/*.json's "ratio" field, which the print file's own ratio must match
   (refused, not silently distorted, on a mismatch).

   makeMockupComposeTools({ fsp, pathMod, root })
     -> { composeTool, register(reg), _internals }
*/
'use strict';
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./fs.js'));
  else { root.SK = root.SK || {}; root.SK.tools = root.SK.tools || {}; (root.SK.tools.builtin = root.SK.tools.builtin || {}).mockupCompose = factory(root.SK.tools.builtin.fs); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (fsMod) {
  'use strict';

  // Etsy listing-photo spec (etsy-rules §5): square or 4:3, >=2000px shortest side, under ~1 MB.
  const OUTPUT_SIZES = { square: { w: 2000, h: 2000 }, '4x3': { w: 2700, h: 2025 } };
  const MAX_PHOTO_BYTES = 1024 * 1024;   // ~1 MB budget per listing photo
  const JPEG_QUALITY_START = 85, JPEG_QUALITY_FLOOR = 55, JPEG_QUALITY_STEP = 6;

  // The standard 5-ratio print kit, verbatim from etsy-rules §4 — never re-derive this table, it is
  // the one place it is allowed to drift from the rule doc, so it is copied here ONCE and commented.
  const RATIO_TABLE = [
    { ratio: '2:3', prints: '4x6, 8x12, 12x18, 16x24, 20x30, 24x36 in' },
    { ratio: '3:4', prints: '6x8, 9x12, 12x16, 18x24 in' },
    { ratio: '4:5', prints: '8x10, 16x20, 24x30 in' },
    { ratio: '11:14', prints: '11x14, 22x28 in' },
    { ratio: 'ISO (A-series)', prints: 'A5, A4, A3, A2, A1' }
  ];

  const FONT_DIR = '/data/data/com.termux/files/home/fonts/';
  const FONTS = {
    script: { path: FONT_DIR + 'GreatVibes-Regular.ttf-var.ttf', family: 'MockupScript' },
    sans: { path: FONT_DIR + 'Montserrat-var.ttf', family: 'MockupSans' }
  };
  const BROWN = '#3a261c';
  const CREAM = '#fcf7ee';

  function makeMockupComposeTools(deps) {
    deps = deps || {};
    const fsp = deps.fsp, P = deps.pathMod, ROOT = deps.root;
    if (!fsp || !P || !ROOT) throw new Error('mockup-compose.js requires { fsp, pathMod, root }');
    let canvasLib = null, canvasLoadError = '';
    try { canvasLib = require('@napi-rs/canvas'); } catch (e) { canvasLoadError = (e && e.message) || String(e); }
    let fontsRegistered = false;
    function ensureFonts() {
      if (fontsRegistered || !canvasLib) return;
      try {
        canvasLib.GlobalFonts.registerFromPath(FONTS.script.path, FONTS.script.family);
        canvasLib.GlobalFonts.registerFromPath(FONTS.sans.path, FONTS.sans.family);
      } catch (e) { require('../../failopen.js').note('mockup-compose.font-register', e); /* fonts stay unregistered; canvas falls back to a default sans — still legible */ }
      fontsRegistered = true;
    }
    const jail = fsMod.makeFsTools({ fsp, pathMod: P, root: ROOT })._internals;
    let seq = 0;

    function emitDeliverable(ctx, aid, rel) {
      if (!ctx || typeof ctx.emit !== 'function') return;
      const d = { id: 'img_' + String(rel).replace(/[^A-Za-z0-9_.-]/g, '_'), agentId: aid, kind: 'image', title: String(rel) };
      if (ctx.room) d.room = ctx.room;
      ctx.emit('deliverable', d);
    }

    function loadImage(buf) {
      return new Promise((resolve, reject) => {
        const img = new canvasLib.Image();
        img.onload = () => resolve(img);
        img.onerror = (e) => reject(new Error('could not decode image: ' + ((e && e.message) || e)));
        img.src = buf;
      });
    }

    async function readJail(aid, rel, what) {
      const { abs } = await jail.resolveInside(aid, rel);
      try { return await fsp.readFile(abs); }
      catch (e) { if (e && e.code === 'ENOENT') throw new Error('no such ' + (what || 'file') + ' in workspace: ' + rel); throw e; }
    }

    async function writeJailed(aid, rel, buf, ctx) {
      const { abs } = await jail.resolveInside(aid, rel);
      await fsp.mkdir(P.dirname(abs), { recursive: true });
      const staging = abs + '.pending-' + process.pid + '-' + (++seq);
      try {
        await fsp.writeFile(staging, buf, { flag: 'wx' });
        require('node:fs').renameSync(staging, abs);
        emitDeliverable(ctx, aid, rel);
      } finally {
        await fsp.unlink(staging).catch(e => { if (!e || e.code !== 'ENOENT') require('../../failopen.js').note('mockup-compose.staging-cleanup', e); });
      }
    }

    // Encode a canvas to JPEG under MAX_PHOTO_BYTES, stepping quality down until it fits (never
    // silently shrinking PIXELS to hit the budget — only quality, so the committed WxH is exact).
    async function encodeJpegUnderBudget(canvas) {
      let q = JPEG_QUALITY_START, buf = await canvas.encode('jpeg', q);
      while (buf.length > MAX_PHOTO_BYTES && q > JPEG_QUALITY_FLOOR) {
        q -= JPEG_QUALITY_STEP;
        buf = await canvas.encode('jpeg', q);
      }
      return { buf, quality: q, underBudget: buf.length <= MAX_PHOTO_BYTES };
    }

    // greedy word-wrap: splits `text` into lines that each fit `maxWidth` under ctx's CURRENT font.
    // A single word longer than maxWidth is placed on its own line rather than cut off — this is
    // prose on a plain background, there is no excuse for a line running off the edge of the canvas.
    function wrapLines(cctx, text, maxWidth) {
      const words = String(text).split(/\s+/).filter(Boolean);
      const lines = [];
      let cur = '';
      for (const w of words) {
        const trial = cur ? cur + ' ' + w : w;
        if (cctx.measureText(trial).width <= maxWidth || !cur) { cur = trial; }
        else { lines.push(cur); cur = w; }
      }
      if (cur) lines.push(cur);
      return lines;
    }

    // cover-fit drawImage: scale `image` to fully cover a w x h canvas region (centered crop on the
    // overhanging axis), never letterboxing — used for the clean "print alone" background fill and
    // the lettering close-up zoom, where a plain border reads as a mistake, not a design choice.
    function drawCover(cctx, image, dx, dy, w, h) {
      const srcRatio = image.width / image.height, dstRatio = w / h;
      let sx, sy, sw, sh;
      if (srcRatio > dstRatio) { sh = image.height; sw = sh * dstRatio; sy = 0; sx = (image.width - sw) / 2; }
      else { sw = image.width; sh = sw / dstRatio; sx = 0; sy = (image.height - sh) / 2; }
      cctx.drawImage(image, sx, sy, sw, sh, dx, dy, w, h);
    }

    // ---------------- 1. hero wall mockup ----------------
    async function renderHero(printImage, template, size) {
      const room = await loadImage(template.roomBuf);
      const canvas = canvasLib.createCanvas(size.w, size.h);
      const cctx = canvas.getContext('2d');
      cctx.imageSmoothingEnabled = true;
      if ('imageSmoothingQuality' in cctx) cctx.imageSmoothingQuality = 'high';
      drawCover(cctx, room, 0, 0, size.w, size.h);   // fill the output frame with the room photo first
      // the room photo was authored at its own native size; corners are stored in THAT native pixel
      // space, so map the room image onto the output canvas via the SAME cover-fit scale/offset
      // drawCover just used, then place the art in that same coordinate space.
      const srcRatio = room.width / room.height, dstRatio = size.w / size.h;
      let scale, offX, offY;
      if (srcRatio > dstRatio) { scale = size.h / room.height; offX = (size.w - room.width * scale) / 2; offY = 0; }
      else { scale = size.w / room.width; offX = 0; offY = (size.h - room.height * scale) / 2; }
      const toCanvas = (pt) => [pt[0] * scale + offX, pt[1] * scale + offY];
      const [tl, tr, bl] = [toCanvas(template.topLeft), toCanvas(template.topRight), toCanvas(template.bottomLeft)];
      const w = printImage.width, h = printImage.height;
      const a = (tr[0] - tl[0]) / w, b = (tr[1] - tl[1]) / w;
      const c = (bl[0] - tl[0]) / h, d = (bl[1] - tl[1]) / h;
      cctx.save();
      cctx.transform(a, b, c, d, tl[0], tl[1]);
      cctx.drawImage(printImage, 0, 0);
      cctx.restore();
      return canvas;
    }

    // ---------------- 2. print alone, clean ----------------
    function renderPrintAlone(printImage, size) {
      const canvas = canvasLib.createCanvas(size.w, size.h);
      const cctx = canvas.getContext('2d');
      cctx.fillStyle = CREAM; cctx.fillRect(0, 0, size.w, size.h);
      const margin = Math.round(Math.min(size.w, size.h) * 0.08);
      const availW = size.w - margin * 2, availH = size.h - margin * 2;
      const scale = Math.min(availW / printImage.width, availH / printImage.height);
      const dw = Math.round(printImage.width * scale), dh = Math.round(printImage.height * scale);
      const dx = Math.round((size.w - dw) / 2), dy = Math.round((size.h - dh) / 2);
      cctx.imageSmoothingEnabled = true;
      if ('imageSmoothingQuality' in cctx) cctx.imageSmoothingQuality = 'high';
      // a soft drop shadow so the print reads as a physical object on the cream field, not a sticker
      cctx.save();
      cctx.shadowColor = 'rgba(58,38,28,0.18)'; cctx.shadowBlur = margin * 0.3; cctx.shadowOffsetY = margin * 0.08;
      cctx.drawImage(printImage, dx, dy, dw, dh);
      cctx.restore();
      return canvas;
    }

    // ---------------- 3. "5 sizes included" chart ----------------
    function renderSizesChart(productName, size) {
      ensureFonts();
      const canvas = canvasLib.createCanvas(size.w, size.h);
      const cctx = canvas.getContext('2d');
      cctx.fillStyle = CREAM; cctx.fillRect(0, 0, size.w, size.h);
      const pad = Math.round(size.w * 0.08);
      let y = pad + Math.round(size.h * 0.05);
      cctx.fillStyle = BROWN;
      cctx.font = Math.round(size.h * 0.045) + 'px ' + FONTS.sans.family;
      cctx.fillText('5 SIZES INCLUDED', pad, y);
      y += Math.round(size.h * 0.03);
      cctx.font = Math.round(size.h * 0.028) + 'px ' + FONTS.sans.family;
      cctx.fillStyle = 'rgba(58,38,28,0.75)';
      cctx.fillText(productName, pad, y);
      y += Math.round(size.h * 0.08);
      const rowH = (size.h - y - pad) / RATIO_TABLE.length;
      for (const row of RATIO_TABLE) {
        cctx.fillStyle = BROWN;
        cctx.font = 'bold ' + Math.round(size.h * 0.032) + 'px ' + FONTS.sans.family;
        cctx.fillText(row.ratio, pad, y);
        cctx.fillStyle = 'rgba(58,38,28,0.78)';
        cctx.font = Math.round(size.h * 0.026) + 'px ' + FONTS.sans.family;
        cctx.fillText(row.prints, pad, y + Math.round(size.h * 0.034));
        cctx.strokeStyle = 'rgba(58,38,28,0.15)'; cctx.lineWidth = 1;
        cctx.beginPath(); cctx.moveTo(pad, y + rowH * 0.62); cctx.lineTo(size.w - pad, y + rowH * 0.62); cctx.stroke();
        y += rowH;
      }
      return canvas;
    }

    // ---------------- 4. lettering close-up ----------------
    // crops the bottom band where letter_kjv.py paints its scrim+text, then shows the FULL WIDTH of
    // that band (CONTAIN-fit, never cropped on the sides) — a deterministic crop+scale of the REAL
    // lettered pixels, no re-rendering of the text. A cover-fit square crop was tried first and cut
    // whole words off the ends of long lines (e.g. "strength" truncated to "st") — contain-fit trades
    // a little empty margin for NEVER losing part of a word, which matters far more for a listing photo.
    function renderLetteringCloseup(printImage, size) {
      const bandFrac = 0.26;   // bottom ~26% of the print — comfortably covers the scrim block on every kit so far
      const bandH = Math.round(printImage.height * bandFrac);
      const bandY = printImage.height - bandH;
      const bandW = printImage.width;
      const canvas = canvasLib.createCanvas(size.w, size.h);
      const cctx = canvas.getContext('2d');
      cctx.fillStyle = CREAM; cctx.fillRect(0, 0, size.w, size.h);
      cctx.imageSmoothingEnabled = true;
      if ('imageSmoothingQuality' in cctx) cctx.imageSmoothingQuality = 'high';
      const scale = Math.min(size.w / bandW, size.h / bandH);
      const dw = Math.round(bandW * scale), dh = Math.round(bandH * scale);
      const dx = Math.round((size.w - dw) / 2), dy = Math.round((size.h - dh) / 2);
      cctx.drawImage(printImage, 0, bandY, bandW, bandH, dx, dy, dw, dh);
      return canvas;
    }

    // ---------------- 5. "what you get" graphic ----------------
    function renderWhatYouGet(productName, size) {
      ensureFonts();
      const canvas = canvasLib.createCanvas(size.w, size.h);
      const cctx = canvas.getContext('2d');
      cctx.fillStyle = CREAM; cctx.fillRect(0, 0, size.w, size.h);
      const pad = Math.round(size.w * 0.09);
      let y = pad + Math.round(size.h * 0.06);
      cctx.fillStyle = BROWN;
      cctx.font = Math.round(size.h * 0.042) + 'px ' + FONTS.sans.family;
      cctx.fillText('INSTANT DIGITAL DOWNLOAD', pad, y);
      y += Math.round(size.h * 0.045);
      cctx.font = Math.round(size.h * 0.026) + 'px ' + FONTS.sans.family;
      cctx.fillStyle = 'rgba(58,38,28,0.75)';
      cctx.fillText(productName + ' — what you get', pad, y);
      y += Math.round(size.h * 0.08);
      const lines = [
        '5 print files, one per aspect ratio — fits 20+ frame sizes',
        '300 DPI, print-ready at home, a local print shop, or an online printer',
        'No physical item ships — frame not included',
        'Download from a web browser (etsy.com -> Purchases)',
        'Personal use only — not for resale or commercial use'
      ];
      const fontSize = Math.round(size.h * 0.03);
      cctx.font = fontSize + 'px ' + FONTS.sans.family;
      const textX = pad + Math.round(size.w * 0.05);
      const maxTextWidth = size.w - pad - textX;
      const wrapped = lines.map(line => wrapLines(cctx, line, maxTextWidth));
      const totalRows = wrapped.reduce((n, ls) => n + ls.length, 0);
      const rowH = (size.h - y - pad) / totalRows;
      const markerR = Math.round(fontSize * 0.14);
      for (const ls of wrapped) {
        // a drawn filled circle, not a Unicode glyph — a checkmark/bullet character can render as a
        // missing-glyph tofu box depending on what the registered font actually contains (caught live:
        // '✓' rendered as a blank box here). A simple shape always renders, on every font, every time.
        cctx.fillStyle = BROWN;
        cctx.beginPath(); cctx.arc(pad + markerR, y - fontSize * 0.32, markerR, 0, Math.PI * 2); cctx.fill();
        cctx.fillStyle = 'rgba(58,38,28,0.85)';
        for (const row of ls) { cctx.fillText(row, textX, y); y += rowH; }
      }
      return canvas;
    }

    async function loadTemplate(aid, name) {
      const dir = 'outbox/mockup-templates';   // under outbox like every other agent-made image (etsy-rules §1)
      let names;
      try { names = (await fsp.readdir((await jail.resolveInside(aid, dir)).abs)).filter(f => f.endsWith('.json')); }
      catch (e) { throw new Error('no mockup-templates found in this workspace (' + dir + '/) — generate at least one room template first'); }
      if (!names.length) throw new Error('no mockup-templates found in this workspace (' + dir + '/) — generate at least one room template first');
      let file = name ? name.replace(/\.json$/, '') + '.json' : names[0];
      if (!names.includes(file)) throw new Error('no such mockup template "' + (name || '') + '" — available: ' + names.map(n => n.replace(/\.json$/, '')).join(', '));
      const metaBuf = await readJail(aid, dir + '/' + file, 'mockup template');
      let meta;
      try { meta = JSON.parse(metaBuf.toString('utf8')); } catch (e) { throw new Error('mockup template ' + file + ' is not valid JSON'); }
      for (const k of ['room', 'ratio', 'topLeft', 'topRight', 'bottomLeft']) {
        if (!(k in meta)) throw new Error('mockup template ' + file + ' is missing required field "' + k + '"');
      }
      const roomBuf = await readJail(aid, dir + '/' + meta.room, 'template room image');
      return { name: file.replace(/\.json$/, ''), ratio: meta.ratio, topLeft: meta.topLeft, topRight: meta.topRight, bottomLeft: meta.bottomLeft, roomBuf };
    }

    const composeTool = {
      name: 'mockup_compose', capability: 'studio', scope: 'write', requiresConsent: true, timeoutMs: 60000,
      description: 'Make the full Etsy listing-photo set (etsy-rules §5) from a FINISHED print file: a hero ' +
        'wall mockup, the print alone, a "5 sizes included" chart, a lettering close-up, and a "what you get" ' +
        'graphic. Pastes the real print pixels into a pre-made room template with NO re-generation of the art ' +
        'and NO network call — free to call as many times as needed. Required "print_file": a workspace-relative ' +
        'path to one ratio file from the finished kit (its aspect must match the chosen template\'s "ratio" — ' +
        'use the 4:5 file unless told otherwise). Required "product_name": e.g. "Isaiah 40:31 — Renew Your ' +
        'Strength". Optional "template": an outbox/mockup-templates/ name (default: the only/first one available). ' +
        'Optional "out_dir" (default: alongside print_file, in a "listing-photos" subfolder). Optional "shape": ' +
        '"square" (2000x2000, default) or "4x3" (2700x2025).',
      schema: { type: 'object', required: ['print_file', 'product_name'], properties: {
        print_file: { type: 'string' },
        product_name: { type: 'string' },
        template: { type: 'string' },
        out_dir: { type: 'string' },
        shape: { type: 'string', enum: ['square', '4x3'] }
      } },
      run: async (args, ctx) => {
        if (!canvasLib) throw new Error('mockup_compose is unavailable on this station: @napi-rs/canvas failed to load (' + canvasLoadError + '). No files were produced.');
        const aid = (ctx && ctx.agentId) || 'agent';
        const printFile = String((args && args.print_file) || '').trim();
        if (!printFile) throw new Error('print_file is required (a workspace-relative path to a finished ratio print)');
        const productName = String((args && args.product_name) || '').trim();
        if (!productName) throw new Error('product_name is required (used in the sizes chart and the what-you-get graphic)');
        const size = OUTPUT_SIZES[(args && args.shape) || 'square'];
        if (!size) throw new Error('shape must be "square" or "4x3"');

        const printBuf = await readJail(aid, printFile, 'print file');
        const printImage = await loadImage(printBuf);
        const template = await loadTemplate(aid, args && args.template);

        // refuse to distort: the frame opening's ACTUAL ratio (computed from the 3 calibrated corners
        // themselves, not a separately hand-typed "ratio" label) must match the print file's own ratio,
        // never silently shear the real art to fit a mismatched frame. Computing it from the corners —
        // rather than trusting a human-typed label — removes a whole class of calibration error: an
        // AI-generated frame's true opening ratio rarely lands exactly on a named ratio (2:3, 4:5, ...),
        // so the label is kept only as an informational hint, never the source of truth for this check.
        // 4% tolerance (not 2%): room-template corners are hand-calibrated from a generated photo, not
        // measured off a real frame, so a few pixels of normal estimation noise must not cause a refusal.
        const frameW = template.topRight[0] - template.topLeft[0], frameH = template.bottomLeft[1] - template.topLeft[1];
        if (frameW > 0 && frameH > 0) {
          const wantRatio = frameW / frameH, gotRatio = printImage.width / printImage.height;
          if (Math.abs(wantRatio - gotRatio) / wantRatio > 0.04) {
            throw new Error('print_file aspect (' + printImage.width + 'x' + printImage.height + ', ratio ' + gotRatio.toFixed(3) + ') does not match ' +
              'template "' + template.name + '"\'s calibrated frame opening (ratio ' + wantRatio.toFixed(3) + ', labeled "' + template.ratio + '") — pick a closer-matching ratio file, no distortion applied.');
          }
        }

        const base = P.basename(printFile, P.extname(printFile));
        const dir = (args && args.out_dir) ? String(args.out_dir) : (P.dirname(printFile) + '/listing-photos');
        const outputs = [
          { key: 'hero-mockup', canvas: await renderHero(printImage, template, size) },
          { key: 'print-alone', canvas: renderPrintAlone(printImage, size) },
          { key: 'sizes-chart', canvas: renderSizesChart(productName, size) },
          { key: 'lettering-closeup', canvas: renderLetteringCloseup(printImage, size) },
          { key: 'what-you-get', canvas: renderWhatYouGet(productName, size) }
        ];

        const results = [];
        for (const o of outputs) {
          const { buf, quality, underBudget } = await encodeJpegUnderBudget(o.canvas);
          const rel = dir + '/' + base + '-' + o.key + '.jpg';
          await writeJailed(aid, rel, buf, ctx);
          results.push({ key: o.key, path: rel, bytes: buf.length, quality, underBudget, width: size.w, height: size.h });
        }

        const lines = results.map(r => r.key + ' -> ' + r.path + ' (' + r.width + 'x' + r.height + ', ' +
          (r.bytes / 1024).toFixed(0) + ' KB' + (r.underBudget ? '' : ', OVER the ~1MB budget even at floor quality — reduce shape or revisit') + ')');
        return {
          content: 'mockup_compose from ' + printFile + ' + template "' + template.name + '":\n' + lines.join('\n'),
          summary: 'mockup_compose -> ' + results.length + ' listing photo(s) for ' + productName,
          // Lets sidecar/artifacts.js's observe() record these into run.artifacts (its tool-name allowlist has no
          // entry for mockup_compose) so the Deliverables panel's file list is never empty for real output.
          producedFiles: results.map(r => ({ path: r.path, bytes: r.bytes }))
        };
      }
    };

    return {
      composeTool,
      register(reg) { reg.register(composeTool); return reg; },
      _internals: { RATIO_TABLE, OUTPUT_SIZES, MAX_PHOTO_BYTES, drawCover, renderHero, renderPrintAlone, renderSizesChart, renderLetteringCloseup, renderWhatYouGet, loadTemplate, encodeJpegUnderBudget }
    };
  }

  return { makeMockupComposeTools };
});

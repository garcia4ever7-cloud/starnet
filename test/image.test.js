/* node test/image.test.js — the STUDIO skills: image_generate + image_analyze. Offline + deterministic
   (fetch injected, real temp workspace). Pairs with sidecar/tools/builtin/image.js. Verifies: the OpenRouter
   request shape (modalities for gen; text-then-image_url parts for analyze), base64 data-URL decode + jailed
   save, content-addressed default naming, a 'deliverable' emit, workspace-path read for analysis, jail escape
   refusal, and a clean error when no API key is set. */
'use strict';
const A = require('./_assert.js');
const fsp = require('node:fs/promises');
const fssync = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { makeImageTools } = require('../sidecar/tools/builtin/image.js');

// Per-process root. The name used to be fixed, and the first thing this file does is rm -rf it —
// so two gates running at once (two worktrees, or a lane gating beside the integration tree) raced
// on the same directory. Worse, the saved file is CONTENT-ADDRESSED, so both runs wrote the same
// path: one process read the file while the other was truncating it and the PNG-magic assertion
// failed with nothing wrong in the product. A phantom RED on merge night. Keep this unique.
const ROOT = path.join(os.tmpdir(), 'starnet-image-test-' + process.pid);

// a 1x1 transparent PNG (real bytes), as base64 — used as the model's "generated" image
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const DATA_URL = 'data:image/png;base64,' + PNG_B64;

// build a fetch stub: records the last request body, returns a routed response
function stubFetch(handler) {
  const calls = [];
  const fn = async (url, init) => {
    let body = null; try { body = init && init.body ? JSON.parse(init.body) : null; } catch (_) {}
    calls.push({ url: String(url), body, init });
    return handler(String(url), body, init);
  };
  fn.calls = calls;
  return fn;
}

function jsonResp(obj, status) { return { status: status || 200, json: async () => obj, arrayBuffer: async () => Buffer.alloc(0), headers: { get: () => 'application/json' } }; }

(async () => {
  try { await fsp.rm(ROOT, { recursive: true, force: true }); } catch (_) {}

  // ---- A. parseImageFromResponse / dataUrlToBuffer pure helpers ----
  const T0 = makeImageTools({ openrouter: { apiKey: 'k' }, fsp, pathMod: path, root: ROOT, fetchImpl: async () => jsonResp({}) });
  A.eq(T0._internals.parseImageFromResponse({ choices: [{ message: { images: [{ image_url: { url: DATA_URL } } ] } }] }), DATA_URL, 'parses images[].image_url.url');
  A.eq(T0._internals.parseImageFromResponse({ choices: [{ message: { content: [{ type: 'image_url', image_url: { url: DATA_URL } }] } }] }), DATA_URL, 'parses content[] image_url part fallback');
  A.eq(T0._internals.parseImageFromResponse({ choices: [{ message: { content: 'no image here' } }] }), '', 'no image -> empty string');
  const dec = T0._internals.dataUrlToBuffer(DATA_URL);
  A.eq(dec.mime, 'image/png', 'dataUrlToBuffer reads the mime');
  A.ok(dec.buffer.length > 0 && dec.buffer[0] === 0x89 && dec.buffer[1] === 0x50, 'dataUrlToBuffer decodes real PNG bytes (\\x89P…)');

  // ---- B. image_generate: posts modalities, decodes the data URL, saves a content-addressed file, emits deliverable ----
  const genFetch = stubFetch((url) => {
    if (url.indexOf('/chat/completions') >= 0) return jsonResp({ choices: [{ message: { content: 'here you go', images: [{ type: 'image_url', image_url: { url: DATA_URL } }] } }] });
    return jsonResp({}, 404);
  });
  const T1 = makeImageTools({ openrouter: { apiKey: 'sk-test' }, fsp, pathMod: path, root: ROOT, fetchImpl: genFetch });
  const emits = [];
  const ctx = { agentId: 'hero', room: 'office', emit: (n, p) => emits.push({ n, p }) };
  const g = await T1.generateTool.run({ prompt: 'a red cube' }, ctx);
  // request shape
  A.eq(genFetch.calls[0].body.modalities, ['image', 'text'], 'image_generate sends modalities:[image,text]');
  // 2026-07-07 image-quality escape: the default was the OLDEST slug in the live catalog (garbled text on
  // mockups). Default is now current-gen Nano Banana 2; premium (gemini-3-pro-image) is taught in the description.
  A.eq(genFetch.calls[0].body.model, 'google/gemini-3.1-flash-image', 'image_generate defaults to the CURRENT-GEN image model');
  A.ok(/gemini-3-pro-image/.test(T1.generateTool.description) && /READABLE TEXT/.test(T1.generateTool.description), 'the tool teaches the premium model for text-heavy/hero assets');
  A.ok(genFetch.calls[0].init.headers.Authorization === 'Bearer sk-test', 'image_generate sends the BYOK key');
  // saved file
  const rel = (g.summary.match(/image → (\S+)/) || [])[1];
  A.ok(rel && rel.indexOf('images/gen-') === 0 && rel.endsWith('.png'), 'image_generate uses a content-addressed images/gen-*.png name');
  const onDisk = fssync.readFileSync(path.join(ROOT, 'hero', rel));
  A.ok(onDisk[0] === 0x89 && onDisk[1] === 0x50, 'the saved PNG matches the decoded bytes');
  A.ok(g.content.indexOf('/api/file?agent=hero&path=') >= 0, 'image_generate returns the /api/file viewer URL');
  A.ok(emits.some(e => e.n === 'deliverable' && e.p.kind === 'image' && e.p.agentId === 'hero'), 'image_generate emits a deliverable event');

  // A configured OpenRouter-compatible base is part of the authorized route (local proxy/tests included).
  const baseFetch = stubFetch(() => jsonResp({ choices: [{ message: { images: [{ image_url: { url: DATA_URL } }] } }] }));
  const TB = makeImageTools({ openrouter: { apiKey: 'base-key', baseUrl: 'http://127.0.0.1:43210/api/v1/' }, fsp, pathMod: path, root: ROOT, fetchImpl: baseFetch });
  await TB.generateTool.run({ prompt: 'local route' }, ctx);
  A.eq(baseFetch.calls[0].url, 'http://127.0.0.1:43210/api/v1/chat/completions', 'image_generate honors the configured OpenRouter base URL');

  // OpenAI keys use the dedicated Images API. gpt-image-2.5-flare is the media model inside STUDIO,
  // never a streaming chat agent.
  const openAIFetch = stubFetch(() => jsonResp({ data: [{ b64_json: PNG_B64 }], usage: { input_tokens: 8, output_tokens: 16 } }));
  const TO = makeImageTools({ openrouter: { apiKey: 'openai-key', provider: 'openai', protocol: 'openai-images', baseUrl: 'https://api.openai.com/v1/' }, fsp, pathMod: path, root: ROOT, fetchImpl: openAIFetch });
  const go = await TO.generateTool.run({ prompt: 'a moonlit landscape', aspect_ratio: '16:9' }, ctx);
  A.eq(openAIFetch.calls[0].url, 'https://api.openai.com/v1/images/generations', 'OpenAI generation uses /images/generations');
  A.eq(openAIFetch.calls[0].body, { model: 'gpt-image-2.5-flare', prompt: 'a moonlit landscape', size: '1536x1024' }, 'OpenAI request uses its native prompt/model/size shape without chat streaming fields');
  A.eq(openAIFetch.calls[0].init.headers.Authorization, 'Bearer openai-key', 'OpenAI Images API receives the configured OpenAI key');
  A.ok(/gpt-image-2\.5-flare/.test(TO.generateTool.description) && !/gemini-3-pro-image/.test(TO.generateTool.description), 'OpenAI STUDIO teaches the model valid for its route');
  A.ok(go.summary.indexOf('image → ') === 0, 'OpenAI base64 output is saved as an image artifact');
  A.eq(TO.hasVision, false, 'an OpenAI generation-only route does not falsely advertise chat vision');
  const invalidOverrideFetch = stubFetch(() => jsonResp({ data: [{ b64_json: PNG_B64 }] }));
  const TOInvalidOverride = makeImageTools({ openrouter: { apiKey: 'openai-key', provider: 'openai', protocol: 'openai-images' }, imageModel: 'google/gemini-3-pro-image', fsp, pathMod: path, root: ROOT, fetchImpl: invalidOverrideFetch });
  await TOInvalidOverride.generateTool.run({ prompt: 'route-safe model', model: 'recraft/recraft-v4' }, ctx);
  A.eq(invalidOverrideFetch.calls[0].body.model, 'gpt-image-2.5-flare', 'an OpenRouter IMAGE_MODEL override cannot cross onto the OpenAI Images API');

  // ---- B2. gemini-native protocol: Google's own generateContent endpoint, x-goog-api-key (not Bearer),
  // inlineData base64 (no data: wrapper) response shape, legacy-slug retry on a model-shaped 404 ----
  const geminiFetch = stubFetch((url) => {
    if (url.indexOf(':generateContent') >= 0) return jsonResp({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: PNG_B64 } }] } }], usageMetadata: { promptTokenCount: 10 } });
    return jsonResp({}, 404);
  });
  const TG = makeImageTools({ openrouter: { apiKey: 'gemini-key', provider: 'gemini', protocol: 'gemini-native' }, fsp, pathMod: path, root: ROOT, fetchImpl: geminiFetch });
  const gg = await TG.generateTool.run({ prompt: 'a lighthouse at dusk', aspect_ratio: '16:9' }, ctx);
  A.eq(geminiFetch.calls[0].url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent', 'gemini-native generation hits the native generateContent endpoint with the default model');
  A.eq(geminiFetch.calls[0].init.headers['x-goog-api-key'], 'gemini-key', 'gemini-native sends x-goog-api-key, not an Authorization Bearer header');
  A.eq(geminiFetch.calls[0].init.headers.Authorization, undefined, 'gemini-native never sends a Bearer Authorization header');
  A.eq(geminiFetch.calls[0].body.generationConfig, { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '16:9' } }, 'gemini-native requests IMAGE modality + the resolved aspect ratio');
  A.eq(geminiFetch.calls[0].body.contents, [{ parts: [{ text: 'a lighthouse at dusk' }] }], 'gemini-native sends the prompt as a single text part');
  A.ok(gg.summary.indexOf('image → ') === 0, 'gemini-native base64 inlineData output is saved as an image artifact');
  const ggOnDisk = fssync.readFileSync(path.join(ROOT, 'hero', (gg.summary.match(/image → (\S+)/) || [])[1]));
  A.ok(ggOnDisk[0] === 0x89 && ggOnDisk[1] === 0x50, 'the gemini-native saved file matches the decoded inlineData bytes');
  A.ok(/no free tier for image/.test(TG.generateTool.description), 'the gemini-native STUDIO tool is honest that image output is a paid call');

  const geminiBaseFetch = stubFetch(() => jsonResp({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: PNG_B64 } }] } }] }));
  const TGBase = makeImageTools({ openrouter: { apiKey: 'gemini-key', provider: 'gemini', protocol: 'gemini-native', baseUrl: 'http://127.0.0.1:43211/v1beta/' }, fsp, pathMod: path, root: ROOT, fetchImpl: geminiBaseFetch });
  await TGBase.generateTool.run({ prompt: 'local gemini route' }, ctx);
  A.eq(geminiBaseFetch.calls[0].url, 'http://127.0.0.1:43211/v1beta/models/gemini-3.1-flash-image:generateContent', 'gemini-native honors a configured base URL');

  const geminiSlugDrift = stubFetch((url) => url.indexOf('gemini-3.1-flash-image') >= 0
    ? jsonResp({ error: { message: 'model not found' } }, 404)
    : jsonResp({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: PNG_B64 } }] } }] }));
  const TGDrift = makeImageTools({ openrouter: { apiKey: 'gemini-key', provider: 'gemini', protocol: 'gemini-native' }, fsp, pathMod: path, root: ROOT, fetchImpl: geminiSlugDrift });
  const ggDrift = await TGDrift.generateTool.run({ prompt: 'slug drift retry' }, ctx);
  A.eq(geminiSlugDrift.calls.length, 2, 'a model-shaped 404 retries once on the legacy slug');
  A.ok(geminiSlugDrift.calls[1].url.indexOf('gemini-2.5-flash-image') >= 0, 'the retry uses the known-good legacy Gemini image model');
  A.ok(ggDrift.summary.indexOf('image → ') === 0, 'the legacy-slug retry still produces a saved image artifact');

  // ---- B1b. aspect_ratio rides image_config; default stays bare (no image_config); bad value refused pre-flight ----
  const gAr = await T1.generateTool.run({ prompt: 'a wide vista', aspect_ratio: '16:9' }, ctx);
  A.ok(gAr.summary.indexOf('image → ') === 0, 'aspect_ratio call still saves an image');
  const arCall = genFetch.calls[genFetch.calls.length - 1];
  A.eq(arCall.body.image_config, { aspect_ratio: '16:9' }, 'aspect_ratio:"16:9" is sent as image_config.aspect_ratio');
  A.eq(genFetch.calls[0].body.image_config, undefined, 'no aspect_ratio -> no image_config field (provider default 1:1)');
  A.ok(/16:9/.test(T1.generateTool.description) && /widescreen/i.test(T1.generateTool.description), 'the tool teaches the aspect_ratio dial for widescreen asks');
  A.eq(T1.generateTool.schema.properties.aspect_ratio.enum, undefined, 'aspect_ratio is NOT an enum — any shape is accepted');
  A.ok(T1.generateTool.schema.properties.width && T1.generateTool.schema.properties.height, 'schema exposes exact width/height');

  // ---- B1b-2. image_size rides image_config.image_size (OpenRouter native-resolution dial) ----
  const gSize = await T1.generateTool.run({ prompt: 'a mountain vista', aspect_ratio: '4:5', image_size: '4K' }, ctx);
  A.ok(gSize.summary.indexOf('image → ') === 0, 'image_size call still saves an image');
  const sizeCall = genFetch.calls[genFetch.calls.length - 1];
  A.eq(sizeCall.body.image_config, { aspect_ratio: '4:5', image_size: '4K' }, 'aspect_ratio + image_size both land in image_config');
  A.ok(/image_size 4K/.test(gSize.content), 'the result names the requested image_size');
  const gSizeOnly = await T1.generateTool.run({ prompt: 'z2', image_size: '2k' }, ctx);
  A.eq(genFetch.calls[genFetch.calls.length - 1].body.image_config, { image_size: '2K' }, 'image_size alone sends image_config.image_size with no aspect_ratio field; lowercase is normalized');
  let badSize = null; try { await T1.generateTool.run({ prompt: 'x', image_size: '8K' }, ctx); } catch (e) { badSize = e.message; }
  A.ok(/unrecognized image_size/.test(badSize) && /no image was produced/.test(badSize), 'an unsupported image_size is refused pre-flight with an honest error');
  A.eq(T1.generateTool.schema.properties.image_size.enum, ['1K', '2K', '4K'], 'image_size schema is a closed enum of the real provider tiers');
  // a route that does not actually carry image_config (gemini-native) says so instead of silently dropping the dial
  const geminiSizeFetch = stubFetch(() => jsonResp({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: PNG_B64 } }] } }] }));
  const TGSize = makeImageTools({ openrouter: { apiKey: 'gemini-key', provider: 'gemini', protocol: 'gemini-native' }, fsp, pathMod: path, root: ROOT, fetchImpl: geminiSizeFetch });
  const gSizeIgnored = await TGSize.generateTool.run({ prompt: 'ignored on this route', image_size: '4K' }, ctx);
  A.ok(/image_size "4K" was requested but ignored/.test(gSizeIgnored.content), 'image_size on a non-OpenRouter protocol is honestly reported as ignored, not silently dropped');

  // ---- B1c. any ratio/size snaps to the nearest provider ratio; exact pixels get fitted ----
  {
    const rs = T1._internals.resolveShape;
    A.eq(rs('99:1').ratio, '21:9', 'an off-menu ratio snaps to the nearest provider ratio (99:1 -> 21:9)');
    A.eq(rs('16/9').ratio, '16:9', 'slash separator accepted');
    A.eq(rs('1.5').ratio, '3:2', 'a bare decimal ratio works');
    A.eq(rs('landscape').ratio, '3:2', 'shape words work');
    A.eq(rs('Portrait').ratio, '2:3', 'shape words are case-insensitive');
    A.eq(rs('1920x1080'), { ratio: '16:9', width: 1920, height: 1080, exact: true }, 'WxH in aspect_ratio = exact size request');
    A.eq(rs('', 1080, 1350), { ratio: '4:5', width: 1080, height: 1350, exact: true }, 'width+height alone pick the nearest ratio');
    A.eq(rs('1:1', 800, 600).ratio, '1:1', 'an explicit ratio wins over the pixel ratio for generation');
    A.eq(rs(''), { ratio: '', width: 0, height: 0, exact: false }, 'nothing asked -> provider default, no image_config');
    A.eq(rs('banana'), null, 'garbage is refused');
    A.eq(rs('', 100, 0), null, 'width without height is refused');
    A.eq(rs('', 99999, 10), null, 'absurd pixel sizes are refused');
    const before = genFetch.calls.length;
    let badAr = null; try { await T1.generateTool.run({ prompt: 'x', aspect_ratio: 'banana' }, ctx); } catch (e) { badAr = e.message; }
    A.ok(/could not understand the requested image shape/.test(badAr) && /no image was produced/.test(badAr), 'an unparseable shape is refused with an honest, actionable error');
    A.eq(genFetch.calls.length, before, 'the bad-shape refusal fires BEFORE any network call');
    const gSnap = await T1.generateTool.run({ prompt: 'ultra wide', aspect_ratio: '32:9' }, ctx);
    A.eq(genFetch.calls[genFetch.calls.length - 1].body.image_config, { aspect_ratio: '21:9' }, '32:9 is sent to the provider as the nearest 21:9');
    A.ok(/21:9/.test(gSnap.content), 'the result names the ratio actually rendered');
    // the stub PNG is a hand-rolled fixture the resizer can't decode -> the tool must say so, not lie
    const gNoFit = await T1.generateTool.run({ prompt: 'wallpaper', width: 64, height: 36, path: 'art/nofit' }, ctx);
    A.eq(genFetch.calls[genFetch.calls.length - 1].body.image_config, { aspect_ratio: '16:9' }, 'exact 64x36 generates at 16:9');
    A.ok(/NOT resized to 64x36/.test(gNoFit.content), 'an un-resizable render is shipped with an honest NOT-resized note');
    let sharp = null; try { sharp = require('sharp'); } catch (_) {}
    if (sharp) {
      const realPng = await sharp({ create: { width: 160, height: 90, channels: 3, background: '#336699' } }).png().toBuffer();
      const realFetch = stubFetch(() => jsonResp({ choices: [{ message: { images: [{ image_url: { url: 'data:image/png;base64,' + realPng.toString('base64') } }] } }] }));
      const TR = makeImageTools({ openrouter: { apiKey: 'k' }, fsp, pathMod: path, root: ROOT, fetchImpl: realFetch });
      const gExact = await TR.generateTool.run({ prompt: 'wallpaper', width: 64, height: 36, path: 'art/exact' }, ctx);
      A.ok(/fitted to 64x36/.test(gExact.content), 'exact-size result reports the fit');
      const meta = await sharp(path.join(ROOT, 'hero', 'art', 'exact.png')).metadata();
      A.eq([meta.width, meta.height], [64, 36], 'the saved file is EXACTLY 64x36');
      const gTall = await TR.generateTool.run({ prompt: 'poster', aspect_ratio: '1000x1500', path: 'art/tall' }, ctx);
      A.eq(realFetch.calls[realFetch.calls.length - 1].body.image_config, { aspect_ratio: '2:3' }, '"1000x1500" generates at 2:3');
      const m2 = await sharp(path.join(ROOT, 'hero', 'art', 'tall.png')).metadata();
      A.eq([m2.width, m2.height], [1000, 1500], 'a WxH string in aspect_ratio yields that exact pixel size');
    }
  }

  // ---- B2. custom output path + content-addressed idempotency (same bytes -> same default name) ----
  const g2 = await T1.generateTool.run({ prompt: 'x', path: 'art/cube' }, ctx);
  A.ok(g2.summary.indexOf('art/cube.png') >= 0, 'image_generate appends .png to an extensionless custom path');
  const g3 = await T1.generateTool.run({ prompt: 'y' }, ctx);
  A.eq((g3.summary.match(/image → (\S+)/) || [])[1], rel, 'identical image bytes -> identical content-addressed name (idempotent)');

  // ---- C. image_generate errors when the model returns no image ----
  const noImgFetch = stubFetch(() => jsonResp({ choices: [{ message: { content: 'I cannot do that' } }] }));
  const T2 = makeImageTools({ openrouter: { apiKey: 'sk' }, fsp, pathMod: path, root: ROOT, fetchImpl: noImgFetch });
  let threw = false; try { await T2.generateTool.run({ prompt: 'z' }, ctx); } catch (e) { threw = /no image/.test(e.message); }
  A.ok(threw, 'image_generate throws a clear error when no image comes back');

  // ---- C2. MAX_IMAGE_BYTES (2026-10-22 field incident): a real 4K generation decodes to roughly 10-21 MB
  //          and must NOT be thrown away post-download; the cap still exists for a genuinely absurd response ----
  {
    const make = (mb) => Buffer.alloc(mb * 1024 * 1024, 1).toString('base64');
    const bigFetch = stubFetch(() => jsonResp({ choices: [{ message: { images: [{ image_url: { url: 'data:image/png;base64,' + make(20) } }] } }] }));
    const TBig = makeImageTools({ openrouter: { apiKey: 'k' }, fsp, pathMod: path, root: ROOT, fetchImpl: bigFetch });
    const rb = await TBig.generateTool.run({ prompt: '4k shot', path: 'art/big4k' }, ctx);
    A.ok(rb.summary.indexOf('image → ') === 0, 'a real-world 4K-class generated image (~20 MB) is no longer thrown away post-download');

    const hugeFetch = stubFetch(() => jsonResp({ choices: [{ message: { images: [{ image_url: { url: 'data:image/png;base64,' + make(40) } }] } }] }));
    const THuge = makeImageTools({ openrouter: { apiKey: 'k' }, fsp, pathMod: path, root: ROOT, fetchImpl: hugeFetch });
    let tooBig = false; try { await THuge.generateTool.run({ prompt: 'absurd' }, ctx); } catch (e) { tooBig = /too large/.test(e.message); }
    A.ok(tooBig, 'the cap still rejects something genuinely absurd (40 MB) — raised, not removed');
  }

  // ---- D. image_analyze: reads a workspace file, sends text-then-image_url parts, returns model text ----
  const anFetch = stubFetch(() => jsonResp({ choices: [{ message: { content: 'A small red cube on white.' } }] }));
  const T3 = makeImageTools({ openrouter: { apiKey: 'sk' }, fsp, pathMod: path, root: ROOT, fetchImpl: anFetch });
  const a = await T3.analyzeTool.run({ image: rel, prompt: 'what is this?' }, ctx);   // rel was saved under hero/ above
  A.ok(/red cube/i.test(a.content), 'image_analyze returns the vision model text');
  const parts = anFetch.calls[0].body.messages[0].content;
  A.eq(parts[0].type, 'text', 'analyze sends the text part first');
  A.eq(parts[1].type, 'image_url', 'analyze sends an image_url part second');
  A.ok(parts[1].image_url.url.indexOf('data:image/png;base64,') === 0, 'analyze base64-encodes the workspace image into a data URL');

  // ---- D2. image_analyze reading a workspace file shares the SAME raised cap — an agent can now look back
  //          at its own real 4K output (image_quality_check / image_analyze "second check") without it
  //          being refused as "too large" the moment image_generate stopped refusing to save it ----
  {
    const bigBuf = Buffer.alloc(20 * 1024 * 1024, 2);
    await fsp.writeFile(path.join(ROOT, 'hero', 'big.png'), bigBuf);
    const anBigFetch = stubFetch(() => jsonResp({ choices: [{ message: { content: 'a large four-k watercolor' } }] }));
    const T3b = makeImageTools({ openrouter: { apiKey: 'sk' }, fsp, pathMod: path, root: ROOT, fetchImpl: anBigFetch });
    const ab = await T3b.analyzeTool.run({ image: 'big.png' }, ctx);
    A.ok(/four-k watercolor/.test(ab.content), 'image_analyze can read back a ~20 MB workspace image (e.g. its own 4K output)');
  }

  // ---- E. image_analyze passes an http(s) URL straight through (no file read) ----
  const a2 = await T3.analyzeTool.run({ image: 'https://example.com/cat.jpg' }, ctx);
  A.ok(/red cube/i.test(a2.content), 'image_analyze works with a public URL');
  A.eq(anFetch.calls[1].body.messages[0].content[1].image_url.url, 'https://example.com/cat.jpg', 'a public URL is passed through unchanged');

  // ---- F. jail escape on analyze path is refused ----
  let escaped = false; try { await T3.analyzeTool.run({ image: '../secrets.txt' }, ctx); } catch (e) { escaped = /illegal path|escapes|no such file/i.test(e.message); }
  A.ok(escaped, 'image_analyze refuses a path that escapes the workspace');

  // ---- G. no API key -> clean, actionable error ----
  const T4 = makeImageTools({ openrouter: { apiKey: '' }, fsp, pathMod: path, root: ROOT, fetchImpl: async () => jsonResp({}) });
  let noKey = false; try { await T4.generateTool.run({ prompt: 'q' }, ctx); } catch (e) { noKey = /media connection/i.test(e.message); }
  A.ok(noKey, 'image_generate errors helpfully when no OpenRouter key is configured');

  // ---- H. browserVision: reusable vision callback for browser.vision ----
  A.eq(T3.hasVision, true, 'hasVision is true when a key is present');
  A.eq(T4.hasVision, false, 'hasVision is false with no key (browser.vision stays unwired -> honest unavailable)');
  const bv = await T3.browserVision({ imageBase64: Buffer.from('png').toString('base64'), question: 'what is on screen?' });
  A.ok(/red cube/i.test(bv), 'browserVision returns the vision model text');
  const bvParts = anFetch.calls[anFetch.calls.length - 1].body.messages[0].content;
  A.eq(bvParts[0].text, 'what is on screen?', 'browserVision forwards the question');
  A.ok(bvParts[1].image_url.url.indexOf('data:image/png;base64,') === 0, 'browserVision wraps the screenshot as a PNG data URL');
  let bvNoKey = false; try { await T4.browserVision({ imageBase64: 'x', question: 'q' }); } catch (e) { bvNoKey = /API key/i.test(e.message); }
  A.ok(bvNoKey, 'browserVision throws a clear no-key error (browser.vision converts this to unavailable)');

  // ---- G. slug-drift fallback: an unknown-model rejection retries ONCE on the legacy slug; other errors don't ----
  {
    const fbFetch = stubFetch((url, body) => {
      if (body && body.model === 'google/gemini-3.1-flash-image') return jsonResp({ error: { message: 'gemini-3.1-flash-image is not a valid model ID' } }, 400);
      return jsonResp({ choices: [{ message: { images: [{ image_url: { url: DATA_URL } }] } }] });
    });
    const TF = makeImageTools({ openrouter: { apiKey: 'k' }, fsp, pathMod: path, root: ROOT, fetchImpl: fbFetch });
    const r = await TF.generateTool.run({ prompt: 'cube' }, { agentId: 'hero', emit: () => {} });
    A.eq(fbFetch.calls.length, 2, 'invalid-model 400 retries exactly once');
    A.eq(fbFetch.calls[1].body.model, 'google/gemini-2.5-flash-image', 'the retry rides the known-good LEGACY slug');
    A.ok(r.content.indexOf('gemini-2.5-flash-image') >= 0, 'the result names the model that ACTUALLY generated (honest fallback)');

    // TRANSIENT RETRY (2026-10-22): a non-model, non-refusal error (429, 5xx, dropped connection) is most
    // likely a one-off provider hiccup, not a broken request — retry ONCE on the SAME model before giving up.
    const rlFetch = stubFetch(() => jsonResp({ error: { message: 'rate limited' } }, 429));
    const TR = makeImageTools({ openrouter: { apiKey: 'k' }, fsp, pathMod: path, root: ROOT, fetchImpl: rlFetch });
    let threw = false; try { await TR.generateTool.run({ prompt: 'x' }, { agentId: 'hero', emit: () => {} }); } catch (e) { threw = /429/.test(e.message); }
    A.ok(threw && rlFetch.calls.length === 2, 'a persistent non-model error (429) retries ONCE on the SAME model, then propagates');
    A.eq(rlFetch.calls[0].body.model, rlFetch.calls[1].body.model, 'the transient retry does NOT fall back to the legacy slug — only a model-shaped rejection does');

    // a transient error that clears on the second attempt recovers the whole call, not just a bare retry count
    let rlAttempt = 0;
    const rlRecoverFetch = stubFetch(() => {
      rlAttempt++;
      return rlAttempt === 1 ? jsonResp({ error: { message: 'rate limited' } }, 429)
        : jsonResp({ choices: [{ message: { images: [{ image_url: { url: DATA_URL } }] } }] });
    });
    const TRR = makeImageTools({ openrouter: { apiKey: 'k' }, fsp, pathMod: path, root: ROOT, fetchImpl: rlRecoverFetch });
    const rr = await TRR.generateTool.run({ prompt: 'recovers on retry' }, { agentId: 'hero', emit: () => {} });
    A.eq(rlRecoverFetch.calls.length, 2, 'the recovering case also made exactly 2 attempts');
    A.ok(rr.summary.indexOf('image → ') === 0, 'a transient failure that clears on retry still produces a saved image');

    // an apparent content/policy refusal is NOT retried — retrying a refusal just spends money to get refused again
    const refusalFetch = stubFetch(() => jsonResp({ error: { message: 'Content policy violation: request refused' } }, 400));
    const TRF = makeImageTools({ openrouter: { apiKey: 'k' }, fsp, pathMod: path, root: ROOT, fetchImpl: refusalFetch });
    let refused = false; try { await TRF.generateTool.run({ prompt: 'x' }, { agentId: 'hero', emit: () => {} }); } catch (e) { refused = /refused/i.test(e.message); }
    A.ok(refused && refusalFetch.calls.length === 1, 'an apparent content/policy refusal is NOT retried');
  }

  // ---- H. deps.imageModel (the STARNET_IMAGE_MODEL knob) overrides the default; args.model still wins ----
  {
    const kFetch = stubFetch(() => jsonResp({ choices: [{ message: { images: [{ image_url: { url: DATA_URL } }] } }] }));
    const TK = makeImageTools({ openrouter: { apiKey: 'k' }, fsp, pathMod: path, root: ROOT, fetchImpl: kFetch, imageModel: 'openai/gpt-5-image' });
    await TK.generateTool.run({ prompt: 'a' }, { agentId: 'hero', emit: () => {} });
    A.eq(kFetch.calls[0].body.model, 'openai/gpt-5-image', 'deps.imageModel (env knob) overrides the built-in default');
    await TK.generateTool.run({ prompt: 'a', model: 'google/gemini-3-pro-image' }, { agentId: 'hero', emit: () => {} });
    A.eq(kFetch.calls[1].body.model, 'google/gemini-3-pro-image', 'an explicit per-call model still wins over the knob');
  }

  // ---- I. AUX VISION: session-provider fallback (the ref-style route; kills the "give me a key" bug) ----
  {
    // I1. NO key + auxVision -> analyze works through the session provider; no OpenRouter fetch fired
    const auxCalls = [];
    const noOrFetch = stubFetch(() => { throw new Error('must not hit OpenRouter'); });
    const TA = makeImageTools({ openrouter: { apiKey: '' }, fsp, pathMod: path, root: ROOT, fetchImpl: noOrFetch,
      auxVision: async (req) => { auxCalls.push(req); return 'a green triangle (session model)'; } });
    const r1 = await TA.analyzeTool.run({ image: 'https://example.com/x.jpg', prompt: 'what shape?' }, ctx);
    A.ok(/green triangle/.test(r1.content), 'keyless analyze answers via the session provider');
    A.eq(noOrFetch.calls.length, 0, 'no OpenRouter call was attempted without a key');
    A.eq(auxCalls[0].messages[0].content[0].text, 'what shape?', 'aux route forwards the question');
    A.eq(auxCalls[0].messages[0].content[1].type, 'image_url', 'aux route carries the image block');
    A.eq(TA.hasVision, true, 'hasVision is TRUE with auxVision even without a key (browser.vision stays wired)');
    const bva = await TA.browserVision({ imageBase64: 'AAAA', question: 'q' });
    A.ok(/green triangle/.test(bva), 'browserVision rides the aux route keyless');

    // I2. key present but OpenRouter FAILS (dead key / out of credits) -> aux route rescues
    const brokeFetch = stubFetch(() => jsonResp({ error: { message: 'This request requires more credits' } }, 402));
    const TB = makeImageTools({ openrouter: { apiKey: 'k' }, fsp, pathMod: path, root: ROOT, fetchImpl: brokeFetch,
      auxVision: async () => 'rescued by session model' });
    const r2 = await TB.analyzeTool.run({ image: 'https://example.com/x.jpg' }, ctx);
    A.ok(/rescued by session model/.test(r2.content), 'OpenRouter failure degrades to the session provider, not an error');
    A.eq(brokeFetch.calls.length, 1, 'OpenRouter was tried first when a key exists');

    // I3. both routes fail -> ONE error naming both causes
    const TC = makeImageTools({ openrouter: { apiKey: 'k' }, fsp, pathMod: path, root: ROOT, fetchImpl: brokeFetch,
      auxVision: async () => { throw new Error('model has no eyes'); } });
    let both = null; try { await TC.analyzeTool.run({ image: 'https://example.com/x.jpg' }, ctx); } catch (e) { both = e.message; }
    A.ok(/more credits/.test(both) && /no eyes/.test(both), 'double failure reports BOTH routes honestly');

    // I4. aux returning empty text -> honest may-not-support-vision error (never fake success)
    const TD = makeImageTools({ openrouter: { apiKey: '' }, fsp, pathMod: path, root: ROOT, fetchImpl: noOrFetch,
      auxVision: async () => '   ' });
    let empty = null; try { await TD.analyzeTool.run({ image: 'https://example.com/x.jpg' }, ctx); } catch (e) { empty = e.message; }
    A.ok(/may not support vision/.test(empty), 'empty session answer surfaces as a not-vision-capable error');

    // I5. image_generate is UNCHANGED: still requires the OpenRouter key even when auxVision exists
    let genKey = false; try { await TA.generateTool.run({ prompt: 'x' }, ctx); } catch (e) { genKey = /media connection/i.test(e.message); }
    A.ok(genKey, 'image_generate requires a media route; a vision callback alone cannot generate images');
  }

  // Cancellation fences: providers may ignore abort and a staged write may complete late.
  for (const phase of ['before', 'response', 'download', 'write']) {
    const ac = new AbortController(), bills = [], delivered = [];
    const aid = 'cancel-' + phase, rel = 'existing.png';
    const abs = path.join(ROOT, aid, rel);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, 'original-image');
    let fetched = 0;
    const injectedFs = Object.assign({}, fsp, { writeFile: async (...args) => {
      await fsp.writeFile(...args);
      if (phase === 'write' && String(args[0]).includes('.pending-')) ac.abort();
    } });
    const tools = makeImageTools({ openrouter: { apiKey: 'fixture' }, fsp: injectedFs, pathMod: path, root: ROOT,
      onUsage: usage => bills.push(usage), fetchImpl: async url => {
        fetched++;
        if (phase === 'response') ac.abort();
        if (String(url).endsWith('/output.png')) {
          ac.abort();
          return { status: 200, headers: { get: () => 'image/png' }, arrayBuffer: async () => Buffer.from(PNG_B64, 'base64') };
        }
        return jsonResp({ usage: { cost: .025 }, choices: [{ message: { images: [{ image_url: { url: phase === 'download' ? 'https://fixture.invalid/output.png' : DATA_URL } }] } }] });
      } });
    if (phase === 'before') ac.abort();
    let cancelled = false;
    try { await tools.generateTool.run({ prompt: 'cube', path: rel }, { agentId: aid, signal: ac.signal, emit: (...args) => delivered.push(args) }); }
    catch (e) { cancelled = e.name === 'AbortError'; }
    A.ok(cancelled, phase + ': cancellation propagates');
    A.eq(await fsp.readFile(abs, 'utf8'), 'original-image', phase + ': existing output remains intact');
    A.eq(delivered.length, 0, phase + ': no deliverable emitted');
    A.eq((await fsp.readdir(path.dirname(abs))).length, 1, phase + ': staged bytes cleaned up');
    A.eq(bills.length, phase === 'before' ? 0 : 1, phase + ': received charge retained once despite cancellation');
    if (phase === 'before') A.eq(fetched, 0, 'already cancelled dispatch makes no paid request');
  }
  // Unexpected cleanup failures stay observable without turning a published image into a failed run.
  {
    const failopen = require('../sidecar/failopen.js');
    const before = failopen.counts()['image.staging-cleanup'] || 0;
    const injectedFs = Object.assign({}, fsp, { unlink: async () => { throw Object.assign(new Error('fixture cleanup denied'), { code: 'EACCES' }); } });
    const tools = makeImageTools({ openrouter: { apiKey: 'fixture' }, fsp: injectedFs, pathMod: path, root: ROOT,
      fetchImpl: async () => jsonResp({ choices: [{ message: { images: [{ image_url: { url: DATA_URL } }] } }] }) });
    const delivered = [];
    const result = await tools.generateTool.run({ prompt: 'cube', path: 'cleanup-proof.png' }, { agentId: 'cleanup', emit: (...args) => delivered.push(args) });
    A.ok(/cleanup-proof.png/.test(result.content), 'cleanup diagnostic preserves a successfully published result');
    A.eq(delivered.length, 1, 'cleanup diagnostic does not duplicate the deliverable');
    A.eq(failopen.counts()['image.staging-cleanup'], before + 1, 'unexpected staging cleanup error is counted');
  }
  // ---- Z. mid-download retry (2026-10-22): headers arrive (200) but the body read drops — ERR_HTTP2_STREAM_ERROR
  // and sibling connection-reset codes mid-stream, not a pre-connect failure. Must retry the WHOLE request (fresh
  // bytes) up to 3 times with backoff rather than silently swallowing to a fake empty success. ----
  {
    const http2Err = () => Object.assign(new Error('fetch failed'), { cause: { code: 'ERR_HTTP2_STREAM_ERROR' } });
    // Z1: drops twice, succeeds on the 3rd real attempt -> the tool call ultimately succeeds with the real image.
    let calls = 0;
    const flakyFetch = stubFetch((url) => {
      calls++;
      return { status: 200, json: async () => { if (calls <= 2) throw http2Err(); return { choices: [{ message: { images: [{ image_url: { url: DATA_URL } }] } }] }; },
        arrayBuffer: async () => Buffer.alloc(0), headers: { get: () => 'application/json' } };
    });
    const TZ1 = makeImageTools({ openrouter: { apiKey: 'k' }, fsp, pathMod: path, root: ROOT, fetchImpl: flakyFetch });
    const r1 = await TZ1.generateTool.run({ prompt: 'retry cube' }, { agentId: 'retry1', emit: () => {} });
    A.eq(calls, 3, 'two mid-download drops + one real success = 3 total request attempts');
    A.ok(!r1.isError && /saved/i.test(r1.content), 'the call succeeds once a retry gets real bytes through');

    // Z2: drops every time -> stops after 3 retries (4 total attempts), ends in the same honest "no image"
    // error the old swallow-to-{} fallback already produced — never retries forever, never a worse error.
    let calls2 = 0, threw2 = false;
    const alwaysFlakyFetch = stubFetch(() => { calls2++; return { status: 200, json: async () => { throw http2Err(); }, arrayBuffer: async () => Buffer.alloc(0), headers: { get: () => 'application/json' } }; });
    const TZ2 = makeImageTools({ openrouter: { apiKey: 'k' }, fsp, pathMod: path, root: ROOT, fetchImpl: alwaysFlakyFetch });
    try { await TZ2.generateTool.run({ prompt: 'always drops' }, { agentId: 'retry2', emit: () => {} }); }
    catch (e) { threw2 = /no image/i.test(e.message); }
    A.eq(calls2, 4, 'exactly 3 retries (4 total attempts) for a persistent mid-download drop, never unbounded');
    A.ok(threw2, 'exhausting all retries on a real drop still ends in the same honest "no image" error as before');

    // Z3: an ordinary (non-transport) json-parse failure is NOT a mid-download drop -> no retry, old behavior.
    let calls3 = 0;
    const ordinaryBadJson = stubFetch(() => { calls3++; return { status: 200, json: async () => { throw new SyntaxError('Unexpected token'); }, arrayBuffer: async () => Buffer.alloc(0), headers: { get: () => 'application/json' } }; });
    const TZ3 = makeImageTools({ openrouter: { apiKey: 'k' }, fsp, pathMod: path, root: ROOT, fetchImpl: ordinaryBadJson });
    try { await TZ3.generateTool.run({ prompt: 'malformed body' }, { agentId: 'retry3', emit: () => {} }); } catch (_) {}
    A.eq(calls3, 1, 'a non-transport JSON parse error is never retried — single attempt, same as before this fix');
  }
  try { await fsp.rm(ROOT, { recursive: true, force: true }); } catch (_) {}
  A.report('image.test');
})().catch(e => { console.log('FATAL', e && e.stack || e); process.exit(1); });

/* node test/anthropic-image-base64.test.js — Regression test for strict image base64
   validation before provider submission.

   Root cause: anthImageBlock() in sidecar/providers/anthropic.js accepted any base64-looking
   data URL without validating that the base64 payload was actually well-formed. A malformed
   base64 image (wrong padding, invalid characters, empty data) reached Anthropic's API, which
   answered HTTP 400 "invalid image base64" — a provider round-trip that should never happen.

   Fix: anthImageBlock() now validates base64 image data with isValidBase64ImageData() before
   building the Anthropic image block, throwing a clear local error instead of submitting bad
   bytes to the provider.
*/
'use strict';
const A = require('./_assert.js');
const { _internals } = require('../sidecar/providers/anthropic.js');

const { anthImageBlock } = _internals;

function dataUrl(b64, mime) { return 'data:' + (mime || 'image/png') + ';base64,' + b64; }

// A valid 1x1 PNG base64 (minimal valid PNG).
const VALID_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

(async () => {
  // A. Valid base64 image data passes through unchanged.
  {
    const out = anthImageBlock(dataUrl(VALID_PNG));
    A.ok(out, 'valid image block produced');
    A.eq(out.type, 'image', 'block type is image');
    A.eq(out.source.type, 'base64', 'source type is base64');
    A.eq(out.source.media_type, 'image/png', 'media type preserved');
    A.eq(out.source.data, VALID_PNG, 'valid base64 data passed through verbatim');
  }

  // B. http(s) URL images pass through unchanged (no base64 to validate).
  {
    const out = anthImageBlock('https://example.com/a.jpg');
    A.ok(out, 'url image block produced');
    A.eq(out.source.type, 'url', 'url source type');
    A.eq(out.source.url, 'https://example.com/a.jpg', 'url preserved');
  }

  // C. Invalid base64 — bad characters — throws locally before any provider submission.
  {
    const bad = dataUrl('not!valid*base64$$$', 'image/png');
    let threw = false;
    try { anthImageBlock(bad); }
    catch (e) { threw = true; A.ok(/invalid image base64/.test(String(e.message)),
      'error names invalid image base64: ' + e.message); }
    A.ok(threw, 'bad base64 characters throw instead of reaching the provider');
  }

  // D. Invalid base64 — wrong padding length — throws locally.
  {
    const bad = dataUrl('iVBORw0KGgo', 'image/png');  // length 11, not a multiple of 4
    let threw = false;
    try { anthImageBlock(bad); }
    catch (e) { threw = true; A.ok(/invalid image base64/.test(String(e.message)),
      'error names invalid image base64: ' + e.message); }
    A.ok(threw, 'mis-padded base64 throws instead of reaching the provider');
  }

  // E. Empty base64 data throws locally.
  {
    const bad = dataUrl('', 'image/png');
    let threw = false;
    try { anthImageBlock(bad); }
    catch (e) { threw = true; A.ok(/invalid image base64/.test(String(e.message)),
      'error names invalid image base64: ' + e.message); }
    A.ok(threw, 'empty base64 throws instead of reaching the provider');
  }

  // F. Malformed data URL (no comma separator) returns null, not a block.
  {
    const out = anthImageBlock('not-a-data-url-at-all');
    A.eq(out, null, 'malformed data URL returns null (no block, no provider submission)');
  }

  // G. A data URL without a comma separator (no payload) returns null — it is malformed
  //    and never reaches the provider, regardless of whether it names base64.
  {
    const out = anthImageBlock('data:image/png;base64');
    A.eq(out, null, 'data URL with no payload returns null (no block, no provider submission)');
  }

  A.report('anthropic-image-base64.test');
})().catch(e => { console.log('FAIL: ' + (e && e.stack || e)); process.exit(1); });

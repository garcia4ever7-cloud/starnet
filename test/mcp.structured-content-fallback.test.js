/* node test/mcp.structured-content-fallback.test.js — a connector whose server mirrors its payload into
   `structuredContent` and leaves `content` empty (spec only RECOMMENDS the text mirror, doesn't require it)
   used to render as a SILENT success with nothing in it — the connector call path was the one MCP surface
   that dropped structuredContent entirely. Locks the real-world case that broke it: Airtable's own MCP
   server (mcp.airtable.com) returns exactly this shape for list_bases/create_records_for_table/etc, which
   made every Airtable read/write look "blocked" even though the token, scopes, and call all worked. */
'use strict';
const A = require('./_assert.js');
const { makeMcpToolDef } = require('../sidecar/mcp/translate.js');

function def(call) {
  return makeMcpToolDef({ connectorId: 'airtable', label: 'Airtable', call, mcpTool: { name: 'list_bases' } });
}

(async () => {
  // real shape captured live from mcp.airtable.com's list_bases
  {
    const res = await def(() => Promise.resolve({
      content: [],
      structuredContent: { bases: [{ id: 'app8QovHftBtG1kZV', name: 'Etsy Scout', permissionLevel: 'create' }] },
      isError: false
    })).run({}, {});
    A.ok(res.content.indexOf('app8QovHftBtG1kZV') >= 0, 'structuredContent data reaches the model when content[] is empty: ' + res.content);
    A.ok(res.content.indexOf('Etsy Scout') >= 0, 'the actual payload (not a placeholder) is rendered');
  }

  // content[] populated normally — structuredContent must NOT be consulted (no double-rendering)
  {
    const res = await def(() => Promise.resolve({
      content: [{ type: 'text', text: 'normal result' }],
      structuredContent: { bases: [{ id: 'should-not-appear' }] },
      isError: false
    })).run({}, {});
    A.ok(res.content.indexOf('normal result') >= 0, 'content[] text is used as-is');
    A.ok(res.content.indexOf('should-not-appear') < 0, 'structuredContent is ignored once content[] already rendered something');
  }

  // both empty — stays empty, never throws
  {
    const res = await def(() => Promise.resolve({ content: [], structuredContent: {}, isError: false })).run({}, {});
    A.ok(typeof res.content === 'string', 'a genuinely empty result still returns a string, not a throw');
  }

  // isError:true still throws (the fallback only widens what counts as a SUCCESS payload)
  {
    let threw = false;
    try {
      await def(() => Promise.resolve({ content: [{ type: 'text', text: 'bad field id' }], isError: true })).run({}, {});
    } catch (e) { threw = true; A.ok(/bad field id/.test(e.message), 'error text still surfaces: ' + e.message); }
    A.ok(threw, 'isError:true still throws regardless of structuredContent');
  }

  A.report('mcp.structured-content-fallback.test');
})();

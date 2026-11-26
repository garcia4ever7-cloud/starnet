/* test/hostquota-run-cap.test.js — the PER-RUN cap on billable third-party runs (sidecar/hostquota.js).

   THE DEFECT (live, 2026-11-25, run 93e8cc89): SCOUT's routine prompt said "scrape AT MOST 3 shops this run".
   The run launched 8 Apify shop scrapes in batches of three and spent the whole team's daily allowance in four
   minutes. Nothing was broken — the limit was prose, and the only host rail counted the DAY (8), not the RUN.

   What is pinned here, through the REAL modules and the REAL place a connector call leaves (translate.js
   makeMcpToolDef.run) — no network, no key, no clock:
     1. the exact call sequence of run 93e8cc89 stops at 3, and the refused calls never reach the connector
     2. a refused call does NOT spend the team's daily counter
     3. a second run gets its own 3; the daily cap still wins across runs
     4. both doors (connector tool + web_request host) draw on the same per-run count
     5. read-only Apify tools and other connectors stay unmetered
     6. no runId -> daily cap only (historic behaviour); explicit 0 switches the per-run cap off
     7. the tracked-run table is bounded */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const A = require('./_assert.js');
const { makeHostQuota, parseLimits, DEFAULT_RUN_LIMITS } = require('../sidecar/hostquota.js');
const { makeMcpToolDef } = require('../sidecar/mcp/translate.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'starnet-runcap-'));
const NOW = () => Date.parse('2026-11-25T09:00:00');
let n = 0;
const fresh = (extra) => makeHostQuota(Object.assign({ fs, file: path.join(tmp, 'q' + (++n) + '.json'), now: NOW }, extra || {}));
const dayCount = (q, file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')).counts['apify.com'] || 0; } catch (_) { return 0; } };

async function main() {
  A.eq(DEFAULT_RUN_LIMITS['apify.com'], 3, 'the default per-run cap on Apify actor runs is 3');

  /* ---- 1. replay run 93e8cc89 through the real tool def ---- */
  const file1 = path.join(tmp, 'replay.json');
  const quota = makeHostQuota({ fs, file: file1, now: NOW });
  const left = [];   // every call that actually reached the connector
  const def = makeMcpToolDef({
    connectorId: 'apify', label: 'Apify Etsy', quota,
    mcpTool: { name: 'good-apis--etsy-shop-scraper', description: 'scrape a shop', inputSchema: { type: 'object' } },
    call: async (name, args) => { left.push(args.shop_name); return { content: [{ type: 'text', text: 'ok ' + args.shop_name }] }; }
  });
  const SHOPS = ['AbidingPressCo', 'AuraHomeCollections', 'MyDosesofGrace', 'LoveDictionary', 'TheFDCollective',
    'DeerfieldPaperCo', 'DobbieDesigns', 'ScriptfulArt'];
  const ctx = { runId: '93e8cc89-b720-4e34-92ae-c1c2c781a589' };
  const outcomes = [];
  for (const shop of SHOPS) {
    try { await def.run({ shop_name: shop, waitSecs: 45 }, ctx); outcomes.push('ran'); }
    catch (e) { outcomes.push('refused'); if (outcomes.length === 4) A.ok(/per RUN/.test(e.message) && /do not retry/i.test(e.message), 'the refusal names the per-run rail and says not to retry: ' + e.message); }
  }
  A.eq(outcomes, ['ran', 'ran', 'ran', 'refused', 'refused', 'refused', 'refused', 'refused'], 'the 8-scrape sequence of run 93e8cc89 stops after 3');
  A.eq(left, SHOPS.slice(0, 3), 'only the first three calls ever reached the connector — a refused call never leaves');
  A.eq(dayCount(quota, file1), 3, 'five refused calls spent NOTHING from the team\'s daily counter');

  /* ---- 3. another run gets its own allowance; the day still wins ---- */
  const ctx2 = { runId: 'run-two' }, ctx3 = { runId: 'run-three' };
  for (let i = 0; i < 3; i++) await def.run({ shop_name: 'b' + i }, ctx2);
  A.eq(left.length, 6, 'a second run gets its own 3');
  await def.run({ shop_name: 'c0' }, ctx3); await def.run({ shop_name: 'c1' }, ctx3);
  A.eq(dayCount(quota, file1), 8, 'eight across three runs — the daily counter is unchanged in meaning');
  let dayErr = '';
  try { await def.run({ shop_name: 'c2' }, ctx3); } catch (e) { dayErr = e.message; }
  A.ok(/per day for the WHOLE team/.test(dayErr), 'run three had one of its own left, but the DAILY cap refuses the 9th: ' + dayErr);
  A.eq(left.length, 8, 'and that 9th call never left');

  /* ---- 4. two doors, one per-run count ---- */
  const q4 = fresh();
  A.eq(q4.consumeTool('apify', 'good-apis--etsy-search-scraper', 'r').runUsed, 1, 'search scraper counts 1 for the run');
  A.eq(q4.consumeTool('apify', 'good-apis--etsy-shop-scraper', 'r').runUsed, 2, 'shop scraper draws on the same per-run count');
  A.eq(q4.consume('api.apify.com', 'r').runUsed, 3, 'and so does a direct web_request to Apify');
  const over = q4.consume('console.apify.com', 'r');
  A.eq([over.ok, over.scope, over.limit], [false, 'run', 3], 'the 4th, by either door, is refused with scope "run"');

  /* ---- 5. unmetered things stay unmetered ---- */
  for (const ro of ['get-dataset-items', 'get-actor-run', 'fetch-actor-details', 'abort-actor-run'])
    A.eq(q4.consumeTool('apify', ro, 'r').limit, 0, ro + ' is not metered even in a run that is at its cap — paid-for work can still be collected');
  A.eq(q4.consumeTool('airtable', 'create_records_for_table', 'r').limit, 0, 'Airtable writes are untouched');
  A.eq(q4.consume('example.com', 'r').limit, 0, 'an uncapped host is untouched');

  /* ---- 6. no runId, and the off switch ---- */
  const q6 = fresh();
  for (let i = 1; i <= 8; i++) A.eq(q6.consumeTool('apify', 'good-apis--etsy-shop-scraper').used, i, 'no runId: call ' + i + ' of 8 is bounded by the daily cap only');
  A.eq(q6.consumeTool('apify', 'good-apis--etsy-shop-scraper').ok, false, 'no runId: the 9th is still refused by the day');
  const qOff = fresh({ runLimits: parseLimits('apify.com=0') });
  for (let i = 1; i <= 5; i++) A.eq(qOff.consumeTool('apify', 'good-apis--etsy-shop-scraper', 'r').ok, true, 'explicit apify.com=0: per-run cap off, call ' + i);
  const qTwo = fresh({ runLimits: parseLimits('apify.com=2') });
  qTwo.consume('api.apify.com', 'r'); qTwo.consume('api.apify.com', 'r');
  A.eq(qTwo.consume('api.apify.com', 'r').ok, false, 'HOST_RUN_LIMITS can tighten the cap (2)');
  A.eq(Object.keys(parseLimits('apify.com=lots')).length, 0, 'an unparseable HOST_RUN_LIMITS yields nothing, so the host keeps the default rather than "no rail"');
  for (const bad of [0, null, undefined, {}, 42]) A.eq(fresh().consume('api.apify.com', bad).runLimit, undefined, 'a non-string/empty runId is treated as no run, never as a shared bucket');

  /* ---- 7. bounded memory: the oldest run is forgotten, a recent one is not ---- */
  const q7 = fresh({ limits: { 'apify.com': 100000 } });
  for (let i = 0; i < 3; i++) q7.consume('api.apify.com', 'recent');
  for (let i = 0; i < 600; i++) q7.consume('api.apify.com', 'filler-' + i);
  A.eq(q7.consume('api.apify.com', 'filler-599').runUsed, 2, 'a run inside the window keeps its count');
  A.eq(q7.consume('api.apify.com', 'recent').runUsed, 1, 'a run 600 runs old has been evicted (table is bounded at 512)');
}

let crashed = null;
main().catch(e => { crashed = e; }).then(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  if (crashed) { console.log('FAIL: crashed — ' + (crashed && crashed.stack || crashed)); process.exit(1); }
  A.report('hostquota-run-cap');
});

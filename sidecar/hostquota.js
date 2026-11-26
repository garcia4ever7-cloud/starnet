/* sidecar/hostquota.js — a TEAM-WIDE daily cap on outbound web_request calls to named hosts.

   The owner's standing policy caps Apify at 8 runs per day across the whole team, "including failures".
   Nothing in this station enforced that: Apify is reached through web_request with a stored key, and the
   budget rails (budgetcaps.js) count MODEL spend in USD — they cannot see a third-party API call at all. The
   cap existed only as prose in SCOUT's skills, which is to say it existed only while a model chose to obey it.

   WHY THIS IS NOT A HOOK. sidecar/hooks.js is the Commander's extension point and is deliberately FAIL-OPEN:
   "a handler that throws or times out is skipped and logged, never fatal". Correct for a formatter, wrong for
   a money rail — a broken hook would silently restore unlimited spending. This module fails CLOSED: if the
   counter cannot be read or written, the call is refused.

   COUNT ATTEMPTS, NOT SUCCESSES. consume() increments BEFORE the request goes out and never decrements, so a
   400, a timeout and a 200 all cost one of the eight. That is what "including failures" means, and it is also
   the only honest reading: the station cannot know whether a failed Apify POST started a billable actor run.

   Pure-ish by the repo's rules: every ambient dependency is injected (fs facade, path, clock). Day boundaries
   are LOCAL midnight, matching the budget panel's "today" window.

   TWO DOORS, ONE COUNTER — and the SECOND one is the one that actually bills. Apify is reached from this
   station through its MCP CONNECTOR (`mcp:apify`, tools good-apis--etsy-search-scraper /
   good-apis--etsy-shop-scraper), not through web_request: capping only outbound HTTP would have been a rail in
   front of a door nobody uses. consumeTool() covers the connector path and shares the same daily file, so eight
   means eight however the run reaches Apify. Only the tools that START AN ACTOR RUN are metered — reading a
   finished dataset (get-dataset-items, get-actor-run, fetch-actor-details) costs nothing and must stay free, or
   the cap would stop an agent from collecting work it had already paid for.

   makeHostQuota({ fs, file, now, limits, toolLimits }) -> { consume, consumeTool, peek, limits, toolLimits }
     limits : { '<hostname suffix>': maxPerDay }  e.g. { 'apify.com': 8 }. A request matches a limit when its
              hostname equals the key or ends with '.' + key, so api.apify.com and console.apify.com share one
              budget — an actor run can be started from either and the cap is on RUNS, not on endpoints.
     toolLimits : { '<connectorId>:<toolNameSubstring>': { limit, counter } } — a connector tool matches when
              its name CONTAINS the substring, and `counter` names the shared budget it draws from (so the
              Apify scraper tools and api.apify.com all decrement 'apify.com').
     consume(host) / consumeTool(connectorId, toolName) -> { ok:true, host, used, limit }
              | { ok:false, host, used, limit, error }
              Anything matching NO limit returns { ok:true, limit:0 } and is never counted or persisted. */
'use strict';

const DEFAULT_LIMITS = Object.freeze({ 'apify.com': 8 });

/* PER-RUN CAP (2026-11-25). The daily cap bounds the TEAM; nothing bounded ONE RUN. SCOUT's routine prompt said
   "scrape at most 3 shops this run" and a live run (93e8cc89) launched 8 in batches of three, spending the whole
   team's day in four minutes — the limit was prose, so it held only while a model chose to obey it (the same
   defect the daily cap was written to close). Keyed by the same counter names as the daily limits, counted per
   host-minted runId, held in memory (a run does not outlive the process). 0 switches a counter's per-run cap off.
   A call with NO runId is bounded by the daily cap only: there is no run to count against, and inventing a shared
   bucket would lock every such caller out after three calls for the life of the process. */
const DEFAULT_RUN_LIMITS = Object.freeze({ 'apify.com': 3 });
const MAX_TRACKED_RUNS = 512;   // bounded: the oldest run is forgotten first; a live run is never that old

/* The CONNECTOR door. Keyed '<connectorId>:<substring of the tool name>'; only the two tools that START a
   billable Apify actor run are listed. `counter: 'apify.com'` makes them share the HTTP door's budget, so the
   owner's eight is eight in total and not eight per route. Deliberately a substring match: the projected tool
   name is mcp__apify__good-apis--etsy-search-scraper, and the MCP server may rename around the edges. */
const DEFAULT_TOOL_LIMITS = Object.freeze({
  'apify:etsy-search-scraper': Object.freeze({ limit: 8, counter: 'apify.com' }),
  'apify:etsy-shop-scraper': Object.freeze({ limit: 8, counter: 'apify.com' }),
  'apify:call-actor': Object.freeze({ limit: 8, counter: 'apify.com' }),
  'apify:run-actor': Object.freeze({ limit: 8, counter: 'apify.com' })
});

function localDayKey(ms) {
  const d = new Date(ms);
  const p = n => String(n).padStart(2, '0');
  return String(d.getFullYear()) + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

// the longest matching suffix wins, so a specific host can be capped tighter than its parent domain.
function matchLimit(limits, hostname) {
  const h = String(hostname || '').toLowerCase().replace(/\.$/, '');
  let best = null;
  for (const key of Object.keys(limits)) {
    const k = key.toLowerCase();
    if (h === k || h.endsWith('.' + k)) { if (!best || k.length > best.length) best = k; }
  }
  return best;
}

function parseLimits(spec) {
  // "apify.com=8,example.com=2" -> { 'apify.com': 8, 'example.com': 2 }. A malformed entry is skipped, never
  // defaulted to a bigger number: an unparseable rail must not read as "no rail".
  const out = {};
  for (const part of String(spec || '').split(/[,\s]+/)) {
    if (!part) continue;
    const m = /^([A-Za-z0-9.-]+)=(\d{1,6})$/.exec(part.trim());
    if (!m) continue;
    out[m[1].toLowerCase()] = Number(m[2]);
  }
  return out;
}

function makeHostQuota(deps) {
  deps = deps || {};
  const fs = deps.fs, file = deps.file, now = deps.now;
  const limits = (deps.limits && typeof deps.limits === 'object' && Object.keys(deps.limits).length)
    ? deps.limits : DEFAULT_LIMITS;
  const toolLimits = (deps.toolLimits && typeof deps.toolLimits === 'object') ? deps.toolLimits : DEFAULT_TOOL_LIMITS;
  const runLimits = (deps.runLimits && typeof deps.runLimits === 'object') ? deps.runLimits : DEFAULT_RUN_LIMITS;
  const perRun = new Map();   // runId -> { '<counter>': attempts }

  function runLimitFor(key) { const n = Number(runLimits[key]); return n > 0 ? Math.floor(n) : 0; }
  function runUsed(runId, key) { const row = perRun.get(runId); return row ? (Number(row[key]) || 0) : 0; }
  function runBump(runId, key) {
    let row = perRun.get(runId);
    if (!row) {
      if (perRun.size >= MAX_TRACKED_RUNS) perRun.delete(perRun.keys().next().value);
      row = {}; perRun.set(runId, row);
    }
    row[key] = (Number(row[key]) || 0) + 1;
    return row[key];
  }

  function load() {
    // A MISSING file is a fresh day, not a failure. An UNREADABLE/corrupt file is a failure, and fails closed.
    let raw;
    try { raw = fs.readFileSync(file, 'utf8'); }
    catch (e) { if (e && (e.code === 'ENOENT' || e.code === 'ENOTDIR')) return { day: null, counts: {} }; throw e; }
    const doc = JSON.parse(raw);
    return { day: (doc && doc.day) || null, counts: (doc && doc.counts && typeof doc.counts === 'object') ? doc.counts : {} };
  }

  function peek(hostname) {
    const key = matchLimit(limits, hostname);
    if (!key) return { ok: true, host: hostname, used: 0, limit: 0 };
    const limit = limits[key];
    let state;
    try { state = load(); } catch (e) { return { ok: false, host: key, used: limit, limit, error: 'daily-quota file unreadable (' + ((e && e.message) || e) + ') — refusing rather than spending blind' }; }
    const day = localDayKey(now());
    const used = state.day === day ? (Number(state.counts[key]) || 0) : 0;
    return { ok: used < limit, host: key, used, limit };
  }

  function consume(hostname, runId) {
    const key = matchLimit(limits, hostname);
    if (!key) return { ok: true, host: hostname, used: 0, limit: 0 };
    return consumeCounter(key, limits[key], runId);
  }

  /* THE CONNECTOR DOOR. An MCP tool that starts a billable third-party run draws on the SAME daily counter as
     the HTTP door, so the owner's cap cannot be doubled by switching routes. A tool matching no rule is a
     no-op: read-only Apify tools (get-dataset-items, get-actor-run) must stay free, or the cap would block an
     agent from collecting work already paid for. */
  function consumeTool(connectorId, toolName, runId) {
    const cid = String(connectorId || '').toLowerCase();
    const tname = String(toolName || '').toLowerCase();
    for (const rule of Object.keys(toolLimits)) {
      const i = rule.indexOf(':');
      if (i < 0) continue;
      const wantCid = rule.slice(0, i).toLowerCase();
      const needle = rule.slice(i + 1).toLowerCase();
      if (wantCid !== cid || !needle || tname.indexOf(needle) < 0) continue;
      const cfg = toolLimits[rule] || {};
      const limit = Number(cfg.limit) > 0 ? Number(cfg.limit) : 0;
      if (!limit) continue;
      return consumeCounter(String(cfg.counter || rule), limit, runId);
    }
    return { ok: true, host: cid + ':' + tname, used: 0, limit: 0 };
  }

  function consumeCounter(key, limit, runId) {
    /* PER-RUN CAP FIRST, and a refusal here does NOT touch the daily counter: the call never leaves, so it
       cannot have started a billable run, and charging the team's day for it would let one looping run burn
       all eight by being refused. Counted like the daily cap — per ATTEMPT that was let through. */
    const rid = (typeof runId === 'string' && runId) ? runId : '';
    const runLimit = rid ? runLimitFor(key) : 0;
    if (runLimit) {
      const usedThisRun = runUsed(rid, key);
      if (usedThisRun >= runLimit) {
        return { ok: false, host: key, used: usedThisRun, limit: runLimit, scope: 'run',
          error: key + ' is capped at ' + runLimit + ' request' + (runLimit === 1 ? '' : 's') + ' per RUN by the station (a hard rail, not a guideline); this run has used '
            + usedThisRun + '. Do not retry and do not route around it — nothing further will start in this run. Record what you already have and finish.' };
      }
    }
    const day = localDayKey(now());
    let state;
    try { state = load(); }
    catch (e) { return { ok: false, host: key, used: limit, limit, error: 'daily-quota file unreadable (' + ((e && e.message) || e) + ') — refusing rather than spending blind' }; }
    const counts = state.day === day ? Object.assign({}, state.counts) : {};
    const used = Number(counts[key]) || 0;
    if (used >= limit) {
      return { ok: false, host: key, used, limit,
        error: key + ' is capped at ' + limit + ' request' + (limit === 1 ? '' : 's') + ' per day for the WHOLE team (the owner\'s standing policy, counted including failures); '
          + used + ' have already been used today. Do not retry and do not route around it — report this to the Commander and work on something else.' };
    }
    counts[key] = used + 1;
    try { fs.writeFileSync(file, JSON.stringify({ day, counts }), { mode: 0o600 }); }
    catch (e) { return { ok: false, host: key, used, limit, error: 'daily-quota file unwritable (' + ((e && e.message) || e) + ') — refusing rather than spending uncounted' }; }
    const out = { ok: true, host: key, used: used + 1, limit };
    if (runLimit) { out.runUsed = runBump(rid, key); out.runLimit = runLimit; }
    return out;
  }

  return { consume, consumeTool, peek, limits, toolLimits, runLimits };
}

module.exports = { makeHostQuota, parseLimits, DEFAULT_LIMITS, DEFAULT_TOOL_LIMITS, DEFAULT_RUN_LIMITS, localDayKey, matchLimit };

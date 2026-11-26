#!/usr/bin/env node
/* scripts/etsy-dryrun.mjs — exercise the REAL delegation mechanism for the Etsy chain, without production
 * writes and, by default, without spending a cent.
 *
 * WHAT IT IS FOR. The Etsy chain has never run end to end. Two different things can be wrong — the
 * DELEGATION MECHANISM (does team.dispatch reach its workers at all?) and the WORK (is the research/art/listing
 * any good?) — and a failed paid fire cannot tell them apart. This separates them: VERIFY mode drives the
 * shipping `team.dispatch` tool with an injected fake run host, so the host's own target validation, worker
 * sequencing, depth fence, handoff recording and result aggregation all execute for real at $0. SPEND mode
 * fires the actual routine and is behind two explicit flags.
 *
 *   node scripts/etsy-dryrun.mjs                       # VERIFY (default): $0, no provider call, no tool call
 *   node scripts/etsy-dryrun.mjs --json
 *   node scripts/etsy-dryrun.mjs --no-report            # skip writing the report file
 *   node scripts/etsy-dryrun.mjs --report=<path>
 *   node scripts/etsy-dryrun.mjs --spend --i-understand-this-spends-money
 *
 * WHAT EACH MODE PROVES, EXACTLY — do not overstate either:
 *
 *   VERIFY proves: the preflight's five axes; that the real dispatchTool.run() accepts this crew; that an
 *     unknown agentId and a self-dispatch are REFUSED (not guessed); that every worker is started with
 *     surface:'autonomous' and parentRunId set, which is the structural depth-1 fence; that a handoff record
 *     is produced for EVERY outcome including failures; and that the aggregate the lead reads back names each
 *     worker. It proves NOTHING about model quality, provider credit, prompt sufficiency, or whether a worker
 *     can actually do its stage — the run host is a fake.
 *
 *   SPEND proves: all of the above against the live sidecar with real models, real workers and real cost.
 *     It is the only mode that can show the chain working. It requires the preflight to PASS first.
 *
 * HARD SAFETY BOUNDARY, enforced in code and not by instruction:
 *   1. Nothing runs unless `etsy-preflight.mjs` returns PASS. The preflight is IMPORTED, not re-implemented.
 *   2. The routine prompt must still carry draft-only language (`requireDraftOnly`). A routine someone has
 *      quietly turned into a publisher aborts the dry run before any stage starts.
 *   3. Every brief this script composes is screened by `screenForForbiddenIntent()` and the stage is REFUSED
 *      if it reads as publishing, buying, listing-modification, an Apify run or an Airtable write.
 *   4. VERIFY mode holds no API token, builds no tool registry and opens no socket, so it cannot call a
 *      forbidden tool even by accident: the only execution path is a pure canned function.
 *   5. It writes NOTHING into workspaces/<leadId>/outbox/. Handoff files are the HOST's record of real work;
 *      a synthetic one there would be a fabricated artifact. Existing ones are inventoried read-only.
 */
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import {
  REPO, WORKSPACES, ETSY_CHAIN_JOB_ID, ETSY_WORKERS,
  assess, gatherLiveInputs, renderText as renderPreflight
} from './etsy-preflight.mjs';

const req = createRequire(import.meta.url);
const { makeOrchestrationTools } = req(path.join(REPO, 'sidecar/tools/builtin/orchestration.js'));

const HOME = os.homedir();

/* ================================ SAFETY BOUNDARY ================================ */

/* The routine must still SAY draft-only. Both clauses are required: "draft only" alone could survive a
   rewrite that added a publish step elsewhere, and "publish nothing" alone could survive one that dropped
   the draft instruction. Patterns are deliberately loose on punctuation and tight on meaning. */
export const DRAFT_ONLY_REQUIRED = [
  { id: 'draft-only', re: /\bdraft\s+only\b/i, why: 'the listing stage must ask for a DRAFT, never a live listing' },
  { id: 'publish-nothing', re: /\bpublish\s+nothing\b/i, why: 'the routine must forbid publishing outright' }
];

export function requireDraftOnly(promptText) {
  const text = String(promptText || '');
  const missing = DRAFT_ONLY_REQUIRED.filter(p => !p.re.test(text));
  return {
    ok: missing.length === 0,
    missing: missing.map(m => ({ id: m.id, pattern: String(m.re), why: m.why })),
    checked: DRAFT_ONLY_REQUIRED.map(p => p.id)
  };
}

/* Intent screen for text THIS SCRIPT composes and would hand to a worker. It is not a content filter for
   model output — it cannot be, and pretending otherwise would be the false-assurance this repo keeps paying
   for. It is a tripwire on the one thing the script controls: its own briefs. */
export const FORBIDDEN_INTENT = [
  { id: 'publish', re: /\b(publish|go\s+live|make\s+it\s+live|list\s+it\s+on\s+etsy)\b/i },
  { id: 'listing-modify', re: /\b(update|edit|modify|delete|deactivate)\s+(the\s+)?(live\s+)?listing\b/i },
  { id: 'purchase', re: /\b(buy|purchase|order|checkout|pay\s+for|top\s+up)\b/i },
  { id: 'apify-run', re: /\b(apify|actor\s+run|run\s+the\s+actor|new\s+scrape)\b/i },
  { id: 'airtable-write', re: /\b(airtable|create\s+a\s+record|update\s+the\s+record|write\s+the\s+row)\b/i },
  { id: 'credentials', re: /\b(api\s+key|token|credential|budget\s+cap|permission)\b/i }
];

export function screenForForbiddenIntent(text) {
  const t = String(text || '');
  const hits = FORBIDDEN_INTENT.filter(p => p.re.test(t)).map(p => p.id);
  return { ok: hits.length === 0, hits };
}

/* ================================ THE STAGES ================================
   Mirrors the routine's own Stage 1 / 2 / 2.5 / 3, but with briefs this script authors so the intent screen
   has something real to screen. The briefs are deliberately colourless: VERIFY mode is a mechanism test, and
   a brief that reads like real work would tempt a future reader into quoting its output as research. */
export const STAGES = [
  { id: 'stage-1-research', worker: 'scout', brief: 'DRY RUN, mechanism only. Do not research anything. Reply with the single word ACK.' },
  { id: 'stage-2-design', worker: 'webdesigner', brief: 'DRY RUN, mechanism only. Draw nothing and save nothing. Reply with the single word ACK.' },
  { id: 'stage-2.5-validation', worker: 'qceditor', brief: 'DRY RUN, mechanism only. Inspect nothing. Reply with the single word ACK.' },
  { id: 'stage-3-listing', worker: 'publisher', brief: 'DRY RUN, mechanism only. Draft nothing. Reply with the single word ACK.' }
];

/* ================================ VERIFY MODE ================================ */

/* The fake run host. It is the ONLY execution path in verify mode: it runs no tool, opens no socket, and
   books $0. It records exactly what the real dispatcher asked for, which is the evidence this mode produces. */
function makeFakeRunHost(log) {
  return async function fakeRunOnce(opts) {
    log.push({
      agentId: opts.agentId,
      surface: opts.surface,
      parentRunId: opts.parentRunId || null,
      isTask: !!opts.isTask,
      model: opts.model || null,
      maxCostUsd: opts.maxCostUsd,
      maxIters: opts.maxIters,
      sawConsentBroker: typeof opts.consent === 'function',
      promptChars: (opts.messages || []).reduce((n, m) => n + String((m && m.content) || '').length, 0)
    });
    return {
      messages: [{ role: 'assistant', content: 'ACK (dry run — no work performed, no tool called, $0)' }],
      usd: 0, reason: 'done', artifacts: [], taintedBy: ''
    };
  };
}

export async function runVerifyMode(o) {
  const opts = o || {};
  const leadId = String(opts.leadId || 'agent');
  const rosterIds = new Set((opts.roster || []).map(String));
  const stages = Array.isArray(opts.stages) ? opts.stages : STAGES;
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now();

  // the crew map the real tool validates against. Only ids actually on the live roster are offered, so a
  // missing agent surfaces as the host's own refusal rather than being papered over here.
  const crew = new Map();
  for (const id of rosterIds) crew.set(id, { system: 'dry-run identity', name: id, model: 'dry-run-model' });

  const workerLog = [];
  const handoffSink = [];
  let seq = 0;
  const tools = makeOrchestrationTools({
    roster: () => crew,
    key: 'DRY-RUN-NO-KEY', model: 'dry-run-model', provider: 'dry-run',
    newId: () => 'dryrun-worker-' + (++seq),
    // The handoff record is captured IN MEMORY. The host writes the real ones into
    // workspaces/<leadId>/outbox/; a synthetic file there would be indistinguishable from a record of real
    // delegated work, which is the exact failure class this station has already paid for twice.
    recordHandoff: (h) => { handoffSink.push(h); return { ok: true, relPath: '(in-memory: dry run writes no handoff file)' }; },
    runOnce: makeFakeRunHost(workerLog)
  });

  const rows = [];
  for (const st of stages) {
    const startedAt = now();
    const screen = screenForForbiddenIntent(st.brief);
    if (!screen.ok) {
      rows.push({
        stage: st.id, worker: st.worker, outcome: 'REFUSED-BY-GUARD',
        startedAt: new Date(startedAt).toISOString(), endedAt: new Date(startedAt).toISOString(), ms: 0,
        reason: 'the brief this script composed matched the forbidden-intent screen: ' + screen.hits.join(', '),
        error: '', retries: 0, taintedBy: '', handoffFile: '', dispatchSummary: ''
      });
      continue;
    }
    let res = null, error = '';
    try {
      res = await tools.dispatchTool.run(
        { workers: [{ agentId: st.worker, prompt: st.brief }] },
        { agentId: leadId, runId: 'dryrun-lead', emit: () => {} }
      );
    } catch (e) { error = 'dispatchTool.run threw: ' + ((e && e.message) || e); }
    const endedAt = now();

    let row0 = null;
    try { row0 = (JSON.parse(String((res && res.content) || '[]')) || [])[0] || null; } catch (_) { row0 = null; }

    rows.push({
      stage: st.id,
      worker: st.worker,
      outcome: error ? 'ERROR' : (row0 && row0.reason === 'done' ? 'DISPATCHED' : 'REFUSED-BY-HOST'),
      startedAt: new Date(startedAt).toISOString(),
      endedAt: new Date(endedAt).toISOString(),
      ms: endedAt - startedAt,
      reason: (row0 && row0.reason) || '',
      error: error || (row0 && row0.reason !== 'done' ? String(row0.result || '') : ''),
      // The routine's "one repair round on VERDICT: CHANGES" is the LEAD'S prompt-level judgement, not a host
      // mechanism, so a mechanism dry run cannot exercise it. Recorded as 0 with that said out loud rather
      // than reported as "no retries needed".
      retries: 0,
      retriesNote: 'the repair round is lead-prompt logic, not a host mechanism — not exercised by verify mode',
      taintedBy: String((row0 && row0.taintedBy) || ''),
      handoffFile: String((row0 && row0.handoffFile) || ''),
      dispatchSummary: String((res && res.summary) || ''),
      usd: Number((row0 && row0.usd) || 0)
    });
  }

  /* The two refusals that must hold. Asserted by DRIVING the real tool, not by reading its source. */
  const negatives = [];
  for (const probe of [
    { label: 'self-dispatch', agentId: leadId, expect: /cannot delegate to yourself/i },
    { label: 'unknown-agentId', agentId: 'definitely-not-an-agent', expect: /no such live worker/i }
  ]) {
    let got = '';
    try {
      const r = await tools.dispatchTool.run(
        { workers: [{ agentId: probe.agentId, prompt: 'DRY RUN, mechanism only. Reply ACK.' }] },
        { agentId: leadId, runId: 'dryrun-lead', emit: () => {} }
      );
      const row = (JSON.parse(String(r.content || '[]')) || [])[0] || {};
      got = String(row.result || '');
    } catch (e) { got = 'threw: ' + ((e && e.message) || e); }
    negatives.push({ probe: probe.label, refused: probe.expect.test(got), saw: got });
  }

  const depthFenceHeld = workerLog.length > 0 && workerLog.every(w => w.surface === 'autonomous' && !!w.parentRunId);

  return {
    mode: 'verify',
    spent: 0,
    rows,
    workerLog,
    negatives,
    handoffsRecorded: handoffSink.length,
    depthFenceHeld,
    proves: [
      'the shipping team.dispatch run() accepts this crew and sequences each stage',
      'an unknown agentId and a self-dispatch are refused by the host, never guessed',
      'every worker is started surface:autonomous with parentRunId set (the structural depth-1 fence)',
      'a handoff record is produced for every outcome, failures included'
    ],
    provesNot: [
      'that any model can do its stage — the run host is a fake and no model was called',
      'that a provider has credit, or that the live sidecar is healthy',
      'that the artwork, research or listing text would be any good',
      'that the lead\'s one-repair-round logic works — that is prompt judgement, not a host mechanism'
    ]
  };
}

/* ================================ SPEND MODE ================================ */

function readEnvFile(file) {
  const out = {};
  let raw = '';
  try { raw = fs.readFileSync(file, 'utf8'); } catch (_) { return out; }
  for (const line of raw.split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

export async function runSpendMode(o) {
  const opts = o || {};
  const jobId = String(opts.jobId || ETSY_CHAIN_JOB_ID);
  const base = opts.base || ('http://127.0.0.1:' + (process.env.STARNET_PORT || process.env.PORT || '8787'));
  const env = opts.env || readEnvFile(process.env.STARNET_ENVFILE || path.join(HOME, '.config', 'starnet', 'env'));
  const token = String(env.STARNET_API_TOKEN || '');
  const doFetch = opts.fetch || globalThis.fetch;
  const startedAt = Date.now();

  if (!token) {
    return { mode: 'spend', started: false, reason: 'no STARNET_API_TOKEN in the sidecar env file — refusing to fire blind' };
  }
  // Health first: firing into a dead sidecar produces a confusing network error rather than an honest refusal.
  try {
    const h = await doFetch(base + '/api/health', { method: 'GET' });
    if (!h || !h.ok) return { mode: 'spend', started: false, reason: 'sidecar /api/health did not answer ok (status ' + (h && h.status) + ')' };
  } catch (e) {
    return { mode: 'spend', started: false, reason: 'sidecar unreachable at ' + base + ': ' + ((e && e.message) || e) };
  }

  /* ONE fire of the routine, on its own recorded prompt, model, grants and spend ceiling. Deliberately
     POST /api/cron/run and NOT /api/cron/update: this must not arm, disarm, reschedule or otherwise change
     the routine. The route's auth header is x-starnet-token, never Authorization: Bearer. */
  let fired = null, error = '';
  try {
    const r = await doFetch(base + '/api/cron/run', {
      method: 'POST',
      headers: { 'x-starnet-token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: jobId })
    });
    const text = await r.text();
    fired = { status: r.status, body: text.slice(0, 2000) };
    if (!r.ok) error = 'POST /api/cron/run returned ' + r.status;
  } catch (e) { error = 'POST /api/cron/run failed: ' + ((e && e.message) || e); }

  return {
    mode: 'spend',
    started: !error,
    startedAt: new Date(startedAt).toISOString(),
    jobId, fired, error,
    reason: error || 'routine fired once on its own recorded configuration (no schedule or flag was changed)',
    followUp: [
      'the fire is ASYNCHRONOUS — read the outcome from the cron row, not from this response',
      'GET /api/cron and read lastRunId / lastStatus / lastReason / lastUsd for ' + jobId,
      'new handoff files appear in workspaces/<leadId>/outbox/ as <utc-stamp>-<lead>-to-<worker>.md',
      'a run only counts as real if its toolTrace shows team_dispatch ok with workers done — reason:done alone proves nothing'
    ]
  };
}

/* ================================ OUTBOX INVENTORY (read-only) ================================ */

export function inventoryHandoffs(leadId, workspaces, since) {
  const dir = path.join(workspaces || WORKSPACES, String(leadId || 'agent'), 'outbox');
  let names = [];
  try { names = fs.readdirSync(dir); } catch (_) { return { dir, readable: false, files: [] }; }
  const files = names
    .filter(n => /^\d{8}-\d{6}-.+-to-.+\.md$/.test(n))
    .sort()
    .map(n => {
      let size = null, mtime = null;
      try { const s = fs.statSync(path.join(dir, n)); size = s.size; mtime = s.mtime.toISOString(); } catch (_) {}
      return { name: n, bytes: size, mtime };
    });
  const recent = since ? files.filter(f => f.mtime && f.mtime >= since) : files;
  return { dir, readable: true, count: files.length, newest: files.slice(-6), newSinceStart: since ? recent : null };
}

/* ================================ REPORT ================================ */

/* The four workers share four of their six axes, so a naive blocker dump repeats the same paragraph four
   times and buries the one line that differs. Collapse to DISTINCT blockers, naming who each applies to. */
export function distinctBlockers(preflight) {
  const byText = new Map();
  for (const w of (preflight.workers || [])) {
    for (const b of (w.blockers || [])) {
      if (!byText.has(b)) byText.set(b, []);
      byText.get(b).push(w.agentId);
    }
  }
  return Array.from(byText.entries()).map(([text, who]) => ({
    who: who.length === (preflight.workers || []).length ? 'all workers' : who.join(', '),
    text
  }));
}

export function renderReport(r) {
  const L = [];
  L.push('# Etsy chain dry run — ' + r.at);
  L.push('');
  L.push('MODE    : ' + r.mode + (r.mode === 'verify' ? '   (non-spending: $0, no provider call, no tool call)' : '   (SPENDING: real models, real cost)'));
  L.push('VERDICT : ' + r.verdict);
  L.push('routine : ' + r.jobId + (r.jobName ? '  (' + r.jobName + ')' : ''));
  L.push('lead    : ' + r.leadId);
  L.push('');
  L.push('## Gate 1 — preflight (scripts/etsy-preflight.mjs, imported not re-implemented)');
  L.push('');
  L.push('    ' + r.preflight.verdict + '  —  ' + r.preflight.counts.failed + ' FAIL, '
    + r.preflight.counts.unverified + ' UNVERIFIED of ' + r.preflight.counts.workers + ' workers');
  if (r.preflight.verdict !== 'PASS') {
    for (const b of distinctBlockers(r.preflight)) L.push('    - [' + b.who + '] ' + b.text);
  }
  L.push('');
  L.push('## Gate 2 — draft-only language still present in the routine prompt');
  L.push('');
  L.push('    ' + (r.draftOnly.ok ? 'PASS — ' + r.draftOnly.checked.join(', ') + ' all present'
                                  : 'FAIL — missing: ' + r.draftOnly.missing.map(m => m.id).join(', ')));
  for (const m of r.draftOnly.missing) L.push('    - ' + m.id + ' (' + m.pattern + '): ' + m.why);
  L.push('');
  if (!r.stagesRan) {
    L.push('## Stages');
    L.push('');
    L.push('    NOT RUN — ' + r.abortReason);
    L.push('');
  } else if (r.mode === 'verify') {
    L.push('## Stages (verify mode — real dispatcher, fake run host)');
    L.push('');
    L.push('    | stage | worker | outcome | ms | usd | taint | handoff |');
    L.push('    |---|---|---|---|---|---|---|');
    for (const s of r.run.rows) {
      L.push('    | ' + s.stage + ' | ' + s.worker + ' | ' + s.outcome + ' | ' + s.ms + ' | '
        + s.usd.toFixed(4) + ' | ' + (s.taintedBy || 'clean') + ' | ' + (s.handoffFile || '-') + ' |');
    }
    L.push('');
    for (const s of r.run.rows) {
      if (s.error) L.push('    ' + s.stage + ' error: ' + s.error);
      L.push('    ' + s.stage + ' window: ' + s.startedAt + ' -> ' + s.endedAt
        + '  retries=' + s.retries + ' (' + s.retriesNote + ')');
    }
    L.push('');
    L.push('### Host refusals, proven by driving the real tool');
    L.push('');
    for (const n of r.run.negatives) L.push('    ' + (n.refused ? 'ok  ' : 'FAIL') + ' ' + n.probe + ': ' + n.saw);
    L.push('');
    L.push('### Depth fence');
    L.push('');
    L.push('    ' + (r.run.depthFenceHeld ? 'ok  ' : 'FAIL') + ' every worker started surface:autonomous with parentRunId set');
    for (const w of r.run.workerLog) {
      L.push('    - ' + w.agentId + ' surface=' + w.surface + ' parentRunId=' + w.parentRunId
        + ' sharedConsentBroker=' + w.sawConsentBroker);
    }
    L.push('');
    L.push('    NOT a measurement of the live per-worker spend ceiling: this dry run injects no `perWorker`,');
    L.push('    so the maxCostUsd it observes (' + JSON.stringify(r.run.workerLog.map(w => w.maxCostUsd))
      + ') describes this harness, not the sidecar. Read the real one from BUDGET_PER_WORKER / budget.json.');
    L.push('');
    L.push('    handoff records produced: ' + r.run.handoffsRecorded
      + ' (in memory — this script writes NO file into the lead\'s outbox, see below)');
    L.push('');
    L.push('### What this run proves');
    L.push('');
    for (const p of r.run.proves) L.push('    + ' + p);
    L.push('');
    L.push('### What it does NOT prove');
    L.push('');
    for (const p of r.run.provesNot) L.push('    - ' + p);
    L.push('');
  } else {
    L.push('## Spend mode');
    L.push('');
    L.push('    started: ' + r.run.started);
    L.push('    reason : ' + r.run.reason);
    if (r.run.fired) L.push('    fired  : HTTP ' + r.run.fired.status + ' ' + r.run.fired.body);
    L.push('');
    for (const f of r.run.followUp || []) L.push('    next: ' + f);
    L.push('');
  }
  L.push('## Handoff files (read-only inventory — the HOST writes these, this script never does)');
  L.push('');
  L.push('    ' + r.handoffs.dir);
  if (!r.handoffs.readable) L.push('    (not readable)');
  else {
    L.push('    ' + r.handoffs.count + ' lead->worker handoff file(s) on disk; newest:');
    for (const f of r.handoffs.newest) L.push('      ' + f.name + '  ' + f.bytes + ' B  ' + f.mtime);
    if (r.handoffs.newSinceStart) L.push('    new since this dry run started: ' + r.handoffs.newSinceStart.length);
  }
  L.push('');
  L.push('## Safety boundary actually enforced in this run');
  L.push('');
  for (const s of r.safety) L.push('    + ' + s);
  L.push('');
  return L.join('\n');
}

/* ================================ CLI ================================ */

export async function main(argv) {
  const args = (argv || []).slice();
  const flag = (n) => args.some(a => a === '--' + n);
  const value = (n) => { const h = args.find(a => a.indexOf('--' + n + '=') === 0); return h ? h.slice(n.length + 3) : null; };
  const jobId = value('job') || ETSY_CHAIN_JOB_ID;
  const wantSpend = flag('spend');
  const spendConfirmed = flag('i-understand-this-spends-money');
  const at = new Date().toISOString();
  const startedAtIso = at;

  let gathered;
  try { gathered = gatherLiveInputs({ jobId }); }
  catch (e) {
    const msg = 'DRY RUN ABORTED — could not read live state: ' + ((e && e.message) || e);
    console.log(msg);
    return { code: 1, text: msg };
  }
  const leadId = gathered.input.leadId;
  const preflight = assess(gathered.input);
  const draftOnly = requireDraftOnly(gathered.input.promptText);

  const safety = [
    'the preflight was IMPORTED from scripts/etsy-preflight.mjs and re-run here — its logic is not duplicated',
    'the routine prompt was screened for draft-only language before any stage was considered',
    'every brief this script composes was screened against the forbidden-intent list ('
      + FORBIDDEN_INTENT.map(f => f.id).join(', ') + ')',
    'nothing was written into ' + path.join(WORKSPACES, leadId, 'outbox') + ' — handoff files are the host\'s record',
    'no schedule, grant, budget, credential or permission was read-modified-written'
  ];

  /* --- the two gates. FAIL CLOSED: a mode that would spend is refused hardest. --- */
  let stagesRan = false, abortReason = '', run = null, verdict = 'ABORTED';

  if (wantSpend && !spendConfirmed) {
    abortReason = '--spend requires --i-understand-this-spends-money as well. This mode fires the real routine '
      + 'with real models against a station whose lifetime spend already exceeds the stated $100 ceiling.';
  } else if (!draftOnly.ok) {
    abortReason = 'the routine prompt no longer carries draft-only language (missing: '
      + draftOnly.missing.map(m => m.id).join(', ') + '). Refusing to exercise a chain that may publish.';
  } else if (preflight.verdict !== 'PASS') {
    abortReason = 'preflight did not PASS (' + preflight.counts.failed + ' FAIL, '
      + preflight.counts.unverified + ' UNVERIFIED). The lead cannot reach its workers, so a dry run would '
      + 'measure nothing. Distinct blockers: '
      + distinctBlockers(preflight).map(b => '[' + b.who + '] ' + b.text).join('  ||  ');
  } else if (wantSpend) {
    safety.push('SPEND MODE: the routine was fired ONCE via POST /api/cron/run — no arm, no reschedule, no edit');
    run = await runSpendMode({ jobId });
    stagesRan = true;
    verdict = run.started ? 'FIRED' : 'ABORTED';
    if (!run.started) abortReason = run.reason;
  } else {
    run = await runVerifyMode({ leadId, roster: gathered.input.roster });
    stagesRan = true;
    const allOk = run.rows.every(r => r.outcome === 'DISPATCHED')
      && run.negatives.every(n => n.refused) && run.depthFenceHeld;
    verdict = allOk ? 'PASS' : 'FAIL';
  }

  const report = {
    at, mode: wantSpend ? 'spend' : 'verify', verdict,
    jobId: gathered.job.id, jobName: gathered.job.name, leadId,
    preflight, draftOnly, stagesRan, abortReason, run,
    handoffs: inventoryHandoffs(leadId, WORKSPACES, startedAtIso),
    safety
  };

  const text = renderReport(report);
  if (flag('json')) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(text);
    if (preflight.verdict !== 'PASS') {
      console.log('--- PREFLIGHT DETAIL ---');
      console.log(renderPreflight(preflight, { jobId: gathered.job.id, jobName: gathered.job.name, at }));
    }
  }

  if (!flag('no-report')) {
    const stamp = at.replace(/[:.]/g, '-');
    const abs = path.resolve(value('report') || path.join(WORKSPACES, '.dryrun', 'etsy-dryrun-' + stamp + '.md'));
    try {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, text + '\n\n```json\n' + JSON.stringify(report, null, 2) + '\n```\n');
      if (!flag('json')) console.log('report written: ' + abs);
    } catch (e) { console.log('report NOT written (' + ((e && e.message) || e) + ')'); }
  }

  return { code: verdict === 'PASS' || verdict === 'FIRED' ? 0 : 1, report, text };
}

const invokedDirectly = (() => {
  try { return process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url)); }
  catch (_) { return false; }
})();
if (invokedDirectly) {
  const r = await main(process.argv.slice(2));
  process.exit(r.code);
}

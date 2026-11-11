/* memorial/business/costs.mjs — what an order actually cost, including everything the model
 * ledger cannot see.
 *
 * WHY THIS EXISTS
 * ---------------
 * StarNet's budget rails count MODEL spend in USD and nothing else. sidecar/ledger.js rows are
 * `{runId, agentId, turns, usd, tokens, model, unmetered, ts}` — no vendor, no category, no order.
 * sidecar/hostquota.js is the only non-model meter and it counts CALLS PER DAY, not money.
 * So today the station literally cannot answer "what did that product cost to make", which is the
 * difference between having agents and having a business.
 *
 * Extending sidecar/ledger.js would have been wrong: its totals feed budgetcaps.js, so adding
 * non-model rows there would corrupt the $25/day governor. This is a separate book with a wider
 * row, and it deliberately records a `kind` so model spend can be reconciled against the real
 * ledger rather than double-counted.
 *
 * A note on Higgsfield, recorded because it is a live accounting hole: there are TWO wallets. The
 * MCP tools spend the owner's Plus credits (1,045 at last check); the platform REST path that
 * StarNet's code uses bills an account with no readable balance, no ledger entry and no cost
 * preflight. Any REST render must be recorded here as `estimated: true`, because the true figure
 * is not observable from this device.
 */
'use strict';

import { append, readAll, logPath } from './jsonl.mjs';

export const COSTS_FILE = () => logPath('costs.jsonl');

/** model = LLM tokens · credits = third-party units · licence = one-off rights · labour = minutes */
export const KINDS = ['model', 'credits', 'licence', 'labour', 'fee', 'other'];

/**
 * record — one cost against one order.
 * @param {string} kind     one of KINDS
 * @param {number} usd      best-known dollar figure; 0 is legitimate, null is not
 * @param {boolean} estimated  true when the vendor does not expose a real figure (see Higgsfield)
 */
export function record({ orderId, engine, kind, usd, units = null, vendor = null, note = null, estimated = false }, opts = {}) {
  const file = opts.file || COSTS_FILE();
  if (!KINDS.includes(kind)) throw new Error(`costs.record: kind must be one of ${KINDS.join('|')}`);
  if (typeof usd !== 'number' || !Number.isFinite(usd) || usd < 0) {
    throw new Error('costs.record: usd must be a finite number >= 0 — an unknown cost is `estimated`, never invented');
  }
  return append(file, {
    id: `${orderId || 'unattributed'}:${kind}:${Date.now()}`,
    orderId: orderId || null, engine: engine || null, kind, usd, units, vendor, note, estimated,
  });
}

export function forOrder(orderId, opts = {}) {
  const file = opts.file || COSTS_FILE();
  return readAll(file).rows.filter(r => r.orderId === orderId);
}

/** Total cost of one order, with the estimated portion called out separately — never merged. */
export function totalFor(orderId, opts = {}) {
  const rows = forOrder(orderId, opts);
  const known = rows.filter(r => !r.estimated).reduce((a, r) => a + r.usd, 0);
  const est = rows.filter(r => r.estimated).reduce((a, r) => a + r.usd, 0);
  return { usd: known + est, known, estimated: est, hasEstimates: est > 0, rows: rows.length };
}

export function summary(opts = {}) {
  const file = opts.file || COSTS_FILE();
  const rows = readAll(file).rows;
  const byKind = {};
  let total = 0, estimated = 0;
  for (const r of rows) {
    byKind[r.kind] = (byKind[r.kind] || 0) + r.usd;
    total += r.usd;
    if (r.estimated) estimated += r.usd;
  }
  return { total, estimated, byKind, rows: rows.length };
}

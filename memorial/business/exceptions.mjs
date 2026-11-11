/* memorial/business/exceptions.mjs — the exception-based management mechanism.
 *
 * WHY THIS EXISTS
 * ---------------
 * The owner's requirement is "StarNet handles routine work and brings me decisions that genuinely
 * require my approval." StarNet has no such mechanism, in any form. A full search of all 324
 * /api/* routes, all of sidecar/ and all of frontend/app/ found no approvals queue, no inbox, no
 * alert store and no digest. What exists instead:
 *
 *   - permissions.js consent prompts  - live-BLOCKING and ephemeral; an autonomous run
 *                                       default-denies and nothing is queued for later.
 *   - consentwait.js                  - a fail-closed timer; a forgotten prompt auto-denies.
 *   - autonotify.js                   - pings only on cron SUCCESS and is deliberately silent on
 *                                       failure to avoid spam. Exactly backwards for this purpose.
 *   - channel.send                    - a transport, not a queue: no state, no ack, no resolution.
 *
 * The cost of not having one is already on the record: the sidecar has been running without its
 * environment file since Nov 3, three cron routines have failed silently every day since, and
 * there is no log. Six days of a dead business and nothing surfaced it. That is the failure this
 * file exists to prevent, and it is the first row written.
 *
 * AN EXCEPTION IS NOT AN ERROR LOG LINE. Every entry must answer four questions, because an alert
 * the owner cannot act on is noise:
 *     what happened · why it needs a HUMAN · what happens if ignored · what you suggest
 * `why` is mandatory and enforced. If a machine could decide it, it is not an exception.
 */
'use strict';

import { append, readAll, replay, logPath } from './jsonl.mjs';

export const EXCEPTIONS_FILE = () => logPath('exceptions.jsonl');

/** decision = owner judgement · blocked = cannot self-heal · quality = failed QC · risk = legal/compliance */
export const KINDS = ['decision', 'blocked', 'quality', 'risk'];
export const SEVERITIES = ['critical', 'high', 'normal', 'low'];
const SEV_RANK = { critical: 0, high: 1, normal: 2, low: 3 };

/**
 * raise — record something that needs a human.
 * Idempotent on `id`: re-raising an open exception refreshes it instead of duplicating, so a
 * routine that fires hourly does not produce 24 identical alerts a day.
 */
export function raise(ex, opts = {}) {
  const file = opts.file || EXCEPTIONS_FILE();
  const { id, kind, severity = 'normal', engine = null, orderId = null,
          what, why, ifIgnored = null, suggested = null, deadline = null } = ex || {};

  if (!id) throw new Error('exceptions.raise: id required (stable, so repeats collapse)');
  if (!KINDS.includes(kind)) throw new Error(`exceptions.raise: kind must be one of ${KINDS.join('|')}`);
  if (!SEVERITIES.includes(severity)) throw new Error(`exceptions.raise: bad severity '${severity}'`);
  if (!what) throw new Error('exceptions.raise: `what` required');
  if (!why) throw new Error('exceptions.raise: `why` required — if a machine could decide it, it is not an exception');

  const prev = get(id, opts);
  if (prev && prev.state === 'open') {
    return append(file, { id, seenCount: (prev.seenCount || 1) + 1, lastSeen: new Date().toISOString() });
  }
  return append(file, {
    id, kind, severity, engine, orderId, what, why, ifIgnored, suggested, deadline,
    state: 'open', seenCount: 1, lastSeen: new Date().toISOString(),
  });
}

export function resolve(id, resolution, opts = {}) {
  const file = opts.file || EXCEPTIONS_FILE();
  if (!get(id, opts)) throw new Error(`exceptions.resolve: unknown exception ${id}`);
  return append(file, { id, state: 'resolved', resolution: resolution || null, resolvedAt: new Date().toISOString() });
}

export function dismiss(id, reason, opts = {}) {
  const file = opts.file || EXCEPTIONS_FILE();
  if (!get(id, opts)) throw new Error(`exceptions.dismiss: unknown exception ${id}`);
  return append(file, { id, state: 'dismissed', resolution: reason || null, resolvedAt: new Date().toISOString() });
}

export function get(id, opts = {}) {
  const file = opts.file || EXCEPTIONS_FILE();
  return replay(readAll(file).rows).get(id) || null;
}

/** Open exceptions, most urgent first: severity, then deadline, then age. */
export function open(opts = {}) {
  const file = opts.file || EXCEPTIONS_FILE();
  const rows = [...replay(readAll(file).rows).values()].filter(r => r.state === 'open');
  if (opts.engine) return sort(rows.filter(r => r.engine === opts.engine));
  return sort(rows);
}

function sort(rows) {
  return rows.sort((a, b) => {
    const s = (SEV_RANK[a.severity] ?? 9) - (SEV_RANK[b.severity] ?? 9);
    if (s) return s;
    if (a.deadline && b.deadline) return String(a.deadline).localeCompare(String(b.deadline));
    if (a.deadline) return -1;
    if (b.deadline) return 1;
    return String(a.ts).localeCompare(String(b.ts));
  });
}

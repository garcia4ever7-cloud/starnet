/* memorial/business/orders.mjs — the unit of work, for BOTH revenue engines.
 *
 * WHY THIS EXISTS
 * ---------------
 * StarNet has excellent state machines and not one of them models a customer order.
 * `cron-store.js` is the best reducer on the station but every field says "routine" and its driver
 * is schedule-driven. `project-orchestration.js` bakes the four studio agent roles into a constant
 * and its atomicWrite has no fsync. `workshop-store.js` is a claim/park queue for away-builds.
 * So the discipline is borrowed and the schema is new.
 *
 * Deliberately engine-agnostic: an Etsy printable kit and a memorial film are both orders. That is
 * the whole point of a shared business spine — one place that knows what is in flight, for both.
 *
 * STATES, and the reason each exists:
 *   intake     - exists, not yet complete enough to work on (waiting on photos, names, dates)
 *   ready      - has everything it needs; may be picked up unattended
 *   rendering  - claimed by a worker; carries a lease so a crash does not strand it
 *   rendered   - artifact produced, NOT yet trusted
 *   verified   - passed mechanical verification (video-verify + memorial checks)
 *   packaged   - delivery artifact assembled (the thing the customer receives)
 *   delivered  - handed over; terminal
 *   blocked    - cannot proceed without a human; ALWAYS paired with an exception
 *   cancelled  - terminal
 *
 * `rendered` and `verified` are separate on purpose. Collapsing them is precisely how a
 * 1,056-byte placeholder once shipped from this station as a finished video.
 */
'use strict';

import { append, readAll, replay, logPath } from './jsonl.mjs';

export const ORDERS_FILE = () => logPath('orders.jsonl');

export const STATES = ['intake', 'ready', 'rendering', 'rendered', 'verified', 'packaged', 'delivered', 'blocked', 'cancelled'];

const ALLOWED = {
  intake:    ['ready', 'blocked', 'cancelled'],
  ready:     ['rendering', 'blocked', 'cancelled'],
  rendering: ['rendered', 'ready', 'blocked', 'cancelled'],   // ready = lease released / retry
  rendered:  ['verified', 'blocked', 'ready', 'cancelled'],   // ready = re-render after a failure
  verified:  ['packaged', 'blocked', 'cancelled'],
  packaged:  ['delivered', 'blocked', 'cancelled'],
  delivered: [],
  blocked:   ['ready', 'rendering', 'rendered', 'verified', 'packaged', 'cancelled'],
  cancelled: [],
};

export function canTransition(from, to) {
  if (!STATES.includes(to)) return false;
  if (from == null) return to === 'intake';
  return (ALLOWED[from] || []).includes(to);
}

/** Record a new order. Engine is 'memorial' | 'etsy'. */
export function create({ orderId, engine, tier, title, due, meta }, opts = {}) {
  if (!orderId) throw new Error('orders.create: orderId required');
  if (!engine) throw new Error('orders.create: engine required');
  const file = opts.file || ORDERS_FILE();
  if (get(orderId, opts)) throw new Error(`orders.create: ${orderId} already exists`);
  return append(file, { id: orderId, engine, tier: tier || null, title: title || null, due: due || null, state: 'intake', attempts: 0, meta: meta || {} });
}

/** Move an order. Refuses an illegal transition rather than silently recording nonsense. */
export function transition(orderId, to, detail = {}, opts = {}) {
  const file = opts.file || ORDERS_FILE();
  const cur = get(orderId, opts);
  if (!cur) throw new Error(`orders.transition: unknown order ${orderId}`);
  if (!canTransition(cur.state, to)) {
    throw new Error(`orders.transition: ${orderId} cannot go ${cur.state} -> ${to}`);
  }
  const row = { id: orderId, state: to, ...detail };
  if (to === 'rendering') {
    row.attempts = (cur.attempts || 0) + 1;
    row.leaseUntil = detail.leaseUntil || new Date(Date.now() + (opts.leaseMs || 30 * 60 * 1000)).toISOString();
  }
  if (to !== 'rendering') row.leaseUntil = null;
  return append(file, row);
}

export function get(orderId, opts = {}) {
  const file = opts.file || ORDERS_FILE();
  return replay(readAll(file).rows).get(orderId) || null;
}

export function list(opts = {}) {
  const file = opts.file || ORDERS_FILE();
  let rows = [...replay(readAll(file).rows).values()];
  if (opts.engine) rows = rows.filter(r => r.engine === opts.engine);
  if (opts.state) rows = rows.filter(r => r.state === opts.state);
  if (opts.open) rows = rows.filter(r => !['delivered', 'cancelled'].includes(r.state));
  return rows.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
}

/**
 * claimNext — take the oldest ready order for an engine, atomically enough for one host.
 * Also reclaims orders whose lease expired, which is how a killed render un-strands itself.
 * Modelled on workshop-store.js's claim/sweep discipline.
 */
export function claimNext(engine, opts = {}) {
  const now = opts.now ? new Date(opts.now) : new Date();

  for (const o of list({ ...opts, engine, state: 'rendering' })) {
    if (o.leaseUntil && new Date(o.leaseUntil) < now) {
      transition(o.id, 'ready', { note: 'lease expired — reclaimed' }, opts);
    }
  }
  const ready = list({ ...opts, engine, state: 'ready' });
  if (!ready.length) return null;
  const pick = ready[0];
  transition(pick.id, 'rendering', { worker: opts.worker || 'host' }, opts);
  return get(pick.id, opts);
}

/** Orders stuck in a non-terminal state past their due date — feeds the digest. */
export function overdue(opts = {}) {
  const now = opts.now ? new Date(opts.now) : new Date();
  return list({ ...opts, open: true }).filter(o => o.due && new Date(o.due) < now);
}

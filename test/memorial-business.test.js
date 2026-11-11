/* test/memorial-business.test.js — the order ledger, the exception queue and the cost book.
 *
 * WHY IT EXISTS (2026-11-09). This is the shared spine for BOTH revenue engines, and two of its
 * properties are load-bearing for real money:
 *
 *  - `rendered` and `verified` are separate states. Collapsing them is exactly how a 1,056-byte
 *    placeholder once shipped from this station as a finished video while the tests stayed green.
 *  - An exception must say WHY a human is needed. An alert nobody can act on is noise, and the
 *    failure that motivated this queue — the sidecar running six days with no provider keys while
 *    three cron routines failed silently — produced plenty of noise and no signal.
 *
 * What must stay true:
 *  - illegal state transitions are REFUSED, not recorded
 *  - a crashed render un-strands itself via lease expiry
 *  - re-raising an open exception collapses instead of duplicating
 *  - an exception without `why` is refused
 *  - estimated costs are never silently merged into known ones
 *  - a torn final log line does not lose the complete events before it
 *
 * Run standalone: node test/memorial-business.test.js */
'use strict';
const A = require('./_assert.js');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-biz-'));
process.env.MEMORIAL_BUSINESS_ROOT = TMP;

(async () => {
  const J = await import('../memorial/business/jsonl.mjs');
  const O = await import('../memorial/business/orders.mjs');
  const X = await import('../memorial/business/exceptions.mjs');
  const C = await import('../memorial/business/costs.mjs');

  /* ---------- 1. DURABLE APPEND-ONLY LOG ---------- */
  {
    const f = path.join(TMP, 'probe.jsonl');
    J.append(f, { id: 'a', v: 1 });
    J.append(f, { id: 'b', v: 2 });
    J.append(f, { id: 'a', v: 3 });
    const { rows, torn } = J.readAll(f);
    A.eq(rows.length, 3, 'every appended event is readable');
    A.eq(torn, 0, 'nothing torn on a clean log');
    A.ok(rows[0].ts, 'a timestamp is stamped automatically');

    const m = J.replay(rows);
    A.eq(m.get('a').v, 3, 'replay is last-write-wins per id');
    A.eq(m.size, 2, 'replay collapses to distinct ids');

    /* A half-written final line must not cost us the complete events before it. */
    fs.appendFileSync(f, '{"id":"c","v":4');
    const after = J.readAll(f);
    A.eq(after.rows.length, 3, 'a torn FINAL line is tolerated');
    A.eq(after.torn, 1, 'and reported rather than hidden');

    /* Corruption that is NOT the last line is a real problem and must be loud. */
    const bad = path.join(TMP, 'bad.jsonl');
    fs.writeFileSync(bad, '{"id":"a"}\nNOT JSON\n{"id":"b"}\n');
    A.throws(() => J.readAll(bad), 'mid-file corruption throws instead of silently dropping an event');
  }

  /* ---------- 2. ORDER STATE MACHINE ---------- */
  {
    O.create({ orderId: 'o1', engine: 'memorial', tier: 'remembrance', due: '2026-12-01' });
    A.eq(O.get('o1').state, 'intake', 'a new order starts at intake');
    A.throws(() => O.create({ orderId: 'o1', engine: 'memorial' }), 'a duplicate orderId is refused');

    O.transition('o1', 'ready');
    O.transition('o1', 'rendering');
    A.eq(O.get('o1').attempts, 1, 'entering rendering counts an attempt');
    A.ok(O.get('o1').leaseUntil, 'rendering carries a lease');

    O.transition('o1', 'rendered');
    A.eq(O.get('o1').leaseUntil, null, 'leaving rendering clears the lease');

    A.throws(() => O.transition('o1', 'delivered'),
      'rendered cannot jump straight to delivered — verification is not skippable');
    O.transition('o1', 'verified');
    O.transition('o1', 'packaged');
    O.transition('o1', 'delivered');
    A.throws(() => O.transition('o1', 'ready'), 'delivered is terminal');
    A.throws(() => O.transition('nope', 'ready'), 'an unknown order is refused');

    A.ok(!O.canTransition('rendered', 'delivered'), 'canTransition agrees with transition');
    A.ok(O.canTransition(null, 'intake'), 'intake is the only legal first state');
  }

  /* ---------- 3. CLAIM AND LEASE RECLAIM — how a killed render un-strands itself ---------- */
  {
    O.create({ orderId: 'o2', engine: 'memorial' });
    O.transition('o2', 'ready');
    const got = O.claimNext('memorial');
    A.eq(got.id, 'o2', 'claimNext takes a ready order');
    A.eq(got.state, 'rendering', 'and marks it rendering');
    A.eq(O.claimNext('memorial'), null, 'nothing else is claimable');

    /* simulate the worker being killed: expire the lease */
    O.transition('o2', 'ready', { note: 'manual release' });
    O.transition('o2', 'rendering', { leaseUntil: new Date(Date.now() - 1000).toISOString() });
    const re = O.claimNext('memorial');
    A.eq(re && re.id, 'o2', 'an expired lease is reclaimed rather than stranding the order');
    A.eq(O.get('o2').attempts, 3, 'each claim counts');

    O.create({ orderId: 'e1', engine: 'etsy' });
    A.eq(O.claimNext('etsy'), null, 'an intake-state order is not claimable');
    A.eq(O.list({ engine: 'etsy' }).length, 1, 'the ledger serves both engines');
  }

  /* ---------- 4. EXCEPTIONS ---------- */
  {
    X.raise({ id: 'x1', kind: 'blocked', severity: 'critical', what: 'no provider keys', why: 'only the owner can restart the station' });
    A.eq(X.open().length, 1, 'an open exception is listed');
    X.raise({ id: 'x1', kind: 'blocked', severity: 'critical', what: 'no provider keys', why: 'again' });
    A.eq(X.open().length, 1, 'a repeat collapses instead of duplicating');
    A.eq(X.get('x1').seenCount, 2, 'but the repeat is counted');

    A.throws(() => X.raise({ id: 'x2', kind: 'blocked', what: 'thing' }),
      'an exception with no `why` is refused — if a machine could decide it, it is not an exception');
    A.throws(() => X.raise({ id: 'x3', kind: 'invented', what: 'a', why: 'b' }), 'an unknown kind is refused');
    A.throws(() => X.raise({ kind: 'blocked', what: 'a', why: 'b' }), 'a missing id is refused');

    X.raise({ id: 'x4', kind: 'decision', severity: 'low', what: 'price?', why: 'owner sets price' });
    X.raise({ id: 'x5', kind: 'quality', severity: 'high', what: 'qc failed', why: 'needs judgement' });
    const ord = X.open().map(e => e.id);
    A.eq(ord[0], 'x1', 'critical sorts first');
    A.eq(ord[ord.length - 1], 'x4', 'low sorts last');

    X.resolve('x4', 'priced at $169');
    A.eq(X.open().length, 2, 'a resolved exception leaves the queue');
    A.eq(X.get('x4').resolution, 'priced at $169', 'the resolution is kept for the audit trail');
  }

  /* ---------- 5. COSTS — estimates are never merged into known figures ---------- */
  {
    C.record({ orderId: 'o1', engine: 'memorial', kind: 'labour', usd: 0, units: '61s' });
    C.record({ orderId: 'o1', engine: 'memorial', kind: 'licence', usd: 32.0, vendor: 'artyfile' });
    C.record({ orderId: 'o1', engine: 'memorial', kind: 'credits', usd: 0.35, vendor: 'higgsfield', estimated: true });

    const t = C.totalFor('o1');
    A.eq(t.known, 32, 'known costs total correctly');
    A.eq(t.estimated, 0.35, 'estimated costs are tracked apart');
    A.ok(t.hasEstimates, 'and the total is flagged as containing estimates');
    A.eq(t.usd, 32.35, 'the headline total still includes them');

    A.throws(() => C.record({ orderId: 'o1', kind: 'model', usd: null }),
      'an unknown cost must be recorded as estimated, never invented as null');
    A.throws(() => C.record({ orderId: 'o1', kind: 'model', usd: -1 }), 'a negative cost is refused');
    A.throws(() => C.record({ orderId: 'o1', kind: 'wat', usd: 1 }), 'an unknown cost kind is refused');

    A.eq(C.summary().byKind.licence, 32, 'summary groups by kind');
  }

  fs.rmSync(TMP, { recursive: true, force: true });
  A.report('memorial-business');
})().catch(e => { console.error(e); try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {} process.exit(1); });

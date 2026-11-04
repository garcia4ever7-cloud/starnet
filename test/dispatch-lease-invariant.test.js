/* test/dispatch-lease-invariant.test.js — a stalled team.dispatch must hit its own registry backstop BEFORE
   the cron driver can reclaim the lease.

   THE LIVE INCIDENT THIS PINS (cron run c1bce71a, 2026-11-02). ORCH_DISPATCH_TIMEOUT_MS and
   CRON_HEARTBEAT_STALE_MS were both derived from CRON_MAX_RUN_MS, so they expired together while the
   registry backstop (budget + 60s) sat BEYOND the lease. The reclaim won every time: SCOUT finished in 26s
   and saved its research, the dispatch stalled, and at 480s cron-driver.js:636 cancelled the whole run as a
   stale lease. team.dispatch returned 'cancelled - unconfirmed', a completed and paid-for worker's result was
   thrown away, and because a reclaim is recorded TRANSIENT the routine re-armed and auto-re-fired, spending
   again (run b7003a7a).

   Run d6097aec is the shape we want and the reason this invariant is worth a test: there the backstop fired
   first, the lead was told "team.dispatch timed out after 540 seconds", reported it, and ended 'done'. Still
   unfinished work — but bounded, honest, and nothing lost or silently re-spent.

   Run standalone: node test/dispatch-lease-invariant.test.js */
'use strict';

const A = require('./_assert.js');
const B = require('../sidecar/dispatch-budget.js');

/* ---------- 1. THE DERIVED DEFAULT OBEYS THE INVARIANT ---------- */
function testDerivedDefaultFitsInsideTheLease() {
  // the station's real numbers: CRON_MAX_RUN_MS 480000 -> CRON_HEARTBEAT_STALE_MS 480000 (mult 1)
  const stale = 480000;
  const budget = B.dispatchBudgetMs({ staleMs: stale });
  A.eq(budget, 360000, 'the dispatch budget is derived from the staleness window, not equal to it');
  A.eq(B.leaseOutlivesTool(budget, stale), true,
    'a stalled dispatch times out honestly BEFORE the lease is reclaimed — the whole point');
  A.ok(budget + B.REGISTRY_HEADROOM_MS < stale,
    'the registry backstop (budget + headroom) lands inside the lease window with room to spare');
}

/* ---------- 2. THE OLD CONFIGURATION IS REJECTED BY THE INVARIANT ---------- */
function testThePreIncidentConfigurationFails() {
  // what shipped before 2026-11-02: budget === staleness === CRON_MAX_RUN_MS
  A.eq(B.leaseOutlivesTool(480000, 480000), false,
    'budget == staleness is the c1bce71a shape and must read as BROKEN');
  // and the backstop was strictly beyond the lease, which is why the reclaim always won
  A.ok(480000 + B.REGISTRY_HEADROOM_MS > 480000,
    'the old registry backstop sat past the lease window — the reclaim could not lose that race');
}

/* ---------- 3. AN OPERATOR OVERRIDE WINS, AND A BAD ONE IS DETECTABLE ---------- */
function testOverrideIsHonouredButCheckable() {
  A.eq(B.dispatchBudgetMs({ override: 90000, staleMs: 480000 }), 90000,
    'an explicit DISPATCH_TIMEOUT_MS wins — it is the operator\'s station');
  A.eq(B.leaseOutlivesTool(90000, 480000), true, 'and a small override still satisfies the invariant');
  // a reckless override must be REPORTABLE, not silently restoring the incident (index.js warns on this)
  A.eq(B.leaseOutlivesTool(600000, 480000), false,
    'an override larger than the lease window reads as broken so the host can warn about it');
  A.eq(B.dispatchBudgetMs({ override: '240000', staleMs: 480000 }), 240000,
    'env vars arrive as strings — a numeric string override is honoured');
  A.eq(B.dispatchBudgetMs({ override: 'nonsense', staleMs: 480000 }), 360000,
    'an unparseable override falls back to the derived default rather than 0 or NaN');
  A.eq(B.dispatchBudgetMs({ override: -5, staleMs: 480000 }), 360000, 'and so does a negative one');
}

/* ---------- 4. DEGENERATE INPUTS NEVER PRODUCE AN UNBOUNDED OR ZERO BUDGET ---------- */
function testDegenerateInputsStayBounded() {
  A.eq(B.dispatchBudgetMs({}), B.MIN_BUDGET_MS, 'no staleness window -> the floor, never 0 or NaN');
  A.eq(B.dispatchBudgetMs({ staleMs: 0 }), B.MIN_BUDGET_MS, 'zero staleness -> the floor');
  A.eq(B.dispatchBudgetMs({ staleMs: 60000 }), B.MIN_BUDGET_MS,
    'a staleness window too small to fit the headroom clamps to the floor instead of going negative');
  A.ok(B.dispatchBudgetMs({ staleMs: 60000 }) > 0, 'and the floor is positive');
  A.eq(B.leaseOutlivesTool(0, 480000), false, 'a zero budget is not a satisfied invariant');
  A.eq(B.leaseOutlivesTool(360000, 0), false, 'nor is a zero staleness window');
  // a very long lease (CRON_STALENESS_MULT raised) should widen the delegation window, not pin it
  A.eq(B.dispatchBudgetMs({ staleMs: 1200000 }), 1080000,
    'raising the lease window raises the delegation budget with it');
  A.eq(B.leaseOutlivesTool(1080000, 1200000), true, 'and the invariant still holds at that size');

  /* THE STATION'S LIVE SETTING (2026-11-02). ~/.config/starnet/env sets CRON_MAX_RUN_MS=900000 after a real
     run cut DESIGNER off mid-work: it had rendered genuine 300-DPI print files and was 19 turns in ($0.67 of
     real spend) when the 360s budget derived from the old 480000 window killed the dispatch. The lease was
     raised rather than the budget precisely so this invariant survives the change. */
  A.eq(B.dispatchBudgetMs({ staleMs: 900000 }), 780000,
    'the station\'s configured 900s lease yields a 780s delegation budget — room for a real design loop');
  A.eq(B.leaseOutlivesTool(780000, 900000), true,
    'and a stalled dispatch still times out honestly before the lease can be reclaimed');
}

testDerivedDefaultFitsInsideTheLease();
testThePreIncidentConfigurationFails();
testOverrideIsHonouredButCheckable();
testDegenerateInputsStayBounded();
A.report('dispatch lease invariant');

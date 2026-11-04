/* sidecar/dispatch-budget.js — THE CRON LEASE MUST OUTLIVE THE TOOL CALL.

   WHY THIS MODULE EXISTS (live incident, 2026-11-02, cron run c1bce71a). Three timings were all derived from
   the SAME constant, CRON_MAX_RUN_MS:

     ORCH_DISPATCH_TIMEOUT_MS  = CRON_MAX_RUN_MS        (the team.dispatch wall clock)
     CRON_HEARTBEAT_STALE_MS   = CRON_MAX_RUN_MS        (when cron-driver.js reclaims a "dead" lease)
     registry backstop         = dispatch budget + 60s  (sidecar/tools/builtin/orchestration.js)

   so the registry's backstop sat 60s BEYOND the lease staleness window and the reclaim always won the race.
   The consequences were not a slow run but a LYING one: SCOUT finished its research in 26s and saved the
   file, the dispatch then stalled, and at 480s cron-driver.js:636 aborted the entire run as a stale lease.
   team.dispatch came back 'cancelled - unconfirmed', a completed and paid-for worker's result was discarded,
   and because a reclaim is recorded as a TRANSIENT failure the routine re-armed and auto-re-fired — spending
   real money again on the same beat (run b7003a7a, same day).

   The contrast run, d6097aec, shows the shape we want: there the registry backstop fired FIRST, the lead was
   told "team.dispatch timed out after 540 seconds", it reported that honestly, and the run ended 'done'. The
   work was still unfinished, but nothing was lost, nothing was silently re-spent, and the owner could read
   what happened. That is the whole difference between a bounded failure and a dishonest one.

   So the budget is DERIVED from the staleness window instead of coincidentally equal to it, leaving room for
   the registry backstop plus a safety margin. The invariant is `leaseOutlivesTool`, pinned by
   test/dispatch-lease-invariant.test.js so it cannot drift back.

   Pure arithmetic, no I/O, no ambient clock — the composition root passes the numbers in. */
'use strict';

// orchestration.js sets the dispatch tool's registry timeout to `dispatchBudgetMs + 60000`, so the lease has
// to outlast the budget by at least this much before it may be considered dead. Kept here next to the
// invariant that depends on it; changing it in one place without the other is the bug this module prevents.
const REGISTRY_HEADROOM_MS = 60000;
// Extra room so a reclaim is never a photo-finish with the backstop on a loaded phone.
const SAFETY_MS = 60000;
// A dispatch budget below this is not a delegation window at all (a real worker loop needs minutes).
const MIN_BUDGET_MS = 60000;

function positive(v) {
  const n = Number(v);
  return (Number.isFinite(n) && n > 0) ? Math.floor(n) : null;
}

/* The team.dispatch wall clock. An explicit operator override always wins — it is their station and a longer
   delegation window may be exactly what they want — but the DERIVED default obeys the invariant. Callers
   should check leaseOutlivesTool() and say so out loud when an override breaks it, rather than silently
   restoring the incident above. */
function dispatchBudgetMs(opts) {
  opts = opts || {};
  const override = positive(opts.override);
  if (override) return override;
  const stale = positive(opts.staleMs);
  if (!stale) return MIN_BUDGET_MS;
  return Math.max(MIN_BUDGET_MS, stale - REGISTRY_HEADROOM_MS - SAFETY_MS);
}

/* TRUE when a stalled dispatch will hit its own registry backstop — and so return an honest 'timed out' row
   that keeps the run alive and its completed workers' results intact — BEFORE the cron driver can reclaim the
   lease and cancel the whole run. FALSE is the c1bce71a shape. */
function leaseOutlivesTool(budgetMs, staleMs) {
  const b = positive(budgetMs), s = positive(staleMs);
  if (!b || !s) return false;
  return (b + REGISTRY_HEADROOM_MS) < s;
}

module.exports = { dispatchBudgetMs, leaseOutlivesTool, REGISTRY_HEADROOM_MS, SAFETY_MS, MIN_BUDGET_MS };

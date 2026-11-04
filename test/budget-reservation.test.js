/* test/budget-reservation.test.js — a per-run cap must be a CEILING, not a trailing stop.

   MEASURED HARM THIS PREVENTS (2026-11-03, both real runs, traces preserved in
   workspaces/agent/overspend-20261103-qc-2c1be727/):

     QC_EDITOR 2c1be727, cap $0.50 : turns cost 0.2501 0.0787 0.0834 0.0698 0.1237
       After turn 4 the run stood at $0.4819 — under the cap — so turn 5 was allowed to start, and cost
       $0.1237. Final $0.6057, 21.1% over. The run was then killed before writing the verdict it existed to
       produce: the whole budget bought reading and none of the writing.

     DESIGNER 5fc1e807, cap $0.12  : turns cost 0.1021 0.0224 -> $0.1246, 3.8% over, no artifact.

   The old rule was `if (spentUsd >= maxCostUsd) stop`, which only asks whether the cap is ALREADY spent.
   The new rule additionally refuses to START a turn when the worst turn observed so far would not fit in
   what remains. This file replays the real per-turn figures through both rules so the fix is pinned to
   evidence rather than to an argument.

   Run standalone: node test/budget-reservation.test.js */
'use strict';

const A = require('./_assert.js');
const fs = require('node:fs');
const path = require('node:path');

/* The two rules, modelled exactly as sidecar/loop.js evaluates them at the top of each turn. */
function runOld(turnCosts, cap) {
  let spent = 0, ran = 0;
  for (const c of turnCosts) {
    if (spent >= cap) break;          // the ONLY question the old rule asked
    spent += c; ran++;
  }
  return { spent: Number(spent.toFixed(6)), ran };
}
function runNew(turnCosts, cap) {
  let spent = 0, ran = 0, maxTurn = 0;
  for (const c of turnCosts) {
    if (spent >= cap) break;
    // the addition: do not start a turn the remaining budget cannot afford
    if (maxTurn > 0 && isFinite(cap) && (spent + maxTurn) > cap) break;
    spent += c; ran++;
    if (c > maxTurn) maxTurn = c;
  }
  return { spent: Number(spent.toFixed(6)), ran };
}

/* FULL-PRECISION per-turn costs, read from the preserved agent.cost events — not display-rounded. Using
   rounded figures here made the DESIGNER sum land on 0.1245 instead of the recorded 0.12455. */
const QC = [0.25005374999999996, 0.07865475, 0.08338224999999999, 0.06982674999999999, 0.12374774999999999];
const DESIGNER = [0.10212800000000001, 0.022425];

/* ---------- 1. THE REAL QC OVERSPEND IS REPRODUCED, THEN PREVENTED ---------- */
{
  const before = runOld(QC, 0.50);
  A.eq(before.ran, 5, 'the old rule ran all five turns');
  A.ok(before.spent > 0.50, 'and finished OVER the $0.50 cap — the incident reproduces');
  A.eq(before.spent, 0.605665, 'at exactly the recorded $0.605665');

  const after = runNew(QC, 0.50);
  A.ok(after.spent <= 0.50, 'the reservation keeps the run inside its cap');
  A.eq(after.spent, 0.250054, 'stopping after turn 1, because turn 1 alone cost $0.25');
  A.ok(after.ran < before.ran, 'which means fewer turns — the honest trade, not a free win');
}

/* ---------- 2. THE DESIGNER OVERSPEND, SAME FAULT CLASS ---------- */
{
  const before = runOld(DESIGNER, 0.12);
  A.ok(before.spent > 0.12, 'the old rule overran the $0.12 cap');
  A.eq(before.spent, 0.124553, 'at exactly the recorded $0.124553');
  const after = runNew(DESIGNER, 0.12);
  A.ok(after.spent <= 0.12, 'the reservation keeps it inside');
  A.eq(after.spent, 0.102128, 'ending after turn 1');
}

/* ---------- 3. THE FIRST TURN IS NEVER BLOCKED ----------
   A run must be able to start. If a cap is smaller than a single turn that is a budgeting error to surface
   through an honest overspend-free stop, not a run that silently refuses to begin. */
{
  A.eq(runNew([0.90], 0.50).ran, 1, 'turn 1 always runs — maxTurnUsd is 0 before any turn completes');
  A.eq(runNew([0.90, 0.90], 0.50).ran, 1, 'but turn 2 is then refused');
  A.eq(runNew([], 0.50).ran, 0, 'no turns, no spend');
}

/* ---------- 4. A COMFORTABLE BUDGET IS NOT THROTTLED ----------
   The reservation must not make generously-funded runs stop early, or it would quietly cripple normal work. */
{
  const cheap = [0.005, 0.004, 0.004, 0.004, 0.004];
  A.eq(runNew(cheap, 0.50).ran, 5, 'a cheap run under a roomy cap runs every turn');
  A.eq(runNew(cheap, 0.50).spent, runOld(cheap, 0.50).spent, 'and spends identically to the old rule');
}

/* ---------- 5. DEGENERATE CAPS ---------- */
{
  A.eq(runNew([0.1, 0.1], Infinity).ran, 2, 'an infinite cap never reserves (isFinite guard)');
  A.eq(runNew([0.1, 0.1], 0).ran, 0, 'a zero cap runs nothing');
}

/* ---------- 6. THE SHIPPED CODE IMPLEMENTS THIS RULE ----------
   Pinned against the source because loop.js is not node-loadable in isolation (same technique as
   test/outbox-window.test.js). If the guard is removed or loosened, this fails. */
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'sidecar', 'loop.js'), 'utf8');
  A.ok(/let maxTurnUsd = 0;/.test(src), 'the loop tracks the worst observed turn');
  A.ok(/if \(\(c\.usd \|\| 0\) > maxTurnUsd\) maxTurnUsd = c\.usd \|\| 0;/.test(src),
    'and updates it where a real turn cost is reconciled');
  A.ok(/\(spentUsd \+ maxTurnUsd\) > maxCostUsd/.test(src),
    'and refuses a turn whose worst case would exceed the cap');
  A.ok(/maxTurnUsd > 0 && isFinite\(maxCostUsd\)/.test(src),
    'guarded so turn 1 is never blocked and an infinite cap never reserves');
  A.ok(/budgetScope: 'run', budgetCapUsd: maxCostUsd,\s*\n?\s*budgetReserved/.test(src.replace(/\r/g, '')),
    'and reports the reservation as additive telemetry without changing budgetScope');
  // The ORIGINAL check must remain: the new rule is additional, not a replacement.
  A.ok(/if \(spentUsd >= maxCostUsd\) return end\('budget'/.test(src),
    'the original already-spent check is still present — the guard is additive');
}

A.report('budget reservation');

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
const events = require('../shared/events.js');   // section 7d: the enriched budget payload must still validate

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
   Source-locked so a removal or loosening of the guard fails loudly.
   CORRECTED 2026-11-17: this block used to say loop.js "is not node-loadable in isolation". That is
   false — `require('../sidecar/loop.js')` works, and test/loop.provider-recovery.test.js has always
   done it. Believing otherwise is WHY this file only ever modelled the rule and matched the source
   text, and that is exactly how the defect in section 7 survived: the shipped guard was present and
   correct, but the variable feeding it was never written on the success path, which no amount of
   regex-matching can see. Keep these locks AND the real execution below — a literal is not a contract. */
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

/* ================================================================================================
   7. THE REAL EXECUTION PATH (added 2026-11-17)

   Sections 1-6 model the rule and match the source. That combination passed for two weeks while the
   rule did not actually run: `maxTurnUsd` was written ONLY inside loop.js bookUsage(), which fires on
   the retry / fallback / cancel / fatal paths. A turn that merely SUCCEEDS reconciles inline, so on an
   ordinary all-success run maxTurnUsd stayed 0, the guard's `maxTurnUsd > 0` precondition was always
   false, and the cap degraded to the trailing check this file exists to replace. Measured on the real
   loop before the fix: the QC figures below ran all five turns and ended at $0.605665 — the incident,
   unfixed, with every assertion above still green.

   So this section drives the REAL runAgentLoop with a scripted ALL-SUCCESS provider and asserts
   behaviour, not text. Zero network, virtual clock.
   ================================================================================================ */
const { runAgentLoop } = require('../sidecar/loop.js');
const { makeCostEngine } = require('../sidecar/cost.js');
const { makeEmitter } = require('../shared/emitter.js');

/* $1.00 per million IN, nothing for OUT -> a turn's dollars are exactly prompt_tokens / 1e6, so a
   per-turn cost list below is expressed directly as token counts and the arithmetic stays exact. */
const priceOf = () => ({ in: 1, out: 0 });
const tok = (usd) => Math.round(usd * 1e6);

/* Drive one run. `turnCosts` is the per-SUCCESSFUL-TURN dollar cost; the scripted model keeps calling a
   tool so the loop must decide, before each new turn, whether it can afford one. `chain` adds fallback
   rungs (used for the rotation case). `failAt` makes the Nth stream attempt die after reporting usage. */
async function drive(opts) {
  const o = opts || {};
  const costs = o.turnCosts;
  let call = 0;
  const costEvents = [];
  const endEvents = [];
  const fallbackEvents = [];
  const mkProvider = (modelId) => ({
    stream: async function* () {
      call++;
      if (o.failAt === call) {
        yield { type: 'usage', usage: { prompt_tokens: tok(costs[Math.min(call - 1, costs.length - 1)]), completion_tokens: 0 } };
        const e = new Error('provider http 503 — overloaded'); e.status = 503; throw e;
      }
      /* Past the end of the cost list the model DELIVERS instead of asking for another tool, so a run
         that the budget never stops ends 'done' rather than running out of iterations. The turn still
         reports usage, because a final answer is billed like any other. */
      if (call > costs.length) {
        yield { type: 'text', delta: 'final answer' };
        yield { type: 'usage', usage: { prompt_tokens: tok(costs[costs.length - 1]), completion_tokens: 0 } };
        yield { type: 'done', finishReason: 'stop' };
        return;
      }
      const usd = costs[call - 1];
      yield { type: 'tool_start', index: 0, id: 'c' + call, name: 'noop' };
      yield { type: 'tool_args', index: 0, chunk: '{"n":' + call + '}' };
      yield { type: 'usage', usage: { prompt_tokens: tok(usd), completion_tokens: 0 } };
      yield { type: 'done', finishReason: 'tool_calls' };
    },
    priceOf, contextLimit: () => 400000, supportsTools: () => true,
  });
  const emit = makeEmitter({
    emit: (name, payload) => {
      if (name === 'agent.cost') costEvents.push(payload);
      else if (name === 'agent.run.end') endEvents.push(payload);
      else if (name === 'provider.fallback') fallbackEvents.push(payload);
    }, on: () => {},
  }, () => {});
  const fallbacks = (o.chain || []).map(m => ({
    provider: mkProvider(m), providerId: 'openrouter', model: m,
    cost: makeCostEngine({ priceOf }), maxCostUsd: o.cap,
  }));
  const res = await runAgentLoop({
    messages: [{ role: 'user', content: 'go' }], provider: mkProvider('primary-model'),
    model: 'primary-model', agentId: 'a', runId: 'r', emit, cost: makeCostEngine({ priceOf }),
    fallbacks, limits: { maxCostUsd: o.cap, maxIters: 40 }, sleep: async () => {},
    dispatch: async () => ({ ok: true, isError: false, content: 'ok', summary: 'ok' }),
  });
  return { res, end: endEvents[endEvents.length - 1] || null, costEvents, fallbackEvents, calls: call };
}

(async () => {
  /* ---------- 7a. THE QC INCIDENT, THROUGH THE REAL LOOP ---------- */
  {
    const r = await drive({ cap: 0.50, turnCosts: QC });
    A.eq(r.res.reason, 'budget', 'the QC shape ends as a budget stop');
    A.ok(Number(r.res.usd) <= 0.50, 'and finishes INSIDE its $0.50 cap — the incident does not reproduce');
    A.ok(Number(r.res.usd) < 0.605665,
      'strictly cheaper than the $0.605665 the old trailing rule spent (this fails against the pre-fix loop)');
    A.eq(r.res.budgetScope, 'run', 'the stop still names the run scope');
  }

  /* ---------- 7b. UNIFORM TURNS UNDER THE LEAD AND WORKER CAPS ----------
     The station's live ceilings: the Etsy lead routine carries maxCostUsd 0.50 and BUDGET_PER_WORKER is
     0.60. Values are read as fixtures here, never written — this test must not depend on, or alter, live
     configuration. */
  for (const [label, cap] of [['lead', 0.50], ['worker', 0.60]]) {
    const r = await drive({ cap, turnCosts: [0.303, 0.303, 0.303, 0.303] });
    A.eq(r.res.reason, 'budget', label + ' cap: the run is stopped by the budget');
    A.ok(Number(r.res.usd) <= cap, label + ' cap $' + cap + ': final spend $' + r.res.usd + ' is inside it');
    A.eq(r.res.turns, 1, label + ' cap: exactly one $0.303 turn fits, and the second is refused before it starts');
  }

  /* ---------- 7c. CHEAP TURNS THEN AN EXPENSIVE ONE ----------
     The worst case for a trailing rule: a run sits far under its cap, then one turn triples the running
     cost. Pre-fix this ended 39.7% over. */
  {
    const r = await drive({ cap: 0.50, turnCosts: [0.03075, 0.03075, 0.03075, 0.303, 0.303] });
    A.ok(Number(r.res.usd) <= 0.50, 'cheap-then-spike finishes inside the cap ($' + r.res.usd + ')');
    A.eq(r.res.turns, 4, 'the three cheap turns and the first expensive one ran; the next was refused');
    A.ok(Number(r.res.usd) < 0.698, 'strictly cheaper than the pre-fix $0.698 (fails against the pre-fix loop)');
  }

  /* ---------- 7d. RESERVATION TELEMETRY REACHES BOTH THE BUS AND THE RETURN ----------
     loop.js's own comment promised budgetReserved was "visible in the stream"; end()'s allowlist dropped
     it, so a reservation stop was indistinguishable from a trailing stop. */
  {
    const r = await drive({ cap: 0.50, turnCosts: [0.303, 0.303] });
    A.eq(typeof r.end.budgetReserved, 'number', 'agent.run.end carries budgetReserved');
    A.eq(typeof r.end.budgetSpent, 'number', 'agent.run.end carries budgetSpent');
    A.eq(r.end.budgetReserved, 0.303, 'reserved = the worst turn actually observed');
    A.eq(r.end.budgetSpent, 0.303, 'spent = what was booked when the next turn was refused');
    A.eq(r.end.budgetCapUsd, 0.50, 'alongside the cap that fired');
    A.eq(r.res.budgetReserved, 0.303, 'and the RETURN value carries it too (index.js reads the result, not the bus)');
    A.eq(r.res.budgetSpent, 0.303, 'both fields, on both surfaces');
    const v = events.validate('agent.run.end', r.end);
    A.ok(v.ok, 'the enriched payload still validates against shared/events.js: ' + JSON.stringify(v.errors));
  }

  /* ---------- 7e. THE TWO KINDS OF RUN-CAP STOP STAY DISTINGUISHABLE ----------
     A cap smaller than one turn must still run turn 1 (section 3), so THAT stop comes from the trailing
     ceiling and carries no reservation. If both stops looked alike the telemetry would be useless. */
  {
    const r = await drive({ cap: 0.05, turnCosts: [0.303, 0.303] });
    A.eq(r.res.turns, 1, 'turn 1 is never blocked, even by a cap it cannot fit');
    A.eq(r.res.reason, 'budget', 'and the run then stops');
    A.eq(r.end.budgetReserved, undefined, 'a TRAILING-ceiling stop carries no budgetReserved');
    A.eq(r.end.budgetSpent, undefined, 'nor budgetSpent — so the two stop kinds are distinguishable');
    A.eq(r.end.budgetScope, 'run', 'while budgetScope is unchanged for existing consumers');
  }

  /* ---------- 7f. NO DOUBLE COUNTING, NO DUPLICATE agent.cost ----------
     The fix shares only the high-water mark; the booking stays on the success path. Routing the success
     path through bookUsage() instead would have added final.usd twice and emitted two cost rows. */
  {
    const r = await drive({ cap: 10, turnCosts: [0.01, 0.02, 0.03] });
    A.eq(r.res.reason, 'done', 'a roomy cap lets the run finish');
    A.eq(r.costEvents.length, r.calls, 'exactly one agent.cost row per model call — no duplicate booking');
    const sum = r.costEvents.reduce((a, c) => a + (c.usd || 0), 0);
    A.ok(Math.abs(sum - Number(r.res.usd)) < 1e-9,
      'and the rows sum to the run total ($' + sum.toFixed(6) + ' vs $' + Number(r.res.usd).toFixed(6) + ')');
  }

  /* ---------- 7g. A ROOMY CAP IS STILL NOT THROTTLED (executing counterpart to section 4) ---------- */
  {
    const r = await drive({ cap: 0.50, turnCosts: [0.005, 0.004, 0.004, 0.004, 0.004, 0.004] });
    A.eq(r.res.reason, 'done', 'a cheap run under a roomy cap is never stopped by the reservation');
    A.ok(r.res.turns >= 5, 'and runs its turns normally (' + r.res.turns + ')');
  }

  /* ---------- 7h. AN UNGOVERNED RUN IS BYTE-IDENTICAL ----------
     Most of this station runs with perRun 0 -> maxCostUsd Infinity. The reservation must stay inert
     there, or the fix would silently start stopping runs that were never capped. */
  {
    const r = await drive({ cap: undefined, turnCosts: [0.303, 0.303, 0.303] });
    A.eq(r.res.reason, 'done', 'no cap -> no budget stop');
    A.eq(r.end.budgetScope, undefined, 'and no budget telemetry on the end event');
    A.eq(r.end.budgetReserved, undefined, 'the reservation cannot fire without a finite cap');
  }

  /* ---------- 7i. THE CAP SURVIVES A FALLBACK ROTATION ----------
     A cross-provider switch swaps provider, model and cost engine mid-run (loop.js, search
     provider.fallback). The worst-turn mark must carry across the switch, so the new provider inherits a
     real ceiling instead of starting from zero. */
  {
    const r = await drive({
      // 0.12/turn against a 0.50 cap stops at 0.48 via the RESERVATION (0.48 + 0.12 > 0.50). An evenly
      // dividing cost would land exactly on the cap and stop via the trailing ceiling instead, which
      // would not exercise the thing this block is about.
      cap: 0.50, turnCosts: [0.12, 0.12, 0.12, 0.12, 0.12, 0.12, 0.12], failAt: 2,
      chain: ['rung-a', 'rung-b'],
    });
    A.eq(r.fallbackEvents.length, 1, 'the 503 rotated the run onto the next chain rung');
    A.eq(r.fallbackEvents[0].toModel, 'rung-a', 'specifically the first rung');
    A.eq(r.res.reason, 'budget', 'and the run is still stopped by its budget, not left uncapped');
    A.ok(Number(r.res.usd) <= 0.50,
      'the cap is enforced ACROSS the rotation (final $' + Number(r.res.usd).toFixed(6) + ')');
    A.eq(typeof r.res.budgetReserved, 'number', 'with the reservation telemetry intact after the switch');
  }

  /* ---------- 7j. THE WORKER-POOL SEAM ----------
     BUDGET_WORKER_POOL is not enforced in the loop. orchestration.js computes
     `pooled(perWorker) = Math.min(perWorker, poolLeft())` and hands it to the worker's run as
     maxCostUsd; test/orchestration-worker-pool.test.js asserts that GRANT and says in its own header
     that its fake host "does NOT self-enforce maxCostUsd — the real run host does that". This block is
     the other half of that seam: whatever pooled ceiling arrives, the loop honours it. Without it, a
     correct grant and a correct pool still overspent, because nothing proved the receiver obeyed. */
  {
    const perWorker = 0.60;
    for (const poolLeft of [1.50, 0.45, 0.12]) {
      const granted = Math.min(perWorker, poolLeft);        // exactly orchestration.js pooled()
      const r = await drive({ cap: granted, turnCosts: [0.10, 0.10, 0.10, 0.10, 0.10, 0.10, 0.10, 0.10] });
      A.ok(Number(r.res.usd) <= granted,
        'a pooled grant of $' + granted.toFixed(2) + ' (perWorker 0.60, pool left ' + poolLeft.toFixed(2)
        + ') is honoured by the loop: spent $' + Number(r.res.usd).toFixed(6));
    }
    const dryGrant = Math.min(perWorker, 0);
    A.eq(dryGrant, 0, 'a DRY pool computes 0, which the run host reads as UNCAPPED');
    A.ok(/poolDry\(\)/.test(fs.readFileSync(path.join(__dirname, '..', 'sidecar', 'tools', 'builtin', 'orchestration.js'), 'utf8')),
      'so orchestration.js must refuse the dispatch on poolDry() BEFORE computing a grant — that guard is present');
  }

  A.report('budget reservation');
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });

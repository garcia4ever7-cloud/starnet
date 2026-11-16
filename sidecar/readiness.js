/* sidecar/readiness.js — "can this station actually do unattended work right now?" as a PURE function.

   WHY THIS EXISTS, and why it is not another health check.
   This station has twice been comprehensively non-functional while every existing surface said fine:
     · `GET /api/health` returned `ok` through eight days in which ZERO autonomous runs completed.
     · `GET /api/lifecycle/armed` reported `armed:true, 3 routines` through those same eight days — it counts
       `job.enabled !== false` and never asks whether a fire would be permitted.
     · `npm run qa:ready` is a RELEASE gate over repo artifacts; not one of its checks reads the running
       station, and on Android it is permanently unsatisfiable (it wants a desktop-exe smoke receipt).
     · `test/fast.list` tests code against code in temp fixtures. It was green while a 1,056-byte placeholder
       shipped as a finished video.
   So the gap is not "another endpoint". The gap is that nothing asserted LIVE STATE against the specific
   failures this station actually suffers.

   THE DESIGN RULES, each of which is a scar.

   1. PURE. No IO, no clock, no network, no require of a live subsystem. The host gathers facts and passes
      them in; this file only judges. Same shape as production-gate.js, for the same reason: the decision has
      to be testable without a station, and it must not be able to drift between the callers that ask it.

   2. THREE STATES, NEVER TWO. `ok` / `blocked` / `unknown`. A binary verdict forces unknowable things into
      one bucket or the other, and this station's whole failure history is unknowable things reported as fine.
      Provider CREDIT cannot be known without a billed call. Whether a render is visually correct cannot be
      known mechanically — a 171-second film of solid black clears every byte-level gate here. Whether a model
      will emit real tool calls under the full prompt cannot be known without spending. Those are `unknown`
      FOREVER, by construction, and they are listed beside the verdict rather than folded into it.

   3. GREEN REQUIRES ZERO BLOCKED **AND** THE UNKNOWNS SHOWN. `verdict.ready` is never true while anything is
      blocked, and a caller that renders `ready` without rendering `unknown` is misusing this module — which
      is why `summary.unknown` is always populated and never empty in practice.

   4. A MISSING INPUT IS `blocked`, NEVER A PASS. If the host could not gather a fact, that is a refusal to
      judge, not a judgement of ok. Fail-closed is the only safe direction for a readiness signal: the
      alternative is precisely the eight silent days.

   5. IT NEVER RE-DERIVES ANOTHER MODULE'S RULE. The gate verdict arrives already computed by
      productionGate.decide (via cronStateSnapshot's `gateBlocked`); the lifecycle arrives from
      deliverableManifest.lifecycleOf; the caps from budgetcaps. A second opinion about an authorization rule
      is how two safety controls end up disagreeing about the same run.

   makeReadiness() -> { assess(facts) -> report }   — see assess() for the facts contract. */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).readiness = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const OK = 'ok', BLOCKED = 'blocked', UNKNOWN = 'unknown';

  function row(id, state, title, detail, evidence) {
    return { id: id, state: state, title: title, detail: String(detail || ''), evidence: evidence === undefined ? null : evidence };
  }
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  const arr = (v) => (Array.isArray(v) ? v : []);

  /* ---- A1. Will an armed routine actually be allowed to fire? ----
     The eight-day failure, caught directly. `gateBlocked` is computed by the host from
     productionGate.decide(); we only read it. Deliberately `!== true` rather than `=== false`: the field is
     absent on disabled routines and on a payload from before it existed, and treating absent as blocked
     would manufacture a false alarm — the inverse mistake, which this station has also made. */
  function checkGate(f) {
    const cron = f.cron;
    if (!cron || !Array.isArray(cron.jobs)) {
      return row('gate', BLOCKED, 'Routine authorization', 'no cron snapshot was supplied — cannot judge whether a fire would be permitted');
    }
    const armed = cron.jobs.filter(j => j && j.enabled !== false);
    const blocked = armed.filter(j => j.gateBlocked === true);
    const unjudged = armed.filter(j => j.gateBlocked === null);
    const prod = cron.production || {};
    if (blocked.length) {
      return row('gate', BLOCKED, 'Routine authorization',
        blocked.length + ' of ' + armed.length + ' armed routine(s) would be REFUSED before any provider call: '
        + blocked.map(j => (j.name || j.id) + ' (' + (j.gateCode || j.gateBecause || 'blocked') + ')').join('; '),
        { armed: armed.length, blocked: blocked.length, productionArmed: prod.armed === true });
    }
    if (unjudged.length) {
      return row('gate', UNKNOWN, 'Routine authorization',
        unjudged.length + ' armed routine(s) could not be judged by the host', { unjudged: unjudged.length });
    }
    if (!armed.length) {
      return row('gate', BLOCKED, 'Routine authorization',
        'no routine is armed — nothing is scheduled to run unattended at all', { armed: 0 });
    }
    return row('gate', OK, 'Routine authorization',
      armed.length + ' armed routine(s), none gate-blocked', { armed: armed.length });
  }

  /* ---- A2. Did unattended work actually HAPPEN recently? ----
     The assertion A1 alone cannot make. A1 proves permission; this proves EFFECT. It is the one check that
     would have failed on day two of the idleness rather than never.
     `toolsOk > 0` is required because this station's own hard-won rule is that `reason: 'done'` proves
     nothing — a model can emit tool syntax as prose and the harness runs nothing. A run that completed
     without a single successful tool call is not evidence of work. */
  function checkRecentWork(f) {
    const w = f.recentWork;
    if (!w || typeof w !== 'object') {
      return row('work', BLOCKED, 'Recent unattended work', 'no run history was supplied — cannot prove any work happened');
    }
    const ageH = num(w.lastAutonomousDoneAgeHours);
    const maxH = num(w.maxAgeHours) == null ? 48 : num(w.maxAgeHours);
    const tools = num(w.lastAutonomousToolsOk);
    if (ageH == null) {
      return row('work', BLOCKED, 'Recent unattended work',
        'no autonomous run has EVER completed — the station has never done unattended work', { everCompleted: false });
    }
    if (ageH > maxH) {
      return row('work', BLOCKED, 'Recent unattended work',
        'the last completed autonomous run was ' + ageH.toFixed(1) + 'h ago (threshold ' + maxH + 'h) — the station is idle',
        { ageHours: ageH, maxAgeHours: maxH });
    }
    if (tools != null && tools <= 0) {
      return row('work', BLOCKED, 'Recent unattended work',
        'the last autonomous run completed but made ZERO successful tool calls — "done" is not evidence of work',
        { ageHours: ageH, toolsOk: tools });
    }
    return row('work', OK, 'Recent unattended work',
      'last completed autonomous run ' + ageH.toFixed(1) + 'h ago with ' + (tools == null ? 'unrecorded' : tools) + ' successful tool call(s)',
      { ageHours: ageH, toolsOk: tools });
  }

  /* ---- A3. Can a run survive losing its primary model? ----
     A saved chain of ONE is not a chain. Requiring >= 2 entries AND more than one vendor prefix is the
     cheapest possible defence against the live failure: five consecutive refusals on one provider's rate
     limit with nowhere to rotate, which auto-disabled the owner's main pipeline.
     Also refuses the three shapes the field notes record as unusable in a chain: a `:batch` variant (async),
     a `~`-prefixed floating alias (drifts under you), and `openrouter/auto` (unpriceable -> books $0). */
  function checkFallback(f) {
    const fb = f.fallback;
    if (!fb || !Array.isArray(fb.chain)) {
      return row('fallback', BLOCKED, 'Model fallback chain', 'no fallback chain was supplied — cannot judge rotation');
    }
    const chain = fb.chain.map(String);
    const bad = chain.filter(m => /:batch\b/.test(m) || m.startsWith('~') || m === 'openrouter/auto');
    if (bad.length) {
      return row('fallback', BLOCKED, 'Model fallback chain',
        'chain contains entries that cannot work as a fallback: ' + bad.join(', ')
        + ' (:batch is async, ~ is a drifting alias, openrouter/auto is unpriceable and books $0)', { chain: chain, bad: bad });
    }
    if (chain.length < 2) {
      return row('fallback', BLOCKED, 'Model fallback chain',
        'chain has ' + chain.length + ' entr' + (chain.length === 1 ? 'y' : 'ies')
        + ' — a rate limit or outage on the primary ends the run instead of rotating', { chain: chain });
    }
    const vendors = new Set(chain.map(m => m.split('/')[0]));
    const primaries = new Set(arr(f.primaryProviders).map(String));
    if (vendors.size < 2) {
      return row('fallback', BLOCKED, 'Model fallback chain',
        'every chain entry is the same vendor (' + [...vendors].join(',') + ') — one empty wallet kills all of them',
        { chain: chain, vendors: [...vendors] });
    }
    return row('fallback', OK, 'Model fallback chain',
      chain.length + ' entries across ' + vendors.size + ' vendors', { chain: chain, vendors: [...vendors], primaries: [...primaries] });
  }

  /* ---- A4. Is the whole crew standing on one provider? ----
     Concentration risk, stated as a fact rather than a preference. When one provider holds nearly every
     agent, that provider's rate limit is the station's rate limit — which is exactly how a per-model
     tokens-per-minute cap on one vendor took the business offline. Reported `blocked` only at total
     concentration; a strong majority is `unknown` (a judgement call the owner may have made deliberately). */
  function checkProviderSpread(f) {
    const roster = arr(f.roster);
    if (!roster.length) {
      return row('spread', BLOCKED, 'Provider concentration', 'no roster was supplied — cannot judge concentration');
    }
    const byProvider = {};
    for (const a of roster) { const p = String((a && a.provider) || '(none)'); byProvider[p] = (byProvider[p] || 0) + 1; }
    const total = roster.length;
    const top = Object.keys(byProvider).sort((x, y) => byProvider[y] - byProvider[x])[0];
    const share = byProvider[top] / total;
    const detail = Object.keys(byProvider).sort().map(p => p + ':' + byProvider[p]).join(', ');
    if (Object.keys(byProvider).length === 1) {
      return row('spread', BLOCKED, 'Provider concentration',
        'ALL ' + total + ' agents are on a single provider (' + top + ') — its rate limit is the station\'s rate limit',
        { byProvider: byProvider });
    }
    if (share >= 0.8) {
      return row('spread', UNKNOWN, 'Provider concentration',
        Math.round(share * 100) + '% of agents are on ' + top + ' (' + detail + ') — deliberate, or drift?',
        { byProvider: byProvider, topShare: share });
    }
    return row('spread', OK, 'Provider concentration', detail, { byProvider: byProvider, topShare: share });
  }

  /* ---- A5. Is any advertised tool unimplemented? ----
     A grant with no registered implementation is a DARK TOOL: the model is told a capability exists, spends
     turns trying to call it, and gets nothing. Seven of them lived on the studio bay for months, including
     one whose description promised exactly the clip assembly the video pipeline needed while no code existed.
     Needs the host to pass the registered names, because the registry is built per run. */
  function checkDarkTools(f) {
    const d = f.tools;
    if (!d || !Array.isArray(d.granted) || !Array.isArray(d.registered)) {
      return row('darktools', UNKNOWN, 'Advertised vs implemented tools',
        'the host did not supply both the grant list and the registered list — cannot diff');
    }
    const registered = new Set(d.registered.map(String));
    const dark = [...new Set(d.granted.map(String))].filter(t => !registered.has(t)).sort();
    if (dark.length) {
      return row('darktools', BLOCKED, 'Advertised vs implemented tools',
        dark.length + ' granted tool(s) have no registered implementation: ' + dark.join(', '), { dark: dark });
    }
    return row('darktools', OK, 'Advertised vs implemented tools',
      d.granted.length + ' grants, all implemented', { granted: d.granted.length });
  }

  /* ---- A6. Are deliverables verified? ----
     Reported as a CAPABILITY GAP, not a red light, and the distinction is the point. An `unverified` row is
     not a failed artifact — it is an artifact the host never had a verifier for. On this station exactly one
     code path ever calls setVerification (the studio video), so most rows can never leave `unverified`
     however good they are. Calling that `blocked` would be blaming the artifact for a missing checker.
     What IS blocked: an artifact the Commander approved while the host never proved its bytes. */
  function checkDeliverables(f) {
    const o = f.outbox;
    if (!o || typeof o !== 'object') {
      return row('deliverables', UNKNOWN, 'Deliverable verification', 'no Outbox snapshot was supplied');
    }
    const total = num(o.total) || 0;
    const unverified = num(o.unverified) || 0;
    const approvedUnverified = num(o.approvedUnverified) || 0;
    if (approvedUnverified > 0) {
      return row('deliverables', BLOCKED, 'Deliverable verification',
        approvedUnverified + ' artifact(s) are APPROVED while the host never verified their bytes',
        { total: total, unverified: unverified, approvedUnverified: approvedUnverified });
    }
    if (!total) {
      return row('deliverables', UNKNOWN, 'Deliverable verification', 'no deliverables are registered yet', { total: 0 });
    }
    if (unverified > 0) {
      return row('deliverables', UNKNOWN, 'Deliverable verification',
        unverified + ' of ' + total + ' rows are unverified — the host has no verifier for those kinds, '
        + 'which is a capability gap, not a failed artifact',
        { total: total, unverified: unverified });
    }
    return row('deliverables', OK, 'Deliverable verification', total + ' rows, all verified', { total: total });
  }

  /* ---- A7 + A8. Is the spend ledger usable, and is the day rail soft or strict? ----
     These are ONE failure and only the second half explains why it is fatal. An orphan receipt makes spend
     history unknown; whether that DEGRADES or BRICKS depends on whether a governed scope is strict. Saving
     `perDay` — even to the value it already had — makes the day scope explicit and therefore strict, and a
     strict governed scope turns an unknown ledger into a hard refusal of every metered run. Four separate
     station-wide outages trace to exactly this pair. */
  function checkLedger(f) {
    const b = f.budget;
    if (!b || typeof b !== 'object') {
      return row('ledger', BLOCKED, 'Spend accounting', 'no budget snapshot was supplied — cannot judge whether runs would be refused');
    }
    const acct = b.accounting || {};
    const pending = num(b.pendingReceipts);
    const strictDay = b.savedKeys ? arr(b.savedKeys).indexOf('perDay') >= 0 : null;
    if (pending != null && pending > 0) {
      return row('ledger', BLOCKED, 'Spend accounting',
        pending + ' orphan spend receipt(s) present' + (strictDay ? ' AND the day rail is STRICT (perDay is saved), so every metered run is refused' : ''),
        { pendingReceipts: pending, strictDay: strictDay });
    }
    if (acct.complete !== true || acct.durable !== true) {
      return row('ledger', BLOCKED, 'Spend accounting',
        'the ledger is not complete/durable (complete=' + acct.complete + ', durable=' + acct.durable + ') — metered runs will refuse',
        { accounting: acct, strictDay: strictDay });
    }
    return row('ledger', OK, 'Spend accounting',
      'ledger complete and durable, no orphan receipts'
      + (strictDay ? ' (note: perDay is SAVED, so the day rail is STRICT — an orphan receipt would brick, not degrade)' : ''),
      { accounting: acct, strictDay: strictDay });
  }

  /* ---- A9. Is a delegated worker bounded? ----
     orchestration.js passes `maxCostUsd: perWorker` with a comment promising "a runaway worker can't blow the
     lead's per-run ceiling". With BUDGET_PER_WORKER unset perWorker is 0, which is not > 0, so runOnce falls
     through to the station perRun — and with perRun also 0 that is Infinity. The promise is inert and the only
     bound left is the day pool. Either knob satisfies this; neither being set does not. */
  function checkWorkerCap(f) {
    const c = f.caps;
    if (!c || typeof c !== 'object') {
      return row('workercap', UNKNOWN, 'Delegated worker spend cap', 'no cap snapshot was supplied');
    }
    const perWorker = num(c.perWorker);
    const perRun = num(c.perRun);
    if ((perWorker != null && perWorker > 0) || (perRun != null && perRun > 0)) {
      return row('workercap', OK, 'Delegated worker spend cap',
        'bounded (perWorker=' + perWorker + ', perRun=' + perRun + ')', { perWorker: perWorker, perRun: perRun });
    }
    return row('workercap', BLOCKED, 'Delegated worker spend cap',
      'BOTH perWorker and perRun are 0/unset — a dispatched worker has NO per-run ceiling; only the day pool bounds it',
      { perWorker: perWorker, perRun: perRun });
  }

  /* ---- THE PERMANENT UNKNOWNS ----
     Named, always present, and never allowed to contribute to a green verdict. Each one is here because
     proving it requires either money or human judgement, and asserting it anyway is the exact lie this
     module exists to prevent. The free PROXY is reported beside each so the row is still useful. */
  function permanentUnknowns(f) {
    const out = [];
    const lastErr = f.lastProviderError ? String(f.lastProviderError) : '';
    out.push(row('credit', UNKNOWN, 'Provider credit / balance',
      'cannot be known without a billable call. Credential PRESENCE is not funding'
      + (lastErr ? '. Last observed provider failure: ' + lastErr.slice(0, 160) : ''),
      { proxy: 'last fire outcome + the redacted error ring', lastProviderError: lastErr || null }));
    out.push(row('visual', UNKNOWN, 'Visual / semantic correctness',
      'no mechanical check can judge whether a render or a page is actually GOOD. A 171-second film of solid '
      + 'black passes every byte-level gate here. Quality is a QC reviewer\'s verdict, never this report\'s',
      { proxy: 'the qc axis, set by an independent reviewer' }));
    out.push(row('toolcalling', UNKNOWN, 'Model tool-calling under the full prompt',
      'a single-tool probe passing proves nothing, and `reason: done` with non-zero usd proves nothing. Only a '
      + 'real run emitting both agent.tool_call and agent.tool_result proves it, and that costs money',
      { proxy: 'toolsOk on the most recent autonomous run (see the "work" row)' }));
    if (f.unaccountedSpendFlag === true) {
      out.push(row('unaccounted', BLOCKED, 'Unauditable spend channel',
        'STUDIO_ALLOW_UNACCOUNTED_SPEND is ENABLED — video renders can bill an account this station cannot read',
        { enabled: true }));
    } else {
      out.push(row('unaccounted', OK, 'Unauditable spend channel',
        'STUDIO_ALLOW_UNACCOUNTED_SPEND is absent, so the unauditable render lane is closed', { enabled: false }));
    }
    return out;
  }

  /* assess(facts) -> report
       facts.cron            : { jobs:[{enabled,gateBlocked,gateCode,gateBecause,name,id}], production:{armed} }
       facts.recentWork      : { lastAutonomousDoneAgeHours, lastAutonomousToolsOk, maxAgeHours? }
       facts.fallback        : { chain:[slug] }
       facts.primaryProviders: [providerId]
       facts.roster          : [{ agentId, provider, model }]
       facts.tools           : { granted:[name], registered:[name] }
       facts.outbox          : { total, unverified, approvedUnverified }
       facts.budget          : { accounting:{complete,durable}, pendingReceipts, savedKeys:[capName] }
       facts.caps            : { perWorker, perRun }
       facts.lastProviderError, facts.unaccountedSpendFlag
     Every field is optional; a missing one yields `blocked` or `unknown` for its row, never a pass. */
  function assess(facts) {
    const f = facts || {};
    const checks = [
      checkGate(f), checkRecentWork(f), checkFallback(f), checkProviderSpread(f),
      checkDarkTools(f), checkDeliverables(f), checkLedger(f), checkWorkerCap(f)
    ].concat(permanentUnknowns(f));

    const blocked = checks.filter(c => c.state === BLOCKED);
    const unknown = checks.filter(c => c.state === UNKNOWN);
    const ok = checks.filter(c => c.state === OK);

    return {
      // `ready` is true ONLY with zero blocked rows. It is deliberately NOT "ready" in the sense of
      // "production-ready" — a caller must render `unknown` alongside it or it is misrepresenting this report.
      verdict: {
        ready: blocked.length === 0,
        blockedCount: blocked.length,
        unknownCount: unknown.length,
        okCount: ok.length,
        headline: blocked.length === 0
          ? ('no blocking condition found; ' + unknown.length + ' thing(s) remain UNKNOWABLE without spend or human judgement')
          : (blocked.length + ' blocking condition(s): ' + blocked.map(b => b.id).join(', '))
      },
      checks: checks,
      summary: {
        blocked: blocked.map(c => c.id),
        unknown: unknown.map(c => c.id),
        ok: ok.map(c => c.id)
      }
    };
  }

  return { assess, STATES: { OK: OK, BLOCKED: BLOCKED, UNKNOWN: UNKNOWN } };
});

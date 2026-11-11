/* test/cron-runnability-truth.test.js — A COUNTDOWN IS A PROMISE (2026-11-11).

   WHAT PROVOKED THIS, measured on the live station:
     · production was disarmed 2026-11-03T21:36:39Z (and the log attributed it to "owner" unconditionally —
       see the attribution half of this fix in production-gate.readArmState)
     · three routines stayed ARMED and every fire for the next eight days was declined before any provider
       call: lastStatus 'declined', consecutiveFailures 0 (a decline must never auto-disable a routine, so the
       auto-disable safety net can never escalate one either)
     · ZERO autonomous runs completed in those eight days
     · a refused fire is never written to runs.jsonl — it is refused before runStore.record — so the run log
       could not contradict it either
     · and the dashboard tile read "next routine: 5h" the entire time, because it derived a countdown from
       `enabled` + `nextRunAt` and nothing else.

   The station's first law is that the interface must never assert state the harness cannot prove. A countdown
   to a fire the harness has ALREADY decided to refuse is exactly that, in the one place that decides whether
   the owner's business does any work at all.

   WHAT THIS PINS:
     A. the gate verdict is computed by CALLING productionGate.decide, not by re-deriving its rule, and the
        unmetered escape hatch still works (that is what keeps a free/subscription setup running while
        disarmed — removing it would brick the owner's documented free-model posture)
     B. the readiness signal is COMPLETE, not gate-only: a missing model and a missing credential block too,
        and the AUTHORIZATION reason outranks them so the deciding reason is never buried
     C. provider CREDIT is deliberately NOT claimed — it cannot be known without a billed call
     D. a failure to judge reports UNKNOWN, never "runnable" (fail-closed on the display)
     E. the widget shows the BLOCKER instead of a time when nothing can run, prefers a runnable routine when
        one exists, and never silently upgrades `null` to runnable

   Plain node, no framework (test/_assert.js). */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');

const gate = require('../sidecar/production-gate.js');

/* ---------- A. THE VERDICT COMES FROM THE GATE, AND `unmetered` STILL ESCAPES ---------- */
{
  // The exact input shape the snapshot builds: a scheduled fire is always surface 'autonomous'.
  const judge = (armed, unmetered) => gate.decide({ armed: armed, metered: !unmetered, surface: 'autonomous' });

  A.eq(judge(false, false).allow, false, 'disarmed + metered + unattended is refused — the live case');
  A.eq(judge(false, false).code, 'PRODUCTION_DISARMED', 'with the stable machine-readable code');
  A.eq(judge(false, false).because, 'disarmed+metered+unattended', 'naming the deciding rule');

  /* THE ESCAPE HATCH MUST SURVIVE. production-gate's own comment: an unmetered run "has no money to protect.
     This is what keeps the owner's free-model setup fully functional while production is disarmed." A
     readiness signal that reported those as blocked would tell the owner to arm production they do not need. */
  A.eq(judge(false, true).allow, true, 'disarmed + UNMETERED is allowed');
  A.eq(judge(false, true).because, 'unmetered', 'and says why');
  A.eq(judge(true, false).allow, true, 'armed + metered is allowed');
  A.eq(judge(true, false).because, 'armed', 'and says why');

  /* Only four providers are unmetered on this station (codex/grok/kimi/ollama — subscription or local), so a
     free-TIER API model like gemini is correctly metered and correctly refused. Pinned so a future edit that
     marks a billable provider unmetered has to confront this line. */
  const reg = require('../sidecar/providers/registry.js');
  const ids = typeof reg.providerIds === 'function' ? reg.providerIds() : [];
  A.ok(ids.length > 4, 'the registry lists providers');
  const unmeteredIds = ids.filter(id => !!((reg.getProviderProfile(id) || {}).unmetered)).sort();
  A.eq(unmeteredIds.join(','), 'codex,grok,kimi,ollama',
    'exactly the subscription/local providers are unmetered — a billable one must never be added silently');
  A.eq(!!((reg.getProviderProfile('gemini') || {}).unmetered), false,
    'gemini is METERED even on its free tier, so it is gated (its 20/day free tier still 429s, not bills)');
}

/* ---------- B+C+D. THE SNAPSHOT'S READINESS LOGIC ---------- */
{
  /* cronStateSnapshot lives inside sidecar/index.js (~22k lines, not independently requirable), so the
     DECISION ORDER is replayed here against the real gate and the real registry, and the source is asserted
     to still have this shape. Source-locking is used only for what cannot be executed standalone. */
  const reg = require('../sidecar/providers/registry.js');
  const runnability = (job, armed, hasCred, model) => {
    const provider = job.provider || 'gemini';
    const unmetered = !!((reg.getProviderProfile(provider) || {}).unmetered);
    const v = gate.decide({ armed: armed, metered: !unmetered, surface: 'autonomous' });
    if (!v.allow) return { blocked: true, code: v.code, because: v.because };
    if (!job.noAgent) {
      if (!model) return { blocked: true, code: 'NO_MODEL', because: 'no model configured' };
      if (!hasCred) return { blocked: true, code: 'NO_CREDENTIAL', because: 'provider "' + provider + '" has no usable credential' };
    }
    return { blocked: false, code: '', because: v.because };
  };

  const job = { provider: 'gemini', noAgent: false };
  A.eq(runnability(job, false, true, 'm').code, 'PRODUCTION_DISARMED', 'disarmed outranks everything');
  /* AUTHORIZATION OUTRANKS CONFIG, deliberately. A routine that is BOTH unauthorized and misconfigured must
     report the gate — telling the owner "no credential" when arming is the deciding action sends them to fix
     the wrong thing. */
  A.eq(runnability(job, false, false, '').code, 'PRODUCTION_DISARMED',
    'a routine blocked on BOTH reports the authorization one, not the config one');
  A.eq(runnability(job, true, true, '').code, 'NO_MODEL', 'armed + no model -> NO_MODEL');
  A.eq(runnability(job, true, false, 'm').code, 'NO_CREDENTIAL', 'armed + no credential -> NO_CREDENTIAL');
  A.eq(runnability(job, true, true, 'm').blocked, false, 'armed + configured -> runnable');

  // C. CREDIT IS NOT CLAIMED: a fully configured routine on an exhausted wallet still reports runnable,
  // because the host cannot know a balance without a billed call. The last fire's lastError carries that.
  A.eq(runnability(job, true, true, 'm').blocked, false,
    'an exhausted-quota routine reports runnable — credit is unknowable for free and is NOT guessed at');

  // A script-only routine is not asked for a model/credential it never uses, but the GATE still applies
  // (runOnceCore makes no noAgent exception either, so neither does this).
  A.eq(runnability({ provider: 'gemini', noAgent: true }, true, false, '').blocked, false,
    'a script-only routine needs no model/credential');
  A.eq(runnability({ provider: 'gemini', noAgent: true }, false, false, '').code, 'PRODUCTION_DISARMED',
    'but a script-only routine is NOT exempt from the authorization gate');

  const src = fs.readFileSync(path.join(__dirname, '..', 'sidecar', 'index.js'), 'utf8');
  const at = src.indexOf('function cronStateSnapshot');
  A.ok(at > 0, 'cronStateSnapshot located');
  const body = src.slice(at, src.indexOf('function handleCronList', at));
  A.ok(body.length > 1500, 'the whole snapshot function was captured, not a truncated window');
  A.ok(/productionGate\.decide\(\{ armed: arm\.armed, metered: !unmetered, surface: 'autonomous' \}\)/.test(body),
    'the snapshot CALLS the gate rather than re-deriving its rule');
  A.ok(/cronProviderFor\(job\)/.test(body), 'and resolves the provider with the same resolver the driver uses');
  A.ok(/gateBlocked/.test(body) && /blockedJobs/.test(body), 'it exposes the per-job verdict and an armed-blocked count');
  A.ok(/production: \{ armed: arm\.armed/.test(body), 'and the authorization state beside the schedule');
  // D. fail-closed on the DISPLAY: an unjudgeable routine must not read as runnable.
  A.ok(/blocked: null/.test(body) && /must not be reported as "runnable"/.test(body),
    'a failure to judge reports unknown, never runnable');
  A.ok(body.indexOf("code: 'NO_MODEL'") > body.indexOf('if (!v.allow) return'),
    'config checks come AFTER the authorization verdict in the source, matching the precedence asserted above');
}

/* ---------- E. THE WIDGET STOPS PROMISING WORK THAT CANNOT HAPPEN ---------- */
{
  /* frontend/app/widgets.js is a browser module and nextRoutine is not exported, so its behaviour is asserted
     by EXECUTING the real function rather than regex-matching its source — the repo's own lesson from
     provider-configured-from-sidecar.test.js, which executes harness.js the same way and whose comment notes
     that source-locking a frontend file is the weaker choice.

     Run in a `vm` sandbox (the established idiom here) rather than `new Function`. The executed text is this
     repository's own version-controlled file and the sandbox is given nothing but a stub helper — no require,
     no process, no fs — so the extracted function cannot reach anything even if the file were wrong. */
  const vm = require('node:vm');
  const wsrc = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'widgets.js'), 'utf8');
  const start = wsrc.indexOf('function nextRoutine(');
  A.ok(start > 0, 'nextRoutine located in widgets.js');
  const end = wsrc.indexOf('\n  }', start);
  A.ok(end > start, 'and its body delimited');
  const fnSrc = wsrc.slice(start, end + 4);
  // cronStateLabel is the only helper it calls, on the early-return paths; stub it inside the sandbox.
  const sandbox = { cronStateLabel: () => 'scheduler off', nextRoutine: null };
  vm.runInNewContext(fnSrc + '\nthis.nextRoutine = nextRoutine;', sandbox, { timeout: 5000 });
  const nextRoutine = sandbox.nextRoutine;
  A.eq(typeof nextRoutine, 'function', 'the real nextRoutine was loaded and is callable');

  const now = Date.parse('2026-11-11T00:00:00Z');
  const soon = new Date(now + 5 * 3600000).toISOString();
  const later = new Date(now + 20 * 3600000).toISOString();

  // THE LIVE CASE: armed routines, all gate-blocked, production disarmed.
  const blockedState = {
    enabled: true, halted: false, production: { armed: false, blockedJobs: 3 },
    jobs: [
      { id: 'a', name: 'Etsy Scout daily', enabled: true, nextRunAt: soon, gateBlocked: true, gateBecause: 'disarmed+metered+unattended' },
      { id: 'b', name: 'Etsy chain', enabled: true, nextRunAt: later, gateBlocked: true, gateBecause: 'disarmed+metered+unattended' },
      { id: 'c', name: 'Harvest weekly', enabled: true, nextRunAt: later, gateBlocked: true, gateBecause: 'disarmed+metered+unattended' }
    ]
  };
  const blocked = nextRoutine(blockedState, now);
  A.eq(blocked.val, 'off', 'with nothing runnable the tile does NOT show a countdown');
  A.ok(/3 routines blocked/.test(blocked.sub), 'it names how many are blocked: ' + blocked.sub);
  A.ok(/production disarmed/.test(blocked.sub), 'and why');
  A.eq(/\dh/.test(String(blocked.val)), false, 'and no hour figure survives anywhere in the value');

  // A runnable routine is still reported normally — the fix must not blind a healthy station.
  const okState = {
    enabled: true, halted: false, production: { armed: true, blockedJobs: 0 },
    jobs: [{ id: 'a', name: 'Etsy Scout daily', enabled: true, nextRunAt: soon, gateBlocked: false, gateBecause: 'armed' }]
  };
  const ok = nextRoutine(okState, now);
  A.eq(ok.val, '5h', 'a runnable routine still counts down');
  A.eq(ok.sub, 'Etsy Scout daily', 'named as before');

  // MIXED: one blocked, one runnable -> count down to the RUNNABLE one, not the sooner blocked one.
  const mixed = nextRoutine({
    enabled: true, halted: false, production: { armed: true, blockedJobs: 1 },
    jobs: [
      { id: 'a', name: 'blocked one', enabled: true, nextRunAt: soon, gateBlocked: true, gateBecause: 'no model configured' },
      { id: 'b', name: 'good one', enabled: true, nextRunAt: later, gateBlocked: false, gateBecause: 'armed' }
    ]
  }, now);
  A.eq(mixed.sub, 'good one', 'the countdown skips a blocked routine and names the one that can run');
  A.eq(mixed.val, '20h', 'using the runnable routine\'s time, not the blocked one\'s sooner slot');

  // D on the display side: unknown must not silently read as a clean countdown.
  const unk = nextRoutine({
    enabled: true, halted: false, production: { armed: true },
    jobs: [{ id: 'a', name: 'mystery', enabled: true, nextRunAt: soon, gateBlocked: null }]
  }, now);
  A.ok(/readiness unknown/.test(unk.sub), 'an unjudgeable routine is flagged, not presented as fine: ' + unk.sub);

  // Back-compat: an OLD snapshot with no gateBlocked field at all must behave exactly as before.
  const legacy = nextRoutine({
    enabled: true, halted: false,
    jobs: [{ id: 'a', name: 'legacy', enabled: true, nextRunAt: soon }]
  }, now);
  A.eq(legacy.val, '5h', 'a snapshot from before this field still counts down (additive, nothing breaks)');
  A.eq(legacy.sub, 'legacy', 'and names the routine with NO "readiness unknown" false alarm');
  /* The undefined-vs-null distinction is load-bearing and was wrong in the first draft of this fix: `== null`
     treated an ABSENT field as "the host could not judge" and labelled every routine of an older payload
     unknown. Pinned here because that false alarm is the same class of lie as the countdown it replaced. */
  A.ok(!/readiness unknown/.test(legacy.sub), 'an absent field is not an unknown verdict');

  // The pre-existing early returns are untouched.
  A.eq(nextRoutine(null, now).val, null, 'no cron state -> no claim');
  A.eq(nextRoutine({ enabled: false, jobs: [] }, now).val, null, 'a disarmed scheduler -> no claim');
  A.eq(nextRoutine({ enabled: true, halted: false, jobs: [] }, now).sub, 'nothing scheduled', 'empty -> nothing scheduled');
}

/* ---------- F. ATTRIBUTION IS A CLAIM, NEVER A PROOF ----------
   readArmState used to render "production ARMED/DISARMED by the owner" unconditionally, ignoring the stored
   `by`. /api/production/arm rides the same shared x-starnet-token every /api route does, so the host cannot
   tell the owner's own click from any other token-holder's POST — and an assistant session holds that token.

   The live record is {"armed":false,"at":"2026-11-03T21:36:39.342Z","by":"owner"} and the log shows an ARM at
   07:03:20Z that same day, 14h33m earlier — the arm window an assistant session is recorded as having opened
   and closed. So the owner was being told their own business was disarmed by their own decision while three
   routines declined every fire for eight days. Nothing here grants or withholds authority: `armed` is
   untouched either way, only the sentence stops overclaiming. */
{
  const persisted = gate.readArmState({ armed: false, at: '2026-11-03T21:36:39.342Z', by: 'owner' }, undefined);
  A.eq(persisted.armed, false, 'the authorization decision itself is unchanged');
  A.eq(persisted.at, '2026-11-03T21:36:39.342Z', 'the timestamp is exposed so staleness is computable');
  A.eq(persisted.by, 'owner', 'and the stored label is exposed rather than discarded');
  A.ok(/cannot verify who acted/.test(persisted.note), 'the note says the attribution is unverifiable: ' + persisted.note);
  A.eq(/by the owner/.test(persisted.note), false, 'and never asserts "by the owner" as fact');

  /* The first draft of this fix exempted by:'owner' from the caveat — which would have left the LIVE record
     reading exactly as before and fixed nothing. No value is privileged. */
  A.ok(/cannot verify/.test(gate.readArmState({ armed: true, at: 'T', by: 'owner' }, undefined).note),
    'by:"owner" gets no exemption — it is the live value and the whole point');
  A.ok(/recorded by: some-session/.test(gate.readArmState({ armed: false, by: 'some-session' }, undefined).note),
    'a different claimed actor is quoted as a claim');
  A.ok(/unattributed/.test(gate.readArmState({ armed: false, at: 'T' }, undefined).note),
    'a record with no `by` at all says unattributed, not "the owner"');

  // Unchanged behaviour on every other branch — fail-closed and precedence must not move.
  A.eq(gate.readArmState(null, undefined).source, 'default', 'never-set is still reported as default');
  A.eq(gate.readArmState({ nonsense: 1 }, '1').armed, false, 'a malformed record still fails CLOSED over env=1');
  A.eq(gate.readArmState({ nonsense: 1 }, '1').source, 'malformed', 'and is reported as damage, not default');
  A.eq(gate.readArmState(null, '1').armed, true, 'env can still arm when nothing is persisted');

  // The host must stop manufacturing 'owner' as a DEFAULT, and must keep an append-only history.
  const isrc = fs.readFileSync(path.join(__dirname, '..', 'sidecar', 'index.js'), 'utf8');
  const sv = isrc.slice(isrc.indexOf('function saveProductionArm'), isrc.indexOf('function saveProductionArm') + 1400);
  A.eq(/String\(who \|\| 'owner'\)/.test(sv), false, 'saveProductionArm no longer defaults the actor to "owner"');
  A.ok(/claimed \|\| 'unattributed'/.test(sv), 'an unclaimed change is recorded as unattributed');
  A.ok(/appendProductionArmHistory\(rec\)/.test(sv), 'and every change appends to a durable history');
  // Scoped to the FUNCTION BODY, not the file: the helper's definition sits above saveProductionArm, so a
  // whole-file indexOf compares the wrong occurrence (this assertion failed that way on first write).
  A.ok(sv.indexOf('writeFileDurable({ fs, path }, PRODUCTION_ARM_FILE') < sv.indexOf('appendProductionArmHistory(rec)'),
    'the durable current-state write still happens first — a failed history append must never block a disarm');
}

A.report('cron runnability truth');

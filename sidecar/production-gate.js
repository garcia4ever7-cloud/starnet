/* sidecar/production-gate.js — OWNER-AUTHORIZED PRODUCTION. The decision "may this run spend real money
   with nobody watching?" as a pure function, so it is testable without a station and cannot drift between
   the paths that ask it.

   WHY THIS EXISTS (2026-11-03). The owner wants every subsystem AVAILABLE but production to start only on
   their command. The three obvious ways to get that are all wrong:

     • disable the routines          -> destroys the schedule the owner wants preserved, and a disabled
                                        routine proves nothing about readiness. Explicitly ruled out.
     • set budgetcaps perRun low     -> bounds the SIZE of unattended spend, never its EXISTENCE, and it
                                        equally throttles the interactive runs the owner is driving.
     • rely on the $25/day rail      -> that is a soft rail with a one-click RESUME; it is a backstop
                                        against runaway cost, not an authorization control.

   So the gate is orthogonal to budget: budget answers "how much", this answers "may it start at all".

   THE RULE, in precedence order:

     1. ARMED                  -> allow. The owner has authorized production; nothing here second-guesses it.
     2. NOT METERED            -> allow. A free/unmetered run has no money to protect. This is what keeps the
                                  owner's free-model setup fully functional while production is disarmed.
     3. A HUMAN IS PRESENT     -> allow. An interactive run IS the owner's command, by definition.
     4. otherwise              -> REFUSE. Unattended + metered + disarmed = exactly the case the owner said
                                  must not happen during readiness.

   WHAT "A HUMAN IS PRESENT" MEANS. Deliberately the SAME test sidecar/permissions.js already uses for its
   exec lockout (`surface !== 'autonomous'`, with a missing surface DEFAULTING to autonomous). Inventing a
   second definition of unattended is how two safety controls end up disagreeing about the same run, so this
   module imports the idea rather than re-deriving it: unknown posture is treated as the dangerous one.

   WHY A DELEGATED WORKER IS CHECKED TOO. A lead refused at the gate never dispatches, so workers are mostly
   moot — but `decide()` is called per run, so a worker spawned by any future path is judged on its own
   surface. A gate that only guarded the entry point would be one refactor away from being bypassed.

   FAIL-CLOSED. An unreadable/corrupt arm state is DISARMED, never armed. `readArmState` returns the reason
   so the host can say why rather than silently refusing.

   This module does no IO and reads no clock. The host passes state in. */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).productionGate = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* The refusal code is stable and machine-readable: a caller (UI, cron result row, a test) must be able to
     tell "the owner has not armed production" apart from a credential, quota or budget failure. Reusing an
     existing code would have made this indistinguishable from out-of-credit, which is the mistake that makes
     a safety refusal look like an outage. */
  const CODE = 'PRODUCTION_DISARMED';

  /* Said in the owner's terms, not the implementation's. It states what was refused, why, that nothing was
     spent, and the ONE action that changes it — a refusal that does not say how to proceed gets worked
     around instead of understood. */
  const MESSAGE = 'Production is DISARMED, so this unattended paid run was refused before any provider call '
    + '(nothing was spent). The routine itself is untouched and still scheduled. Arm production with '
    + 'POST /api/production/arm {"armed":true} when you are ready for live paid work, or run it interactively '
    + '— an interactive run is your command and is never gated.';

  function isMissing(v) { return v == null || v === ''; }

  /* The surfaces on which a human is actually present. An ALLOWLIST, deliberately — not `!== 'autonomous'`.
     Writing it as a denylist is a latent bypass: every other value ('cron', 'schedule', 'AUTONOMOUS', '',
     'unknown', anything a future caller invents) would read as "a human is watching" and be allowed to spend
     unattended. sidecar/index.js happens to normalize `surface` to exactly 'interactive' | 'autonomous'
     before the gate sees it, so the host was never exploitable — but a safety primitive must be safe on its
     own terms, because the next caller may not normalize. Unknown posture is the dangerous posture.

     'interactive' is the only member today. An owner-trusted Telegram DM reaches the gate already mapped to
     'interactive' by the host (accessSurface), so it needs no entry of its own. */
  const HUMAN_SURFACES = Object.freeze(['interactive']);
  function humanPresent(surface) {
    if (isMissing(surface)) return false;
    return HUMAN_SURFACES.indexOf(String(surface)) >= 0;
  }

  /* decide({ armed, metered, surface }) -> { allow, code?, reason?, because }
       armed   : boolean  — has the owner authorized production? (host reads the arm state)
       metered : boolean  — would this run spend real money? (host passes !providerUnmetered)
       surface : string   — 'interactive' | 'autonomous' | ... (missing => autonomous)
     `because` always names the deciding rule, so a log line explains itself without re-deriving the logic. */
  function decide(input) {
    const o = input || {};
    const armed = o.armed === true;
    const metered = o.metered === true;
    const surface = o.surface;

    if (armed) return { allow: true, because: 'armed' };
    if (!metered) return { allow: true, because: 'unmetered' };
    if (humanPresent(surface)) return { allow: true, because: 'interactive' };

    return {
      allow: false, code: CODE, reason: MESSAGE,
      because: 'disarmed+metered+unattended',
      surface: isMissing(surface) ? 'autonomous' : String(surface)
    };
  }

  /* readArmState(raw, envValue) -> { armed, source, note }
     Resolves the persisted override against the env default, with the SAME precedence as budgetcaps.js
     (a persisted choice wins; else env; else the safe default). Anything unparseable is DISARMED and says so.

     `raw` is the parsed JSON contents of the arm-state file (or null if absent/unreadable). */
  function readArmState(raw, envValue) {
    const envArmed = /^(1|true|yes|on)$/i.test(String(envValue == null ? '' : envValue).trim());

    if (raw && typeof raw === 'object' && typeof raw.armed === 'boolean') {
      /* ATTRIBUTION IS A LABEL, NOT A PROOF (2026-11-11). This note used to read "production ARMED/DISARMED by
         the owner" unconditionally, ignoring the stored `by` entirely. The station cannot tell the owner
         clicking the UI from any other token-holder — /api/production/arm rides the same x-starnet-token gate
         every /api route does, and an assistant session holds that token when it curls the loopback API.

         It said "by the owner" and it was wrong, with a real cost. The live record is
         `{"armed":false,"at":"2026-11-03T21:36:39.342Z","by":"owner"}`, and the log shows an ARM at
         2026-11-03T07:03:20Z followed by that DISARM 14h33m later — exactly the arm-window an assistant
         session is recorded as having opened and closed. So the owner was being told their own business was
         disarmed by their own decision, while three routines declined every fire for eight days.

         Now: an UNATTRIBUTED record says so plainly, and a claimed `by` is quoted as a claim. Nothing here
         grants or withholds authority — `armed` is unchanged either way; only the sentence stops overclaiming. */
      /* UNIFORMLY a claim, with no privileged value. An earlier draft of this fix exempted by:'owner' from the
         caveat — which would have left the live record (`"by":"owner"`) reading exactly as before and fixed
         nothing. The station cannot prove ANY of these values, so none of them is stated as fact. */
      const who = String(raw.by == null ? '' : raw.by).trim().slice(0, 64);
      const attributed = who ? ' (recorded by: ' + who + ' — the station cannot verify who acted)' : ' (unattributed)';
      return {
        armed: raw.armed, source: 'persisted',
        at: raw.at ? String(raw.at) : '',
        by: who,
        note: (raw.armed ? 'production ARMED' : 'production DISARMED')
          + (raw.at ? ' at ' + String(raw.at) : '') + attributed
      };
    }
    if (raw != null && !(raw && typeof raw === 'object' && typeof raw.armed === 'boolean')) {
      // present but malformed — fail CLOSED and be loud about which way it fell
      return { armed: false, source: 'malformed', note: 'arm state unreadable or malformed — treating as DISARMED' };
    }
    if (envArmed) return { armed: true, source: 'env', note: 'production ARMED by STARNET_PRODUCTION_ARMED' };
    return { armed: false, source: 'default', note: 'production DISARMED (default — no owner authorization on record)' };
  }

  /* validateArmPatch(body) -> { ok, armed } | { ok:false, error }
     Strict: arming is an authorization decision, so it must be stated as a real boolean. A truthy string is
     refused rather than guessed at — "arm" is not something to infer from "maybe". */
  function validateArmPatch(body) {
    if (!body || typeof body !== 'object') return { ok: false, error: 'body must be an object' };
    if (typeof body.armed !== 'boolean') return { ok: false, error: 'armed must be true or false (a real boolean)' };
    return { ok: true, armed: body.armed };
  }

  return { decide, readArmState, validateArmPatch, humanPresent, CODE, MESSAGE };
});

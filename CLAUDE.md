# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Where we left off — 2026-11-26 evening (v0.15.4 port READY in the sandbox; switch-over NOT done)

**Start at `handoff.md` ("v0.15.4 SWITCH-OVER — read this first").** The live station is still **0.12.5** on :8787 (sidecar
12486, launcher 12468, untouched by the port). The upgrade to upstream **v0.15.4** is fully ported and tested in
`~/starnet-next` (uncommitted, detached at `124b20a6b`), with every work file in `~/starnet-next-work/` and the full write-up
in `~/starnet-next/PHONE_PORT_NOTES.md`. Nothing was committed, pushed, restarted or spent ($0 — all tests ran on the 8788
copy `~/starnet-testws/` with network blocked and a fake key).
- **Live facts (read 2026-11-26 ~19:30 PST):** save `_saveRevision` **5603**, integrity CONSISTENT; models **Fable 5.2 on 4**
  (NIGHT4CHRIST, DESIGNER, PUBLISHER, QC_EDITOR), **Opus 5.5 on 6**; production ARMED (2026-11-21, unattributed); 0 receipts;
  only routine ON = chain `ebc4f07d` (Mon 03:00 LA, Fable, cap $2.00, grant `orchestrator`, next 11-30 03:00 PST).
- **The chain-retry fix is now COMMITTED and pushed** (`006c1646e`, 11-26 12:41; branch 0/0 with origin). `sidecar/cron-driver.js.orig`
  is the stray pre-fix copy. v0.15.4 does not need this fix (its driver already settles on the lead's runId).
- **Facts that change on v0.15.4 (detail in handoff.md):** the launcher's `STARNET_DIR` picks the tree; the env needs
  `STARNET_TRUST_LOCAL_PEERS=1` AND `STARNET_DESK_CODE_TO_LOG=1` (else desk codes are never printed — the console is a kept log); open the StarNet page once after the switch (v6 -> v7 save move — until then routines refuse);
  the chain's $2 cap covers lead AND workers (BUDGET_WORKER_POOL is ignored; upstream read no per-routine cap at all — the
  port restores it); raises (arming production, Full Access, routine
  grants, spending raises) ask for a 6-digit desk code that the sidecar prints in `~/.local/state/starnet/sidecar.log`;
  a granted routine loses its grant if its agent's instructions, skills or model change (re-grant in SCHEDULES, desk code).

## Where we left off — 2026-11-26, 12:12 PST (chain-retry fix is LIVE)

**Chain-retry fix applied and live (owner's yes):** `sidecar/cron-driver.js` patched with
`~/.local/share/StarNet/chainfix-20261126/cron-driver.patch` (backup `sidecar/cron-driver.js.orig`; ~~uncommitted~~ committed + pushed as `006c1646e`, 11-26 12:41).
`node --check` OK; replay of the real 11-26 events: old code `failed`, patched `ok`. Restarted 12:12 PST with the
clean-env recipe below (`.spend-pending/` 0 before and after): launcher 12468, **sidecar 12486**, health ok, `/api/version`
buildSha `b82cc582d` (dirty), no `LD_PRELOAD`/`CLAUDE*` in its environ, no new log errors. All 11 routines byte-identical
before/after (chain `ebc4f07d` only one on, `0 3 * * 1` America/Los_Angeles, fable, $2, next 11-30 03:00).
Undo: `cp sidecar/cron-driver.js.orig sidecar/cron-driver.js` + the same restart.

## Where we left off — 2026-11-26, 09:45 PST (pause done; chain root cause found; dossier lines fixed)

**Chain `ebc4f07d` 11-26 failure, root cause (read in logs + code):** `sidecar/cron-driver.js` `startFire`'s sink takes
ANY `agent.run.error` on the stream as the fire's failure — a dispatched worker's too. Two QC_EDITOR worker timeouts
(`ERR_HTTP2_STREAM_ERROR`) turned a lead that ended `done` into `failed`+transient → 3 auto-retries. Fix = skip
error/capdenied/run.end events whose `runId` ≠ the lead's; patch at `~/.local/share/StarNet/chainfix-20261126/cron-driver.patch`
(syntax OK, replay of the real events: failed → ok). ~~NOT applied — it needs a sidecar restart (owner's yes).~~ **[LIVE since 12:12 PST — see above.]** Error state
cleared via `{patch:{enabled:true}}` (no run). **Dossier (rev 5585):** cd_14/cd_28 rewritten, cd_15/cd_20/cd_21 → KJV,
cd_4 unattended-friendly, cd_12 left (unclear). See handoff.md. Reload StarNet tabs (an old tab could push the old dossier).

## Where we left off — 2026-11-26, 09:30 PST (routines PAUSED until the store is in production, owner's yes 08:48)

**Paused (`POST /api/cron/update {id, patch:{enabled:false}}`, read back from `GET /api/cron` and `cron.jobs.json`):**
SCOUT `7b22107c`, HARVEST/Weekly Income Scan `d22650c8`, Quality Gate `41a7de48`, Concept Queue `e7fccdb8`, Print Kit
`b8c6f80c` — all `enabled:false, state:paused`. Models, caps, schedules unchanged. **The only routine still ON is the
chain `ebc4f07d`, now weekly: `0 3 * * 1` America/Los_Angeles (Mondays 03:00; next 11-30 03:00)** — was daily `0 3 * * *`
on the host zone. Route contract (read in `index.js` `handleCronUpdate` + `cron.js parseSchedule`): `patch.schedule` is a
cron STRING, the zone goes in `patch.timezone` (stored as `schedule.tz`); a schedule edit keeps the job's current tz if none
is given. Field diff of all 11: nothing else changed. SCOUT's 09:00 run (`0cbd4ad5`, Opus 5.5) had already finished
before the pause: `reason: budget`, 6 turns, $0.685 (+ $0.037 aux row), 9 tools ok, 2 Apify scrapes. HARVEST's dossier
timing lines updated (rev 5583 → 5584). Backups: `cron.jobs.json.bak-20261126-pause`,
`agent.{save,roster}.json.bak-20261126-pause`. **Undo** per routine: the same patch with `{"enabled":true}`; chain:
`{"schedule":"0 3 * * *","timezone":"America/Los_Angeles"}`.

## Where we left off — 2026-11-26, 08:40 PST (model split, owner's yes)

**Models split 08:32 PST.** Fable 5.2 (`anthropic/claude-fable-5-2`) stays on NIGHT4CHRIST, DESIGNER, QC_EDITOR,
PUBLISHER. **Opus 5.5 (`anthropic/claude-opus-5-5`)** now on SCOUT, HARVEST, STORYWRITER, DIRECTOR, PRODUCER,
COPYWRITER (`scripts/station-models.mjs set <id> claude-opus-5-5 --provider anthropic`, one per agent; each live probe
OK). Opus passed the 2-turn tool test through the real adapter at high and medium effort before the change. Save rev
5577 → **5583**, integrity CONSISTENT; save, roster and `GET /api/runtime/agent` agree; only `model` changed per agent.
**Routine pins** (via `POST /api/cron/update`, model **and** provider — a Claude id under `provider: gemini` would not
run): SCOUT `7b22107c` and Weekly Income Scan `d22650c8` gemini/gemini-flash-lite-latest → **anthropic/claude-opus-5-5**;
chain lead `ebc4f07d` gemini/gemini-3-flash-preview → **anthropic/claude-fable-5-2**. Field diff of all 11 routines:
nothing else changed (caps, schedules, enabled, nextRunAt, grants). The chain's `state: error` predates the change
(11-26 03:00 failures). The three 11-30 routines pin nothing → NIGHT4CHRIST's model (Fable).
Backups: `agent.save.json`, `agent.roster.json`, `cron.jobs.json` `.bak-20261126-opus-split`; snapshots
`model-snapshots/2026-11-26T16-32-*__before-set-<id>.json`. **Undo:** per agent
`node scripts/station-models.mjs set <id> claude-fable-5-2 --provider anthropic` (NOT `revert` — it undoes only the
last set, COPYWRITER); routines: the same patch with the old model/provider (`gemini-flash-lite-latest` ×2,
`gemini-3-flash-preview`; provider `gemini`). Owner said yes to pushing the docs commits (2026-11-26 08:40).

## Where we left off — 2026-11-26, 05:15 PST (re-checked live 05:00, read-only)

**Live 05:00 PST:** sidecar 29630 up (health ok, app 200), integrity CONSISTENT, `_saveRevision` **5577**, **all 10 agents
`anthropic/claude-fable-5-2`** in save, roster and `GET /api/runtime/agent`; `.spend-pending/` empty; git tip **`2acc52622`**
= `origin/feat/harness-backend-station-20261124` (0/0), only `sidecar/cron-orchestrator.js` modified. Six commits went
up on 11-25/26: `8557798db` `95370d285` (11-25 22:02, pushed 11-26 04:32), `eb9e67100` `5ec382504` `7fe7bd3d1` `2acc52622`.
The newest docs-fix commit (11-26 ~05:20) was local only until 08:40, when the owner said yes to the push.
**Start at `handoff.md`.** The text below is the 04:30 write-up, kept for its detail.

**New agent dossiers are INSTALLED and verified (2026-11-26 04:17 PST).** All 10 agents (NIGHT4CHRIST, SCOUT,
DESIGNER, QC_EDITOR, PUBLISHER, HARVEST, STORYWRITER, DIRECTOR, PRODUCER, COPYWRITER) got new identity/purpose/context/
manual text from the owner's 18-part bundle: shared `## Etsy team rules` / `## Studio rules` blocks, KJV-only, standing
approval from `agent/etsy-creative-brief.md`, owner-only list, Apify 3/run 8/day, done-tests and reply line. Written by
hand to BOTH files: `agent.save.json` `_saveRevision` 5574 → **5575**, stamp `1795695438440`, plus a full-roster
`POST /api/roster` (accepted, count 10). Only the four doc sections changed. Models, providers, approvalMode, skills,
routines, foundation/personality/AUTHORITY/FORK text were untouched by that install [models changed later, 04:42 — item 1 below]. Re-verified 04:24: 10/10 PASS, integrity CONSISTENT.
Prompts shrank (DESIGNER 36,160 → 9,286 chars; NIGHT4CHRIST 26,134 → 12,148); the Studio four grew (~8.1–8.5k) because
each carries the full Studio rules. Method and recipe: newest section of `STATION_FIELD_NOTES.md`.
Backups (workspaces dir, never commit): `agent.save.json.bak-20261126-041644` (1,088,103 B),
`agent.roster.json.bak-20261126-041644` (150,760 B), `webdesigner/styles.bak-20261126-041644/` (3 files).
**Reload any open StarNet tab before using it:** an old tab can push the old prompts back to the roster (the save is
protected by `_saveRevision`; the roster only by its timestamp).

**Style library** (`webdesigner/styles/`): 2 styles. `index.md` rewritten from the bundle (rows:
soft-watercolor-sunrise active; gothic-blackletter-faith "trial", lettering in-art — status line added 04:46). The existing
`soft-watercolor-sunrise.md` was kept unchanged (the bundle's shorter version was NOT installed).

**Last night's chain (03:00) failed on provider timeouts, not config.** SCOUT done, DESIGNER made the Psalm 46:1
five-ratio kit (openai gpt-5, 03:02), then QC_EDITOR (openai gpt-5) hit `provider_stream timeout` ×4 and every fallback
(haiku-5.5, gemini-3-flash-preview, gpt-5-mini) → `fetch failed (ERR_HTTP2_STREAM_ERROR)`. The lead run ended "done"
but cron counted it failed and auto-retried the whole chain at 03:20/03:28/03:32 (gemini rate_limit, then OpenRouter
timeouts; last error 03:34). Providers answer normally since. No sidecar log lines after 03:34.

**Station now:** sidecar 29630, OmniRoute 29422/29443, health ok, app 200, cron healthy, production ARMED
(2026-11-21, unattributed), 0 pending receipts. Routines ON: SCOUT daily 09:00; chain 03:00 (next 11-27);
HARVEST Tue 10:00 (next 12-01); Quality Gate Draft, Scripture Art Concept Queue, Print Kit Readiness Plan (11-30 09:00).
**Git:** 6 commits pushed to `feat/harness-backend-station-20261124`, tip `2acc52622` (verified 05:00 by `git ls-remote`);
`sidecar/cron-orchestrator.js` still uncommitted (owner decision).

**Waiting on the owner:**
1. ~~NIGHT4CHRIST has NO model~~ **FIXED 04:42 PST: all 10 agents now run `anthropic/claude-fable-5-2`** (owner asked for
   the best models, quality first). Set with `scripts/station-models.mjs set all claude-fable-5-2 --provider anthropic`
   (snapshot `model-snapshots/2026-11-26T12-42-08-449Z__before-set-all.json`, backups
   `agent.{save,roster}.json.bak-20261126-044208-models` and `.bak-1795696928470`), save rev **5576** (now **5577** after the 04:46 fixes), integrity
   CONSISTENT, script probe OK, plus a 2-turn tool test through the real adapter. reasoningEffort/approvalMode unchanged.
   Undo: `node scripts/station-models.mjs revert`. **Reload StarNet tabs.** Why Fable, measured 04:3x (total test
   spend ~$0.04): on this station's OpenAI wire (chat/completions) `gpt-6.2-astra`/`gpt-6.2-sol` cannot call tools at
   any setting and `gpt-5.4`/`gpt-5.5` only with reasoning off; `gpt-5.2` and `o3` work with tools+vision+reasoning;
   `gemini-3.1-pro-preview` answers 429 (no quota on this key); `claude-opus-5-5` and `claude-fable-5-2` pass
   tools+vision and a 2-turn tool exchange. Fable 5.2 = $10/$50 per Mtok (cache read $1).
2. **DONE 2026-11-26 08:32 PST (owner's yes):** chain lead → Fable, SCOUT and HARVEST routines → Opus 5.5; 6 agents
   moved to Opus 5.5 — see "Where we left off — 08:40" above. Was: ~~**Routines still pin cheaper models (routine changes need the owner's yes):**~~ chain 03:00 lead
   `gemini/gemini-3-flash-preview`; SCOUT 09:00 and HARVEST Tue 10:00 `gemini/gemini-flash-lite-latest`. Proposed:
   all three → `anthropic/claude-fable-5-2`. The three 11-30 routines pin nothing, so they now use Fable. Workers the
   chain dispatches (SCOUT, DESIGNER, QC_EDITOR, PUBLISHER) already use their roster model (Fable).
   Estimated spend at Fable: ~$5/day as routines stand, ~$7/day if the three routines move [Guessing: assumes ~70%
   cache hits]; a chain retry storm (like 11-26 03:20–03:32) could approach the $25/day rail. Risks: every agent is on
   one provider; the Anthropic balance is not readable by API (check the console); the station fallback chain
   (haiku-5.5, gemini-3-flash-preview, gpt-5-mini) runs on OpenRouter, which has **$6.32 left of $45** — top up.
   Gemini 3.8 Flash was not tested or used (Fable outranks it).
2b. ~~**NEW 05:00 — per-run spend caps were set for cheap models.**~~ **DONE 2026-11-26 ~05:45 PST (owner's yes):** `maxCostUsd` raised via `POST /api/cron/update {id, patch:{maxCostUsd}}`,
   read back from `GET /api/cron` and `cron.jobs.json`: chain `ebc4f07d` $0.50 → **$2.00**; SCOUT `7b22107c`, HARVEST
   `d22650c8`, Quality Gate `41a7de48`, Concept Queue `e7fccdb8`, Print Kit `b8c6f80c` $0.25 → **$1.00**. Nothing else
   changed (field-by-field diff of all 11 routines); OFF routines, models, schedules, grants and the $25/day rail
   untouched. Backup `cron.jobs.json.bak-20261126-caps`. Undo: the same patch with the old values (0.5 / 0.25).
   **Does the chain cap count its workers? No** (read in code): a routine cap reaches only the lead run
   (`callerMaxCostUsd`, lower-only); the lead's `spentUsd` books its own model turns plus media-tool costs
   (`pendingMediaCosts`), not worker runs. Workers are capped separately by the sidecar env:
   `STARNET_BUDGET_PER_WORKER=1.00` per worker and `STARNET_BUDGET_WORKER_POOL=2.00` per lead run. Station `perRun` is 0
   (ungoverned), so the routine cap is the binding per-run limit. Worst case per chain fire ≈ $2 lead + $2 workers =
   $4; cron's auto-retry (4 fires on 11-26 03:00–03:32) could approach $16 — still under the $25/day rail.
   Before the change:  `GET /api/cron` `maxCostUsd`: SCOUT, HARVEST and the
   three 11-30 routines **$0.25**, the 03:00 chain **$0.50**. Fable costs ~100× gemini-flash-lite per token. The 11-30
   routines' last runs cost $0.002–0.007 on the cheap model, so on Fable they would come to roughly $0.20–0.70 and
   [Likely] stop on their cap; the chain's Fable workers (DESIGNER's gpt-5 kit run alone was $0.12) [Guessing] may hit
   $0.50 — whether the chain cap counts worker spend was not checked. Raise the caps or keep cheaper models: owner decision.
   The ~$5–7/day estimate above ignores these caps.
3. ~~Style conflict (gothic vs wordless master)~~ and 4. ~~QC_EDITOR has no Etsy-rules block~~ — both FIXED. **Three fixes applied 04:46 PST (owner-approved), rev 5577:** QC_EDITOR context now starts with the shared Etsy-rules block (copied from SCOUT); DESIGNER manual step 2 has the "lettering: in-art" exception; `gothic-blackletter-faith.md` now has `status: trial` + `lettering: in-art (exception to wordless master)`; HARVEST routine says "KJV scripture wall art" (no NIV). Backups `agent.{save,roster}.json.bak-20261126-044623-fixes`, `cron.jobs.json.bak-20261126-044623-harvest-kjv`, `webdesigner/styles/{gothic-blackletter-faith,index}.md.bak-20261126-044623`.
5. Look at SCOUT's 11-26 09:00 run (first run on the new dossier + live Apify cap) and the 11-27 03:00 chain.
6. Decide on `sidecar/cron-orchestrator.js` (live since 11-22, uncommitted, no test).
7. Publish "Verses for Hard Days" on etsy.com; approve or reject Outbox items (137 pending, none ever approved).
8. Money: ledger lifetime **$139.67** vs the $60 capital ceiling — enforce or not.
9. Security: jail `shell.exec` (P0 `cd082d49`); review the 45 gitleaks findings (the repo is public); delete
   `~/.claude/settings.json.bak-20261125-pre-kling-removal` (it holds the Kling key).
10. 8 of 10 agents still get the "AUTHORITY — FULL POWER" block (approvalMode full); moving them to `ask` is yours.
11. Do **not** publish PUBLISHER's NIV set-of-3 draft (no NIV permission; KJV only).
12. ~~HARVEST's routine prompt says "KJV/NIV"~~ FIXED 04:46 (only that wording; model/schedule unchanged). The `etsy-rules`
    skill's `deliverable_note` note is marked FIXED (Claude Code side).

Crash recovery (done 2026-11-26 00:33): Termux:Boot test reboot passed — newest-but-one field-notes section.

**Rule 1 — Owner's top goal:** StarNet's agents run the Etsy shop on their own with minimal owner
support. Prefer fixes that keep agents working unattended over ones that need the owner to tap or
approve.

**Current reconciliation of Rule 1:** autonomous *draft production* (research → design → listing
draft) is reachable; the last-mile publish step is a human on etsy.com — there is no Etsy API and
the chain routine instructs "draft only, publish nothing". Rule 1 is unreachable as currently
designed for fully autonomous publishing, not because of a bug. See `docs/CLAUDE_ARCHIVE_20261120.md`
§2026-11-11 ("Etsy's last mile is permanently manual").

## Role & Behavioral Guidelines

You are my advisor, not my assistant. Your job is accuracy, not agreement. Follow these rules in every reply:

1. **Do not open with agreement or praise.** If my idea has a flaw, gap, or risky assumption, state it in your first sentence. If my idea is solid, say so plainly in one line and move on. Never invent objections just to disagree.
2. **Rate your confidence on key claims:** `[Certain]` for hard evidence, `[Likely]` for strong inference, `[Guessing]` when filling gaps. If most of your reply is guesswork, say so upfront.
3. **Never use filler praise:** "Great question," "You're absolutely right," "That makes sense," "Absolutely," "Definitely."
4. **When I'm wrong, use this structure:** "I disagree because [reason]. Here's what I'd do instead: [alternative]. The risk in your approach is [specific downside]."
5. **Lead with the uncomfortable truth.** If there's something I won't want to hear, put it in the first line, not paragraph three.
6. **No warm-up paragraphs.** Start with the most useful thing you can say.
7. **If I push back, hold your position** unless I give you new facts or your claim was tagged `[Guessing]`. "But I really think" is not new information.
8. **ALWAYS VERIFY BEFORE CLAIMING.** Never say *done, working, fixed, verified, ready, complete* or *production-ready* about anything you have not just observed doing the thing. Run it, read the real output, and show me that output. This outranks finishing quickly.
   - A passing test, clean code, a 200 response, or a file existing are **not** proof the feature works. Only a live run is.
   - Never state an API's fields, URLs, or response shape from memory or inference — probe it and read what comes back. A `TODO: verify` comment means that code has never run.
   - If you could not verify something, say which part and why, in the same breath as the claim. "I ran X and saw Y; I could not check Z" is always better than a confident summary.
   - When you find an unverified claim in this file, the field notes, or a doc, **correct it** rather than writing around it. Two "PRODUCTION READY" entries here once described a fabricated 1 KB placeholder as a *"Real video"* — that is the failure this rule exists to stop.

## Commands

```bash
node sidecar/index.js          # run the sidecar directly against LIVE state (Node core modules only — no install needed)
npm run dev:seed:keep          # the real dev loop — scratch workspace from dev/fixtures/seed-workspace/, SKYNET_DEV=1
npm ci                         # install deps (desktop shell / dev tooling only)
npm run test:fast              # the merge gate — 1,019 steps from test/fast.list via scripts/run-fast-tests.mjs (counted 2026-11-26)
npm run test:fast -- <substr>  # filter test:fast to steps whose path contains <substr>
node test/<name>.test.js       # run one test file standalone (plain node, no framework — requires test/_assert.js)
npm run test:http              # live sidecar HTTP/E2E suite (test/http.list)
npm test                       # test:fast + test:http
npm run security:secrets       # full-history secret scan; requires Gitleaks in PATH
npm run qa:ready               # release-readiness aggregate; candidate-bound, invalidated by any new commit
npm run sync:website           # regenerate website/app from frontend/ — gated by a test; never hand-edit website/app
npm run desktop:dev            # Tauri dev shell (needs Rust + Tauri prereqs)
npm run desktop:build          # build desktop installers locally
node scripts/station-models.mjs list     # who runs what model, live — see STATION_FIELD_NOTES.md §6
node scripts/station-models.mjs set <agentId|all> <model>   # change a model safely (auto-snapshot + sync)
node scripts/station-models.mjs revert   # undo the most recent model change
node scripts/git-push-safe.mjs           # report ahead/behind vs remote before pushing (read-only)
node scripts/agent-config-integrity.mjs  # save vs roster CONTENT agreement (read-only; exit 0 consistent, 1 divergent, 2 unreadable/ambiguous workspace)
```

There is no general linter/formatter (`lint:evidence-secrets` only scans QA evidence docs for leaked secrets, it is not a code linter). Tests are plain Node scripts, not a framework — `node test/foo.test.js` runs independently of the gate.

`engines` says `>=18`, but use **Node 22** — it matches CI and the release train. `test:fast` is the merge gate for everything; additionally run `test:http` whenever you touch routes, streaming, persistence, providers, tools, schedules, or channels.

For the file-by-file layout (`sidecar/`, `frontend/app/`, `shared/`, `test/`, `qa/`), read `CODE_MAP.md` first — ~~it is kept current~~ [2026-11-26: its per-area numbers date from 2026-07; a dated live-numbers note now sits at its top] — this file does not duplicate it. `docs/BRAIN.md` is the designated 5-minute orientation (same caveat: reconciled 2026-08-03). `sidecar/index.js` is ~~~17k~~ 24,564 lines (counted 2026-11-26) and the file most merges conflict in — reference it by symbol or by a literal string to grep for, never by line number, which drifts within days.

## Project laws

These are enforced socially and in review, not by a linter, and they outrank convenience:

- **The interface must never assert state the harness cannot prove.** Truthful telemetry is the core product law — no simulated revenue, completed work, model activity, or spend. If the harness can't prove it, the UI doesn't claim it, and neither do you in a PR or a status report.
- **Only claim behavior you verified in the live app.** A passing test is not a claim that the feature works end to end. This law has been broken here and it cost the owner real trust: `test:fast` stayed green while a fabricated placeholder video shipped as finished work and four separate defects each stopped the studio pipeline dead. The evidence for a claim is the live output you just read — paste it. See behavioural rule 8.
- **Permission escalation defaults to deny; destructive actions require explicit consent.**
- **Secrets stay in the sidecar or the native credential store** — never the renderer, never logs.

## Fixing a reported bug

Check `qa/BUGS.md` before starting. Every fix needs a durable record per `qa/bugs/README.md`: origin, affected build, the report, a before/after regression, and the **sibling adapters, entry points, displays, and lifecycle paths** that share the defect. Each sibling needs either a registered fast/http scenario or an explicitly written-down coverage gap — silently fixing only the reported path is the failure mode this protocol exists to prevent.

## Architecture — things that span multiple files and aren't obvious from one

**One process, one truth.** `node sidecar/index.js` is the entire backend: HTTP + SSE on `:8787`, every `/api/*` route, the in-process agent loop, and the static file server for `frontend/`. The desktop app is this same sidecar embedded in Tauri. There is no separate API server or build step for the frontend — `frontend/index.html` loads `app/*.js` modules directly in dependency order.

**Two copies of agent state must agree, and the newer `updatedAt` wins — always.** Agent config lives in two places: `workspaces/agent.save.json` (`doc.agents[]` — the durable source, pulled by the browser via `GET /api/save` at boot) and the live in-memory roster mirrored at `workspaces/agent.roster.json` (pushed via `POST /api/roster`, source of truth for the running sidecar). `frontend/app/cloudsave.js`'s `reconcile()` adopts whichever of {local browser copy, remote/server copy} has the **newer `doc.updatedAt`** — not whichever has "better" content. A server-side edit to `agent.save.json` that doesn't bump `doc.updatedAt` past the browser's last-known value gets silently overwritten the next time that browser tab reconciles, with no error. Any out-of-band edit to agent config (not through the live UI) must: write `doc.agents[]`, bump `doc.updatedAt = Date.now()` and `doc._saveRevision`, then mirror the same fields into `agent.roster.json` via `POST /api/roster` with the identical timestamp.

*Corrected 2026-11-24 (read in code):* `_saveRevision` outranks `updatedAt`. `reconcile()` adopts the server copy whenever the revisions differ, whatever the timestamps (`cloudsave.js`, search `_saveRevision) !== revision`); `POST /api/save` gates on revision and skips the timestamp check (`savestore.js` `compareRevision`). So an out-of-band edit that bumps `updatedAt` but not `_saveRevision` is overwritten by the next tab save. **A save/roster `updatedAt` gap of seconds to hours is normal** — `persist()` and `pushRoster()` are separate writes with separate `Date.now()` stamps, and nothing compares them. Never "sync" the two stamps; judge agreement by content with `node scripts/agent-config-integrity.mjs` (exit 0 = consistent). The procedure that does this correctly is `scripts/station-models.mjs` `applyAssignment`; `scripts/integrate-christian-studio.mjs` did it wrong (save-shaped roster entries → empty roster at next boot) and is retired fail-closed.

**Capability is granted by what's built, not configured per-agent.** `sidecar/capability/registry.js` (`CAP_REGISTRY`) maps station *object types* (`computer`, `notebook`, `cabinet`, `dish`, `workbench`, `connector`, `orchestrator`, `studio`, `jukebox`) to tool grants — e.g. `cabinet` → `fs.read`/`fs.write`/etc. An agent class's `kit` (in `shared/specialties.js`) names which of these *shared station objects* its tools depend on; the kit is never issued per-agent — only a **desk** is a genuine per-agent world object (`workspaces/agent.save.json` → `doc.station.props[]`, `{id, t:'desk', x, y, w, h, agentId}`). A station may already have unowned desks pre-placed in `doc.station.props`; claiming one for a new agent is a matter of setting its `agentId`, not fabricating new geometry — check for one before inventing coordinates.

**No headless path creates a new agent.** `team.summon` (`sidecar/tools/builtin/orchestration.js`) only *requests* a summon — it emits `crew.summon.request` over the run's event stream and blocks on a live browser tab running the real `summonAgent()` (`frontend/app/app.js`) and POSTing `/api/summon/ack`. A cron routine or any other headless caller cannot summon; it can only dispatch to an `agentId` that already exists. Creating a new agent without a live UI session means hand-authoring the `doc.agents[]` entry directly (see above) using an existing agent's record as the field-shape template.

**Two distinct "skill" mechanisms, not one.** Library skills (`sidecar/skills/library/*.md`, global, `default:false`) are referenced by bare slug in an agent's own `skills[]` array and feed its system prompt/tool use — no per-agent copy needed. Custom/runtime skills are created via `POST /api/agent-skills/manage` (`skillStore.manage`, backing `sidecar/skillstore.js`) and are per-agent records. **A cron routine's `skills[]` field only resolves against `skillStore.view(agentId, ref)`** — i.e. only custom/runtime skill records, never bare library slugs — even though the same slug works fine in the agent's own `skills[]`. Attaching a library skill's *behavior* to a routine means either giving the agent that skill in its roster record (it applies to every run regardless of the routine) or creating a custom skill that documents the same procedure.

**Provider credentials resolve from the sidecar process's environment only.** `sidecar/providers/registry.js` reads each provider's key from `process.env` (`keyEnv`, e.g. `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`) — a key "saved" through the browser UI lives in browser localStorage and is **never sent to or read by the sidecar process**. A cron/headless run needs the real key exported into the sidecar's environment before it starts (e.g. sourced by whatever launcher starts `node sidecar/index.js`); there is no API route that makes a UI-saved key usable server-side.

**Everything round-trips through `shared/` event/schema contracts** (`shared/events.js`, `shared/schema.js`) — additive-only, never rename or remove an event or field, since both the sidecar and every frontend module validate against the same frozen shapes.

**A routine's `skills[]` needs `skill.view` in its resolved toolset, or it fails outright.** `sidecar/index.js`, search `"requires saved skills"` — if a routine sets `preloadSkills` (populated from its `skills[]`) but the agent's resolved tool list doesn't include `skill.view`, the run errors with `"This routine requires saved skills, but its per-job toolset/station does not grant skill.view."` before any model call happens. This is a capability-gating gap, not a credential or quota issue — check the agent's `executionProfile`/`enabledToolsets` (not just whether the skill records themselves exist) when a routine with skills attached fails immediately.

**The desktop version is pinned in five places that must agree.** `package.json`, the root entries in `package-lock.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and the `skynet-desktop` entry in `src-tauri/Cargo.lock` (all `0.12.5` today). `npm run release:bump` moves all five together, and release preflight + CI prove their agreement before an artifact is named or tagged — so never hand-edit one of the five.

**There are two unrelated spend limits; don't conflate them.** The *shipped product* has a $25/day **soft** rail on metered runs (`sidecar/budgetcaps.js`, one-click RESUME, editable, `0` = off, off-by-default quotas everywhere else). That is a harness feature affecting all users. It is entirely separate from the **owner's** business/dev spend policy for this particular station, below.

## Read this before touching the live station

**`STATION_FIELD_NOTES.md` (repo root)** records what already cost time or money to learn — the headless-delegation boundary, live-runtime paths and API shapes, image-pipeline traps, pre-existing `test:fast` failures, and current spend. Check it before re-investigating anything about the running station; it exists specifically so work isn't redone.

**SUPERSEDED 2026-10-27 — a cron lead CAN now delegate.** This file used to say here that `team.dispatch` is granted only to an interactive browser-commanded run and that no headless path can delegate. That was true and is no longer: a routine the Commander ticks **`orchestrator`** on resolves the orchestrator object and clears a new, name-fenced consent tier, so a scheduled NIGHT4CHRIST hands subtasks to its crew unattended. Verified live, not inferred — see `STATION_FIELD_NOTES.md` §16 for the event stream, the two gates that had to open together, and why max delegation depth is 1 structurally.

What still holds: **`GET /api/toolsets` reports the interactive-lead view and will mislead you**; an UNGRANTED routine still has no `team.dispatch` (this is opt-in per routine, not a blanket change); and `routine.create`, `routine.manage`, `loop.*`, `team.configure`, `task.manage`, `team.summon` and `team.spawn` remain human-gated even on a granted routine.

## Current operating state (project-level, not code architecture — updates as the project moves)

This repo doubles as the live runtime for the owner's actual Etsy business. Know before touching agent config:

- **Ten agents exist** (live roster, 2026-11-24): NIGHT4CHRIST (`agent`, Commander), SCOUT (research), DESIGNER (`webdesigner`, product creation), PUBLISHER (listing drafts), HARVEST (zero-cost income-opportunity hunting outside Etsy), and the studio crew STORYWRITER, DIRECTOR, PRODUCER, QC_EDITOR (`qceditor`), COPYWRITER. The GPT-4o Independent Reviewer (`gpt4o_reviewer`) is **designed but not in the roster** — see its section below.
- **approvalMode — historical snapshot 2026-11-24, not current state** (live source: `agent.roster.json` / `node scripts/agent-config-integrity.mjs`): `full` on 8 — agent, webdesigner, publisher, scout, harvest, storywriter, director, qceditor; `ask` on 2 — producer, copywriter. Only `'full'` and `'ask'` exist; anything else normalizes to `ask`. **An `ask` agent in a cron run never stalls** — an ungranted consent-gated call is denied immediately (`sidecar/permissions.js`, `SILENCE`); unattended capability for `ask` agents comes from routine `unattendedGrants` and the Workshop grant, not from waiting. Full Access allows before even the hardline floor (`permissions.js` `full-power`), and answering "Full access" on any permission card permanently flips that agent to `full` (`persistAgentFullAccess`) — that is how modes drift without a doc trail. Older docs saying SCOUT/DESIGNER/PUBLISHER are `ask` (`STATION_FIELD_NOTES.md` §1, §16 table) are stale.
- **Agent dossiers (2026-11-26, revision 5575; live revision now 5577 after the 04:42 model move and 04:46 fixes):** every agent's four docs were replaced by the owner's bundle — shared Etsy/Studio rule blocks, KJV only, the creative brief is standing approval, owner-only list, Apify 3 per run / 8 per day. To change them again use the app's dossier editor in ONE tab, or the hand recipe in the newest `STATION_FIELD_NOTES.md` section (both files, revision +1, full-roster POST, then reload tabs).
- **Standing spend policy**: $60 business capital ceiling, separate $40 development allowance, $0 default new spend, max 8 Apify runs/day including failures. No purchases, publishes, credential/budget changes, or destructive git ops without explicit owner approval. The same applies to commits, paid generation (Higgsfield MCP credits are the owner's Plus wallet), and StarNet/OmniRoute restarts: each needs the owner's explicit yes for that action, and one approval does not carry over to the next.
- **The working tree is intentional; back up before editing.** Before changing an existing file, make a same-directory backup — `cp path/to/file path/to/file.bak` — unless that exact backup already exists; never overwrite a useful one. The stray `.bak` files already in the tree are deliberate, not litter. This station runs on Android/Termux with phone-only workflows and carries intentional platform-specific fixes, so prefer small reversible changes and never run `reset`, `clean`, `checkout`, `stash`, bulk reinstalls, or dependency sweeps. Inspect a file before editing it, leave unrelated working-tree changes exactly as found (never fold them into your own edit), and ask before expanding scope beyond what the owner approved. `CLAUDE_CODE_ETSY_PROJECT.md` (untracked, repo root) holds the full owner brief.
- **The `skill.view` toolset gap above is fixed** (2026-10-15): a `notebook`-type object (`gigs_servercart`) was placed in SCOUT's resolved capability room. Verified by one real cron run: the `skill.view` error is gone.
- **First real product**: "Verses for Hard Days" (`workspaces/agent/verses-for-hard-days/`) — 10 KJV scripture printable pages plus competitor pricing research and a full listing draft with per-sale profit calculation. Status: `approved-to-publish` (owner-approved, not yet published — no Etsy API exists).
- **Memorial film engine (`memorial/`)**: production integration proceeds in owner-approved stages. Finish a stage, report, and stop; never start the next stage without explicit approval. Current stage, evidence, open issues and recovery steps: `memorial/MEMORIAL_SESSION_HANDOFF.md`. Read it before touching `memorial/`.
- **2026-10-20: two new STUDIO tools shipped** (`image_stock_fetch` — CC0/public-domain source imagery with a licence record per asset; `vector_export` — SVG → 300-PPI PNG + hand-written PDF) and `image_quality_check` was hardened to accept the real argument shapes models actually send. Full detail: `STATION_FIELD_NOTES.md` §4 and §9.
- **Model routing** is switched with `scripts/station-models.mjs`, not by hand. Current assignment and the OpenRouter wallet balance drift fast — check `node scripts/station-models.mjs list` rather than trusting a number written here.

**NEW — 2026-11-19**: Added `100-repo-evaluation` skill in `.claude/skills/100-repo-evaluation/SKILL.md` (three-phase repository evaluation framework, adapted from Nate Herk's "I Tried 100+ Github Repos for Claude").
- **Security-review plugin** (`~/.claude/plugins/cache/claude-plugins-official/security-guidance/2.0.20/hooks/llm.py`): reviews commits via LLM. Requires `ANTHROPIC_API_KEY`; model names `anthropic/claude-opus-5-5` (primary) and `anthropic/claude-sonnet-5-5` (fallback) — unprefixed names fail with HTTP 400. OmniRoute (`localhost:20128`) has no anthropic provider connection configured, so reviews go direct to `api.anthropic.com`. The plugin is NOT restarted by `start-starnet.sh`; restart it manually after env changes.
- **DESIGNER's reusable art-style library** lives in StarNet at `webdesigner/styles/` — see the `etsy-rules` skill's `styles.md`. [2026-11-26: 2 styles — soft-watercolor-sunrise (active, default) and gothic-blackletter-faith (trial); `index.md` now uses the bundle's name/status/look/best-for table and new-style template.]
- **Two scoped side missions are written up but deliberately not started**: jailing `shell.exec`'s filesystem access, and locking NIGHT4CHRIST/HARVEST from Full Access to Ask. See `STATION_FIELD_NOTES.md` §9 "Side missions" before picking either up — plan mode first.

## Hard-won rules (2026-10-26) — read before touching providers, spend, or the live station

Every item here cost real time or money to learn. Full detail: `STATION_FIELD_NOTES.md` §13.

### Never assert a shape you have not seen

This is the root cause of nearly everything below. In one session the Kling request body, the Higgsfield base URL + auth header + endpoint, the job-status URL, the job-result shape, and the `/api/runs` response were all **written from assumption and all wrong** — in code that had been recorded as "production-ready". A header comment saying `TODO: verify` is a warning that the code has never run, not a formality.

**Probe the live API for free before writing the client**: POST with exactly ONE field deliberately invalid. Validation rejects the request before anything bills, and the error text usually quotes the whole allowed enum. Order matters — auth is checked first, then the model, then fields, then balance — so vary one field while holding an earlier-checked one invalid. A GET against a non-existent id is also free and answers "does this key authenticate?".

### A passing test is not evidence that anything works

`npm run test:fast` was green through: a hardcoded provider whose account had no credit, a response stream the code aborted before reading, agents asked to persist state they never persisted, and a route whose handler and registration disagreed so **no URL could ever reach it**. Tests assert code against code. Only a live run proves a feature. Never write "verified"/"production ready" off a green suite — the project law already says this; this session is what ignoring it looks like.

### Unattended means the sidecar's own environment

A provider key that is not in **`~/.config/starnet/env`** does not exist as far as cron, the agent loop and the studio pipeline are concerned. Not `.env.local`, not browser localStorage, not your shell. `start-starnet.sh` does `set -a; . "$ENVFILE"; set +a`, so that file also **overwrites** anything you exported. Verify what the running process actually holds rather than assuming: `tr '\0' '\n' < /proc/<pid>/environ | grep -oE '^[A-Z_]+='`.

### Count `.spend-pending` receipts before every restart

Killing the sidecar mid-run orphans a receipt and the ledger then **fail-closes on every later boot** — the station looks healthy and silently refuses to run any agent (`UNSETTLED_SPEND`). This has now recurred four times; the fourth was self-inflicted by a restart during an in-flight run. `ls ~/.local/share/StarNet/workspaces/.spend-pending/*.json` must be empty first. Recovery shape and backups: `STATION_FIELD_NOTES.md` §13h. An interrupted run's true cost is unrecoverable — record `usd: 0` and say so; never invent one.

### In-memory state wins over files you edit behind its back

The deliverable store, `agent.save.json`, skills and notebooks are all read at boot or owned by a live process. Appending to `deliverables.library.jsonl` while the sidecar runs changes nothing. Use the proper API, or restart (after the receipt check above).

### Editing a module does not change the running station

`require` caches. A fix can test green while the live process keeps failing identically until it is restarted. Confirm the process is newer than the file before concluding a fix did not work.

### Money

- **Fall through to another provider ONLY on exhausted credit, never on a broken request** — otherwise a bug in provider A quietly starts spending on provider B and the real error is never seen. Kling `code 1102` / HTTP 402 means empty wallet; `1201` means your request is wrong.
- **Preflight cost where the API offers it** (Higgsfield `get_cost: true` returns credits and submits nothing). Cheapest known real video: Higgsfield `seedance_2_0_mini`, 720p/5s/9:16, **5 credits**; 480p/4s is 2.
- **Higgsfield has two wallets.** The MCP tools spend the owner's Plus credits; the platform REST API (`platform.higgsfield.ai`, what StarNet uses) does **not** — its usage appears in no balance or ledger visible here. Treat REST usage as spend of unknown size against an account this station cannot read.
- **~~The direct Anthropic account has no balance.~~ ~~CORRECTED 2026-10-27 — it is funded and works.~~** [Stale as of 2026-11-26: `STATION_FIELD_NOTES.md` §21 (2026-11-04) later recorded "credit balance too low", and nothing has probed it since (a probe spends) — treat the balance as unknown.] [2026-11-26 04:42: **all 10 agents are on `anthropic/claude-fable-5-2`** (direct Anthropic). The 04:3x Fable/Opus test calls succeeded, so the account had credit then [Likely]; the balance is still not readable by API — check the console. Every agent now depends on this one wallet.] The 2026-10-27 check: probed with a real 1-token call to `claude-haiku-5-5`: HTTP 200, `stop_reason: max_tokens`, usage recorded. A full NIGHT4CHRIST run on its roster model `claude-sonnet-5-5` also completed (`reason=done`). So `anthropic` is a usable provider again — but **mind the price**: that one-word run cost **$0.098**, because the station's system prompt + memory recall dominate the input, not the reply. OpenRouter remains the cheaper lane (balance was $5.93 of $35 on 2026-10-27; check `GET https://openrouter.ai/api/v1/credits`). The studio pipeline still reads `STUDIO_PROVIDER` / `STUDIO_MODEL`.
- **OpenRouter cannot generate video at all** — 0 of 466 models output video.

## OmniRoute — routing rules (condensed from `STATION_FIELD_NOTES.md` §14/§14a)

Full detail and the live 7-entry chain: `STATION_FIELD_NOTES.md` §14. The rules that change behavior:

- **Termux shebang trap:** `#!/usr/bin/env node` cannot run (no `/usr/bin/env` on this device). Always invoke OmniRoute through node explicitly: `node "$PREFIX/lib/node_modules/omniroute/bin/omniroute.mjs" serve`. The launcher `~/start-starnet.sh` does this.
- **Instant 401 = stale client key:** `~/.omniroute/client_api_key.local` must equal `OMNIROUTE_API_KEY` in `~/.config/starnet/env` **and** match a key the server stores (`GET /api/keys`). A stale file makes the router, every provider test, `/v1/models` and every combo look dead at once. **The sidecar must be restarted to pick up a key change.**
- **Combos are edited `PUT /api/combos/<UUID>` — by id; the name 404s.** `strategy` must come from the enum (`priority` = ordered fallback; `"fallback"` is rejected).
- **Never print a key, a password, or a combo credential.** Compare by SHA-256 fingerprint.
- **`cloude-free` books $0 for real work** — OmniRoute reports the model as `cloude-free` with no resolvable price, so `agent.cost` books **$0** and `budgetcaps.js` goes blind. That breaks the truthful-telemetry law. Reach free models as **named OpenRouter slugs in StarNet's own fallback chain** instead — each hop is priced per model and emits an auditable `provider.fallback` receipt. `free-omni` remains fine for `omni` and for chat-shaped work.

## Model rotation (condensed from `STATION_FIELD_NOTES.md` §18)

`sidecar/fallbackchain.js` + `sidecar/recovery-policy.js` + `sidecar/providers/errorClass.js` already implement a classified cross-provider chain that every run path consults. What was missing was a populated, *verified* chain and primaries that weren't free models.

### The mechanism that is easy to get wrong

A saved chain turns into **cross-provider** entries only when the primary is NOT openrouter (`sidecar/index.js`, search `savedProviderFallbacks`). So **primaries live on the direct `anthropic` provider and the chain is OpenRouter slugs** — two vendors, two wallets. Put the primaries on `openrouter` and the same chain resolves same-provider, so one empty OpenRouter wallet kills all 8 entries at once. Cron never sets `o.fallbackModels`, so the persisted chain applies to **every unattended run** with no per-routine wiring.

### What rotates and what must not

`billing` / `auth` / `rate_limit` / `overloaded` / `server_error` / `model_not_found` / `quota_exhausted` → **rotate**. `format_error` / `local_error` / `content_policy_blocked` → **fail, no switch**; `output_cap` retries the same model with a lower budget. Proven live: a real 400 produced `fallbacks=0`, `usd=0`, one attempt. **A bug in provider A can never quietly spend on provider B.**

Gotcha: `billing`/`auth`/`rate_limit` carry `shouldFallback: false` but `shouldRotateCredential: true`, and `recovery-policy.js` fires on **either**. Reading only `shouldFallback` makes it look like out-of-credit doesn't rotate. It does.

**~~Known gap:~~ FIXED 2026-11-01.** A connection-level failure classifies as `timeout` (`shouldFallback: false`), so it retried the same provider and **never reached the chain** — a run died with seven working entries sitting idle. `sidecar/recovery-policy.js` now has `EXHAUSTED_FALLBACK` (`{ timeout: 1 }`): once the local ladder's rungs AND its patience budget are spent, a transport failure crosses to the next provider instead of ending the run. Both former `fail` returns were rewired; the recoveries budget still bounds it.

**The allowlist is the whole point — do not widen it to `cls.retryable`.** The only other retryable class reaching that code is `unknown`, and crossing on `unknown` is exactly the money rule's "a bug in provider A quietly starts spending on provider B". Non-retryable classes (`format_error`, `content_policy_blocked`, `auth`, `billing`…) still fail in place on the first attempt, and `rate_limit` still crosses earlier via `shouldRotateCredential`. Regression: `test/recovery-exhausted-fallback.test.js` (33 assertions, in `test/fast.list`).

### Verifying a model before you trust it

`reason=done` is NOT proof a model works — that is the documented failure where a model writes tool syntax as prose and the harness runs nothing. A candidate is only acceptable if a real `POST /api/run` against a real agent emits **both `agent.tool_call` and `agent.tool_result`**. The run stream is NDJSON of `{name, payload}` — not `{type, ...}`.

**⚠️ Routing drift — check live state, not this file.** The live roster (2026-11-20) has all agents on `codex`/`openai`/`gemini` providers — NOT the `anthropic` primaries this section describes — ~~and `GET /api/fallback/chain` returned `{"chain":[],"saved":true}` (an empty chain was persisted and beats the env default).~~ [Stale as of 2026-11-26: the live chain is 3 OpenRouter slugs — `anthropic/claude-haiku-5.5` » `google/gemini-3-flash-preview` » `openai/gpt-5-mini`, `saved:true`; roster then: openai gpt-5 ×8, gemini ×2 — **superseded 2026-11-26 04:42: all 10 agents on `anthropic/claude-fable-5-2`**, so the primaries ARE `anthropic` again, as this section designs; routine pins (chain lead gemini-3-flash-preview, SCOUT/HARVEST gemini-flash-lite-latest) still override for those runs. Because the primaries are not openrouter, the chain acts as a cross-provider fallback: SCOUT's scheduled runs moved to haiku whenever Gemini refused — see "2026-11-25 evening".] **Before any session that touches spend or providers, check `node scripts/station-models.mjs list` and `GET /api/fallback/chain`.** This is the fourth recorded instance of model routing drifting out from under the written design.

## GPT-4o Independent Reviewer — reviewer restrictions (2026-11-18)

A separate, advisory-only reviewer agent (`gpt4o_reviewer`, provider `openai`, model `gpt-4o`) participates in Group Chat. It is **not** a production agent and must never be treated as one.

### Enforced restrictions (server-side, not advisory)

The reviewer is restricted by four defense-in-depth ceilings in `sidecar/index.js` `runOnceCore()` (lines 18186, 18196, 18379, 18519). Each independently narrows `resolved.tools` to exactly `['group.read']`:

| Ceiling | Line | Purpose |
|---|---|---|
| `groupTools` filter before registration | 18186 | `group.publish` and `group.handoff` stripped from `o.groupTools` before `registry.register()` — never registered |
| `resolved.tools` hard ceiling after enabled-toolsets | 18196 | Tools narrowed to `['group.read']`; deferred (tool.search-offered) names narrowed to `['group.read']` |
| Final hard ceiling after all projection | 18379 | Re-applies after connectors, real-screen injection, internal brief tools — nothing can add a prohibited tool back |
| Absolute final ceiling before `makeCapCtx` | 18519 | Re-applies immediately before capCtx is built; deferred recomputation cannot slip a prohibited tool through |

The `capCtx.canUse()` gate consults `resolved.tools` directly (`sidecar/capability/capGate.js`), so no prohibited tool can be dispatched — direct, deferred, forged/manual, recovery replay, or nested calls.

### Allowed operation

- `group.read` — read an explicitly shared Group Chat artifact by artifact ID (text or binary facts). Read-only, id-addressed, no path access.

### Prohibited operations (all blocked)

`group.publish`, `group.handoff`, `fs.*`, `shell.*`, `terminal.*`, `verify.*`, `code.run`, `browser.*`, `web_*`, `connectors.*`, `team.*`, `session.*`, `skill.*`, `notebook.*`, `image_*`, `video.*`, `voice.*`, `routine.*`, `outbox_*`, `deliverable_note`, `channel.*`

### Group Chat integration

- Appears as a separate participant via `makeGroupSessions` (`sidecar/group-sessions.js`). Receives bounded context (last 80 messages + origin + shared artifacts) through `context()` in `group-sessions.js`. Reads only explicitly shared artifacts via `group.read` by artifact ID — never a path, never cross-workspace.

### Authentication

The `/api/run` route requires `X-StarNet-Token` header. The token is randomly generated per sidecar boot (`crypto.randomBytes(32).toString('hex')`, `sidecar/index.js:397`) and injected into the frontend as `window.__STARNET_API_TOKEN__`. The browser's `Harness.apiToken()` reads it (`sidecar/frontend/app/harness.js:167`) and attaches it to every `/api/` fetch via the hardened `window.fetch` wrapper (`sidecar/frontend/app/harness.js:1336`).

### Live validation

Performing one live validation call is authorized (owner instruction). The call uses `agentId: gpt4o_reviewer`, `provider: openai`, `model: gpt-4o`, short prompt, strict output-token limit (100 tokens). No production pipelines, routines, or paid image/video generation are run.

### Roster persistence

**~~The reviewer entry is in `workspaces/agent.roster.json`~~ CORRECTED 2026-11-24 — it is NOT.** Verified live: `gpt4o_reviewer` appears in neither `agent.roster.json` nor `agent.save.json`, and not even in `agent.roster.json.bak-gpt4o-reviewer-20261118` (the backup named after it). The four `runOnceCore()` ceilings exist in code, but there is no live agent for them to apply to. The intended record was `provider: openai`, `model: gpt-4o`, `approvalMode: ask`, `executionProfile: station-gear`, `skills: []` — creating it is a hand-authored `doc.agents[]` entry (see "No headless path creates a new agent"), not done.

### Undo

```bash
node scripts/station-models.mjs restore before-rotation
```

## Daily Operations Cheat Sheet (condensed)

### 🔁 Startup / Health

```bash
bash ~/start-starnet.sh      # Starts OmniRoute first, then StarNet, with wake lock and auto-restart. "already up" means it's fine.
bash ~/starnet-up.sh         # Quick check: says UP or DOWN, and starts StarNet if down.
```

**Open in Chrome:** `http://127.0.0.1:8787`

⚠️ After a phone reboot nothing restarts StarNet until the Termux:Boot app is installed — from **F-Droid**, because Termux here is the F-Droid build (`TERMUX_APP__APK_RELEASE=F_DROID`). ~~`~/.termux/boot/10-starnet.sh` is written but inert until then.~~ [2026-11-26: replaced by `~/.termux/boot/start-starnet` — wake lock → 30 s → wait ≤90 s for network → skip if a launcher already runs → `bash ~/starnet-up.sh` (which refuses to start with receipts pending); log `~/.local/state/starnet/boot.log`. The old script is backed up as `~/.termux/10-starnet.sh.bak-20261126`.]

⚠️ **Never `kill` the node process to restart it** — that is a clean shutdown, so `start-starnet.sh` exits with it instead of reviving it. Kill the launcher too and relaunch detached:

```bash
cd ~ && setsid nohup bash ~/start-starnet.sh >> ~/.local/state/starnet/launcher.out 2>&1 < /dev/null &
```

From the owner's own Termux tab that line is clean. **When Claude Code runs a restart (only with the owner's yes) it
must use a clean environment** — on 2026-11-25 (22:03 PST) a relaunch from Claude's shell passed its `LD_PRELOAD` shim and
`CLAUDE_*` session variables into the sidecar. Count `.spend-pending` first, stop the launcher and then its sidecar by
exact PID, wait for the port to close, then:

```bash
mapfile -t KEEP < <(env | grep -E '^(ANDROID_[A-Za-z_]*|TERMUX[A-Za-z_]*|BOOTCLASSPATH|DEX2OATBOOTCLASSPATH|SYSTEMSERVERCLASSPATH|EXTERNAL_STORAGE|LANG)='); env -i "${KEEP[@]}" HOME=$HOME PATH=$PREFIX/bin PREFIX=$PREFIX TMPDIR=$PREFIX/tmp SHELL=$PREFIX/bin/bash $PREFIX/bin/bash -l -c 'cd ~ && setsid nohup bash ~/start-starnet.sh >> ~/.local/state/starnet/launcher.out 2>&1 < /dev/null &'
```

Keep the `ANDROID_*`/`TERMUX*`/`BOOTCLASSPATH` variables: the launcher's `termux-wake-lock` fails silently without
them. Afterwards `/proc/<sidecar>/environ` must show no `LD_PRELOAD` and no `CLAUDE*` variables.

### 🩺 "StarNet isn't working" — check in this order

```bash
curl -s -m 4 http://127.0.0.1:8787/api/health            # expect: ok
ls ~/.local/share/StarNet/workspaces/.spend-pending/     # MUST be empty! If anything listed, every agent silently refuses
pgrep -af 'node sidecar/index\.js'                         # Shows whether StarNet is running
tail -50 ~/.local/state/starnet/sidecar.log               # Recent log
```

Agent shows no model / blank? Just **reload the browser tab** — it's a display bug. Don't paste keys into the UI.

### 🧵 Driving an agent from curl (the shape that actually works)

```bash
set -a; . ~/.config/starnet/env; set +a
curl -sN -X POST http://127.0.0.1:8787/api/run \
  -H "x-starnet-token: $STARNET_API_TOKEN" -H 'Content-Type: application/json' \
  -d '{"agentId":"scout","surface":"autonomous","provider":"anthropic","model":"claude-haiku-5-5",
       "messages":[{"role":"user","content":"YOUR INSTRUCTION"}]}'
```

⚠️ The field is **`messages`** (an array). `message` is silently ignored — the run carries no user turn.
⚠️ Always pass `provider` + `model` — a bare `/api/run` does not use the agent's roster model.
⚠️ `"surface":"autonomous"` above is **ignored** — `/api/run` hard-codes `surface: 'interactive'` with a live
consent prompt (`sidecar/index.js`, search `surface: 'interactive', prompt: promptConsent`). An `ask` agent driven
this way waits on a permission card (auto-denies after `CONSENT_TIMEOUT_MS`, default 120 s). Only a cron fire is
truly unattended.
⚠️ The stream is NDJSON of `{name, payload}`. A run only counts as real if **both** `agent.tool_call`
and `agent.tool_result` appear — `reason: done` alone proves nothing.

### ⏰ Routines (scheduled jobs)

Load token first: `set -a; . ~/.config/starnet/env; set +a`

List routines:
```bash
curl -s -H "x-starnet-token: $STARNET_API_TOKEN" http://127.0.0.1:8787/api/cron
```

Run one now (spends money):
```bash
curl -sN -X POST http://127.0.0.1:8787/api/cron/run -H "x-starnet-token: $STARNET_API_TOKEN" -H "Content-Type: application/json" -d '{"id":"PASTE_ID"}'
```

⚠️ **`POST /api/cron/run` is Run Now, never a read.** It starts a paid run and streams it; the run is **aborted
the moment the client disconnects** (`res.on('close', () => { ac.abort(); … })`, deliberate). So never pass
`curl -m N`, never pipe it to `head`, and never call it during an audit. On 2026-11-24 an audit labelled this call
"SCOUT ROUTINE DETAIL", ran it with `-m 5`, killed the run at 4.9 s ($0.0116), recorded a `cancelled` failure
against the routine, then misdiagnosed that self-inflicted failure as a missing skill. Routine detail is
`GET /api/cron`; run history is `runs.jsonl` and `autonomy.ledger.jsonl` (a `"binding":"run-now"` row marks a manual fire).
A routine auto-pauses after `maxConsecutiveFailures` (5) terminal failures in a row — a cancelled Run Now counts.

⚠️ Header is `x-starnet-token`, **never** `Authorization: Bearer`. Enable a routine with
`POST /api/cron/update {id:"…", patch:{enabled:true}}` — a flat body `{"id":"…","enabled":true}`
may reply 200 but change nothing.

### 🧪 Tests

```bash
npm run test:fast    # The merge gate — 1,019 steps (can stop at step 304: qa/bugs/2ba9cd3e is INTERMITTENT on this
                     # device; step by step 2026-11-25: 1,007 green / 12 red, all pre-existing — handoff §1b/§1c)
npm run test:http    # Live sidecar HTTP/E2E suite (run whenever you touch routes, streaming,
                     # persistence, providers, tools, schedules, or channels)
npm test             # test:fast + test:http
```

**Test harness rules (learned 2026-11-25, `qa/bugs/2c50b150`, `qa/bugs/7e750ab7` — fixes ~~UNCOMMITTED~~ committed + pushed in `27d9397fe` on 2026-11-25 19:10 PST, see
`memorial/MEMORIAL_SESSION_HANDOFF.md` §1a):**
- **Run tests with credentials stripped** — tests copy `process.env` into the sidecars they spawn, and a test
  sidecar that outlives its test keeps whatever keys you had:
  `strip=$(env | grep -oE '^[A-Za-z_]*(KEY|TOKEN|SECRET|PASSWORD)[A-Za-z_]*' | sed 's/^/-u /'); env $strip node test/x.test.js`
- **`A.report()` (`test/_assert.js`) calls `process.exit()`.** Never call it inside a `try` whose `finally`
  kills a sidecar or removes a folder — the finally never runs, even on a PASS. Call it after the try/finally.
- **A booted sidecar writes `<workspace>.recovery-owner.json(.generations)` BESIDE its workspace** and never
  deletes them. Wrap temp dirs in `track(fs.mkdtempSync(...))` from `test/helpers/tmp-tracker.js` (removes the
  dir + both siblings at exit, even after a failure); `SidecarFixture.dispose()` does the same.
- **Test sidecars on a fresh workspace default to production DISARMED**, and the `custom` provider tests use for
  mocks is metered — so a test driving a mock must arm ITS sandbox (`process.env.STARNET_PRODUCTION_ARMED = '1'`
  at the top, or `SidecarFixture.create({armed:true})`). Never change the gate default or mark `custom` unmetered.
- **Stop a spawned sidecar and WAIT for `exit`** before the test ends — a shutting-down sidecar rewrites its
  workspace after cleanup.
- **After any test run:** `pgrep -af 'sidecar/index\.js'` must show only the launcher's child (parent = the
  `start-starnet.sh` PID). Anything else is a leak: verify `SKYNET_WORKSPACES` is under `$PREFIX/tmp`, port ≠ 8787,
  parent 1 — then ask, then kill by PID.
- **e2e baseline on this device (2026-11-25, all 113 `http.list` e2e steps, keyless, with the uncommitted fixes):**
  108 green / 5 red — `output-recovery`, `image-task`, `e2e.attachments`, `nightshift-presence`,
  `browser.gauntlet` (hangs to timeout; environmental). Historical snapshot; re-measure.
- `scripts/run-test-list.mjs` STOPS at the first failing step — to measure a whole list, run each step through it
  with its own filter.

### 🔧 Upgrading Claude Code itself on this phone (host tool, not StarNet)

New launches run **2.1.331**, glibc-patched copy at `~/.local/share/claude-termux/versions/2.1.331`, launched by
`$PREFIX/bin/claude` (shim preloaded). Upgraded and verified live 2026-11-24 — full steps in
`STATION_FIELD_NOTES.md` §12 (the launchers section), "Upgrade procedure".

- **"Update installed · Restart to update" means `claude` is now BROKEN for new tabs.** The updater
  re-creates `~/.local/bin/claude` (first on PATH) pointing at a raw binary whose interpreter
  `/lib/ld-linux-aarch64.so.1` doesn't exist on Android → "No such file or directory". Quick fix:
  `rm ~/.local/bin/claude` (then `claude` runs the existing patched version again).
  Since 2026-11-24 `~/.claude/settings.json` has `env.DISABLE_AUTOUPDATER="1"`, so this should no
  longer happen on its own (not yet observed through a real release). `autoUpdates:false` is ignored
  by design on this install — the code skips it when `installMethod` is `native` with
  `autoUpdatesProtectedForNative: true`, which `~/.claude.json` has.
- **To actually upgrade:** download `downloads.claude.ai/claude-code-releases/<ver>/linux-arm64/claude` (the updater is off, so it won't fetch it), verify it against the signed manifest → copy it OUT of
  `versions/` → `patchelf --set-interpreter` to Termux glibc → test with a COPY of the wrapper (one
  live `claude -p` tool call that writes a probe file) → back up wrapper, edit only its `exec` line → `rm ~/.local/bin/claude` if it exists.
- **Never re-run `~/claude-code-termux/install-claude-code-termux.sh` as-is** — it rewrites the
  wrapper with an unconditional `LD_PRELOAD` and puts the shim inside the updater-pruned `versions/`.
- **Fable 5.2 is gated by account usage credits, not the client version** (`/model` → "Visit
  https://clau.de/usage-credits"). Upgrading never unlocks it; adding credits is an owner purchase.

### 📁 Where Things Live

| Location | Contains |
|----------|----------|
| Code | `~/starnet` |
| Real data, agents, outbox | `~/.local/share/StarNet/workspaces/` |
| Provider keys | `~/.config/starnet/env` |
| Log | `~/.local/state/starnet/sidecar.log` |
| Tech diary | `~/starnet/STATION_FIELD_NOTES.md` |

### ⚠️ Files You Should NOT Trust

These claim "PRODUCTION READY" or "COMPLETE" but are false artifacts (owner reported bugs later):
- `BUILD_COMPLETE`, `COMPLETION_REPORT`, `IMPLEMENTATION_COMPLETE`
- `KLING_`, `KNIGHT_DASHBOARD`, `ORCHESTRATION_`, `OUTBOX_READY`
- `VIDEO_DELIVERY_COMPLETE`, `VIDEO_PLAYBACK_*`

The Knight video they describe was a **fake placeholder** (1,056 bytes). Trust `CLAUDE.md` and `STATION_FIELD_NOTES.md` over everything else. ~~Also: the old note about the Anthropic console account being empty is **corrected** — it is now funded and responding.~~ [Stale as of 2026-11-26: see the Money section — balance unknown since 2026-11-04.]

## Production arm/disarm state (current)

Check `~/.local/share/StarNet/workspaces/.production-arm.json` before trusting any armed/disarmed claim. **Production is ARMED** as of `2026-11-21T08:32:28.502Z` (`{"armed":true,"at":"2026-11-21T08:32:28.502Z","by":"unattributed"}`), verified live via `GET /api/production/status`; re-checked 2026-11-25 22:45 PST and again 2026-11-26 05:00 PST — still armed, file unchanged. Arm/disarm with `POST /api/production/arm {"armed":true|false}`. The gate code is intact; only the switch was flipped, so the control remains available. A refusal is deliberately invisible (no `runs.jsonl` row, `consecutiveFailures` stays 0, no cron notification) — if work stops, check this file first.

Historical: on `2026-11-20T07:03:24.171Z` production was DISARMED (`by":"unattributed"`), then re-armed on `2026-11-21T08:32:28.502Z`. The 2026-11-20 DISARMED record is a historical snapshot, not current state — the live file wins.

## Verify live state before each session (snapshots go stale)

This file's dated claims rot faster than the code. Before touching spend, providers, or the production gate, check live state rather than trusting anything written here:

- `cat ~/.local/share/StarNet/workspaces/.production-arm.json` — armed/disarmed switch. This file's armed/disarmed claim is a snapshot; the live file wins.
- `node scripts/station-models.mjs list` — who runs what model, live. The roster has drifted from the `anthropic`-primary design described in §Model rotation at least four times; the live roster and `GET /api/fallback/chain` are authoritative.
- `GET /api/fallback/chain` — empty chain (`saved:true`) beats the env default; an empty chain means no cross-provider rotation on unattended runs.

### Live-state documentation rule

Never hardcode a dated armed/disarmed, provider, model, or chain value as "current." If you record one, mark it "historical snapshot, not current state" and link to the live source. Use `/starnet-live-health` to verify before writing any such claim.

All dated session history (2026-10-26 through 2026-11-17) has been moved to `docs/CLAUDE_ARCHIVE_20261120.md` with zero history deleted.

### Live platform fix not yet reflected above
- `sidecar/workspace-owner.js` — Android/Termux stale-lock recovery: when `process.kill(pid, 0)` returns `EPERM`/`EACCES` (permission-blocked, not a liveness answer), `defaultPidAlive` falls back to `fs.accessSync('/proc/<pid>', F_OK)`; ENOENT there proves the holder is dead and the stale lock is reclaimable. This fixed a `WORKSPACE_BUSY` exit-73 that held a dead PID 14644 claim forever. Committed in `ad1c83fea` (corrected 2026-11-26: this line used to say "uncommitted"; `git log -- sidecar/workspace-owner.js` and the HEAD source show the EPERM/EACCES → `/proc` fallback).

### Session d2ab07f3 (2026-11-25 evening) — COMMITTED + PUSHED 2026-11-25 19:10 PST (`27d9397fe`)
Full inventory, evidence and backups: `memorial/MEMORIAL_SESSION_HANDOFF.md` §1a. In short: ~83 test files +
`test/helpers/{tmp-tracker,sidecar-fixture}.js` + `qa/bugs/{2c50b150,7e750ab7}` + `qa/BUGS.md` — committed in
`27d9397fe` after a full step-by-step `test:fast` (1,007 green / 12 red, all pre-existing) and pushed to
`feat/harness-backend-station-20261124` (tip verified by `git ls-remote`).
- **`KLING_API_KEY` is no longer in `~/.claude/settings.json` `env`** (removed 2026-11-25, owner's request) — Claude
  Code sessions no longer inherit it, so tests started from Claude no longer leak it. StarNet still gets it from
  `~/.config/starnet/env`. Backup `~/.claude/settings.json.bak-20261125-pre-kling-removal` still holds the key (mode 600).
- **The Outbox ▶ Play button works in a real browser** (headless Chromium, real click, 4-minute film played and
  seeked; handoff §3e). Nobody has watched/listened by eye or ear yet.
- **Kling has never produced or billed anything** with this key (its own task/cost API: 0 tasks, no resource
  packs; every StarNet attempt refused "Account balance not enough").

### Session 085a8b6e (2026-11-25) — COMMITTED + PUSHED 2026-11-25 19:10 PST (`27d9397fe`, `b7c04e867`, `3210676cb`)
Start at `memorial/MEMORIAL_SESSION_HANDOFF.md` §1c, then §1b. Memorial: opt-in `"theme": "dawn"` (4 owner-chosen
watercolour backgrounds — StarNet's own AI art), per-card `"background"`, light chapter/verse cards, portrait card
with the photo on its own rising layer; tests 120/120. Demo film is in Central Outbox **and** WORK → DELIVERABLES
(the owner looks there — put films in both). Also: runner credential scrub (`scripts/run-test-list.mjs` `stepEnv`),
bug `2ba9cd3e`. Higgsfield `upscale_image` repaints — do not use it (`STATION_FIELD_NOTES.md` §3).
**Still uncommitted (other sessions' work, deliberately left out):** [2026-11-25 22:00 PST: the Apify cap files, its test, its `fast.list` line, the `f050e860` record and `qa/BUGS.md` rows, and the field-notes SCOUT section are now committed in `8557798db` + `95370d285` (pushed 2026-11-26 04:32); only `sidecar/cron-orchestrator.js` and the untracked files remain.] the Apify per-run cap (`sidecar/hostquota.js`,
`mcp/translate.js`, `tools/builtin/web.js`, `test/hostquota-run-cap.test.js`, its `test/fast.list` line, `qa/bugs/f050e860`
+ its `qa/BUGS.md` rows, the SCOUT section of the field notes), `sidecar/cron-orchestrator.js`, `sidecar/index.js`, and
untracked files (`chat*`, assessment notes and others). **Fixed 2026-11-25 19:16 PST (`3166726ba`, owner's request):** `test/fast.list` had named
`test/domain-task-workspace-file.test.js` and `test/etsy-preflight.test.js` since `003d25c0d` (2026-11-18) but neither was
committed, so `test-list-runner` failed on a clean checkout. Both are now committed, with `scripts/etsy-preflight.mjs` and
`scripts/etsy-dryrun.mjs`, which the Etsy test imports; verified on a clean checkout (55 + 225 + 12 assertions OK).

### 2026-11-25 evening — what changed (all checked live; pushed later, 2026-11-26 04:32 PST)
[Date corrected 2026-11-26: this section and the dates above marked 11-25 were first written as "2026-11-26" — the UTC date; on the phone (PST) it was still 11-25.]
- **Apify per-run cap LIVE.** `sidecar/hostquota.js` refuses a 4th billable Apify call in one run (counted per
  host-minted runId; a refusal does not spend the team's daily 8). Committed `8557798db`, field notes `95370d285`;
  ~~NOT pushed~~ pushed 2026-11-26 04:32 PST. Loaded by the 22:18 PST restart (sidecar start time later than the file). Tests: `hostquota-run-cap`
  42 OK, `headless-dispatch` 102 OK; full `test:fast` step by step 1,007 green / 12 red — the same 12 known reds.
- **Clean restart.** A 22:03 PST relaunch from Claude Code's shell leaked the shim + `CLAUDE_*` vars into StarNet; the
  22:18 relaunch used the `env -i` recipe above (cheat sheet) and was verified clean (launcher 17889, sidecar 17906).
- **NIGHT4CHRIST's `etsy-pipeline-handoff-via-airtable` skill, step 5 fixed** through StarNet's own route
  (`POST /api/agent-skills/manage`, action `patch`): DESIGNER/PUBLISHER are `full`; an ask agent's consent-gated call
  is denied at once in a headless run, never left stalling. Read back from `GET /api/agent-skills?agent=agent&body=1`
  (not withheld, guard `allow`). Backups: `~/.local/share/StarNet/skill-backups/`. A hand edit of SKILL.md would not
  stick — the store re-renders that file from its own record.
- **SCOUT budget stops (11-18/23/25) explained:** each scheduled run got `rate_limit`/`overloaded` from Gemini on its
  first call and the fallback chain moved it to `claude-haiku-5.5` on OpenRouter (reasoning effort high), at
  $0.011–0.013 per turn vs $0.006 on Gemini; the old prompt then spent 15–25 turns re-reading Apify datasets. The
  prompt was shortened 2026-11-25 (Run Now on Gemini: 12 turns, $0.072); the 11-26 09:00 run is the first real test.
  Look at `recoveryAttempts` and `provider/model` in `runs.jsonl` before blaming a prompt.
- **`sidecar/cron-orchestrator.js` is still uncommitted** (studio stage prompt "do this stage yourself"; live since
  11-22). `lint-determinism` flags `Date.now` only in COMMITTED code (`cron-orchestrator.js:305/:536`,
  `cron-orchestration-tasks.js:67`, `deliverable-manifest.js:757`), not in this edit.
- ~~**Termux:Boot prepared, not active**~~ [2026-11-26: installed and tested — a test reboot at 00:33 PST brought StarNet up on its own; see the top section.]
- **Money:** StarNet ledger lifetime $139.67 (October $115.66, November $24.01; NIGHT4CHRIST $110.83 = 79%, 44 budget
  stops). Today's day rail $25; per-routine caps $0.10–$0.50.
- **Blueprint sets (PNG):** v1 — `Download/starnet-blueprints-20261126/` (8 sheets), Library ids
  `blueprint-20261126-01`…`-08`, Outbox project `blueprints-20261126`. r2 — `Download/starnet-blueprints-20261126-r2/`
  (11 sheets: the 8 redrawn + 9 money map, 10 Etsy shop board, 11 fix-it sheet), Library ids
  `blueprint-20261126-r2-09`…`-11` (sheets 1–8 r2 are in Downloads only). Files in
  `workspaces/agent/workshop/blueprints-20261126{,-r2}/`. The drawing code lived in a session scratchpad and may be gone.
- **Field notes:** the stale §1 delegation lines, the 2026-10-25 "production ready" sections and the §13c restart
  recipe are struck through with dated notes (`95370d285`); headless delegation works one level deep (§16).

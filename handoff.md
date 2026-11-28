# StarNet handoff — read this first (updated 2026-11-28, end of session c2fcd585; the owner will /clear)

Phone station (Galaxy Z Fold 8, Termux, F-Droid build). Live data: `~/.local/share/StarNet/workspaces/` (W).
Repo `~/starnet` is PUBLIC on GitHub — push only with the owner's yes for that push. Never print keys or tokens.

## CURRENT STATE (2026-11-28 ~08:40 PST — re-check live before acting; read-only checks listed under "Verify")
- **Station:** v0.15.4 from `~/starnet-next`, branch `phone-port-v0.15.4`, code `93abce2bd`, tip `ae58a3312` (docs only; = GitHub). Launcher 8798, sidecar
  **8820** (since 2026-11-27 ~00:25). Production ARMED (persisted, 2026-11-21, unattributed). Save `_saveRevision` **5764**,
  integrity CONSISTENT. `.spend-pending/` 0. Env has `STARNET_TRUST_LOCAL_PEERS=1`, `STARNET_DESK_CODE_TO_LOG=1`,
  `STARNET_BUDGET_PER_WORKER=1.00`, `STARNET_BUDGET_WORKER_POOL=2.00` (the pool is ignored on v0.15.4: one cap covers lead + workers).
- **Models (roster, read 2026-11-28):** Fable 5.2 (`anthropic/claude-fable-5-2`) on NIGHT4CHRIST, DESIGNER, PUBLISHER, QC_EDITOR;
  Opus 5.5 (`anthropic/claude-opus-5-5`) on SCOUT, HARVEST, STORYWRITER, DIRECTOR, PRODUCER, COPYWRITER. approvalMode full on 8,
  ask on PRODUCER and COPYWRITER. Prices in `~/starnet-next/sidecar/providers/prices.js`: Fable 5.2 $8/$40 (fixed 11-26), Opus 5.5
  $4/$20 — both match the published prices. The "Opus price mismatch" is only the OLD 0.12.5 tree's table ($5/$25, Opus 5's price):
  it matters only after a rollback.
- **Routines:** only the chain `ebc4f07d` is ON — Mondays 03:00 America/Los_Angeles, next **Mon 11-30 03:00 PST**, lead Fable,
  cap **$5** for lead + all workers, $1 per worker (env), grant `orchestrator`, fingerprint `…cb99ede2` (still matches: NIGHT4CHRIST
  was not edited). All 10 other routines paused (`enabled:false`). Editing NIGHT4CHRIST's instructions/skills/model or the chain's
  prompt/model/skills drops the grant -> re-grant in SCHEDULES (desk code in `~/.local/state/starnet/sidecar.log`).
- **Commits (all pushed, verified by `git ls-remote`):** `~/starnet-next` `phone-port-v0.15.4`: `3c9c1fac3` (port), `0c10e9dd6` (QC JPEG +
  Fable 5.2 price), `93abce2bd` (retired page key). `~/starnet` local branch `feat/harness-backend` is pushed to
  **`origin/feat/harness-backend-station-20261124`** (its upstream setting points at `-20261122`, so `git status` says "ahead" — ignore;
  push with `git push origin feat/harness-backend:feat/harness-backend-station-20261124`): `0464184f4`, `8f5f9c3d4`, `55117de8f`,
  `168715ed3`, plus **`d227b5908`** (2026-11-28 notes; this hash line was added in the next commit). `~/starnet-next` also has docs-only
  **`ae58a3312`** (port-notes line) on top of `93abce2bd`, pushed — the running code is still `93abce2bd`.
- **Backups:** rollback set `W.bak-20261126-2236-pre0154` + env/launcher/boot `.bak-20261126-2236-pre0154` (keep to at least 12-03).
  Today: `agent.save.json`, `agent.roster.json`, `authority-seal.json`, `cron.jobs.json` `.bak-20261128-flagship`;
  `.deliverables/manifest.jsonl` + `deliverables.library.jsonl` `.bak-20261128-{redo,v5,text-v2,seasons,set2,set3}`;
  `webdesigner/styles/index.md.bak-20261128-garden`; notes `*.bak-20261128-handoff-final` (never commit any `.bak*`).
- **LiteDesignz = flagship line "Garden of Memories"** — everything is in **`docs/LITEDESIGNZ.md`**: shop text v2 (title "Garden Floral Digital
  Keepsakes and Memorial Designs"; no KJV, verses or watercolor), banner v5 + icon v4, master images (garden `f961bb96` / 4K `98f074fa`;
  peony "Eternal Love" `ed347807` / 4K `85c562e9`), all 20 slideshow backgrounds with job IDs (set 1 seasons, set 2 owner bouquets,
  set 3 remembrance flowers), the house style `webdesigner/styles/litedesignz-garden-of-memories.md` (active, main), Higgsfield credits
  (82 used, 840 left — owner's figures), rules, and the briefs in `docs/litedesignz/`. Etsy upload is blocked by a sign-in error: the
  owner uploads by phone. Digital downloads first; slideshows vs downloads undecided.
- **Flagship note in the dossiers (2026-11-28, through StarNet's routes):** DESIGNER, PUBLISHER, SCOUT `context` got the note
  (`POST /api/save` 5763 -> 5764, then full-roster `POST /api/roster` count 10; integrity CONSISTENT). **NIGHT4CHRIST held back** — any
  dossier edit changes its grant digest and Monday's chain would lose `orchestrator`; it gets the style default via `styles/index.md`.
  Side effect: the paused SCOUT routine `3d117f09` (grant `connectors`) was fingerprinted on SCOUT's old text — re-grant it if it is
  ever turned back on. Recipe: `STATION_FIELD_NOTES.md` "v7 dossier edit through StarNet's routes (2026-11-28)".
- **Rules (owner):** everything through StarNet and the Outbox (register in BOTH CENTRAL OUTBOX and MY WORK ▸ DELIVERABLES); Higgsfield
  to upgrade images (show the credit cost first); no Bible verses on LiteDesignz shop images; agents run unattended; nothing published by
  agents; no new keys/accounts; no model/cap/routine change without the owner's yes; back up before every edit.

## OWNER STEPS STILL OPEN
1. SETTINGS ▸ PROVIDERS: remove the browser's saved **ANTHROPIC** and **GEMINI** keys (row ✕ REMOVE -> ✕ CONFIRM within 5 s). Harmless
   since 11-27 (station drops them for page runs), but they are old keys.
2. Tap **MY WORK ▸ CENTRAL OUTBOX** once (owner's own open step; LiteDesignz rows: filter Project = litedesignz).
3. After **Mon 11-30 03:00**: check the chain's cost against the $5 cap (`runs.jsonl`, lead `ebc4f07d`). PUBLISHER (Fable) may need more
   than the $1 per-worker cap — raising `STARNET_BUDGET_PER_WORKER` needs the owner's yes and a restart (receipts 0, not within 12 h of 03:00).
4. Delete `W/.secrets/provider-keys.json.bak-20261126-pre-remove` (holds the two OLD keys, mode 600) once satisfied.
5. **RESTORE question:** at 22:43 on 11-26 three boot-offer RESTOREs ran (additive: 17 old conversations came back incl. "(restored copy)"
   duplicates, 2× General). Did the owner press RESTORE, and keep or delete the duplicates?
6. **Repo private?** `~/starnet` is public; the notes name the shops, job IDs and station layout (no secrets). Owner's call.
7. Opus price: no action on live (see Models); only relevant if the station is rolled back to 0.12.5.
8. Older open items still stand (below): approve/reject Outbox items, "Verses for Hard Days" publish, Commander-dossier cd_32, two
   withheld skills, `shell.exec` jail, $60 capital ceiling vs ledger.

## NEXT STEPS (for the next session)
1. Before anything: `/starnet-live-health`; `ls W/.spend-pending`; `node scripts/agent-config-integrity.mjs` (in `~/starnet-next`).
2. Monday 11-30 after 03:00: read the chain run (cost, workers, outputs). Register its outputs in both Outbox views by hand if the run-end
   collector missed shell outputs (`docs/LITEDESIGNZ.md`, helpers `register-set.sh` / `verify-set.mjs`).
3. LiteDesignz products: wait for the owner's choice (slideshows vs downloads); default style = Garden of Memories.

### Verify (read-only, free)
`curl -s -m4 127.0.0.1:8787/api/health`; `GET /api/production/status`; `GET /api/cron` (chain enabled, grant, cap 5);
`GET /api/outbox?agent=agent` (191 rows on 11-28); `GET /api/deliverables?agent=agent` (296 total on 11-28); roster models from
`W/agent.roster.json`. Header `x-starnet-token` from `~/.config/starnet/env`.

# v0.15.4 SWITCH-OVER — DONE 2026-11-26 (record below; superseded where it disagrees with CURRENT STATE above)

## Owner decisions for the switch-over (DECIDED 2026-11-26 ~22:00 PST, Thursday night, owner)
1. **Chain budget on v0.15.4: $5.00 per run (`maxCostUsd: 5`), covering the lead AND all workers** (one spend pool on
   v0.15.4). Only the cap changes; the `orchestrator` delegation grant stays. Checked in the port's code: `maxCostUsd` is not
   in `cron-store.js` `RUN_FIELDS` (so the edit does not revoke the grant) and `handleCronUpdate` asks for no desk code for a
   cap edit (only for adding grants). Applied to the 8788 copy in P5 and to live after S8 (on v0.15.4, not on 0.12.5 —
   on 0.12.5 a $5 cap would mean $5 lead + $2 worker pool). Rollback restores the $2.00 cap with the backup.
2. **Desk codes:** turn on `STARNET_DESK_CODE_TO_LOG=1` and `STARNET_TRUST_LOCAL_PEERS=1` (S5). Trade-off accepted: anything
   that reads `sidecar.log` can read a desk code.
3. **Higgsfield key leak:** no separate 0.12.5 patch — the switch-over fixes it.
Running order: P5 -> S0..S12, one step at a time with its test; Claude stops for the owner before any spend (P5 / S10), any
desk code, and any failed test. No push.

## P5 RESULT (2026-11-26 22:15–22:26 PST, owner's yes; real keys on the 8788 copy; $4.71 spent)
Launcher: `~/starnet-next-work/tests/run-test-station-REALKEYS.sh`; output `~/starnet-next-work/test-output/p5-realkeys/`
(`runnow.ndjson`, `test-station.log`, `pre-test-snapshot/`). Build `3c9c1fac3` (0.15.4, clean). Copy chain cap set to $5 (grant kept).
- Lead NIGHT4CHRIST (Fable) `6d1a4ec8`: done/succeeded, 13 turns, **$2.16**. 3 sequential team.dispatch, unattended via the grant.
- SCOUT `d09041cf` (Opus 5.5) $0.34 succeeded · QC_EDITOR `effc21bc` (Fable) $1.17 succeeded (Psalm 46:1 kit passed) ·
  **PUBLISHER `d06437de` (Fable) $1.04 out_of_budget** at the $1 per-worker cap, no draft. DESIGNER not dispatched (kit reused).
- Total **$4.71** (runs.jsonl; ledger rows carry no usd). 0 Apify, 0 image generations. 3 host handoff files, +1 Outbox row.
- Cause of the PUBLISHER stop [Likely]: the chain prompt names the LIVE path `~/.local/share/StarNet/workspaces`; on the copy the
  workers' file tools are jailed to the copy, so PUBLISHER could not reach its sources and burned turns. On live the paths match.
- **Isolation finding:** the copy's agents read the LIVE kit via unjailed `shell.exec` (P0 cd082d49); QC_EDITOR's shell cwd stuck in
  the live kit folder and it created `qc-psalm-46-1/` (preview JPGs) inside LIVE `webdesigner/outbox/psalm-46-1-kit/download/`
  06:22:11Z, moved it to live `qceditor/` 06:22:28Z, then to the copy 06:22:47Z. Live contents are back as before (kit files'
  mtimes 11-26 03:0x unchanged); everything else it did on live was reads. Same behaviour exists on 0.12.5.
- Money note: a Monday run where DESIGNER builds a new kit will likely exceed $5 (this run had no DESIGNER stage).
- Owner (22:3x): go on to S0–S12; KEEP the $5 pool and the $1 per-worker cap.

## SWITCH-OVER PROGRESS (TS=20261126-2236, also in `~/starnet-next-work/SWITCHOVER_TS`)
- S0 all 7 true (outbox 137, rev 5603). S1 tabs closed (owner). S2 0.12.5 stopped clean 22:36 (receipts 0 before/after).
- S3 backups: `workspaces.bak-20261126-2236-pre0154` (diff -rq: identical, 8,324 entries), `env.bak-…`, `start-starnet.sh.bak-…`,
  `~/.termux/start-starnet.bak-…`; S4 `cron.jobs.json.bak-…`. S5 env +2 lines (mode 600). S6 launcher line 14 -> `$HOME/starnet-next`.
- S7 v0.15.4 UP 22:38: launcher 9843, sidecar **9868**, build 3c9c1fac3 clean, environ clean, ARMED persisted, chain enabled +
  grant + $2 + gateBlocked false, outbox 137, 3 grant fingerprints recorded, no errors. **Differs from the plan:** the boot is
  KEYED, not "unkeyed" — `STARNET_CONNECTOR_ENCRYPTION_KEY` (in the env) keys the authority seal, so `agent.roster.json` was sealed
  once (`authority-seal.json`). Approval modes/models unchanged (8 full, 2 ask), integrity CONSISTENT, nothing dropped.
  CONSEQUENCE: a hand edit of agent.roster.json outside StarNet is no longer obeyed (read as its safe default) — change agents
  only through StarNet's own routes/page from now on; keep STARNET_CONNECTOR_ENCRYPTION_KEY in the env.
- S8 DONE 22:43 (owner opened the page): save v7; `agent.save.pre-history-ref.json` = the exact v6 save (rev 5603, content-identical
  to the backup); integrity CONSISTENT; 10 models unchanged; routing no longer held (`/api/routing/lines/stats`). Also at
  22:43:13/27/41 three boot-offer RESTOREs of preserved `agent.save-conflict-*` copies ran (backups
  `agent.save-before-restore-*.json`): ADDITIVE ONLY — 17 conversations came back (old routine sessions + "(restored copy)"
  duplicates incl. 2× General); nothing removed (all 79 v6 conversations present). Owner to confirm they pressed RESTORE.
- Chain cap set to **$5** on live 22:5x (`cron.jobs.json.bak-20261126-2236-pre-cap5`); grant kept (grantsDropped []); other routines
  unchanged (every routine also gained a host-written `intakeBinding` observation — not editable, not used to dispatch).
- **Grant check for Monday [Certain]:** NIGHT4CHRIST's roster `system` changed 12,265 -> 10,900 chars (the accepted v7 dossier
  refresh) but `GrantedContext.instructionsOf()` is byte-identical (7,899 chars) and its digest `cb99ede2…` equals the chain's
  stored `grantDrive` — Monday's fire keeps `orchestrator`.
- **"failover (auth) … claude-fable-5-2 → anthropic/claude-haiku-5.5" (22:44, owner saw it) — ROOT CAUSE [Certain]:** the
  BROWSER's saved Anthropic key (localStorage, fp 833e21f4) is an old key: free `GET /v1/models` -> **401 invalid x-api-key**;
  the env key (fp b952d106) -> 200. On v0.15.4 a page run sends the browser's key with every run (per-run key wins), so three
  page-started NIGHT4CHRIST runs (goal decomposition etc., `27de5e86` `26090e78` `157c2210`) failed auth and fell over to
  OpenRouter Haiku ($0.007). The page also handed both its keys to the station at 22:42:58 (`.secrets/provider-keys.json`; its
  Gemini key is the OLD 3ee737a7, env has 77849313). Unattended runs are NOT affected: credential-store order is keychain
  (desktop only) > environment > page copy, and a cron run passes no per-run key -> env key (P5 proved it with Fable).
  FIX = owner, in the StarNet page: clear (or replace) the saved ANTHROPIC and GEMINI keys; a run with no page key uses the
  station's env key. Claude must not type keys.

## 2026-11-26 ~23:00–23:45 PST — owner's 7-step list (stay on v0.15.4; no new keys, no paid runs, no Apify)
1. **Station page copies REMOVED** (owner's yes): `POST /api/providers/engine-key` empty body for anthropic + gemini -> tombstones,
   `keySource: environment`, `unattendedReady: true` (backup `.secrets/provider-keys.json.bak-20261126-pre-remove`, mode 600 — it
   still holds the two OLD keys; delete it once the owner is satisfied). Free check: env Anthropic key `GET /v1/models` 200 (Fable 5.2
   + Opus 5.5 listed), env Gemini 200. **Owner still to clear the browser's own copy:** SETTINGS ▸ PROVIDERS -> ANTHROPIC key row ->
   ✕ REMOVE -> ✕ CONFIRM (within 5 s); same on GEMINI. Until then, runs the PAGE starts still fail over to Haiku.
2. **S9 (read-only):** chain ON, `0 3 * * 1` America/Los_Angeles, next Mon 11/30 03:00 PT, `$5`, grant `orchestrator`, fingerprint
   unchanged, not gate-blocked; `/api/outbox` 137 rows; page ships CENTRAL OUTBOX (`outbox.js` 200). The window opening on screen is
   the owner's tap to check. Restored copies left alone (owner did not press RESTORE).
3. **QC accepts JPEG** — `~/starnet-next/sidecar/tools/builtin/image-qc.js` (backup `.bak-20261126-jpeg-qc`): `parseJpeg`/`parseImage`
   (SOI, segment lengths, SOFn dimensions, SOS, EOI; DPI from JFIF unit 1/2). Kits NOT regenerated. Test `test/image-qc-jpeg.test.js`
   (21 OK; fails on the old module) in `test/fast.list`; record `qa/bugs/1b5addcc` (register OK, 463). Siblings green:
   studio-qc-integration 59, print-prep 46, studio-orchestration 11, qa-bugs-register, source-text-integrity, persist.lint.
4. **Opus 5.5 price correct** ($4/$20, cache read 0.05x = $0.20) vs platform.claude.com pricing — no change. **Fable 5.2 wrong in
   v0.15.4** (no row -> Fable 5 $10/$50, read 0.1x; published $8/$40, read $0.20) — **FIXED (owner's yes, 23:5x):** own rows for Fable 5.2 + Mythos 5.2 at
   $8/$40, cacheRead 0.025 (backup `prices.js.bak-20261126-fable52`); test `test/prices.fable52.port.test.js` (11 OK; 6 fail on the old
   table) in fast.list; price/budget/cap suites green (provider.prices 27, prices.all-providers 140, context.price-tier-window 92,
   claude-cli-effort 222, thinking-binding 120, native-defer 180, unpriced-ceiling 52, routine-cost-cap.port 13, budget-caps 77).
   Billing still books cache reads at the family 0.1x by design (safe direction); `cacheRatesOf` reads 0.025.
5. **Secret sweep — CLEAN** (both repos, every tracked file + full history of all refs: `~/starnet` 18,298 commits, `~/starnet-next`
   18,175). (a) The 15 REAL secret values (every env key/token, the 2 old browser keys, the GitHub credential, OmniRoute client key,
   the Kling key in the settings backup, the test token) searched verbatim: **0 hits anywhere**. (b) Strict real-format keys
   (`sk-ant-api…`, `sk-or-v1-…`, `sk-proj-…`) outside test/: 0 in the tree; 7 history commits, all synthetic and saying so
   (`abcdef…abcdef`, "native proof not real key", "live fake", "recipe lanes mock", "tasks regression dummy"; 22–41 chars vs 73 for
   a real OpenRouter key). (c) gitleaks: history 121 / tree 39 (`~/starnet`), 4 / 127 (`~/starnet-next`) — every one a test fixture,
   placeholder (`YOUR_TOKEN`, `<workspace-lineage-http-token-32bytes>`), SHA-256, asset/budget key name, the literal
   `BEGIN RSA PRIVATE KEY` in a redaction list, or Edge-TTS's public client constant (`sidecar/edgetts.js`). Nothing moved to env.
   One account identifier (an Airtable user id, not a credential) redacted from tracked `docs/CLAUDE_ARCHIVE_20261120.md`
   (backup `.bak-20261126-redact`); it stays in public history — no rewrite (owner's call). Reports (redacted, no values):
   session scratchpad `secret-scan/`.
6. **Committed + pushed** (owner's yes, sweep clean): `~/starnet-next` `phone-port-v0.15.4` = `3c9c1fac3` (the port) + `0c10e9dd6`
   (QC JPEG + Fable 5.2 price), pushed to GitHub as branch `phone-port-v0.15.4`; `~/starnet` `feat/harness-backend` (docs: 0464184f4,
   8f5f9c3d4 and the commit carrying this line) pushed to `feat/harness-backend-station-20261124`. Left out on purpose: every `.bak*`,
   `OMNIROUTE-REPAIR-CHECKPOINT.md`, untracked notes/scratch (`chat`, `detox-run*`, `.ob.json`, …). Not done: the authority-census
   matrix re-capture (it pins to a commit; owner decision, see PHONE_PORT_NOTES 3g).

## 2026-11-27 ~00:10–00:30 PST — browser's old keys stop riding page runs (owner asked; no tap needed)
- The page does NOT forget its own key when the station holds a REMOVE tombstone (harness.js boot hand-over only keeps its rev),
  so every page chat kept sending the OLD Anthropic key. **Station-side rule added** (`~/starnet-next/sidecar/index.js`, backup
  `.bak-20261127-retired-page-key`): in `handleRun`, when the page sends a key for provider X AND X's station page copy is a REMOVE
  tombstone AND the station's own key for X comes from the environment, the body's key / spare keys / endpoint are dropped and the
  run uses the env key. A key saved deliberately in any page replaces the tombstone and is honoured again. No key added, changed,
  deleted or logged; the browser's localStorage still holds the old keys (harmless now).
- **Proof, free + offline** (8788 copy, sandbox HOME, offline guard, fake keys, Anthropic -> local mock recording only key
  fingerprints): pristine v0.15.4 sent the removed OLD key (`c767487f`) = the live bug; the fix sent the ENV key (`c784a2db`) on
  `claude-fable-5-2`, run done/succeeded, 0 fallbacks; a NEW key saved afterwards (`00f7c54e`) was used. Scripts + logs: session
  scratchpad `pagekey/`. Copy's key file restored. Regression suites green: credential-store.no-crossing 145, engine-credential 169,
  engine-key-sync 49, route-authority census, persist.lint 102, source-text-integrity, failopen-ratchet 151.
  `credential-store.endpoint-pair.e2e` fails identically on the pristine baseline (Android boot-token fixture) — pre-existing.
  Covered since 2026-11-27 by `test/retired-page-key.e2e.test.js` (http.list; 21 OK; on pristine v0.15.4 row 2 fails).
  `credential-store.remove-rotate.e2e` 117/117 on both trees (run via `run-test-clean.sh`).
- **Live** after a clean restart 00:2x (receipts 0, nothing in flight, ~50 h before Mon 03:00): launcher **8798**, sidecar **8820**;
  chain $5 + grant, ARMED, outbox 137, integrity CONSISTENT. Live preconditions hold (both tombstones, env keys); env key
  `GET /v1/models/claude-fable-5-2` -> 200. No page run has happened since the restart, so a live page-run row is still to be seen:
  the next page chat should log `[credentials] a page sent a saved anthropic key …` once and record `anthropic/claude-fable-5-2`
  with no fallback in runs.jsonl.
- **Committed + pushed** (owner's yes; staged diff scanned: scan-staged hits = the test's 4 fake keys only, gitleaks clean, 0 of 13
  real secret values): `phone-port-v0.15.4` = **`93abce2bd`** on GitHub (verified by ls-remote). This handoff edit is local only.
7. **Restart 23:3x** for the QC fix (receipts 0, nothing in flight; ~51 h before Mon 03:00): launcher **8612**, sidecar **8637**, clean
   environ, ARMED, chain $5 + grant, outbox 137, routing not held, integrity CONSISTENT, 0 error lines.
   **Second restart 23:5x** for the price fix (same checks, all held): launcher **15531**, sidecar **15547**.

## Where the upgrade stands (plan steps 0-6)
| Step | What | State |
|---|---|---|
| 0 | Plan the 0.12.5 -> v0.15.4 upgrade | DONE |
| 1 | Install v0.15.4 in a sandbox (`~/starnet-next`) | DONE |
| 2 | Termux fixes (4) | DONE |
| 3 | v7 data move tested on a copy (8788) | DONE ($0) |
| 4 | Shop-safety port (production gate, Apify cap, schema guard, Etsy lifecycle) | DONE ($0) |
| 4b | Pipeline port (orchestrator grant, handoff files, studio tools, Central Outbox + approval commits, studio video pipeline, integrity script, skill) + full regression sweep + per-routine spend cap | DONE ($0) — this session |
| 5 | ONE real-key chain test, capped (owner's yes; spends) | NOT STARTED |
| 6 | Switch-over (cutover) of the live station | NOT STARTED — needs the owner's yes; steps below |

**Commits (2026-11-26 night, LOCAL ONLY — nothing pushed: repo public).** The repo is public and these notes describe the
Higgsfield key leak that is live on 0.12.5, so no push until the owner decides (and ideally after the switch-over fixes it):
- `~/starnet` `feat/harness-backend`: **`0464184f4`** docs (CLAUDE.md, handoff.md, STATION_FIELD_NOTES.md) + the commit that
  adds these hashes (see `git log -2`). Branch is ahead of `origin/feat/harness-backend-station-20261124`; do NOT push.
- `~/starnet-next` new local branch **`phone-port-v0.15.4`**: **`3c9c1fac3`** — the whole port (183 files) on top of upstream
  `124b20a6b`. No upstream set; its `origin` (= `~/starnet`) untouched. Restore anything with `git -C ~/starnet-next show 3c9c1fac3`.
- Both scanned before committing: gitleaks (no leaks) + `~/starnet-next-work/tests/scan-staged.sh` (keys, tokens, desk codes,
  account-like digits): every hit reviewed — timestamps, paths, a PNG/MP4 fixture, variable names, test-only tokens.
- Not committed on purpose: the `*.bak-20261126-port` backups; other sessions' untracked files (e.g. OMNIROUTE-REPAIR-CHECKPOINT.md).
  `sidecar/cron-orchestrator.js` has no local change (already committed earlier in `b82cc582d`).

**Live station = 0.12.5 on :8787, untouched by all of the above.** Nothing committed, pushed, restarted or spent; no key,
model, cap or routine changed. All tests ran on the copy `~/starnet-testws/` on port 8788 with a sandbox HOME, every
non-loopback connection blocked (`offline-guard.cjs`) and an obviously fake Anthropic key.

## Live state (read-only, 2026-11-26 ~19:30 PST — re-check before acting, it drifts)
- Sidecar **12486**, launcher **12468**, health ok, OmniRoute up. `.spend-pending/` empty.
- `agent.save.json` `_saveRevision` **5603**; integrity CONSISTENT (`node scripts/agent-config-integrity.mjs`).
- Models: **Fable 5.2** (`anthropic/claude-fable-5-2`) on NIGHT4CHRIST (`agent`), DESIGNER (`webdesigner`), PUBLISHER, QC_EDITOR
  (`qceditor`); **Opus 5.5** (`anthropic/claude-opus-5-5`) on SCOUT, HARVEST, STORYWRITER, DIRECTOR, PRODUCER, COPYWRITER.
  Fallback chain (OpenRouter): claude-haiku-5.5 » gemini-3-flash-preview » gpt-5-mini.
- Production **ARMED** (`.production-arm.json`: `{"armed":true,"at":"2026-11-21T08:32:28.502Z","by":"unattributed"}`).
- Routines: only the chain **`ebc4f07d` is ON** — `0 3 * * 1` America/Los_Angeles (next **Mon 11-30 03:00 PST**), lead
  `anthropic/claude-fable-5-2`, `maxCostUsd` $2.00, `unattendedGrants: ['orchestrator']`. Five others paused (09:30 decision).
- Live env (names; values read only for non-secrets): `STARNET_CRON_MAX_RUN_MS=1200000`, `STARNET_BUDGET_PER_WORKER=1.00`,
  `STARNET_BUDGET_WORKER_POOL=2.00`, `STUDIO_PROVIDER=openai`, `STUDIO_MODEL=gpt-6-luna`, `ANTHROPIC_BASE_URL` = api.anthropic.com,
  keys for Anthropic/OpenRouter/OpenAI/Gemini/HF/Kling/OmniRoute. **No `STARNET_TRUST_LOCAL_PEERS`** (v0.15.4 needs it — step S5).
- Git `~/starnet`: branch `feat/harness-backend`, tip `006c1646e` (the chain-retry fix, committed + pushed 11-26 12:41; 0/0 with
  `origin/feat/harness-backend-station-20261124`). Modified: this file, CLAUDE.md, STATION_FIELD_NOTES.md (docs, this session).

## Where everything is
- **`~/starnet-next`** — upstream v0.15.4 (`124b20a6b`, detached HEAD; a local clone whose `origin` is `~/starnet`), with the
  whole port applied, UNCOMMITTED. Own `node_modules` (`npm ci --force --ignore-scripts`; node-pty built from source; sharp wasm).
  Write-up: `~/starnet-next/PHONE_PORT_NOTES.md` (sections 1 Termux, 2 shop safety, 3 pipeline incl. 3g sweep fixes, 4 tests).
  **183 changed/new files** (`~/starnet-next-work/changed-files.final.txt`): the 115 by category below, plus **68 HTTP-list tests**
  that now arm their own sandbox (one line each; list in `test-output/sweep2/http-gate-list.txt`):
- **Termux fixes** (4): `sidecar/persist/replace.js`, `sidecar/process-identity.js`, `sidecar/workspace-owner.js`, `test/workspace-owner-election.test.js`
- **Production gate + routine caps** (5): `sidecar/cron-driver.js`, `sidecar/cron-store.js`, `sidecar/deskproof.js`, `sidecar/index.js`, `sidecar/production-gate.js` (new)
- **Apify cap** (4): `sidecar/hostquota.js` (new), `sidecar/mcp/manager.js`, `sidecar/mcp/translate.js`, `sidecar/tools/builtin/web.js`
- **Routine permission + delegation** (6): `sidecar/capability/project-tools.js`, `sidecar/dispatch-budget.js` (new), `sidecar/handoff-store.js` (new), `sidecar/inputpolicy.js`, `sidecar/permissions.js`, `sidecar/tools/builtin/orchestration.js`
- **Print & studio tools** (8): `sidecar/tools/builtin/higgsfield.js` (new), `sidecar/tools/builtin/image-qc.js` (new), `sidecar/tools/builtin/mockup-compose.js` (new), `sidecar/tools/builtin/openai-image.js` (new), `sidecar/tools/builtin/print-prep.js` (new), `sidecar/tools/builtin/stock-image.js` (new), `sidecar/tools/builtin/vector-export.js` (new), `sidecar/tools/builtin/video-probe.js` (new)
- **Deliverables register + Outbox (server)** (6): `sidecar/apitickets.js`, `sidecar/capability/registry.js`, `sidecar/deliverable-files.js` (new), `sidecar/deliverable-manifest.js` (new), `sidecar/tools/builtin/outbox.js` (new), `sidecar/video-verify.js` (new)
- **Outbox UI (frontend + website mirror)** (12): `frontend/app/apiticket.js`, `frontend/app/outbox.js` (new), `frontend/app/stationui.js`, `frontend/app/toolprops.js`, `frontend/css/app.css`, `frontend/index.html`, `website/app/app/apiticket.js`, `website/app/app/outbox.js` (new), `website/app/app/stationui.js`, `website/app/app/toolprops.js`, `website/app/css/app.css`, `website/app/index.html`
- **Studio video pipeline** (5): `sidecar/audio-finish.js` (new), `sidecar/cron-orchestrator.js` (new), `sidecar/higgsfield-video.js` (new), `sidecar/project-orchestration.js` (new), `sidecar/video-providers.js` (new)
- **Integrity script + skill** (3): `scripts/agent-config-integrity.mjs` (new), `sidecar/skills/library/judgment-rubrics.md` (new), `test/agent-config-integrity.test.js` (new)
- **Tool guards / catalog / persist** (4): `sidecar/etsy-workflow.js` (new), `sidecar/tools/catalog.js`, `sidecar/tools/registry.js`, `sidecar/tools/tool.js`
- **Tests: ported phone tests** (27): `test/deliverable-files.test.js` (new), `test/deliverable-manifest.test.js` (new), `test/dispatch-handoff-race.test.js` (new), `test/dispatch-lease-invariant.test.js` (new), `test/etsy-workflow.test.js` (new), `test/headless-dispatch.test.js` (new), `test/higgsfield-registry.test.js` (new), `test/higgsfield.test.js` (new), `test/hostquota-run-cap.test.js` (new), `test/mockup-compose.test.js` (new), `test/openai-image.test.js` (new), `test/orchestration-deliverables.test.js` (new), `test/outbox-approval-route.test.js` (new), `test/outbox-large-artifact.test.js` (new), `test/outbox-nine-agents.test.js` (new), `test/outbox-route.test.js` (new), `test/outbox-studio-bridge.test.js` (new), `test/outbox-tools.test.js` (new), `test/outbox-ui.test.js` (new), `test/outbox-unverified-approval.test.js` (new), `test/print-prep.test.js` (new), `test/stock-image.test.js` (new), `test/studio-capture.test.js` (new), `test/studio-orchestration.test.js` (new), `test/studio-pipeline-advance.test.js` (new), `test/studio-qc-integration.test.js` (new), `test/vector-export.test.js` (new)
- **Tests: new port tests** (6): `test/higgsfield.port-security.test.js` (new), `test/hostquota.port-wiring.test.js` (new), `test/production-gate.port.test.js` (new), `test/production-gate.test.js` (new), `test/routine-cost-cap.port.test.js` (new), `test/tool-schema.port.test.js` (new)
- **Tests: upstream tests adapted** (24): `test/capgate.test.js`, `test/claude-cli-compact-tools.test.js`, `test/credential-store.no-crossing.test.js`, `test/crew-defaults.invariant.test.js`, `test/cron.images-grant.e2e.test.js`, `test/cron.run-now.e2e.test.js`, `test/cron.session-transcript.e2e.test.js`, `test/cron.station-default.e2e.test.js`, `test/cron.upgrade-backlog.e2e.test.js`, `test/fast.list`, `test/front-doors-tabs.test.js`, `test/harness.integration.test.js`, `test/helpers/sidecar-fixture.js`, `test/inputpolicy.test.js`, `test/outcome-family.census.test.js`, `test/reply-assembler.census.test.js`, `test/route-authority.census.test.js`, `test/routine-delivery.parts.e2e.test.js`, `test/routine-delivery.session-return.e2e.test.js`, `test/routine-drive.http.test.js`, `test/routine-history.publication.http.test.js`, `test/routine-keys.e2e.test.js`, `test/routing.b5.test.js`, `test/tool-withheld-message.test.js`
- **Docs** (1): `PHONE_PORT_NOTES.md` (new)

- **`~/starnet-next-work`** — everything that is not source (README.md inside):
  `1-termux-fixes/` (patches + `.bak` test) · `2-shop-safety/` (patches, the 10 phone commits in `orig/`, phone tests, edit
  scripts) · `3-pipeline/` (`patches/pipeline-port.patch`, `orig/phone-index-blocks/` = phone handler blocks lifted verbatim,
  `orig/phone-css/`, `phone-tests/`, `scripts/`, `authority-matrix.diff.txt`) · `all-changes-vs-v0.15.4.{tracked,new-files}.patch`
  (the whole port) · `changed-files.*` · `env/test.env` (8788 settings, NO provider keys) + `env/live-env-NAMES-only.txt` ·
  `tests/` (`run-test-station.sh`, `run-test-station-step4.sh` = fake key, `run-test-clean.sh` / `run-test-clean-ARMED.sh`
  (`PORT_ROOT=` picks the tree), `sweep.sh`, `offline-guard.cjs`, `cdp-eval.mjs`, `probes/`) · `test-output/` (station logs,
  API answers per step, `step4/`, `step5-pipeline/`, `sweep/`, `sweep2/` = FINAL sweeps, `reruns/`, `cron-suites/`,
  blocked-network logs) · `baseline-v0154-termux/` (pristine v0.15.4 + Termux fixes, for "is this failure pre-existing?") ·
  `tree-after-step4/` · `home/` (sandbox HOME; deletable). The two trees are 3.5 GB each.
- **`~/starnet-testws/`** — the 12 GB test copy of the live workspace (already migrated to v7 by step 3). Restored to its
  pre-test bytes after every test (snapshots in `test-output/*/pre-test-snapshot/`).

## What the port changes (summary — detail in PHONE_PORT_NOTES.md)
- **Termux (4):** workspace lock copy fallback (persist `copyExclusive`), EPERM `/proc` liveness, android treated as linux in
  process-identity, `.bak` EACCES = "no hard links" (was log noise; backups were never lost).
- **Shop safety:** production gate (state file, routes, run-start refusal, cron "declined" outcome, routine snapshot,
  workshop buttons; **arming now asks for the desk code**, disarming never does), Apify cap 8/day + 3/run at both doors,
  tool schema/name guards, Etsy lifecycle module (not wired, as on the phone).
- **Pipeline:** `orchestrator` routine grant (object + consent + depth fence), host handoff files in the lead's outbox, the
  lease-outlives-dispatch invariant, 8 print/studio tools, Central Outbox (manifest at `workspaces/.deliverables`, run-end
  registration, outbox tools, `/api/outbox`, `/api/artifact`, approval + QC writers, `/api/deliverables/register`, UI window
  CENTRAL OUTBOX under MY WORK, tickets), the studio video pipeline (`/api/studio/*`), integrity script, `judgment-rubrics`.
- **Per-routine spend cap (found + ported tonight):** v0.15.4 carried the field but read it nowhere — with station PER RUN = 0
  every routine would have had NO per-run cap. Ported as `routineCapUsd`, lower-only; **on v0.15.4 the chain's $2.00 cap
  covers the lead AND all its workers** (run-spend-pool.js); `STARNET_BUDGET_WORKER_POOL` is ignored; per-worker $1.00 still applies.
- **Security fix (live bug!):** Higgsfield key headers could be steered to another host by a model-supplied endpoint or a
  response status URL. Fixed in the port only.
- **Superseded / not ported on purpose:** pooled worker budget (upstream's spend pool is stricter), the 0.12.5 chain-retry
  patch (upstream's driver already ignores worker runIds), video.kling / image_upscale_kling (never callable), phone
  `image.js` routing (v0.15.4 keeps its own image router), `cron-orchestration-tasks.js` (dead), slow-phase diagnostic log.

## Test results (final tree)
- **Fast list (`test/fast.list`, 1,904 tests), full sweep on the frozen tree + re-run of every failure:** 1,875 pass.
  29 fail: **28 fail identically on pristine v0.15.4 + the Termux fixes** (pre-existing on this phone — browser/WebGL/scene
  bakes need a display, real-socket/SNI tests vs the offline guard, release-train/updater (desktop), workshop e2e and
  boot-security (403 token on Android), durable-store-faults (expects a hard link), prompt-scrub P2 hash (clock/locale),
  voice, channels.store-cache, notebook-peer-reads, save-persist-cost, session-reliability, prop-recovery, workspace-probe,
  skills.package-hardening (EACCES link)); **1 is the port's: `authority-census`** — the captured authority matrix differs in
  734 cells, ALL about the 10 ported tools (`~/starnet-next-work/3-pipeline/authority-matrix.diff.txt`); a re-capture is pinned
  to a commit hash, so it waits for a commit (owner decision). Lists: `test-output/sweep2/final/fast-classification.tsv`.
- **HTTP list (`test/http.list`, 401 tests — never swept before; the fast sweep does not cover it):** first pass 242 pass,
  159 fail. Classified (`tests/classify.sh`: port -> port with sandbox armed -> baseline): **0 port regressions.**
  **68 were the production gate** refusing unattended metered MOCK runs on a fresh, disarmed test sandbox (upstream tests
  written before a gate existed; includes workers dispatched by an interactive lead, which the gate judges as unattended,
  as on 0.12.5). Each now arms its own sandbox (`process.env.STARNET_PRODUCTION_ARMED = '1'`, like the phone's bd14f909c); all
  68 re-run green on the plain runner. **91 fail identically on the baseline** (pre-existing on this phone): 35 boot token
  withheld by the Android peer check in the fixture, 17 other 403s (token/desk on Android), 12 timeouts, 27 other env.
  Final: **310 pass, 91 pre-existing.** Lists: `test-output/sweep2/http-classification.all.tsv`, `http-armed-verify/`.
- **Live-shape runs on 8788** ($0 each): boot clean; ARMED carried over; disarmed Run Now refused + recorded "declined";
  armed Run Now passed the gate; Outbox reads the copied live manifest as **137 rows** (identical to the phone module:
  PUBLISHER 55, QC_EDITOR 57, DESIGNER 49); artifact fetch byte-exact; approval/QC/path gates refuse; ticketed fetch works and
  cannot be replayed as another agent; studio pipeline starts/stops; `/api/run` NDJSON contract (runId + typed outcome)
  confirmed; integrity CONSISTENT; copy restored byte for byte.
- **Final smoke on the finished tree (8788, 2026-11-26 ~20:25 PST):** `/api/version` = `{"app":"0.15.4","buildSha":"124b20a6b…",
  "buildDirty":true}`; production persisted ARMED; chain keeps `maxCostUsd:2`, grant + fingerprint; Outbox 137 rows. It also
  caught a real bug: the arming desk action was not on deskproof.js's whitelist (500 "unknown desk action") — fixed and re-run:
  disarm 200 without asking; arm from disarmed 403 + challenge; code in the log (with `STARNET_DESK_CODE_TO_LOG=1`); confirm 200;
  ARMED, recorded "final smoke — unverified". Copy restored; integrity CONSISTENT; only boot probes blocked; $0.

## SWITCH-OVER PLAN (each step needs the owner's yes; test + undo per step)
Do it on a weekday daytime with the owner at the phone, **not** within ~12 h before Monday 03:00 PST, and after the owner has
decided the chain cap (Recommendation 1). Total time ~45 min (the workspace copy is ~12 GB). Claude may run the commands; the
owner types any desk code. `TS=$(date +%Y%m%d-%H%M)` once, reuse it.

**P5 — Plan step 5 FIRST, on the 8788 copy (recommended before the switch; owner's yes; spends real money).** Proves the
whole pipeline on v0.15.4 with real keys while live keeps running 0.12.5. How: copy `tests/run-test-station-step4.sh` to a
`run-test-station-REALKEYS.sh` that (a) does NOT load `offline-guard.cjs`, (b) instead of the fake key does
`set -a; . ~/.config/starnet/env; set +a` INSIDE that one process (never print it), (c) keeps port 8788, the sandbox HOME and
`STARNET_WORKSPACES=~/starnet-testws/workspaces`, and (d) adds `STARNET_HOST_DAILY_LIMITS=apify.com=3` (the copy has its own
Apify counter, separate from live's 8/day). Snapshot the copy (as in step 5 of the port), boot, set the copy's chain cap to
the decided value (`POST /api/cron/update {"id":"ebc4f07d-a26e-4e40-ae4f-01f8a56ea909","patch":{"maxCostUsd":<X>}}`), then ONE
Run Now of the chain (`POST /api/cron/run`, never `curl -m`). The copy has no chat channels configured (checked), so no bot is
shared with live. Note: with real keys the copy's own background passes (quest refresh on its "caught-up" fast path, reflection after
runs) can make a few small paid calls, as live does; the Run Now is the main spend. Watch what S10 lists. Afterwards SIGTERM the 8788 sidecar by PID and keep its logs; the copy is a sandbox.
Undo: none needed (live untouched); the spend is real.

**S0 — Pre-flight (read-only).** `curl -s -m4 http://127.0.0.1:8787/api/health` = ok · `ls ~/.local/share/StarNet/workspaces/.spend-pending/`
= empty · `GET /api/cron` (header `x-starnet-token`) shows no `inFlight:true` · `node scripts/agent-config-integrity.mjs` = exit 0 ·
`df -h ~` ≥ 20 GB free · record `GET /api/outbox?agent=agent` `count` (compare in S7) · note launcher/sidecar PIDs (`pgrep -af start-starnet.sh`, `pgrep -af 'node sidecar/index\.js'`).
Test: all seven true. Undo: none (read-only). **If any fails, stop.**

**S1 — Close every StarNet browser tab** (an old 0.12.5 page would push its roster to the new station). Test: no tab open.

**S2 — Stop 0.12.5 cleanly** (CLAUDE.md recipe): count `.spend-pending` again (must be 0), `kill <launcher PID>`, then
`kill <sidecar PID>`, wait until `curl …/api/health` fails and `pgrep -af 'node sidecar/index\.js'` is empty (≤ 30 s).
Test: port 8787 closed, no node sidecar. Undo: start 0.12.5 again with the `env -i` recipe (launcher unchanged at this point).

**S3 — Backups (with the station stopped, so the copy is consistent):**
`cp -a ~/.local/share/StarNet/workspaces ~/.local/share/StarNet/workspaces.bak-$TS-pre0154` ·
`cp -p ~/.config/starnet/env ~/.config/starnet/env.bak-$TS-pre0154` · `cp -p ~/start-starnet.sh ~/start-starnet.sh.bak-$TS-pre0154` ·
`cp -p ~/.termux/boot/start-starnet ~/.termux/start-starnet.bak-$TS-pre0154` (outside boot/ so Termux:Boot does not run it).
Test: `du -s` of the copy ≈ the original; `cmp` the save, roster, cron.jobs.json, `.production-arm.json`,
`.deliverables/manifest.jsonl`. Undo: delete the copies (nothing else changed).

**S4 — (optional, recommended) Mark the moment:** `cp -p workspaces/cron.jobs.json workspaces/cron.jobs.json.bak-$TS-pre0154`.

**S5 — Env: add TWO lines** to `~/.config/starnet/env` (append; keep mode 600; never print the file):
`STARNET_TRUST_LOCAL_PEERS=1` — Android denies `/proc/net/tcp`, so without it v0.15.4 withholds the token from the page and the
page cannot open (and the page must open once, S8).
`STARNET_DESK_CODE_TO_LOG=1` — **required on this phone.** The launcher pipes the sidecar's console into `sidecar.log`, and
v0.15.4 refuses to write desk codes to a kept log unless this is set ("This station's console is kept in a log, so its code is
not written here … start it with STARNET_DESK_CODE_TO_LOG=1"). Without it NO raise can be confirmed: re-granting the chain,
arming production, Full Access, spending raises. Trade-off: anything that can read `sidecar.log` (this Termux user, a Claude
session) can read the code. Verified on 8788 tonight: without it, arming asked and printed no code; with it, the code was in the
log and the confirm armed the station.
Test: `grep -cE '^STARNET_(TRUST_LOCAL_PEERS|DESK_CODE_TO_LOG)=1$' ~/.config/starnet/env` = 2; `stat -c %a` = 600.
Undo: `cp -p env.bak-$TS-pre0154 env`.

**S6 — Launcher points at the new tree:** in `~/start-starnet.sh` change line 14 to
`STARNET_DIR="${STARNET_DIR:-$HOME/starnet-next}"`. This one line switches manual starts, `starnet-up.sh` and Termux:Boot
(boot -> starnet-up.sh -> start-starnet.sh). Test: `bash -n ~/start-starnet.sh`; `grep -n STARNET_DIR= ~/start-starnet.sh`.
Undo: `cp -p ~/start-starnet.sh.bak-$TS-pre0154 ~/start-starnet.sh`.

**S7 — Start v0.15.4** with the clean-env recipe from CLAUDE.md (cheat sheet, "When Claude Code runs a restart"), never from a
Claude shell directly. Test (all must hold): `/api/health` ok; `GET /api/version` reports 0.15.4; `/proc/<sidecar>/environ` has
no `LD_PRELOAD` and no `CLAUDE*`; `tail -80 ~/.local/state/starnet/sidecar.log` has no uncaught error and no
`[dispatch] … does NOT fit` warning; expected lines: `authority-seal unkeyed`, `[cron] recorded the model of 3 routine(s) allowed
to run unattended` (grant fingerprints, first boot only — the chain, the dispatch smoke test and the Etsy research routine); `GET /api/production/status` = armed/persisted; `GET /api/cron`
= chain enabled, `unattendedGrants:['orchestrator']`, `maxCostUsd:2`, `gateBlocked:false`; `GET /api/outbox?agent=agent`
count = the count recorded in S0. Undo: stop it (S2 recipe), restore the launcher (S6 undo), start 0.12.5 — the data is still v6 until S8.

**S8 — Open StarNet once in Chrome** (`http://127.0.0.1:8787`, a fresh tab). The page moves the save v6 -> v7 by itself
(seconds) and keeps `agent.save.pre-history-ref.json` (the v6 file). **Until this has happened, routines and channels refuse
to run** (0.15.0 notes). Test: `agent.save.pre-history-ref.json` exists; `node ~/starnet-next/scripts/agent-config-integrity.mjs`
= CONSISTENT; `node ~/starnet/scripts/station-models.mjs list` shows the same 10 models; sidecar.log has no "waiting for a
migration"; COMMS shows the chats. Undo after S8 = **full rollback** (below) — v7 is one-way for 0.12.5.

**S9 — Post-switch checks:** CENTRAL OUTBOX tab opens (MY WORK); SCHEDULES shows the chain armed with its next run; the
grant is intact (no "runs without its unattended grants" in the log after a Run Now). Raises now ask for a 6-digit desk
code that the sidecar prints in `~/.local/state/starnet/sidecar.log` (`tail` it, type the code in the page).

**S10 — Plan step 5 on the live station (only if P5 was skipped; owner's yes; spends):** one Run Now of the chain on v0.15.4 with its (decided) cap. Watch:
`runs.jsonl` (lead + worker rows, `usd`, `reason`/`outcome`), handoff files `workspaces/agent/outbox/<ts>-agent-to-*.md`,
new rows in `/api/outbox`, DESIGNER's `image_generate`/print-prep outputs, SCOUT's Apify calls (≤3), the spend total vs cap.
Never pass `curl -m` or pipe Run Now to `head` (it aborts the run). This is the proof the pipeline works on v0.15.4.

**S11 — (optional) Termux:Boot test:** reboot the phone; `~/.local/state/starnet/boot.log` must show `UP` and `/api/version`
0.15.4. Undo: none needed (boot script unchanged).

**S12 — Keep the backups ≥ 7 days** (and `~/starnet` untouched) until v0.15.4 has run Monday's chain cleanly.

**FULL ROLLBACK to 0.12.5** (any time after S7/S8): stop v0.15.4 (S2 recipe) · `mv workspaces workspaces.failed-0154-$TS` ·
`cp -a workspaces.bak-$TS-pre0154 workspaces` · restore the launcher (S6 undo) · (optional) restore env (S5 undo; the extra
line is harmless) · start with the clean-env recipe · reload tabs · integrity CONSISTENT. Anything v0.15.4 produced after the
switch (runs, Outbox rows, handoff files) stays in `workspaces.failed-0154-$TS` — copy files back by hand if needed.

## Recommendations — top risks for unattended runs (Monday 03:00 chain, safety holds, production switch, spend caps)
1. **Chain budget will likely cut Monday's run short.** [Likely] Past chain fires cost $0.35–$0.99 lead+workers on gemini/gpt-5
   (11-24..11-26). The chain is now Fable (lead) + Fable/Opus workers (≈5–100× per token; SCOUT alone spent $0.685 this
   morning). On v0.15.4 one **$2.00 pool covers lead + workers** (0.12.5: $2 lead + $2 worker pool). Do: decide the cap before
   the switch — e.g. `POST /api/cron/update {"id":"ebc4f07d-…","patch":{"maxCostUsd":5}}` (owner's yes), or keep $2 and accept a
   partial run (the run stops cleanly on budget). Measure it in P5 first. If the switch is not done before Monday, nothing
   changes: 0.12.5 runs Monday's chain as today ($2 lead + $2 worker pool).
2. **v7 move needs the page.** If nobody opens StarNet after S7, every routine refuses (no spend, but no work). Do S8 at once.
3. **Without `STARNET_TRUST_LOCAL_PEERS=1` the page cannot open on Android** (token withheld) — so S8 fails. S5 first.
4. **Grant fingerprints.** v0.15.4 stamps the chain's grant with NIGHT4CHRIST's instructions, skills and the routine's model
   at first boot. Any later dossier/skill/model edit makes the chain run **without** `orchestrator` (no delegation; log
   "runs without its unattended grants"). Also, **editing the routine's own prompt, model, provider, skills, agent, script or toolsets
   revokes its grant** (cron-store `RUN_FIELDS`, checked in code); a `maxCostUsd` edit does NOT. Do: after any such edit,
   re-grant in SCHEDULES (desk code) and check the log before the next fire.
5. **A granted run's prompt is smaller on v0.15.4** (agent's own instructions + routine note; no Commander dossier, memory,
   standing brief or crew names). Watch the first chain's quality in S10; the Etsy rules live in the agent docs, so they stay.
6. **Desk codes need `STARNET_DESK_CODE_TO_LOG=1` (S5) and then live in `sidecar.log`.** Arming production (desk-gated by the
   port; disarming never asks), Full Access, routine grants, spending raises and toolsets all ask. Flow (verified on 8788):
   the request answers 403 `desk_confirm_required` with a challenge; the page shows it; the 6-digit code is in
   `tail ~/.local/state/starnet/sidecar.log` ("Confirm at the desk: …"); type it in the page. From curl:
   headers `x-starnet-desk-proof: <challenge id>` + `x-starnet-desk-code: <code>`. 5 wrong codes lock raises for a while.
7. **Live security bug until the switch:** `higgsfield.generate` (0.12.5) can leak the Higgsfield key. The switch fixes it.
   Until then avoid Higgsfield calls (DESIGNER used it 6 times historically).
8. **Opus 5.5 price:** v0.15.4's table says $4/$20 per Mtok, 0.12.5 says $5/$25. If v0.15.4 is low, Opus spend books ~20% low
   and caps stop later than they should. Check Anthropic's price page; fix `sidecar/providers/prices.js` if needed.
9. **Print files fail QC (phone bug, ported as-is):** print-prep writes JPEG, image_quality_check accepts PNG only. The chain's
   QC stage will report print files as failed. Decide: teach QC JPEG (print-prep has a JFIF DPI reader) or leave.
10. **Second dispatch after tainted input is refused** (same on 0.12.5): once a worker's output (e.g. SCOUT's web data)
    reaches the lead, a NEW `team.dispatch` call is refused unattended. The chain works today because one sequential
    dispatch covers all stages — keep the chain prompt that way.
11. **Dispatch window got longer:** with `STARNET_CRON_MAX_RUN_MS=1200000` v0.15.4 derives 2,580 s per dispatch (phone 1,080 s);
    the 90-min routine wall still bounds the run. Fine, but a stuck worker now burns up to ~43 min before an honest timeout.
12. **OmniRoute unused by v0.15.4** (no `omniroute` provider; `OMNIROUTE_API_KEY` ignored). Nothing live uses it; the launcher still
    starts it (RAM only). Leave or remove later.
13. **Studio pipeline** runs on `openai/gpt-6-luna` (env), priced; its status can stay "running" forever after a submit failure
    (phone bug, ported as-is).
14. **Committing the port:** `~/starnet-next` is an uncommitted detached tree whose `origin` is the PUBLIC repo's local clone.
    Decide branch/commit strategy before pushing anything (45 gitleaks findings are still open); then re-capture the
    authority matrix (`test/authority-census.test.js`) on that commit.
15. **Disk:** backups 12 GB + test copy 12 GB + work trees 7 GB. Delete `~/starnet-testws`, `baseline-v0154-termux/`,
    `tree-after-step4/` and `home/` only after the switch-over is proven (owner's call).

## Open owner decisions (consolidated)
1. Chain cap on v0.15.4 (Rec. 1). 2. When to do S0–S12 and step 5 (spends). 3. Print-prep JPEG vs QC PNG (Rec. 9).
4. Opus price (Rec. 8). 5. Commit/branch/push strategy for the port (Rec. 14) + authority-matrix re-capture. 6. Keep arming
desk-gated (port default) or revert to token-only. 7. Accept `STARNET_DESK_CODE_TO_LOG=1` (S5; codes readable by anything that
reads sidecar.log) — without it no raise can be confirmed on this phone. 8. Patch the live 0.12.5 Higgsfield key leak now
(needs a restart) or wait for the switch (Rec. 7). 9. Older decisions below still open: OpenRouter balance ($6.32 of $45),
Anthropic balance (console), approvalMode `full` on 8 of 10, repo public + gitleaks, Kling key backup file, 137 Outbox items,
ledger $139.67 vs $60 ceiling, production armed "unattributed".

## How to work on the port (for a fresh session)
- Tests: `~/starnet-next-work/tests/run-test-clean.sh test/<name>.test.js` (clean env, no keys, offline guard; `PORT_ROOT=` picks
  the tree; `run-test-clean-ARMED.sh` arms the sandbox). Pre-existing? Run it with
  `PORT_ROOT=~/starnet-next-work/baseline-v0154-termux`. Whole list: `tests/sweep.sh <outdir> [list]`. Sort failures:
  `tests/classify.sh <failed-list> <outdir>` (port -> port armed -> baseline; verdicts pass-now / gate-needs-armed-sandbox /
  pre-existing / PORT-REGRESSION). `run-test-station-DESKLOG.sh` = the 8788 station with desk codes in its log.
- Live-shape test: snapshot the copy's state files, `tests/run-test-station-step4.sh` (8788, fake key, offline guard), test,
  SIGTERM it by PID (cwd `~/starnet-next`), restore the snapshot, run the integrity script on `~/starnet-testws/workspaces`.
- Never touch the live station, `~/.config/starnet/env`, Termux:Boot or `~/starnet` code without the owner's yes.

---

# HISTORICAL — this file as it stood earlier on 2026-11-26 (kept verbatim; superseded where it disagrees with the above)

# StarNet handoff — read this first (updated 2026-11-27, pipeline port)

Phone station (Termux). Repo `~/starnet` is PUBLIC (GitHub confirmed 05:00) — push only with the owner's yes for that push
(08:40: yes for the three docs commits). Live data: `~/.local/share/StarNet/workspaces/`.
Then read `CLAUDE.md` "Where we left off" and the newest section of `STATION_FIELD_NOTES.md`.

## v0.15.4 update: plan steps 1–3 DONE in a sandbox (2026-11-26 ~13:15 PST). Live 0.12.5 untouched on 8787.
- **Where things are:** `~/starnet-next` is upstream v0.15.4 (`124b20a6b`, detached, uncommitted). It has 3 Termux fixes and
  `PHONE_PORT_NOTES.md`, which lists every change by category. The test leftovers, patch, test env and test scripts
  are in `~/starnet-next-work/` (see its README). The test workspace copy is `~/starnet-testws/`.
- **Step 1, install:** `npm ci --force --ignore-scripts` (plain `npm ci` refuses android, because of onnxruntime-node).
  node-pty is built from source with `--nodedir=$PREFIX`. sharp uses the lockfile's `@img/sharp-wasm32` build
  (hash-checked). Voice (onnxruntime) is not usable on Android.
- **Step 2, Termux fixes:** workspace-owner hard-link copy fallback and EPERM `/proc` check, android treated as
  linux in process-identity, and the matching lock-test fix. All 4 lock and identity tests pass.
  `STARNET_TRUST_LOCAL_PEERS=1` is only in the test env file.
- **Step 3, v7 on a copy:** booted on 8788 with a sandbox HOME, all network blocked and a FAKE Anthropic key
  (now deleted). The page went in by itself. Save v6 to v7, `pre-history-ref` kept, all 71 sessions' chats load
  exactly as in v6, agents identical, integrity CONSISTENT. $0 spent, and all 7 network attempts were blocked.
- **Owner decision (DECIDED 2026-11-26, owner): KEEP the 2 refreshed dossier lines.** The 0.15.4 page rewrites 2
  untouched dossier "seed" lines (identity #1 and standing order #2) to match NIGHT4CHRIST's current docs (upstream
  `2ef2cb718`, by design). The owner accepts the refreshed text; do NOT clear them on 0.12.5 before cutover.
  Also, 8 old routine-run sessions leave the session list (0.15.3 rule).
- **Fourth Termux fix DONE (step 4).** Correction: `.bak` copies were never lost (upstream already copies when
  `link()` fails). The fix stops the `persist.bak.link EACCES` noise (EACCES counted as no-hard-links, Android only).
  The step-2 lock fallback was reworked onto persist's `copyExclusive` (upstream `persist.lint` forbids bare writes).

## v0.15.4 update: PIPELINE PORT DONE in the sandbox (2026-11-27). Live 0.12.5 untouched on 8787. Stopped before cutover.
Full detail: `~/starnet-next/PHONE_PORT_NOTES.md` section 3 (+ 4 for tests). Work files: `~/starnet-next-work/3-pipeline/`.
- **Ported (all adapted, nothing committed):** the `orchestrator` routine grant (object + consent + depth fence), host
  handoff files, the lease-outlives-dispatch invariant; the 8 print/studio tools; the Central Outbox (manifest, run-end
  registration, outbox tools, /api/outbox, /api/artifact, approval + QC writers, /api/deliverables/register, UI window,
  tickets) including the 4 held-back commits `b0dcc0b2c` (outbox half), `c9b56ca46`, `21e1e7c79`, `6b141f46d`; the studio
  video pipeline (cron-orchestrator + no-delegate prompt, /api/studio/*); the integrity script; the `judgment-rubrics` skill.
- **Without the grant port the chain could not delegate on v0.15.4** (upstream drops unknown grant names) — fixed; the
  chain's `['orchestrator']` survives the load.
- **8788 test ($0, network blocked, fake key):** clean boot; ARMED carried over; Outbox reads the copied live manifest as
  137 rows (identical to the phone module); artifact fetch byte-exact; approval/QC/path gates refuse correctly; ticketed
  retrieval works and cannot be replayed as another agent; studio pipeline starts and stops cleanly (no OpenRouter key in
  the test env); /api/run's stream contract confirmed. Integrity CONSISTENT; test copy restored byte for byte.
- **Owner decisions (new):** see "Open owner decisions — pipeline port" below.

## v0.15.4 update: plan step 4 shop-safety DONE in the sandbox (2026-11-26 ~14:45 PST). Live 0.12.5 untouched.
Full detail: `~/starnet-next/PHONE_PORT_NOTES.md` sections 1, 2 and 4. Patches: `~/starnet-next-work/2-shop-safety/`.
- **Finding:** all 10 commits fix PHONE-ONLY features (none of them, and none of their bases, are in upstream), so
  each was adapted, not cherry-picked.
- **Ported:** the production gate (`2f5f3486c`, `c0a1d0096`, `e5c8da4ab` plus its base); the Apify cap (`8557798db`
  plus `hostquota.js`, both doors); `b0dcc0b2c` generic half (schema-key guard and argument hint); the Etsy lifecycle
  (`14160ee7b`, a library nothing imports yet). Same state files as 0.12.5 (`.production-arm.json`,
  `.host-daily-quota.json`), so the ARMED state and today's Apify count carry over at cutover.
- **Superseded:** `893070f29`. Upstream's `run-spend-pool.js` makes the lead's cap cover all its workers.
  **`BUDGET_WORKER_POOL` is ignored on v0.15.4: the chain's $2.00 becomes lead + workers together** (today:
  $2 + $2). Owner may want to raise the chain cap before cutover.
- **Blocked until the pipeline port:** `c9b56ca46`, `21e1e7c79`, `6b141f46d` and the outbox half of `b0dcc0b2c`
  (they need the phone-only `deliverable-manifest.js`, outbox UI, `cron-orchestrator.js` and studio tools).
- **Not needed after cutover:** the live chain-retry patch. v0.15.4's cron driver already ignores worker runIds.
- **Adaptations to know about:** the gate refusal is `failureCode 'production_disarmed'` (v0.15.4 uses
  "refused" for model refusals), and the routine is recorded as `declined` (no retry, no streak, still scheduled).
  The workshop "Commander pressed it" flag feeds the gate only, not `accessSurface`. The HUD's `cron.result` still
  says "failed" for a declined fire (wording nit).
- **8788 test ($0, network blocked, fake key):** status carried over ARMED. Disarm logs the recorded label
  ("unverified"). Run Now while disarmed was REFUSED before any provider call and recorded as declined. Run Now
  while armed passed the gate, then was blocked at the network, `usd 0`. All 11 attempts were blocked. Integrity
  CONSISTENT. The test copy was restored from `test-output/step4/pre-test-snapshot/`. Note: the chain is OFF in the
  test copy (ON live).
- **Owner decision (recorded 2026-11-26): keep the 2 refreshed dossier lines** (see above).
- **Next: plan step 4, part 2, the pipeline commits** (print and studio tools, deliverables register, the
  cron-orchestrator prompt, the integrity script, the `orchestrator` routine permission). The 4 blocked outbox
  commits ride with the deliverables register. Then step 5 ($2-capped chain test with real keys, owner's yes),
  then step 6 (cutover).

## Open owner decisions — pipeline port (2026-11-27)
1. **Print-prep vs QC (phone bug):** `image_print_prep` ships JPEG (Etsy 20 MB rule) but `image_quality_check` only accepts
   PNG, so QC of a print-prep file fails today on 0.12.5 too. Teach QC to read JPEG (print-prep already has a JFIF DPI
   reader it could reuse), or leave it. Ported unchanged.
2. **`image_generate` routing:** v0.15.4 keeps its own router (default `google/gemini-3.1-flash-image`); the phone's
   OpenRouter-key fix and native Gemini fallback were not ported (that would change models/keys). Confirm it renders with
   the real keys in the $2 step-5 test.
3. **Studio stage model:** the studio pipeline still runs every stage on `anthropic/claude-sonnet-4.5` via OpenRouter
   unless `STUDIO_MODEL`/`STUDIO_PROVIDER` are set — not the agents' own models. Unchanged on purpose.
4. **Chain budget (from step 4):** on v0.15.4 the chain's $2.00 cap covers lead + workers together (today $2 + $2 pool).
5. **Dispatch window:** derived default is 420 s per team.dispatch on v0.15.4 (the phone uses 360 s); an explicit
   `STARNET_DISPATCH_TIMEOUT_MS` in the env would override it — check the env before cutover (not read here).
6. **Studio status (phone bug):** a studio project whose stage fails at submit stays "running" forever. Fix or leave.
7. **New MY WORK tab:** CENTRAL OUTBOX sits after DELIVERABLES (upstream's own OUTBOX alias still opens DELIVERABLES'
   TO REVIEW section). Keep, rename or move.

## Current state (checked live 04:29, re-checked 05:00, read-only)
- [12:12 PST: now sidecar 12486, launcher 12468, after the chain-fix restart] Sidecar 29630 (health ok, app 200), OmniRoute 29422/29443. Started by the Termux:Boot test reboot at 00:33 PST.
- Cron healthy, not halted. Production ARMED (2026-11-21, unattributed). `.spend-pending/` empty.
- **09:30 (owner's yes 08:48): routines PAUSED until the store is in production.** OFF: SCOUT `7b22107c`, HARVEST
  `d22650c8`, Quality Gate `41a7de48`, Concept Queue `e7fccdb8`, Print Kit `b8c6f80c`. ON: only the chain `ebc4f07d`,
  now **Mondays 03:00 America/Los_Angeles** (`0 3 * * 1`, next 11-30). Undo: `{"enabled":true}` per routine; chain
  `{"schedule":"0 3 * * *","timezone":"America/Los_Angeles"}`. Backup `cron.jobs.json.bak-20261126-pause`. Details: CLAUDE.md top.
- Earlier — Routines ON (next run): SCOUT daily 09:00 · Etsy pipeline chain 03:00 (11-27) · HARVEST Tue 10:00 (12-01) ·
  Quality Gate Draft, Scripture Art Concept Queue, Print Kit Readiness Plan (11-30 09:00).
- Agent config: integrity CONSISTENT, `agent.save.json` `_saveRevision` 5577 (05:00).
- **Models (08:32, owner's yes): split.** Fable 5.2: NIGHT4CHRIST, DESIGNER, QC_EDITOR, PUBLISHER. Opus 5.5
  (`anthropic/claude-opus-5-5`): SCOUT, HARVEST, STORYWRITER, DIRECTOR, PRODUCER, COPYWRITER. Rev **5583**, integrity
  CONSISTENT, save/roster/live agree. Routine pins: SCOUT `7b22107c` + Weekly Income Scan `d22650c8` → anthropic/
  claude-opus-5-5; chain lead `ebc4f07d` → anthropic/claude-fable-5-2 (model and provider changed; nothing else).
  Backups `*.bak-20261126-opus-split` (save, roster, cron). Undo: CLAUDE.md "Where we left off — 08:40".
- Earlier — **Models (04:42): all 10 agents on `anthropic/claude-fable-5-2`** (was: NIGHT4CHRIST empty, 7× openai gpt-5,
  PUBLISHER gemini-3.5-flash, SCOUT gemini-flash-lite). Backups `agent.{save,roster}.json.bak-20261126-044208-models`;
  undo `node scripts/station-models.mjs revert`. Details and the measured model limits: CLAUDE.md item 1.
  Re-checked 05:00: Fable on all 10 in save, roster and `GET /api/runtime/agent`.
- Spend estimate at Fable (CLAUDE.md item 2): ~$5/day as routines stand, ~$7/day if the three pins move [Guessing,
  ~70% cache hits] — BUT the per-run caps ($0.25; chain $0.50) were set for cheap models and will likely stop Fable runs
  first (decision 1) — **caps raised 05:45: chain $2.00, the other 5 ON routines $1.00** (decision 1 DONE).
  Workers are capped separately ($1.00 each, $2.00 pool per lead run). The $25/day rail is the outer limit.
- Git: branch `feat/harness-backend`, pushed to `origin/feat/harness-backend-station-20261124`. Always push explicitly
  to that branch (`git push origin HEAD:refs/heads/feat/harness-backend-station-20261124`); never force; never push
  `origin/feat/harness-backend` (it diverged, 5,382 remote-only commits). Remote tip `2acc52622` (05:00, 0/0).
  08:40: the 05:20 docs fix, the 05:45 caps note and the 08:40 model-split note pushed with the owner's yes.

## Done today (2026-11-26, PST)
1. 00:33: Termux:Boot crash recovery tested — reboot brought StarNet up on its own.
2. Read-only dossier audit (blockers: SCOUT ask-before-scraping, NIGHT4CHRIST NIV reels, status words never set).
3. Diagnosis of the 03:00 chain failure (below).
4. 04:17: the owner's 18-part dossier bundle installed for all 10 agents — docs only, both files, rev 5574 → 5575,
   full-roster POST. Backups (workspaces dir, never commit): `agent.save.json.bak-20261126-041644` (1,088,103 B),
   `agent.roster.json.bak-20261126-041644` (150,760 B), `webdesigner/styles.bak-20261126-041644/`.
   Bundle text + dry-run/apply scripts kept privately at `~/.local/share/StarNet/dossier-install-20261126/`.
5. Style library: `webdesigner/styles/index.md` rewritten (2 styles: soft-watercolor-sunrise active,
   gothic-blackletter-faith trial). Existing style files untouched.
6. 04:42: all 10 agents moved to claude-fable-5-2 (rev 5576).
7. 04:46: three owner-approved fixes (rev 5577): QC_EDITOR context gets the shared Etsy-rules block (copied from
   SCOUT); DESIGNER manual step 2 gets the "lettering: in-art" exception; gothic style file gets `status: trial` +
   `lettering: in-art (exception to wordless master)` (index row updated); HARVEST routine "KJV/NIV" → "KJV".
   Backups: `agent.{save,roster}.json.bak-20261126-044623-fixes`, `cron.jobs.json.bak-20261126-044623-harvest-kjv`,
   `webdesigner/styles/{gothic-blackletter-faith,index}.md.bak-20261126-044623`. Verified field by field: only
   `qceditor.docs.context`, `webdesigner.docs.manual`, their roster prompts and the HARVEST prompt changed.
8. Pushed to `feat/harness-backend-station-20261124` (6 commits): `8557798db` Apify 3-per-run cap and `95370d285`
   field notes (both committed 11-25 22:02, pushed 04:32), `eb9e67100` dossier install + chain diagnosis,
   `5ec382504` handoff.md added, `7fe7bd3d1` Fable move, `2acc52622` the 3 fixes (tip).
9. 05:00 read-only re-check (all PASS) and 05:20 docs correction (CLAUDE.md, field notes, this file, etsy-rules
   skill, Claude memory, starmem pins) — committed locally, NOT pushed. Backups `*.bak-20261126-docs`.

## Verify results
- 04:17 and again 04:24: 10/10 PASS — new identity line in roster prompt and save docs; Etsy/Studio rule blocks fully
  expanded (no `[[...]]`); "NIV" only as "never NIV" / "never published"; no old blocker lines; roster prompt equals
  the install; `doc.agent` matches its roster entry; integrity CONSISTENT; backups present at the sizes above.
- No GET route returns roster prompt text (`/api/runtime/agent` = id/name/model/provider). Check `agent.roster.json`.

## Last night's failure (03:00 chain)
QC_EDITOR (openai gpt-5) hit `provider_stream timeout` ×4 plus every fallback → `fetch failed (ERR_HTTP2_STREAM_ERROR)`.
Cron counted the run failed and re-ran the whole chain at 03:20 / 03:28 / 03:32 (gemini rate_limit, OpenRouter
timeouts). Providers answer normally since. Cause [Likely]: transient provider/network failure, not configuration.

## Chain-retry fix LIVE — 2026-11-26 12:12 PST (owner's yes)
Patch applied to `sidecar/cron-driver.js` (backup `sidecar/cron-driver.js.orig`, uncommitted); `node --check` OK; replay:
old `failed`, patched `ok`. Restarted with the clean-env recipe (CLAUDE.md), `.spend-pending/` 0 before and after.
Now: launcher 12468, sidecar **12486** (replaces 29630), health ok, buildSha `b82cc582d` dirty, no shim/CLAUDE vars, no new
log errors; all 11 routines byte-identical to the pre-restart snapshot (only the chain on, Mon 03:00 LA, $2, next 11-30).
A worker error no longer re-fires the chain. Undo: restore `.orig` and restart the same way.

## Chain 03:00 failure — ROOT CAUSE FOUND 09:35 (fix now LIVE, see above)
`sidecar/cron-driver.js` `startFire` sink sets `state.errMsg` on ANY `agent.run.error` in the stream — including a
dispatched WORKER's (different runId). 11-26: QC_EDITOR workers `ea12470a`/`82175bd8` died on `ERR_HTTP2_STREAM_ERROR`;
the lead `a9c37d84` ended `done`, yet cron recorded `failed` + transient → 3 auto-retries (03:20/03:28/03:32, maxRetries 3,
90 s backoff — station-wide, no per-routine knob). Patch (ignore error/capdenied/run.end events whose runId ≠ the lead's):
`~/.local/share/StarNet/chainfix-20261126/cron-driver.patch`; `node --check` OK on a copy; replay of the real 11-26
events: live code → `failed`, patched → `ok`. Not applied to the repo (would only take effect after a restart). Chain
error state cleared via `POST /api/cron/update {patch:{enabled:true}}` (resumeJob: state scheduled, failures 0, next
11-30 03:00; runs.jsonl unchanged — nothing ran). Backup `cron.jobs.json.bak-20261126-chainfix`. ~~Until the patch is
live, a worker error on Monday re-fires the chain up to 3× (≤ ~$4 each, ≤ ~$16, under the $25 rail).~~ [Live 12:12 PST.]

## Open owner decisions (05:20)
1. ~~**Per-run spend caps.**~~ **DONE 05:45 (owner's yes):** chain `ebc4f07d` $0.50 → $2.00; SCOUT, HARVEST,
   Quality Gate, Concept Queue, Print Kit $0.25 → $1.00, via `POST /api/cron/update` and read back. Backup
   `cron.jobs.json.bak-20261126-caps`; undo = same patch with 0.5 / 0.25. The chain cap does NOT count worker spend
   (workers: env $1.00 each, $2.00 pool per lead run) — CLAUDE.md item 2b. Was: `maxCostUsd`: SCOUT, HARVEST and the three 11-30 routines $0.25; chain $0.50 — set
   for cheap models. On Fable (~100× gemini-flash-lite) the 11-30 routines likely cost ~$0.20–0.70 and stop on the cap
   [Likely]; the chain's Fable workers may hit $0.50 [Guessing; worker spend vs chain cap not checked]. Raise caps or
   keep cheaper models.
2. ~~**Routine model pins.**~~ **DONE 08:32 (owner's yes):** chain lead → Fable 5.2; SCOUT and HARVEST routines →
   Opus 5.5; 6 agents → Opus 5.5 (see Current state).
3. **OpenRouter $6.32 of $45** (re-read 05:00) — it carries the fallback chain (haiku-5.5, gemini-3-flash-preview,
   gpt-5-mini). Top up or not.
4. **Anthropic balance:** all 10 agents now depend on it; not readable by API — check the console.
5. **approvalMode `full` on 8 of 10** ("AUTHORITY — FULL POWER" block); only PRODUCER and COPYWRITER are `ask`.
6. ~~**Garbled owner-profile lines**~~ **DONE 09:40 (owner's yes, rev 5585):** cd_14, cd_28 rewritten; cd_15/cd_20/cd_21
   now say KJV (they named NIV as the translation — they quoted no verse, so there was no wording to swap); cd_4 now lets
   routines proceed without the owner's tap (money/settings stay owner-only); **cd_12 "i want to talk to commander" left
   as-is (meaning unclear)**. Correction: the block reaches only NIGHT4CHRIST's prompt + `_commander.dossier.json` (cron
   personas), not every agent. Backups `agent.{save,roster}.json` + `_commander.dossier.json` `.bak-20261126-dossierfix`.
   Was: (Commander dossier, `doc.dossier`, in every agent's prompt): garbled `cd_14`
   ("…allows when I so . so do it"), `cd_28` ("…what to work on nextI…"), `cd_12` ("i want to talk to commander");
   NIV lines `cd_15`, `cd_20`, `cd_21` contradict KJV-only; `cd_4` "ask me before making changes" fights unattended work.
7. **Repo is public** (GitHub API 05:00) — make it private? 45 gitleaks findings to review either way. Nothing is
   pushed until this is decided. [08:40: owner said yes to pushing the three docs commits; the privacy question stays open.]
8. **Kling key backup** `~/.claude/settings.json.bak-20261125-pre-kling-removal` (mode 600) still holds the key — delete.
9. `sidecar/cron-orchestrator.js` (live since 11-22, uncommitted, no test).
10. Publish "Verses for Hard Days" by hand; 137 Outbox items pending; never publish the NIV set-of-3.
11. Money: ledger lifetime $139.67 vs $60 ceiling. Security: jail `shell.exec`.
12. Production ARMED since 2026-11-21, unattributed — confirm that is intended.

## Traps
- On the OpenAI wire (chat/completions) gpt-6.x cannot call tools and gpt-5.4/5.5 only with reasoning off; do not
  assign them to tool-using agents. gemini-3.1-pro-preview is 429 (no quota). Without the live price cache
  (`liveprices.cache.json`) gpt-6.x is priced at the $2.5/$10 fallback, understating spend.
- `POST /api/cron/run` is Run Now — it spends money. Use `GET /api/cron` to read routines.
- The browser owns the roster: after any hand edit, the owner must reload StarNet tabs, or an old tab pushes old
  prompts back (save is protected by `_saveRevision`; roster only by timestamp).
- Header is `x-starnet-token` (token in `~/.config/starnet/env`, never print it).
- Never restart by killing node alone; use the `env -i` recipe in CLAUDE.md, and only with the owner's yes.
- Never commit `agent.save.json`, `agent.roster.json`, backups, `.env`/env files or anything with keys.
- `scripts/git-push-safe.mjs` misreports direction; trust `git rev-list --left-right --count`.

## Exact next steps
0. ~~Decide the caps~~ done 05:45 (decision 1).
1. Reload the StarNet tab. Confirm the Commander shows claude-fable-5-2 (no "no model selected").
2. After 09:20: read SCOUT's 09:00 run in `runs.jsonl` (first run on the new dossier + live Apify cap, and first on
   Opus 5.5 — check `usd` against the $1.00 cap).
3. After 11-27 03:30: read the chain run (first on Fable workers); QC_EDITOR should answer "VERDICT: PASS/CHANGES";
   check `usd` per run against the $2.00 lead cap and the $2.00 worker pool.
4. ~~11-30 (Mon) 09:00: the three null/null routines … 12-01 (Tue) 10:00: HARVEST~~ PAUSED 09:30 (owner's yes). The only
   scheduled run is the chain, Mon 11-30 03:00 PST — read it after 03:30.
   [SCOUT's 11-26 09:00 run (step 2) happened before the pause: Opus 5.5, `budget` stop at $0.685 of the $1.00 cap, 6 turns.]
5. Work the owner decisions above only with a yes.

## 2026-11-27 ~01:00 PST — dossier audit vs the Nov 26 plan (read-only; NO edits needed)
Plan = the owner's bundle (`~/.local/share/StarNet/dossier-install-20261126/agent-dossiers-bundle-20261126.txt`, parsed exactly as
its `plan.js`) + `fixes.js` (04:46: QC_EDITOR Etsy-rules block, DESIGNER step-2 in-art exception) + HARVEST's approved 09:30
"routine paused" lines. Compared field by field (identity, purpose, context, manual, skills) in three snapshots: the save after the
09:30 edit (`agent.save.json.bak-20261126-dossierfix`, rev 5584), pre-switch (rev 5603) and LIVE v7 (rev 5641).
- **All 10 match the plan** in all three: 9 byte-equal to bundle+fixes; HARVEST = bundle + the approved 09:30 lines (unchanged since).
  Skills identical in all three. Every live roster prompt starts with the planned identity and carries the planned
  purpose/context/manual block exactly once. Commander's `doc.agent.docs` == NIGHT4CHRIST's.
- **Changed by the switch-over, outside the dossier fields** (v0.15.4's own prompt framing; not reverted): the 8 Full-Access agents'
  authority text now says "inside your project folders" (v0.15.3 reach rule, TRUSTED PROJECT; approvalMode still full); the Studio four
  also get the "What you know about your Commander" block; NIGHT4CHRIST's prompt carries the 2 refreshed Commander-dossier lines
  cd_1/cd_10 (owner accepted 11-26). The 09:40 Commander-dossier fixes (cd_4, cd_14, cd_15, cd_20, cd_21, cd_28) are intact.
  New since the switch: Commander-dossier item **cd_32** ("validates tool availability and research readiness before operation"),
  learned by v0.15.4's background study pass at 22:52 from an old Nov 2 SCOUT test run — not in the plan; left for the owner.
- **Skills withheld (same on 0.12.5 — `REVIEW_ACTORS` rule):** NIGHT4CHRIST `handle-model-provider-failures-gracefully` and SCOUT
  `research-etsy-competitor-pricing-for-digital-products` were written by background-review, so they wait for the Commander's
  approval in ABILITIES ▸ SKILLS. Not changed.
- No file edited, no restart, NIGHT4CHRIST untouched: chain grant fingerprint `…cb99ede2` still matches.

## 2026-11-27 ~09:45 PST — LiteDesignz shop branding: STOPPED by the owner at ~$0.95 (budget ~$1)
- Reuse check: DESIGNER's native-4K master `webdesigner/outbox/quality-test/isaiah-40-31-4k-test.png` (3712x4608, text-free, soft
  watercolor sunrise, two eagles in the sky) suits the 3360x840 banner (full-width 3712x928 band, downscale; top y≈1335 or 1200).
  It has no single-peak-with-sun motif, so the icons needed new art. Fonts for lettering: `webdesigner/fonts/CormorantGaramond-
  {Medium,Italic}.ttf` + `OFL.txt`. KJV text checked in `agent/tools/data/verses_kjv.json` (Isaiah 40:31, Philippians 4:13).
- Made (DESIGNER run `9e8adf95`, Fable, interactive, cancelled by Claude's spend watchdog at $0.77): `outbox/litedesignz/icon-art-v1.png`
  and `icon-art-v2.png` (1024x1024, one peak + sun, centred — good) — **in the Outbox** (manifest 232 -> 234). An earlier attempt
  (`17184e68`, $0.05) ran without tools. Not made: banners, 500x500 icons, QC, fonts/licence record, PUBLISHER's text drafts.
- **Findings (fix before the next try):**
  1. `/api/run` attaches tools only with `isTask: true` in the body (the page sends it); without it the agent answers "no tools".
  2. v0.15.4's shell fence refuses a command containing backslashes as "drive-root paths (\…)" — a Python heredoc with `\n` trips it.
     Have the agent `fs_write` the script, then `shell_exec` `python3 <file>`.
  3. **Outbox gap:** v0.15.4's run-end registration (`sidecar/artifacts.js`) records only fs.write/append/edit/patch and image_generate —
     NOT shell outputs and NOT image_print_prep / mockup_compose / vector_export / openai_image_generate outputs (0.12.5 had the same
     list; the existing kit rows were back-filled by hand, runId "pre-existing-kit"). Monday's chain outputs made that way won't show in
     the Outbox on their own.
  4. image_generate cost is booked `unpriced` (≈$0.067/image on OpenRouter, not in StarNet's books).
  5. Cost shape: each DESIGNER Fable turn re-reads ~41–46k tokens ($0.44 uncached first turn, ~$0.16–0.18 cached after).
- Briefs + watchdog runner: session scratchpad `litedesignz/` (brief-designer.md, run-agent.mjs). Nothing published; no model, cap,
  routine or dossier changed; 0 receipts.

## 2026-11-27 ~10:30 PST — LiteDesignz shop branding DONE (draft; nothing published) — $1.47 of the owner's $2
- Style per owner: light, NOT watercolor — cream paper, blush rose corners, gold flourish frame, soft cloud wash. Built by DESIGNER
  (run `6442f7ee`, Fable, task run, $1.40 — stopped by Claude's watchdog after its script ran; first turn $1.11 = 17k output tokens) from
  the station's own art only: `refs/litedesignz/` (COPIES of agent/outbox title-floral-1080p, cover-art-A/B, faith-journal-cover-twilight)
  + its own Rooted & Reflecting cover and the Isaiah 40:31 / Philippians 4:13 4x5 prints. No new AI images, no Higgsfield (owner chose
  to skip: StarNet's higgsfield.generate is text-to-image only and unpriced). Script: `webdesigner/scripts/build_litedesignz.py`.
- Files (webdesigner/outbox/litedesignz/): banner-3360x840-v1.png (brand), banner-3360x840-v2.png (features Isaiah 40:31, Rooted &
  Reflecting, Philippians 4:13), icon-500x500-v1.png (rose in gold ring), icon-500x500-v2.png ("LD" monogram + rose sprig).
  image_quality_check code (run locally by Claude, free): 4/4 PASS. Fonts: Cormorant Garamond Medium/Italic (SIL OFL, webdesigner/fonts).
  The fonts-and-licences record and the agent-side QC step were not reached (watchdog stop) — facts are here instead.
- Text: PUBLISHER (run `52d670a3`, Fable, tool-free, $0.07) -> saved VERBATIM by Claude to publisher/outbox/litedesignz/shop-text-drafts.md.
  Checked by code: title 50 chars; Philippians 4:13 quoted exactly with (KJV); no reviews/sales/"prints only"/non-KJV.
- Outbox: all 5 registered BY HAND with deliverable-manifest.register() under the producing agent's real runId (owner's instruction;
  the run-end collector misses shell outputs and a stopped run registers nothing). Manifest 234 -> 239 (backup
  `.deliverables/manifest.jsonl.bak-20261127-litedesignz`); live /api/outbox lists 7 litedesignz rows (incl. the older icon-art-v1/v2,
  which the owner said to ignore). All unverified / not_reviewed / pending approval.
- Cost lesson: a tool-free run for pure writing costs ~$0.07 on Fable; a task run pays ~42k tokens of tool definitions per turn.
- **Visibility fix (2026-11-27 ~11:00, $0, no agent turns):** the owner's "Outbox" door is MY WORK ▸ DELIVERABLES (the Library,
  `/api/deliverables`), not CENTRAL OUTBOX (`/api/outbox`). The Library builds cards from each run's own artifact list, so it showed only
  `build_litedesignz.py` (stopped run) and no images. Fixed with the station's free route `POST /api/deliverables/register`: byte-identical
  COPIES in `webdesigner/workshop/6442f7ee-…/litedesignz/` (4 PNGs) and `publisher/workshop/52d670a3-…/litedesignz/shop-text-drafts.md`,
  5 rows `litedesignz-*`, status kept (backups `deliverables.library.jsonl.bak-20261127-litedesignz`, `deliverables.store.bak-…`). Read back:
  Library rows 1–5 of 250, image previews; `/api/file` with a page-style file ticket (no token header) returns each file byte-identical at
  full size. CENTRAL OUTBOX already had them (rows 138–144 of 144, oldest-first — filter Project = litedesignz); `/api/artifact` with an
  artifact ticket returns each byte-identical. Originals in `outbox/litedesignz/` unchanged.
- **Icon v3 (2026-11-27 ~10:45, owner's request; $0 StarNet, 4 Higgsfield credits from the owner's Plus wallet via the Higgsfield
  connector in the Claude session):** text-free base = Higgsfield gpt_image_2_6 (2K, high, 2 credits; reference = our cover-art-B, uploaded
  to Higgsfield) job 33a0bd39; Higgsfield 4K upscale (bytedance, 2 credits) job a05ad363 — slightly smooths paper grain/petal lines,
  invisible at 500 px; "LD" + gold rule lettered by Claude Code (`webdesigner/workshop/claude-code-litedesignz-icon-v3/letter_icon_v3.py`,
  Cormorant Garamond Medium, OFL). Output `webdesigner/outbox/litedesignz/icon-500x500-v3.png` (500x500, 407,938 B, QC pass); v2 kept.
  Registered in CENTRAL OUTBOX (manifest; runId `claude-code-litedesignz-icon-v3` — not an agent run) and DELIVERABLES (card
  `litedesignz-icon-500x500-v3`, position 1); page-style ticketed fetch returns it byte-identical in both. Sources (2K base, 4K upscale)
  kept in that workshop folder. Note: the owner named faith-journal-cover-twilight as the look, but its listed features matched cover-art-B
  (twilight is a dark night sky) — the listed features were followed.
- **Owner-picked Higgsfield redo (2026-11-28, $0 StarNet; Higgsfield work done by the owner, 8 credits; Claude only downloaded):** sources in
  `webdesigner/workshop/hf-litedesignz-redo/` (garden original f961bb96 2688x1520; garden widened+4K 98f074fa 5090x2160; peony original
  ed347807; peony widened+4K 85c562e9 5090x2160) + `crop_redo.py`. New files in `webdesigner/outbox/litedesignz/` (older versions kept):
  banner-3360x840-v3.png (garden, full-width 4:1 band, bottom-aligned y 888-2160 -> 3360x840), banner-3360x840-v4.png (peony, same band),
  icon-500x500-v4.png (garden original crop (0,560)-(700,1260): two big pink roses + hydrangeas, circle-safe), icon-500x500-v5.png (peony
  original crop (0,700)-(820,1520)). No text. All downscales. QC 4/4. Registered in CENTRAL OUTBOX (manifest, runId `hf-litedesignz-redo`) and
  DELIVERABLES (cards `litedesignz-…-v3/-v4/-v5`, positions 1–4); page-style ticketed fetch byte-identical in both.
- **Banner v5 (2026-11-28, $0 StarNet, no Higgsfield credits used by Claude):** owner's Higgsfield 21:9 garden image with "LiteDesignz" in gold
  already lettered by Higgsfield (job 9e9c5ccf) -> original saved as `webdesigner/workshop/hf-litedesignz-redo/garden-21x9-litedesignz.png`
  (3840x1648). `webdesigner/outbox/litedesignz/banner-3360x840-v5.png` = full-width 4:1 band y 505–1465 -> 3360x840 (downscale x0.875; code in
  `crop_redo.py`). Checked by eye at 1:1: spelling exactly "LiteDesignz" (capital L and D, one word) plus a gold infinity-knot flourish; nothing
  clipped; text+flourish box in the final x1369–2494, y101–420 (margins L1369 T101 R866 B420), inside Etsy's middle 60% (672–2688). Flowers kept:
  cottage + climbing roses + hydrangeas left, hydrangea/rose bush right, delphinium/lavender border; only the bottom 183 px of the source cut.
  No local text added. QC pass. Registered in CENTRAL OUTBOX (manifest) and DELIVERABLES (card `litedesignz-banner-3360x840-v5`, #1);
  page-style fetch byte-identical in both. All older files kept (banner v1–v4 incl. peony v4, icons v1–v5).
- **Shop text v2 (2026-11-28, $0.08 — owner chose PUBLISHER on its own Fable model over a free model):** PUBLISHER run `7e2f6ed2`, tool-free,
  rewrote the Nov 27 drafts for the garden/keepsake look; saved VERBATIM as `publisher/outbox/litedesignz/shop-text-drafts-v2.md` (1,612 B).
  Note: the Nov 27 drafts live in publisher/outbox (not webdesigner/outbox) and had no section names — v2 adds 4 suggested sections.
  Checked by code: title 52/55, About headline 48, sections 14–20/24, no KJV/scripture/verse/watercolor/mountain/journal/slideshow/Christmas/
  "Garden of Memories"/availability or review claims. Registered in CENTRAL OUTBOX (manifest) and DELIVERABLES (card `litedesignz-shop-text-drafts-v2`, #1);
  page-style fetch byte-identical. Nov 27 drafts unchanged (sha256 fc3c62ec…). Nothing published.
- **Seasonal slideshow backgrounds (2026-11-28, $0 StarNet, no Higgsfield credits used by Claude — downloads only):** the owner's Higgsfield jobs
  spring e3dad384 (white chapel), summer 9b7a4dac (Victorian greenhouse), fall 7fb36942 (stone cottage), winter afc2536c (gazebo with lights),
  each 4096x2323. Originals in `webdesigner/workshop/hf-litedesignz-seasons/{season}-original.png`; crops in
  `webdesigner/outbox/litedesignz/seasons/bg-{season}-3840x2160.png` = centred 16:9 crop (0,9)-(4096,2313), Lanczos down to 3840x2160
  (`crop_seasons.py`). Only 9 px top / 10 px bottom trimmed; no building top or flower cut. QC 4/4. All 8 (4 crops + 4 originals) registered as
  "LiteDesignz seasonal slideshow backgrounds" in CENTRAL OUTBOX (manifest, project litedesignz, runId `hf-litedesignz-seasons`) and DELIVERABLES
  (cards `litedesignz-season-*`, positions 1–8; crops via byte-identical copies in the workshop folder); page-style fetch byte-identical in both.
  Backups `manifest.jsonl.bak-20261128-seasons`, `deliverables.library.jsonl.bak-20261128-seasons`. Nothing published. (The first attempt stopped at
  the usage limit before saving anything.)
- **Slideshow backgrounds sets 2 + 3 (2026-11-28, $0 StarNet, downloads only — owner's Higgsfield jobs):** same rule as the seasons set
  (centred 16:9 crop (0,9)-(4096,2313) of 4096x2323, Lanczos -> 3840x2160; `workshop/hf-litedesignz-seasons/crop_set2.py`).
  Set 2: pastel-farmhouse, pastel-footbridge, sunflower-barn, sunflower-lighthouse, carnation-church, carnation-windmill, dahlia-thatched-cottage,
  dahlia-brick-manor. Set 3: spring-tudor-cottage, spring-wisteria-pergola, summer-tuscan-villa, summer-columned-house, fall-log-cabin,
  fall-water-mill, winter-chalet, winter-red-cottage. Originals `workshop/hf-litedesignz-seasons/<name>-original.png`; crops
  `outbox/litedesignz/seasons/bg-<name>-3840x2160.png`. No building top or flower cut by the 9/10 px trim (two roofs/pergola already ran off the
  originals' top). QC 16/16. All 32 files registered as "LiteDesignz seasonal slideshow backgrounds" in CENTRAL OUTBOX (project litedesignz,
  runId hf-litedesignz-seasons; rows 159 -> 191) and DELIVERABLES (cards litedesignz-season-*; 264 -> 296); every file page-style fetched
  byte-identical in both. Backups `*.bak-20261128-set2`, `*.bak-20261128-set3`. Nothing published.
- **New house style (2026-11-28):** `webdesigner/styles/litedesignz-garden-of-memories.md` (active, MAIN for LiteDesignz) + index row and
  LiteDesignz default line (backup `index.md.bak-20261128-garden`). Style files only; no dossier, model, cap or routine changed (NIGHT4CHRIST
  untouched, chain grant safe). Register/verify helpers copied to `workshop/hf-litedesignz-seasons/`.
- ~~OPEN (stopped at usage limit)~~ DONE later on 2026-11-28: notes refreshed, briefs copied to `docs/litedesignz/`, flagship note added
  (see CURRENT STATE at the top). The whole session scratchpad is archived (NOT in git) at `~/starnet-next-work/scratch-c2fcd585-20261128/`.

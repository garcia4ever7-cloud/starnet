# StarNet handoff — read this first (updated 2026-11-26 08:40 PST)

Phone station (Termux). Repo `~/starnet` is PUBLIC (GitHub confirmed 05:00) — push only with the owner's yes for that push
(08:40: yes for the three docs commits). Live data: `~/.local/share/StarNet/workspaces/`.
Then read `CLAUDE.md` "Where we left off" and the newest section of `STATION_FIELD_NOTES.md`.

## Current state (checked live 04:29, re-checked 05:00, read-only)
- Sidecar 29630 (health ok, app 200), OmniRoute 29422/29443. Started by the Termux:Boot test reboot at 00:33 PST.
- Cron healthy, not halted. Production ARMED (2026-11-21, unattributed). `.spend-pending/` empty.
- Routines ON (next run): SCOUT daily 09:00 · Etsy pipeline chain 03:00 (11-27) · HARVEST Tue 10:00 (12-01) ·
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
6. **Garbled owner-profile lines** (Commander dossier, `doc.dossier`, in every agent's prompt): garbled `cd_14`
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
4. 11-30 (Mon) 09:00: the three null/null routines run on NIGHT4CHRIST's model (now Fable), $1.00 cap each — check
   for budget stops. 12-01 (Tue) 10:00: HARVEST (now Opus 5.5 pin).
5. Work the owner decisions above only with a yes.

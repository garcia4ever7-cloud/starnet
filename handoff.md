# StarNet handoff — read this first (updated 2026-11-26 04:50 PST)

Phone station (Termux). Repo `~/starnet` is PUBLIC. Live data: `~/.local/share/StarNet/workspaces/`.
Then read `CLAUDE.md` "Where we left off" and the newest section of `STATION_FIELD_NOTES.md`.

## Current state (checked live 04:29, read-only)
- Sidecar 29630 (health ok, app 200), OmniRoute 29422/29443. Started by the Termux:Boot test reboot at 00:33 PST.
- Cron healthy, not halted. Production ARMED (2026-11-21, unattributed). `.spend-pending/` empty.
- Routines ON (next run): SCOUT daily 09:00 · Etsy pipeline chain 03:00 (11-27) · HARVEST Tue 10:00 (12-01) ·
  Quality Gate Draft, Scripture Art Concept Queue, Print Kit Readiness Plan (11-30 09:00).
- Agent config: integrity CONSISTENT, `agent.save.json` `_saveRevision` 5577.
- **Models (04:42): all 10 agents on `anthropic/claude-fable-5-2`** (was: NIGHT4CHRIST empty, 7× openai gpt-5,
  PUBLISHER gemini-3.5-flash, SCOUT gemini-flash-lite). Backups `agent.{save,roster}.json.bak-20261126-044208-models`;
  undo `node scripts/station-models.mjs revert`. Details and the measured model limits: CLAUDE.md item 1.
- Git: branch `feat/harness-backend`, pushed to `origin/feat/harness-backend-station-20261124`. Always push explicitly
  to that branch (`git push origin HEAD:refs/heads/feat/harness-backend-station-20261124`); never force; never push
  `origin/feat/harness-backend` (it diverged, 5,382 remote-only commits).

## Done today (2026-11-26)
1. 00:33: Termux:Boot crash recovery tested — reboot brought StarNet up on its own.
2. Read-only dossier audit (blockers: SCOUT ask-before-scraping, NIGHT4CHRIST NIV reels, status words never set).
3. 04:17: the owner's 18-part dossier bundle installed for all 10 agents — docs only, both files, rev 5574 → 5575,
   full-roster POST. Backups (workspaces dir, never commit): `agent.save.json.bak-20261126-041644` (1,088,103 B),
   `agent.roster.json.bak-20261126-041644` (150,760 B), `webdesigner/styles.bak-20261126-041644/`.
   Bundle text + dry-run/apply scripts kept privately at `~/.local/share/StarNet/dossier-install-20261126/`.
4. Style library: `webdesigner/styles/index.md` rewritten (2 styles: soft-watercolor-sunrise active,
   gothic-blackletter-faith trial). Existing style files untouched.
6. 04:42: all 10 agents moved to claude-fable-5-2 (rev 5576).
7. 04:46: three owner-approved fixes (rev 5577): QC_EDITOR context gets the shared Etsy-rules block (copied from
   SCOUT); DESIGNER manual step 2 gets the "lettering: in-art" exception; gothic style file gets `status: trial` +
   `lettering: in-art (exception to wordless master)` (index row updated); HARVEST routine "KJV/NIV" → "KJV".
   Backups: `agent.{save,roster}.json.bak-20261126-044623-fixes`, `cron.jobs.json.bak-20261126-044623-harvest-kjv`,
   `webdesigner/styles/{gothic-blackletter-faith,index}.md.bak-20261126-044623`. Verified field by field: only
   `qceditor.docs.context`, `webdesigner.docs.manual`, their roster prompts and the HARVEST prompt changed.
5. Diagnosis of the 03:00 chain failure (below). Docs refreshed; commits `8557798db`, `95370d285`, `eb9e67100` pushed.

## Verify results
- 04:17 and again 04:24: 10/10 PASS — new identity line in roster prompt and save docs; Etsy/Studio rule blocks fully
  expanded (no `[[...]]`); "NIV" only as "never NIV" / "never published"; no old blocker lines; roster prompt equals
  the install; `doc.agent` matches its roster entry; integrity CONSISTENT; backups present at the sizes above.
- No GET route returns roster prompt text (`/api/runtime/agent` = id/name/model/provider). Check `agent.roster.json`.

## Last night's failure (03:00 chain)
QC_EDITOR (openai gpt-5) hit `provider_stream timeout` ×4 plus every fallback → `fetch failed (ERR_HTTP2_STREAM_ERROR)`.
Cron counted the run failed and re-ran the whole chain at 03:20 / 03:28 / 03:32 (gemini rate_limit, OpenRouter
timeouts). Providers answer normally since. Cause [Likely]: transient provider/network failure, not configuration.

## Open owner decisions
1. Routine model pins (chain lead gemini-3-flash-preview; SCOUT and HARVEST gemini-flash-lite-latest) — proposed
   claude-fable-5-2; needs a yes. Top up OpenRouter ($6.32 left) — it carries the fallback chain. Check the
   Anthropic balance in its console (not readable by API).
2. ~~Gothic vs wordless master~~ and 3. ~~QC_EDITOR Etsy block~~ — fixed 04:46 (see Done #7).
4. `sidecar/cron-orchestrator.js` (live since 11-22, uncommitted, no test).
5. 8 of 10 agents on approvalMode `full` ("AUTHORITY — FULL POWER" block).
6. ~~HARVEST routine "KJV/NIV"~~ — fixed 04:46.
7. Publish "Verses for Hard Days" by hand; 137 Outbox items pending; never publish the NIV set-of-3.
8. Money: ledger lifetime $139.67 vs $60 ceiling. Security: jail `shell.exec`, 45 gitleaks findings, delete the
   Kling-key settings backup in `~/.claude/`.

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
1. Reload the StarNet tab. Confirm the Commander shows claude-fable-5-2 (no "no model selected").
2. After 09:20: read SCOUT's 09:00 run in `runs.jsonl` (first run on the new dossier + live Apify cap).
3. After 11-27 03:30: read the chain run (first on Fable workers); QC_EDITOR should answer "VERDICT: PASS/CHANGES";
   check `usd` per run against the estimate.
4. 11-30 09:00: the three null/null routines run on NIGHT4CHRIST's model (now Fable) — check they succeed.
5. Work the owner decisions above only with a yes.

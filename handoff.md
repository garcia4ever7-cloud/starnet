# StarNet handoff — read this first (updated 2026-11-26 04:40 PST)

Phone station (Termux). Repo `~/starnet` is PUBLIC. Live data: `~/.local/share/StarNet/workspaces/`.
Then read `CLAUDE.md` "Where we left off" and the newest section of `STATION_FIELD_NOTES.md`.

## Current state (checked live 04:29, read-only)
- Sidecar 29630 (health ok, app 200), OmniRoute 29422/29443. Started by the Termux:Boot test reboot at 00:33 PST.
- Cron healthy, not halted. Production ARMED (2026-11-21, unattributed). `.spend-pending/` empty.
- Routines ON (next run): SCOUT daily 09:00 · Etsy pipeline chain 03:00 (11-27) · HARVEST Tue 10:00 (12-01) ·
  Quality Gate Draft, Scripture Art Concept Queue, Print Kit Readiness Plan (11-30 09:00).
- Agent config: integrity CONSISTENT, `agent.save.json` `_saveRevision` 5575.
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
1. NIGHT4CHRIST has NO model (app: "no model selected for OPENAI") — breaks chat and the three 11-30 routines.
   (Being handled 2026-11-26 in the "best models" task — see CLAUDE.md for the outcome.)
2. Gothic style puts lettering in the art vs DESIGNER's "one wordless master image" rule.
3. QC_EDITOR has no Etsy-rules block (installed as sent).
4. `sidecar/cron-orchestrator.js` (live since 11-22, uncommitted, no test).
5. 8 of 10 agents on approvalMode `full` ("AUTHORITY — FULL POWER" block).
6. HARVEST routine says "KJV/NIV"; routine text edits are the owner's.
7. Publish "Verses for Hard Days" by hand; 137 Outbox items pending; never publish the NIV set-of-3.
8. Money: ledger lifetime $139.67 vs $60 ceiling. Security: jail `shell.exec`, 45 gitleaks findings, delete the
   Kling-key settings backup in `~/.claude/`.

## Traps
- `POST /api/cron/run` is Run Now — it spends money. Use `GET /api/cron` to read routines.
- The browser owns the roster: after any hand edit, the owner must reload StarNet tabs, or an old tab pushes old
  prompts back (save is protected by `_saveRevision`; roster only by timestamp).
- Header is `x-starnet-token` (token in `~/.config/starnet/env`, never print it).
- Never restart by killing node alone; use the `env -i` recipe in CLAUDE.md, and only with the owner's yes.
- Never commit `agent.save.json`, `agent.roster.json`, backups, `.env`/env files or anything with keys.
- `scripts/git-push-safe.mjs` misreports direction; trust `git rev-list --left-right --count`.

## Exact next steps
1. Reload the StarNet tab. Check NIGHT4CHRIST has a model.
2. After 09:20: read SCOUT's 09:00 run in `runs.jsonl` (first run on the new dossier + live Apify cap).
3. After 11-27 03:30: read the chain run; QC_EDITOR should answer "VERDICT: PASS/CHANGES".
4. Before 11-30 09:00: confirm the three null/null routines will have a model.
5. Work the owner decisions above only with a yes.

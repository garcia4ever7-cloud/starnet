# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
npm run test:fast              # the merge gate — ~364 steps from test/fast.list via scripts/run-fast-tests.mjs
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
node scripts/agent-config-integrity.mjs  # save vs roster CONTENT agreement (read-only; exit 0 consistent, 1 divergent)
```

There is no general linter/formatter (`lint:evidence-secrets` only scans QA evidence docs for leaked secrets, it is not a code linter). Tests are plain Node scripts, not a framework — `node test/foo.test.js` runs independently of the gate.

`engines` says `>=18`, but use **Node 22** — it matches CI and the release train. `test:fast` is the merge gate for everything; additionally run `test:http` whenever you touch routes, streaming, persistence, providers, tools, schedules, or channels.

For the file-by-file layout (`sidecar/`, `frontend/app/`, `shared/`, `test/`, `qa/`), read `CODE_MAP.md` first — it is kept current and this file does not duplicate it. `docs/BRAIN.md` is the designated 5-minute orientation. `sidecar/index.js` is ~17k lines and the file most merges conflict in — reference it by symbol or by a literal string to grep for, never by line number, which drifts within days.

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
- **Standing spend policy**: $60 business capital ceiling, separate $40 development allowance, $0 default new spend, max 8 Apify runs/day including failures. No purchases, publishes, credential/budget changes, or destructive git ops without explicit owner approval.
- **The working tree is intentional; back up before editing.** Before changing an existing file, make a same-directory backup — `cp path/to/file path/to/file.bak` — unless that exact backup already exists; never overwrite a useful one. The stray `.bak` files already in the tree are deliberate, not litter. This station runs on Android/Termux with phone-only workflows and carries intentional platform-specific fixes, so prefer small reversible changes and avoid `reset`, `clean`, `checkout`, `stash`, bulk reinstalls, or dependency sweeps. `CLAUDE_CODE_ETSY_PROJECT.md` (untracked, repo root) holds the full owner brief.
- **The `skill.view` toolset gap above is fixed** (2026-10-15): a `notebook`-type object (`gigs_servercart`) was placed in SCOUT's resolved capability room. Verified by one real cron run: the `skill.view` error is gone.
- **First real product**: "Verses for Hard Days" (`workspaces/agent/verses-for-hard-days/`) — 10 KJV scripture printable pages plus competitor pricing research and a full listing draft with per-sale profit calculation. Status: `approved-to-publish` (owner-approved, not yet published — no Etsy API exists).
- **2026-10-20: two new STUDIO tools shipped** (`image_stock_fetch` — CC0/public-domain source imagery with a licence record per asset; `vector_export` — SVG → 300-PPI PNG + hand-written PDF) and `image_quality_check` was hardened to accept the real argument shapes models actually send. Full detail: `STATION_FIELD_NOTES.md` §4 and §9.
- **Model routing** is switched with `scripts/station-models.mjs`, not by hand. Current assignment and the OpenRouter wallet balance drift fast — check `node scripts/station-models.mjs list` rather than trusting a number written here.

**NEW — 2026-11-19**: Added `100-repo-evaluation` skill in `.claude/skills/100-repo-evaluation/SKILL.md` (three-phase repository evaluation framework, adapted from Nate Herk's "I Tried 100+ Github Repos for Claude").
- **Security-review plugin** (`~/.claude/plugins/cache/claude-plugins-official/security-guidance/2.0.20/hooks/llm.py`): reviews commits via LLM. Requires `ANTHROPIC_API_KEY`; model names `anthropic/claude-opus-5-5` (primary) and `anthropic/claude-sonnet-5-5` (fallback) — unprefixed names fail with HTTP 400. OmniRoute (`localhost:20128`) has no anthropic provider connection configured, so reviews go direct to `api.anthropic.com`. The plugin is NOT restarted by `start-starnet.sh`; restart it manually after env changes.
- **DESIGNER's reusable art-style library** lives in StarNet at `webdesigner/styles/` — see the `etsy-rules` skill's `styles.md`.
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
- **~~The direct Anthropic account has no balance.~~ CORRECTED 2026-10-27 — it is funded and works.** Probed with a real 1-token call to `claude-haiku-5-5`: HTTP 200, `stop_reason: max_tokens`, usage recorded. A full NIGHT4CHRIST run on its roster model `claude-sonnet-5-5` also completed (`reason=done`). So `anthropic` is a usable provider again — but **mind the price**: that one-word run cost **$0.098**, because the station's system prompt + memory recall dominate the input, not the reply. OpenRouter remains the cheaper lane (balance was $5.93 of $35 on 2026-10-27; check `GET https://openrouter.ai/api/v1/credits`). The studio pipeline still reads `STUDIO_PROVIDER` / `STUDIO_MODEL`.
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

**⚠️ Routing drift — check live state, not this file.** The live roster (2026-11-20) has all agents on `codex`/`openai`/`gemini` providers — NOT the `anthropic` primaries this section describes — and `GET /api/fallback/chain` returned `{"chain":[],"saved":true}` (an empty chain was persisted and beats the env default). **Before any session that touches spend or providers, check `node scripts/station-models.mjs list` and `GET /api/fallback/chain`.** This is the fourth recorded instance of model routing drifting out from under the written design.

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

⚠️ After a phone reboot nothing restarts StarNet — install Termux:Boot app; `~/.termux/boot/10-starnet.sh` is written but inert until then.

⚠️ **Never `kill` the node process to restart it** — that is a clean shutdown, so `start-starnet.sh` exits with it instead of reviving it. Kill the launcher too and relaunch detached:

```bash
cd ~ && setsid nohup bash ~/start-starnet.sh >> ~/.local/state/starnet/launcher.out 2>&1 < /dev/null &
```

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
npm run test:fast    # The merge gate — ~364 steps (halts at step 305 on this device on the
                     # pre-existing qa-product-perfect-claims failure; 12 documented pre-existing failures)
npm run test:http    # Live sidecar HTTP/E2E suite (run whenever you touch routes, streaming,
                     # persistence, providers, tools, schedules, or channels)
npm test             # test:fast + test:http
```

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

The Knight video they describe was a **fake placeholder** (1,056 bytes). Trust `CLAUDE.md` and `STATION_FIELD_NOTES.md` over everything else. Also: the old note about the Anthropic console account being empty is **corrected** — it is now funded and responding.

## Production arm/disarm state (current)

Check `~/.local/share/StarNet/workspaces/.production-arm.json` before trusting any armed/disarmed claim. **Production is ARMED** as of `2026-11-21T08:32:28.502Z` (`{"armed":true,"at":"2026-11-21T08:32:28.502Z","by":"unattributed"}`), verified live via `GET /api/production/status`. Arm/disarm with `POST /api/production/arm {"armed":true|false}`. The gate code is intact; only the switch was flipped, so the control remains available. A refusal is deliberately invisible (no `runs.jsonl` row, `consecutiveFailures` stays 0, no cron notification) — if work stops, check this file first.

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
- `sidecar/workspace-owner.js` — Android/Termux stale-lock recovery: when `process.kill(pid, 0)` returns `EPERM`/`EACCES` (permission-blocked, not a liveness answer), `defaultPidAlive` falls back to `fs.accessSync('/proc/<pid>', F_OK)`; ENOENT there proves the holder is dead and the stale lock is reclaimable. This fixed a `WORKSPACE_BUSY` exit-73 that held a dead PID 14644 claim forever. The fix is uncommitted in the working tree.

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Rule 1 — Owner's top goal: StarNet's agents run the Etsy shop on their own with minimal owner
support. Prefer fixes that keep agents working unattended over ones that need the owner to tap or
approve.**

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
npm run dev:seed:keep          # the real dev loop — scratch workspace from dev/fixtures/seed-workspace/, SKYNET_DEV=1, key/model from dev/.env.dev
npm ci                         # install deps (only needed for the desktop shell / dev tooling)
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
```

There is no general linter/formatter (`lint:evidence-secrets` only scans QA evidence docs for leaked secrets, it is not a code linter). Tests are plain Node scripts, not a framework — `node test/foo.test.js` runs independently of the gate.

`engines` says `>=18`, but use **Node 22** — it matches CI and the release train. `test:fast` is the merge gate for everything; additionally run `test:http` whenever you touch routes, streaming, persistence, providers, tools, schedules, or channels.

For the file-by-file layout (`sidecar/`, `frontend/app/`, `shared/`, `test/`, `qa/`), read `CODE_MAP.md` first — it is kept current and this file does not duplicate it. `docs/BRAIN.md` is the designated 5-minute orientation and is the better entry point when you are new to the repo rather than to one file. `sidecar/index.js` is ~17k lines and the file most merges conflict in — reference it by symbol or by a literal string to grep for, never by line number, which drifts within days.

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

**Capability is granted by what's built, not configured per-agent.** `sidecar/capability/registry.js` (`CAP_REGISTRY`) maps station *object types* (`computer`, `notebook`, `cabinet`, `dish`, `workbench`, `connector`, `orchestrator`, `studio`, `jukebox`) to tool grants — e.g. `cabinet` → `fs.read`/`fs.write`/etc. An agent class's `kit` (in `shared/specialties.js`) names which of these *shared station objects* its tools depend on; the kit is never issued per-agent — only a **desk** is a genuine per-agent world object (`workspaces/agent.save.json` → `doc.station.props[]`, `{id, t:'desk', x, y, w, h, agentId}`). A station may already have unowned desks pre-placed in `doc.station.props`; claiming one for a new agent is a matter of setting its `agentId`, not fabricating new geometry — check for one before inventing coordinates.

**No headless path creates a new agent.** `team.summon` (`sidecar/tools/builtin/orchestration.js`) only *requests* a summon — it emits `crew.summon.request` over the run's event stream and blocks on a live browser tab running the real `summonAgent()` (`frontend/app/app.js`) and POSTing `/api/summon/ack`. A cron routine or any other headless caller cannot summon; it can only dispatch to an `agentId` that already exists. Creating a new agent without a live UI session means hand-authoring the `doc.agents[]` entry directly (see above) using an existing agent's record as the field-shape template.

**Two distinct "skill" mechanisms, not one.** Library skills (`sidecar/skills/library/*.md`, global, `default:false`) are referenced by bare slug in an agent's own `skills[]` array and feed its system prompt/tool use — no per-agent copy needed. Custom/runtime skills are created via `POST /api/agent-skills/manage` (`skillStore.manage`, backing `sidecar/skillstore.js`) and are per-agent records. **A cron routine's `skills[]` field only resolves against `skillStore.view(agentId, ref)`** — i.e. only custom/runtime skill records, never bare library slugs — even though the same slug works fine in the agent's own `skills[]`. Attaching a library skill's *behavior* to a routine means either giving the agent that skill in its roster record (it applies to every run regardless of the routine) or creating a custom skill that documents the same procedure.

**Provider credentials resolve from the sidecar process's environment only.** `sidecar/providers/registry.js` reads each provider's key from `process.env` (`keyEnv`, e.g. `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`) — a key "saved" through the browser UI lives in browser localStorage and is **never sent to or read by the sidecar process**. A cron/headless run needs the real key exported into the sidecar's environment before it starts (e.g. sourced by whatever launcher starts `node sidecar/index.js`); there is no API route that makes a UI-saved key usable server-side.

**Everything round-trips through `shared/` event/schema contracts** (`shared/events.js`, `shared/schema.js`) — additive-only, never rename or remove an event or field, since both the sidecar and every frontend module validate against the same frozen shapes.

**A routine's `skills[]` needs `skill.view` in its resolved toolset, or it fails outright.** `sidecar/index.js`, search `"requires saved skills"` — if a routine sets `preloadSkills` (populated from its `skills[]`) but the agent's resolved tool list doesn't include `skill.view`, the run errors with `"This routine requires saved skills, but its per-job toolset/station does not grant skill.view."` before any model call happens. This is a capability-gating gap, not a credential or quota issue — check the agent's `executionProfile`/`enabledToolsets` (not just whether the skill records themselves exist) when a routine with skills attached fails immediately.

**The desktop version is pinned in five places that must agree.** `package.json`, the root entries in `package-lock.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and the `skynet-desktop` entry in `src-tauri/Cargo.lock` (all `0.12.5` today). `npm run release:bump` moves all five together, and release preflight + CI prove their agreement before an artifact is named or tagged — so never hand-edit one of the five.

**There are two unrelated spend limits; don't conflate them.** The *shipped product* has a $25/day **soft** rail on metered runs (`sidecar/budgetcaps.js`, one-click RESUME, editable, `0` = off, off-by-default quotas everywhere else). That is a harness feature affecting all users. It is entirely separate from the **owner's** business/dev spend policy for this particular station, below.

## Read this before touching the live station

**`STATION_FIELD_NOTES.md` (repo root) records what already cost time or money to learn** — the
headless-delegation boundary, the live-runtime paths and API shapes, the image-pipeline traps, which
`test:fast` failures are pre-existing on this device, and current spend. Check it before
re-investigating anything about the running station; it exists specifically so work isn't redone.

**SUPERSEDED 2026-10-27 — a cron lead CAN now delegate.** This file used to say here that
`team.dispatch` is granted only to an interactive browser-commanded run and that no headless path
can delegate. That was true and is no longer: a routine the Commander ticks **`orchestrator`** on
resolves the orchestrator object and clears a new, name-fenced consent tier, so a scheduled
NIGHT4CHRIST hands subtasks to its crew unattended. Verified live, not inferred — see
`STATION_FIELD_NOTES.md` §16 for the event stream, the two gates that had to open together, and
why max delegation depth is 1 structurally.

What still holds: **`GET /api/toolsets` reports the interactive-lead view and will mislead you**;
an UNGRANTED routine still has no `team.dispatch` (this is opt-in per routine, not a blanket
change); and `routine.create`, `routine.manage`, `loop.*`, `team.configure`, `task.manage`,
`team.summon` and `team.spawn` remain human-gated even on a granted routine.

## Current operating state (project-level, not code architecture — updates as the project moves)

This repo doubles as the live runtime for the owner's actual Etsy business, so a few project facts worth knowing before touching agent config:

- **Five agents exist**: NIGHT4CHRIST (Commander, Etsy team), SCOUT (research), DESIGNER (product creation), PUBLISHER (listing drafts), HARVEST (independent peer agent — zero-cost income-opportunity hunting outside Etsy, parked routine, see its `docs.identity` for the full mandate).
- **Standing spend policy**: $60 business capital ceiling, separate $40 development allowance, $0 default new spend, max 8 Apify runs/day including failures. No purchases, publishes, credential/budget changes, or destructive git ops without explicit owner approval.
- **The working tree is intentional; back up before editing.** Before changing an existing file, make a same-directory backup — `cp path/to/file path/to/file.bak` — unless that exact backup already exists; never overwrite a useful one. The stray `.bak` files already in the tree are deliberate, not litter, and are not yours to clean up. This station runs on Android/Termux with phone-only workflows and carries intentional platform-specific fixes, so prefer small reversible changes and avoid `reset`, `clean`, `checkout`, `stash`, bulk reinstalls, or dependency sweeps. `CLAUDE_CODE_ETSY_PROJECT.md` (untracked, repo root) holds the full owner brief for this work.
- **The `skill.view` toolset gap above is fixed** (2026-10-15): a `notebook`-type object (`gigs_servercart`) was placed in SCOUT's resolved capability room (ARCHIVE — SCOUT has no desk, so its room resolves via its bay, see the remote-bay ruling in `frontend/app/worldmodel.js`). Verified by one real cron run: the `skill.view` error is gone.
- **First real product**: "Verses for Hard Days" (`workspaces/agent/verses-for-hard-days/`) — 10 KJV scripture printable pages (PNG/SVG, now with 300 DPI `*-print.png` versions re-rendered via `@napi-rs/canvas`) plus sourced competitor pricing research and a full listing draft with a transparent per-sale profit calculation. Status: `approved-to-publish` (owner-approved, not yet actually published — no Etsy API exists in this station).
- **2026-10-20: two new STUDIO tools shipped** (`image_stock_fetch` — CC0/public-domain source imagery with a licence record per asset; `vector_export` — SVG → 300-PPI PNG + hand-written PDF) and `image_quality_check` was hardened to accept the real argument shapes models actually send. Full detail, reasoning, and what's still open: `STATION_FIELD_NOTES.md` §4 and §9.
- **Model routing is now switched with `scripts/station-models.mjs`**, not by hand. Current assignment and the OpenRouter wallet balance drift fast — check `node scripts/station-models.mjs list` and `STATION_FIELD_NOTES.md` §7 rather than trusting a number written here. `list` also prints the live fallback chain.
- **DESIGNER's reusable art-style library** lives in StarNet at `webdesigner/styles/` — see the `etsy-rules` skill's `styles.md` for where it is and how to add a style.
- **Two scoped side missions are written up but deliberately not started**: jailing `shell.exec`'s filesystem access, and locking NIGHT4CHRIST/HARVEST from Full Access to Ask. See `STATION_FIELD_NOTES.md` §9 "Side missions" before picking either up — plan mode first.
- **2026-10-26: the Christian Story Studio pipeline now runs end to end — but the two "PRODUCTION READY" claims that used to sit here were false and have been removed.** They are preserved in `CLAUDE.md.20261026-*.bak` as a worked example of the failure this file's laws exist to prevent. What was wrong: the orchestration entry claimed "tested and debugged" while four separate defects each stopped the pipeline dead (see `STATION_FIELD_NOTES.md` §13d–g), and the video-delivery entry called `proj-1792964044657-xs9vyt/video.mp4` a *"Real video … No further work needed"* when those 1,056 bytes were a **fabricated placeholder** — the exact artifact the owner later reported as a bug. Both entries cited passing tests as proof. **The tests were green the entire time.**
- **Studio pipeline, actually verified 2026-10-26**: `POST /api/studio/assignment` creates the project and drives all four stages unattended via `runPipelineToCompletion` (returns immediately with a `poll:` URL; a full run far exceeds any HTTP timeout). Agent answers are captured by the orchestrator from the `/api/run` NDJSON stream — agents are **not** asked to write `blueprint.json` themselves. PRODUCER's video is rendered by the *pipeline* (`ensureProducerVideo`) through `sidecar/video-providers.js`, because `video.kling` is consent-gated and a headless run can never call it. Nothing reaches `status:'kept'` without passing `sidecar/video-verify.js`. Live state, remaining gaps and the provider-wallet problem: `STATION_FIELD_NOTES.md` §13.
- **Video delivery works, with one rule that is easy to miss**: `/api/studio-file` rejects any project id not matching `^proj-\d+-[a-z0-9]+$` with a bare `403` **before** checking auth — a hand-named folder is unservable no matter how good the file is. It also takes a scoped 5-minute ticket, not the master token, so a plain `curl` 403 is not evidence of a broken file. Mint one: `require('./sidecar/apitickets.js').mint(API_TOKEN,'studio','studio\\n<projectId>\\n<file>',{now:Date.now()})`.
- **Unattended delegation shipped 2026-10-27 — per routine, name-fenced, depth 1.** A routine with
  `unattendedGrants:['orchestrator']` lets its agent call `team.dispatch` headlessly; the host then writes every
  lead→worker exchange to `workspaces/<leadId>/outbox/<utc-stamp>-<lead>-to-<worker>.md` (`sidecar/handoff-store.js`)
  — the host writes it because an ASK-mode worker cannot `fs.write` on an unattended run and because an agent asked
  to persist its own state demonstrably does not. **CORRECTED 2026-11-02 — the Etsy chain is no longer disabled.**
  The full Etsy chain `ebc4f07d-a26e-4e40-ae4f-01f8a56ea909` was found `enabled:true` during a live pipeline test
  and had already auto-fired on its own schedule that same day, before the test session started — someone armed
  it between 2026-10-27 and 2026-11-02 and this file was never updated. The smoke test
  `ec4436a4-e1a0-432a-be75-3606b843ad51` is still `enabled:false`/`nextRunAt: null`, unchanged.
  Arm/disarm with `POST /api/cron/update {id, enabled:true|false}`; fire once without arming via `POST /api/cron/run {id}`.
  **Always check `GET /api/cron` for the live `enabled`/`nextRunAt` state before trusting this file's claim about
  either routine** — see `STATION_FIELD_NOTES.md` for the live-test writeup.
- **The Apify 8/day cap is now real code, and it meters the MCP connector, not just HTTP.** `sidecar/hostquota.js`
  keeps ONE team-wide daily counter (`workspaces/.host-daily-quota.json`) shared by `mcp:apify` actor-run tools and
  direct `web_request` to `apify.com`, counted before the call leaves and never decremented (failures cost one).
  Read-only Apify tools are unmetered. Fails CLOSED — deliberately not a `hooks.js` hook, which is fail-open.
- **~~SCOUT's assigned model returns number-stripped text~~ RESOLVED 2026-10-27.** The digit-stripping model
  (`cf/@cf/meta/llama-3.3-70b-instruct-fp8-fast` via omniroute) is gone; SCOUT runs `claude-haiku-5-5` on the
  direct `anthropic` provider and returns intact numbers. Historical detail: `STATION_FIELD_NOTES.md` §16c.
- **Every agent now has an automatic model-rotation chain — paid first, free last.** A run that hits an
  outage, a 429, or an empty wallet rotates to the next provider and finishes instead of dying; a *broken
  request* does not rotate and cannot leak spend onto the next provider. Proven live, both directions.
  See "Model rotation" below and `STATION_FIELD_NOTES.md` §18.

## Hard-won rules (2026-10-26) — read before touching providers, spend, or the live station

Every item here cost real time or money to learn. Full detail: `STATION_FIELD_NOTES.md` §13.

### Never assert a shape you have not seen

This is the root cause of nearly everything below. In one session the Kling request body, the
Higgsfield base URL + auth header + endpoint, the job-status URL, the job-result shape, and
the `/api/runs` response were all **written from assumption and all wrong** — in code that had
been recorded as "production-ready". A header comment saying `TODO: verify` is a warning that
the code has never run, not a formality.

**Probe the live API for free before writing the client**: POST with exactly ONE field
deliberately invalid. Validation rejects the request before anything bills, and the error text
usually quotes the whole allowed enum. Order matters — auth is checked first, then the model,
then fields, then balance — so vary one field while holding an earlier-checked one invalid.
A GET against a non-existent id is also free and answers "does this key authenticate?".

### A passing test is not evidence that anything works

`npm run test:fast` was green through: a hardcoded provider whose account had no credit, a
response stream the code aborted before reading, agents asked to persist state they never
persisted, and a route whose handler and registration disagreed so **no URL could ever reach
it**. Tests assert code against code. Only a live run proves a feature. Never write
"verified"/"production ready" off a green suite — the project law already says this; this
session is what ignoring it looks like.

### Unattended means the sidecar's own environment

A provider key that is not in **`~/.config/starnet/env`** does not exist as far as cron, the
agent loop and the studio pipeline are concerned. Not `.env.local`, not browser localStorage,
not your shell. `start-starnet.sh` does `set -a; . "$ENVFILE"; set +a`, so that file also
**overwrites** anything you exported. Verify what the running process actually holds rather
than assuming: `tr '\0' '\n' < /proc/<pid>/environ | grep -oE '^[A-Z_]+='`.

### Count `.spend-pending` receipts before every restart

Killing the sidecar mid-run orphans a receipt and the ledger then **fail-closes on every
later boot** — the station looks healthy and silently refuses to run any agent
(`UNSETTLED_SPEND`). This has now recurred four times; the fourth was self-inflicted by a
restart during an in-flight run. `ls ~/.local/share/StarNet/workspaces/.spend-pending/*.json`
must be empty first. Recovery shape and backups: `STATION_FIELD_NOTES.md` §13h. An
interrupted run's true cost is unrecoverable — record `usd: 0` and say so; never invent one.

### In-memory state wins over files you edit behind its back

The deliverable store, `agent.save.json`, skills and notebooks are all read at boot or owned
by a live process. Appending to `deliverables.library.jsonl` while the sidecar runs changes
nothing. Use the proper API, or restart (after the receipt check above).

### Editing a module does not change the running station

`require` caches. A fix can test green while the live process keeps failing identically until
it is restarted. Confirm the process is newer than the file before concluding a fix did not work.

### Money

- **Fall through to another provider ONLY on exhausted credit, never on a broken request** —
  otherwise a bug in provider A quietly starts spending on provider B and the real error is
  never seen. Kling `code 1102` / HTTP 402 means empty wallet; `1201` means your request is wrong.
- **Preflight cost where the API offers it** (Higgsfield `get_cost: true` returns credits and
  submits nothing). Cheapest known real video: Higgsfield `seedance_2_0_mini`, 720p/5s/9:16,
  **5 credits**; 480p/4s is 2.
- **Higgsfield has two wallets.** The MCP tools spend the owner's Plus credits; the platform
  REST API (`platform.higgsfield.ai`, what StarNet uses) does **not** — its usage appears in no
  balance or ledger visible here. Treat REST usage as spend of unknown size against an account
  this station cannot read.
- **~~The direct Anthropic account has no balance.~~ CORRECTED 2026-10-27 — it is funded and works.**
  Probed with a real 1-token call to `claude-haiku-5-5`: HTTP 200, `stop_reason: max_tokens`, usage
  recorded. A full NIGHT4CHRIST run on its roster model `claude-sonnet-5-5` also completed
  (`reason=done`). So `anthropic` is a usable provider again — but **mind the price**: that one-word
  run cost **$0.098**, because the station's system prompt + memory recall dominate the input, not
  the reply. OpenRouter remains the cheaper lane (balance was $5.93 of $35 on 2026-10-27; check
  `GET https://openrouter.ai/api/v1/credits`). The studio pipeline still reads `STUDIO_PROVIDER` /
  `STUDIO_MODEL`.
- **OpenRouter cannot generate video at all** — 0 of 466 models output video.

### When work "times out" with empty output, check whether anything was listening

Four stages reported 300s timeouts while the agents were succeeding every time: the collector
aborted the response stream on its first event and then polled a file the model was never
going to write. Suspect the collector before the worker.

## OmniRoute — the free brain (2026-10-26). Read before switching any agent to a free model.

Full detail: `STATION_FIELD_NOTES.md` §14 and §14a.

### CORRECTION 2026-10-27 — this is a StarNet bug, NOT a free-model limitation

**The section below blamed free models for not emitting tool calls. That was wrong.**
`claude-sonnet-5-5` on the DIRECT `anthropic` provider fails identically on the same path:

```
POST /api/run  agentId=agent  surface=autonomous  provider=anthropic  model=claude-sonnet-5-5
  -> tool_call: 0, tool_result: 0, end: done, usd: 0.0037
  -> reply text: <invoke name="web_search"><parameter name="query">…</parameter></invoke>
```

A top-tier paid model emitting Anthropic's text-invoke syntax **as prose** means the tools are
not reaching the model as a real `tools` parameter (or the response is not parsed back). The
same prompt through the `omniroute` (openai-compatible) adapter DID fire real `agent.tool_call`
events — 6 of them — so the fault is specific to the **anthropic adapter on the headless
`/api/run` path**, not to model quality or to OmniRoute. `[Likely]` — two adapters compared,
root cause in the adapter not yet read.

**Consequence:** do not conclude "free models can't tool-call" from this path, and do not trust
a `done` + non-zero `usd` as evidence work happened. Check `agent.tool_call` / `agent.tool_result`
events every time.

**Also on this path:** a bare `/api/run` does NOT use the agent's roster model — it defaults to
OPENROUTER and errors `no model selected — pick a model for OPENROUTER first`. Pass
`provider` + `model` explicitly, as `cron-orchestrator.js` does.

### The original finding — NOW FULLY RETRACTED (2026-10-27)

**This was a StarNet bug, not a free-model limitation. Free models DO emit real tool calls.**
Six free models each passed a real `POST /api/run` under the full agent prompt and 8 toolsets,
with both `agent.tool_call` and `agent.tool_result` present, at $0 — see
`STATION_FIELD_NOTES.md` §18a for the table. The cause was §15's `savedPlacement()` bug handing
every headless run **zero tools**; a model told about tools it was never given improvises the
syntax as prose. Four free models are now the tail of the live fallback chain. The claim below is
kept only to show what that bug looked like from the outside — **do not act on it.**

~~**Free models route through `cloude-free` and cost $0, but they do NOT emit structured tool
calls inside StarNet's agent loop.**~~ Verified on live headless SCOUT runs: `agent.run.start`
reports `model: cloude-free`, `usd: 0`, run ends `done` — and `tool_calls` is empty, because
the model writes tool syntax as **prose** instead:

```
<call tool="station_inspect" arguments="{}" />
<scout.station_inspect />
```

StarNet executes nothing, so the run **reports success having done no work** — the same
failure class as the fabricated video. The identical model via the DIRECT `openrouter`
provider fails the same way, so this is the models under a full agent prompt, not OmniRoute.

**So (CORRECTED):** free models are safe for unattended tool-using agents — they tool-call
fine now that tools actually reach them. What is *not* safe is routing agents **through the
`cloude-free` combo**, for a different reason: OmniRoute reports the model as `cloude-free`
with no resolvable price, so `agent.cost` books **$0** for real work and `budgetcaps.js` goes
blind. That breaks the truthful-telemetry law. Reach free models as **named OpenRouter slugs in
StarNet's own fallback chain** instead — each hop is priced per model and emits an auditable
`provider.fallback` receipt. `free-omni` remains fine for `omni` (Claude Code brings its own
tool harness) and for chat-shaped work.

```bash
node scripts/station-models.mjs restore before-free-omni   # paid/mixed (safe for agents)
node scripts/station-models.mjs restore free-omni          # all agents -> free
node scripts/station-models.mjs list                       # who runs what, live
```

### A single-tool probe passing is NOT evidence a model can drive an agent

Ten models passed a one-tool, one-line probe and then failed completely under StarNet's real
system prompt plus 8 toolsets. **Always validate a candidate with a real `POST /api/run`
against a real agent**, and check `agent.tool_call` / `agent.tool_result` events actually
appear — not just that the run ended `done`. This is behavioural rule 8 applied to models.

### Diagnosing OmniRoute

- **A 401 that returns in single-digit milliseconds is OmniRoute rejecting YOUR client key**,
  not a provider rejecting OmniRoute. The request never left the device. Check first:
  `~/.omniroute/client_api_key.local` must equal `OMNIROUTE_API_KEY` in
  `~/.config/starnet/env` **and** match a key the server stores (`GET /api/keys`). One stale
  file made the router, every provider test, `/v1/models` and every combo look dead at once.
  **The sidecar must be restarted to pick up a key change** — it holds the old value in its
  process env.
- **Termux:** the CLI shebang `#!/usr/bin/env node` cannot work (no `/usr/bin/env`), and
  `$PREFIX/bin/omniroute` must be a **symlink** to
  `$PREFIX/lib/node_modules/omniroute/bin/omniroute.mjs` — as a copy, its relative import
  resolves outside the package.
- **CLI writes fail with "Invalid management token"** even when reads work. Use the
  management API: `POST /api/auth/login {password}` with `~/.omniroute/admin_password.local`
  returns a session cookie good for `/api/providers`, `/api/combos`, `/api/keys`, `/api/models`.
  Provider credential field is **`apiKey`** (not `credential`). Combos are updated by
  `PUT /api/combos/<UUID>` — **by id; the name 404s** — and `strategy` must come from the
  enum (`priority` = ordered fallback; `"fallback"` is rejected).
- **Never print a key, a password, or a combo credential.** Compare by SHA-256 fingerprint.

### cloude-free

10 entries, `priority` strategy, providers alternating so one daily cap cannot stall the
chain, Cloudflare last. Known-bad, do not re-add without re-probing: `gemini/gemini-2.5-flash`
and `-flash-lite` are retired ("no longer available to new users"); `gemini-3.8-flash` and
`gemini-3.7-flash` time out at 90s. `~/start-starnet.sh` now starts OmniRoute first if
`:20128` is not answering.

## Headless-tool wiring fix (2026-10-27)

**Two confirmed root causes fixed:**

1. **savedPlacement() reading wrong location** — ALREADY FIXED in current code
   - Location: `sidecar/capability/saved-placement.js:13`
   - The code correctly handles both envelope shape (`save.doc.station`) and flat shape (`save.station`)
   - Regression test: `test/headless-tools-granted.test.js` verifies both shapes work

2. **isTask = false by default prevented tool schemas** — FIXED
   - Location: `sidecar/index.js:16140` (the `/api/run` handler)
   - Changed: `isTask = false` → `isTask = true`
   - Why: Line 18106 shows the impact: `const toolDefs = isTask ? registry.wireFormat(...) : [];`
   - With `isTask=false`: `toolDefs` was always an empty array — models received zero tools
   - With `isTask=true`: Tool definitions are properly built and sent to the model
   - Result: Headless `/api/run` calls now receive proper tool schemas

**Verification:**
- `test/headless-tools-granted.test.js`: 10 assertions passing, includes regression test for isTask=true
- `test/errorclass.test.js`: 241 assertions passing (no regressions)
- `test/artifacts.test.js`: 34 assertions passing (no regressions)
- Backup created: `sidecar/index.js.bak`

**Impact:** Autonomous/headless agent runs now get tool schemas without accidentally granting tools to unrelated requests (isTask only affects `/api/run`, other paths can still override explicitly).

## Headless DELEGATION + the Apify rail (2026-10-27). Verified live; two owner decisions still open.

Sibling of the headless-tool fix above: tools reaching a headless agent was necessary but not
sufficient — a cron lead still could not hand work to its crew. Full detail, the event stream, and
the measured per-agent tool tables: `STATION_FIELD_NOTES.md` §16.

### Two gates closed on every headless lead, not one

Fixing either alone leaves the chain dead, which is why both are now fed from the SAME durable job
record (an offered tool that consent then refuses is an incoherent state this repo has hit before):

| gate | where | why it closed |
|---|---|---|
| capability | `sidecar/capability/office.js:40` | the `orchestrator` object is added only when `lead` is true, and `lead` is true only for a browser-commanded `/api/run`. No object → `resolveTools` never emits `team.dispatch`, so the model is never told delegation exists. |
| consent | `sidecar/permissions.js` tier 2.5 | `team.dispatch` is scope `'execute'`, so the autonomous **exec lockout** refused it with "silence is not consent" even when the tool WAS present. |

The impact gate was never the problem: `orchestrator` has been in `SAFE_BUILTIN_CAPS` (impact
`none`) all along — delegation spawns no host process and reaches no third party.

### What changed

- `sidecar/inputpolicy.js` — `GRANTABLE_UNATTENDED` += `'orchestrator'`; and `SAFE_BUILTIN_CAPS` +=
  `'deliverable'`, `'taskplan'`, `'routinescratch'` (see the tool-gap note below).
- `sidecar/cron-store.js` — `GRANTABLE` += `'orchestrator'` (storage; the policy re-filters at the gate).
- `sidecar/permissions.js` — new tier **2.45** `dispatchAutonomy`, above the exec lockout, below the
  hardline floor, narrowed by exact TOOL NAME.
- `sidecar/index.js` — grants the orchestrator object when the routine carries it **and**
  `!o.parentRunId`; wires taint-checked `dispatchGrant`; injects `recordHandoff` + `hostQuota`; and
  Run Now now passes `cronJobId`/`cronJobName` like the scheduled fire always did.
- NEW `sidecar/handoff-store.js`, NEW `sidecar/hostquota.js`,
  `sidecar/tools/builtin/orchestration.js`, `sidecar/tools/builtin/web.js`, `sidecar/mcp/translate.js`,
  `sidecar/mcp/manager.js`.
- NEW `test/headless-dispatch.test.js` (102 assertions, in `test/fast.list`).

### Still human-gated on a granted routine — do not "simplify" this to a capability check

`routine.create`, `routine.manage`, `loop.*`, `team.configure`, `task.manage`, `team.summon`,
`team.spawn`. Only `team.dispatch/subagents/steer/interrupt/resume` ride the grant. A
capability-level yes would have handed all of it over at once, which is why tier 2.45 is a NAME
allowlist. An UNGRANTED routine still has no dispatch: this is opt-in per routine, not a blanket change.

### Max delegation depth is 1, structurally — there is no counter to find

A worker is started by `orchestration.js` with no `lead` and no `unattendedGrants`, so it resolves no
orchestrator object and holds no `team.dispatch`: it cannot delegate onward and cannot form a cycle.
The `!o.parentRunId` fence in `index.js` states the invariant where the grant is made, so a future
caller that forwards grants to its children cannot mint a recursive tree. Self-dispatch is refused
inside the tool; an unknown `agentId` is refused, never guessed.

### Handoffs are files, and the HOST writes them

`workspaces/<leadId>/outbox/<utc-stamp>-<lead>-to-<worker>.md`, one per dispatched worker, wrapped
around EVERY `runWorker` outcome. Markdown with a parseable `<!-- starnet-handoff {…} -->` block:
from, to, reason, `complete` (true only for `done`), real usd, lead/worker runIds, cronJobId,
artifact paths, then TASK SENT / CONTEXT SENT / RESULT RETURNED. Two reasons it is not the agent's job:
an agent asked to persist its own state **does not** (the studio pipeline's four phantom 300s
timeouts, §13), and an ASK-mode worker **cannot** `fs.write` unattended at all (`cabinet:write`
default-denies). A failed handoff is written exactly like a successful one and says
`NOT a completed subtask` — a missing file for a worker that ran would be the lie.

### The Apify cap was guarding a door nobody uses

"Max 8 Apify runs/day including failures" had ZERO enforcement — `budgetcaps.js` counts model spend
in USD and cannot see a third-party call, so the cap lived only as prose in a skill. The first
version of the rail metered `web_request`; `GET /api/connectors` says that is the wrong door —
Apify is reached through the **`mcp:apify` connector** (`good-apis--etsy-search-scraper`,
`good-apis--etsy-shop-scraper`). `sidecar/hostquota.js` now meters BOTH, sharing ONE counter
(`workspaces/.host-daily-quota.json`), so eight is eight however the run gets there. Counted before
the call leaves and never decremented; read-only Apify tools are unmetered (blocking those would
strand work already paid for); **fails closed** — deliberately NOT a `sidecar/hooks.js` hook, which
is documented fail-open. Tunable: `STARNET_HOST_DAILY_LIMITS="apify.com=8"`.

### Tool gap was ONE family plus three silently-stripped tools

Measured, not guessed, by replaying the real projection against the live save + roster. Headless
agents were NOT short of station objects. ASK agents 86 → 109 tools with the grant; full-access
108 → 131. Besides `orchestrator`, the find: **`deliverable_note`, `todo` and `routine.notepad` were
stripped from every ASK-mode unattended run** — all three `requiresConsent:false, network:false`
host-local bookkeeping, but their capIds were missing from `SAFE_BUILTIN_CAPS`, so they fell to
`EXTERNAL_UNKNOWN` and `enforceRunAuthority` removed them **before the model saw them**. SCOUT could
not name a deliverable or keep a task list on any cron fire. `channel.send`, `spotify_*` and
`shell.exec` stay refused — the widening is narrow on purpose and `shell.exec` went to nobody new.

Airtable/Apify for an ASK agent's OWN routine is **not** code-fixable and should not be: they are MCP
connector tools, so that routine needs the existing `connectors` tick. The path that already works is
delegation — a worker inherits the lead's `connectorAuthority`, so an agent dispatched by NIGHT4CHRIST
has Apify/Airtable reach it does not have when firing its own routine. (Live-proved 2026-11-02: SCOUT
dispatched by the lead read an Apify dataset fine.)

**CORRECTED 2026-11-02 — SCOUT is NOT an ASK agent.** This paragraph used to say "the two ASK agents
(SCOUT, PUBLISHER)". The live roster (`workspaces/agent.roster.json`) says otherwise, and the only
ASK agent in the Etsy chain is PUBLISHER:

| agent | model | approvalMode |
|---|---|---|
| NIGHT4CHRIST (`agent`) | `claude-sonnet-5-5` | **full** |
| DESIGNER (`webdesigner`) | `claude-sonnet-5-5` | **full** |
| SCOUT (`scout`) | `claude-haiku-5-5` | **full** |
| PUBLISHER (`publisher`) | `claude-haiku-5-5` | **ask** |
| HARVEST (`harvest`) | `claude-haiku-5-5` | **full** |
| QC_EDITOR / DIRECTOR / PRODUCER / COPYWRITER | `opus-5` / `sonnet-5-5` | ask |

Why it matters, and why the error was invisible: the ASK-mode `fs.write` ban is real, but it applies
to **PUBLISHER**, not SCOUT. SCOUT has been saving files unattended all along — `scout-read-*.md`
and `verses-for-hard-days-stage1.md` are its own writes on cron fires — so any session that predicted
"SCOUT cannot persist its research" was reasoning from this line and was wrong. DESIGNER is `full`
too, so artwork is gated by image-generation CREDIT (the `HTTP 429` below), not by permissions.
**Read `approvalMode` out of the live roster before asserting what an agent can persist** — the same
drift rule this file already applies to models and cron `enabled` flags. Whether SCOUT was `ask` when
this was first written and someone later changed it is unknown; what is verified is the table above.

### Test results — state them this way, not as "the gate is green"

`npm run test:fast` **halts at step 305** on the pre-existing `qa-product-perfect-claims` QA-ledger
failure, so the gate cannot go green on this device regardless of the change. All 979 steps were run
individually under the gate's own hermetic per-step profile instead: **12 failing — exactly the 12
documented pre-existing ones** (`STATION_FIELD_NOTES.md` §13, "test:fast on this device"). Zero
regressions, and zero empty catch blocks added (`failopen-ratchet`'s baseline is untouched —
verified by diffing the count against `sidecar/index.js.bak`).

`test/tool-withheld-message.test.js` pinned the literal `['workbench', 'connectors']`, so a
deliberately-modelled third family read as a regression. It now asserts the PROPERTY — the set is
closed and its membership is exactly the three the host models — plus the matching consent tier and
its name fence, so an UNmodelled name still fails loudly.

### OPEN — two owner decisions, and one thing to stop trusting

1. **CORRECTED 2026-11-02 — only ONE of these two routines is still disabled.** This used to say
   both were `enabled:false`/`nextRunAt: null`. A live pipeline test on 2026-11-02 found:
   - Etsy chain `ebc4f07d-a26e-4e40-ae4f-01f8a56ea909` (NIGHT4CHRIST leads SCOUT → DESIGNER → PUBLISHER)
     is **`enabled:true`**, `nextRunAt` set to the next day, and had already auto-fired that same
     morning (2026-11-02T11:09 UTC) before the test session even started — on its own schedule, not
     triggered by anyone's manual action that session. Someone armed it at some point after
     2026-10-27 and this file was never corrected.
   - smoke test `ec4436a4-e1a0-432a-be75-3606b843ad51` is still `enabled:false`/`nextRunAt: null`,
     unchanged.
   Arm/disarm with `POST /api/cron/update {id, enabled:true|false}`; fire once without arming via
   `POST /api/cron/run {id}`. Auth header is `X-StarNet-Token`, **not** `Authorization: Bearer`.
   **Treat this file's enabled/disabled claims as a snapshot, not current truth — check `GET /api/cron`
   first**, the same lesson as the model-routing drift noted elsewhere in this file.
2. **The chain routine has still never been run end to end**, including in its 2026-11-02 auto-fire.
   That run's `team_dispatch` call dispatched to SCOUT (which completed normally) but then itself
   reported `isError:true`/"timeout" after 9 minutes, and the outbox shows only lead→SCOUT handoffs —
   it never reached DESIGNER or PUBLISHER. An earlier dispatch hop is separately live-verified
   (`agent.tool_call team_dispatch` → SCOUT's own loop `done` → host-written handoff file; lead
   $0.0066 on openrouter `anthropic/claude-haiku-5.5`, worker $0, two fires = **$0.013** total).
   Do not describe the chain as working.
3. **SCOUT's assigned model returns number-stripped text** — reproduced twice:
   `"The price is $. for a -page Christian scripture printable bundle."` The harness carried it
   verbatim and the lead correctly reported it unusable rather than inventing a figure, so this is a
   MODEL fault, not wiring. Research is the only thing SCOUT does; change its model before trusting
   any SCOUT output (`node scripts/station-models.mjs list` / `set scout <model>`). §16c.

## "StarNet isn't running" / an agent shows NO MODEL (2026-10-27). Check these before changing anything.

Full detail: `STATION_FIELD_NOTES.md` §17. The lesson in one line: **"it's not running" is a symptom, not a
diagnosis** — four separate things were true at once, and measuring first stopped three wrong fixes
(restarting a healthy sidecar, re-pasting a key that must never be in the renderer, switching a model that worked).

### Triage order — all of this is free

```bash
bash ~/starnet-up.sh      # UP/DOWN, and starts it if down (refuses while a spend receipt is unsettled)
curl -s -m 4 http://127.0.0.1:8787/api/health            # expect: ok
pgrep -af 'node sidecar/index\.js'                       # and its parent should be start-starnet.sh
ls ~/.local/share/StarNet/workspaces/.spend-pending/     # MUST be empty, else every agent silently refuses
grep -c "THE FULL APP IS RUNNING" ~/.local/state/starnet/sidecar.log   # boot count
grep -niE "degraded|EADDRINUSE|out of memory|killed" ~/.local/state/starnet/sidecar.log | tail
```
Then prove the engine with ONE live run before touching config — a `done` reply from the agent in question
beats any amount of staring at the UI.

### An agent whose model shows blank/"none" is a UI bug, not a dead agent

**The sidecar's provider keys are invisible to the browser.** `~/.config/starnet/env` is the supported way to
key an unattended station, but `Harness.configured()`'s browser branch only ever consulted the key *pasted
into the page* (localStorage), and `modeldock.js:286` gates the whole model-catalog fetch on that — so an
env-only provider resolved no model name and the agent rendered blank. Fixed 2026-10-27: `init()` now reads
credential PRESENCE from `GET /api/providers` (a boolean, never the key, so the renderer stays secret-free)
and the browser branch honours it. `/app/*.js` is served `no-store`, so **a plain page reload is enough** —
do not restart the sidecar for this, and never "fix" it by pasting the key into the UI.

Regression: `test/provider-configured-from-sidecar.test.js` — and note it **executes** `harness.js` in a `vm`
sandbox. `harness-internal.test.js`'s claim that the file is "not node-loadable" is wrong; prefer real
execution over source-locking when touching that file.

### Nothing restarted StarNet after a phone reboot

`start-starnet.sh` restarts the sidecar on a CRASH only. A reboot, or swiping Termux out of recents, left the
station down and every routine silently stopped. `~/.termux/boot/10-starnet.sh` now exists but is **inert
until the Termux:Boot app is installed** (only `com.termux` is on this device, not `com.termux.boot`) — that
is a one-time owner install. Until then, `bash ~/starnet-up.sh` after a reboot is the manual equivalent.

## "The phone gets slow when I talk to an agent" (2026-10-27). It is the checkpoint ceiling sweep.

Full detail and every measurement: `STATION_FIELD_NOTES.md` §19; bug record
`qa/bugs/062379c5-checkpoint-ceiling-sweep-re-runs-on-every-mutati.md`.

Before every mutating tool call the host snapshots the agent's workspace into a shadow git repo and
then runs `enforceSizeCeiling()` (`sidecar/checkpoint-store.js`). NIGHT4CHRIST's work tree holds
**1.58GB of 300-PPI print PNGs in `workspaces/agent/outbox/`**, so the repo is 1.445GB against a
500MB ceiling and **neither `gc` nor the re-init fallback can ever get under it**. The shipped code
retried the whole sweep every single tool call: **~20s of CPU each time, 216% of one core, CPU temp
38.7C -> 67.1C, and zero bytes reclaimed.** Fixed by remembering a sweep that could not win
(`sweepMemo`, retry only after 1.25x growth) and refusing a re-init whose baseline provably cannot
fit. Live after: **3s wall, 22% of one core, 46.5C.**

Two things to carry forward:

- **`sidecar.log` duplicates every stdout line** (the sidecar writes it AND `start-starnet.sh` tees
  into it), so `grep -c "THE FULL APP IS RUNNING"` reports double the real boot count and one event
  reads as two. Halve it.
- The repo is still 1.445GB and the station still says so once per boot. Shrinking it means moving
  the print deliverables OUT of `workspaces/agent/` — an owner decision about product files, not a
  code change.

## Model rotation (2026-10-27). Agents survive an outage, a 429, or an empty wallet on their own.

Full detail, evidence and the gating table: `STATION_FIELD_NOTES.md` §18.

**No code was needed.** `sidecar/fallbackchain.js` + `sidecar/recovery-policy.js` +
`sidecar/providers/errorClass.js` already implement a classified cross-provider chain that every run
path consults. What was missing was a populated, *verified* chain and primaries that weren't free models.

### The mechanism that is easy to get wrong

A saved chain turns into **cross-provider** entries only when the primary is NOT openrouter
(`sidecar/index.js`, search `savedProviderFallbacks`). So **primaries live on the direct `anthropic`
provider and the chain is OpenRouter slugs** — two vendors, two wallets. Put the primaries on
`openrouter` and the same chain resolves same-provider, so one empty OpenRouter wallet kills every
entry at once. That is why the primaries are where they are; it is not a preference.

Cron never sets `o.fallbackModels`, so the persisted chain applies to **every unattended run** with no
per-routine wiring.

### Who runs what (measured $/run, not estimated)

| agent | model | $/run |
|---|---|---|
| NIGHT4CHRIST (lead) | `anthropic` `claude-sonnet-5-5` | 0.1116 |
| DESIGNER (vision) | `anthropic` `claude-sonnet-5-5` | 0.1091 |
| SCOUT / PUBLISHER / HARVEST | `anthropic` `claude-haiku-5-5` | ~0.005 |

**sonnet-5-5 is 20x haiku-5-5 per run** — the station's system prompt + memory recall dominate input,
not the reply. Only the lead and DESIGNER are worth it. Downgrade the lead with
`node scripts/station-models.mjs set agent claude-haiku-5-5 --provider anthropic`.

Chain (8 = MAX_ENTRIES, all tool-verified, all vision-capable, vendors alternating at the top):
`anthropic/claude-haiku-5.5` → `google/gemini-3.1-flash-lite` → `openai/gpt-5-nano` →
`qwen/qwen3.7-flash` → 4 free models. Edit with `POST /api/fallback/chain {models:[...]}`; read with
`GET /api/fallback/chain`. **Never put a `:batch` variant (async), a `~`-prefixed floating alias
(drifts), or `openrouter/auto` (unpriceable → books $0) in the chain.**

### What rotates and what must not

`billing` / `auth` / `rate_limit` / `overloaded` / `server_error` / `model_not_found` /
`quota_exhausted` → **rotate**. `format_error` / `local_error` / `content_policy_blocked` → **fail,
no switch**; `output_cap` retries the same model with a lower budget. Proven live: a real 400 produced
`fallbacks=0`, `usd=0`, one attempt. **A bug in provider A can never quietly spend on provider B.**

Gotcha when reading the code: `billing`/`auth`/`rate_limit` carry `shouldFallback: false` but
`shouldRotateCredential: true`, and `recovery-policy.js` fires on **either**. Reading only
`shouldFallback` makes it look like out-of-credit doesn't rotate. It does.

**~~Known gap:~~ FIXED 2026-11-01.** A connection-level failure classifies as `timeout`
(`shouldFallback: false`), so it retried the same provider and **never reached the chain** — a run died
with seven working entries sitting idle. `sidecar/recovery-policy.js` now has `EXHAUSTED_FALLBACK`
(`{ timeout: 1 }`): once the local ladder's rungs AND its patience budget are spent, a transport failure
crosses to the next provider instead of ending the run. Both former `fail` returns were rewired; the
recoveries budget still bounds it.

**The allowlist is the whole point — do not widen it to `cls.retryable`.** The only other retryable class
reaching that code is `unknown`, and crossing on `unknown` is exactly the money rule's "a bug in provider A
quietly starts spending on provider B". Non-retryable classes (`format_error`, `content_policy_blocked`,
`auth`, `billing`…) still fail in place on the first attempt, and `rate_limit` still crosses earlier via
`shouldRotateCredential`. Regression: `test/recovery-exhausted-fallback.test.js` (33 assertions, in
`test/fast.list`) — it pins the refusals as hard as the new behaviour. Before/after on the real module:
`action=fail` → `action=fallback`, with `format_error` unchanged at `fail` both sides.

**What provoked it:** two interactive NIGHT4CHRIST runs on `anthropic/claude-sonnet-5-5` ended
`failureStage: provider_stream, failureCode: timeout` after **5.4 and 4.6 minutes**. Short requests to the
same host were 20/20 fine, so the link was alive — a long stream on a phone radio kept dropping.
`ERR_HTTP2_STREAM_ERROR` was already classified correctly (`errorClass.js:373`) and the ladder already
retried patiently; the missing piece was only the crossing. Two plausible-sounding causes were measured and
discarded first: the sidecar does **not** negotiate HTTP/2 (global `fetch` is HTTP/1.1, no dispatcher, no
proxy), and `termux-wake-lock` is **not** a no-op (it targets `com.termux`'s own service, not Termux:API).

### Verifying a model before you trust it

`reason=done` is NOT proof a model works — that is the documented failure where a model writes tool
syntax as prose and the harness runs nothing. A candidate is only acceptable if a real `POST /api/run`
against a real agent emits **both `agent.tool_call` and `agent.tool_result`**. The run stream is NDJSON
of `{name, payload}` — not `{type, ...}`.

### Pricing note

`liveprices.js` (models.dev, fetched at boot) is what actually prices runs and it is correct. But
`workspaces/liveprices.cache.json` currently holds `byFamily: {}`, so a boot while models.dev is
unreachable falls through to `prices.js` — where `claude-haiku-5-5` used to price **10x high**. Four
correct rows were added there as the offline safety net. **`claude-haiku-5-5` is tiered: above 100k
context it bills 5x ($0.50/$2.50), and neither pricing module models tiers.**

### Undo

```bash
node scripts/station-models.mjs restore before-rotation
```

## 2026-11-01 — four traps that each cost a wrong conclusion in one session

Every item here is something I asserted, then disproved by measuring. The pattern is the same each
time: **a symptom was blamed on the nearest interesting thing instead of the actual cause.**

### `POST /api/run` takes `messages` (an ARRAY), not `message`

`sidecar/index.js`, search `isTask = true` — the handler destructures
`{ model, system, messages = [], agentId = 'agent', isTask = true, provider, ... }`. Pass `message`
and it is **silently ignored**: `messages` defaults to `[]` and the run carries no user turn at all.

What that looks like, and why it is worth a section:

| provider | result with an empty `messages` |
|---|---|
| `anthropic` | `http 400 — messages: at least one message is required`, `usd: 0`, one attempt |
| `openrouter` | run **succeeds** — 23 `tool_call`s, a deliverable, `reason: done` |

The OpenRouter run is the dangerous half: with no user turn the agent just acts on its system prompt,
so it looks like a perfect verification of whatever you thought you asked. I read that as "the engine
works" and then read the anthropic 400 as "the anthropic provider is broken on the headless path" —
and nearly wrote it up as a regression in HEAD (`53be4ef6c`, which does touch anthropic message
building, making the wrong story very plausible). The adapter was fine. **With the correct shape:
`tool_call=1, tool_result=1, reason=done, usd=0.0055` on `anthropic/claude-haiku-5-5`.**

Corollary for behavioural rule 8: when a live run is your evidence, confirm the run actually received
your instruction — check the reply addresses it, not merely that `reason: done`.

### `*.bak` in `.gitignore` does NOT match `file.bak-rotation`

The glob only matches names **ending** in `.bak`. Every suffixed backup this station makes
(`.bak-rotation`, `.bak-gptimage2`, `.bak-<epoch>`) was untracked **and committable** — including a
1.7 MB `sidecar/index.js` copy and `.env.local.bak-20261030`, which held a live HF key in full.
`.env.local` was ignored; a dated backup of it was not. Fixed with `*.bak-*` and `.env.local.*`.
Check with `git check-ignore -v <file>`, never by eyeballing the patterns.

### pnpm broke ONE native module; the other two never worked here

The repo installs with `npm ci`, but a `pnpm install` (2026-10-30, alongside `@openai/codex`) left a
`node_modules/.pnpm` store, a second lockfile, and a `pnpm-workspace.yaml` whose `allowBuilds: false`
suppressed native builds. Three modules then failed to load, and I reported all three as pnpm damage.
Only one was:

| module | truth |
|---|---|
| `node-pty` | **genuinely broken by pnpm.** The working build was displaced to `node_modules/.ignored_node-pty/build/Release/pty.node` — a real `ELF aarch64, Android 24, NDK r30` binary. Copying that tree back into the active package restores it. |
| `sharp` | **never worked on this device.** `sidecar/tools/builtin/print-prep.js:8-15` says so outright — no android-arm64 binding exists, which is *why* the station uses `@napi-rs/canvas`. `image.js` try/catches it. |
| `onnxruntime-node` | **never worked.** Ships `darwin/linux/win32` only. Guarded in `local-voice.js`. |

Before blaming an install for a missing native module, check whether the code already documents it as
unavailable on Android — two of the three were load-bearing comments written by an earlier session.

**The pty fix is not durable:** it lives inside `node_modules/.pnpm/…` and any reinstall wipes it.
The real fix is `node-pty: true` in `pnpm-workspace.yaml`'s `allowBuilds` (the NDK toolchain works —
that binary was compiled on this phone), or resolving the npm/pnpm split properly.

Verify a PTY by spawning one, not by `require`-ing it: a real pty returns `\r\n` line endings and
`stty size` echoes the geometry you asked for (`"PTY_WORKS_17220\r\n24 80"`). Live confirmation is
the per-run `[tools] footprint` line — `pty->terminal.start/...` disappears from `unavailable`.

### Killing the sidecar's node child kills `start-starnet.sh` too

`kill <node pid>` is a CLEAN shutdown, not a crash, so the supervisor exits with it instead of
restarting — the station stayed down until I noticed. The launcher only auto-restarts a *crash*.
Also: if you start it from an agent tool call, it is parented to that call and dies with the session.
Start it detached so it outlives you:

```bash
cd ~ && setsid nohup bash ~/start-starnet.sh >> ~/.local/state/starnet/launcher.out 2>&1 < /dev/null &
```

### Reading `sidecar.log`: `[tools] footprint` is per-RUN, not per-boot

It is emitted inside `handleRun`, so lines *before* a `THE FULL APP IS RUNNING` banner usually belong
to the PREVIOUS process's runtime. Combined with the known duplicate-line problem (§19), I twice
concluded a fix had not taken when I was reading the old boot. Anchor on the banner's **line number**
(`grep -n`) and only trust lines after the last one.

### Model routing drifts out from under the documented design

Found every agent on an **openrouter** primary with OpenRouter at **$0.61 of $35** — someone had run
`station-models.mjs set all` on 2026-10-28. Per §18 that silently defeats rotation: the saved chain
only resolves cross-provider when the primary is NOT openrouter, so one empty wallet kills all 8
entries at once. Restored from snapshot `2026-10-28T05-22-31-410Z__before-set-all`. **Check
`node scripts/station-models.mjs list` against §18 at the start of any session that touches spend or
providers** — the file says what the config *should* be, not what it *is*.

## Daily Operations Cheat Sheet

### 🔁 Startup / Health

**Every day / after Termux gets killed:**
```bash
bash ~/start-starnet.sh      # Starts OmniRoute first, then StarNet, with wake lock and auto-restart. "already up" means it's fine.
bash ~/starnet-up.sh         # Quick check: says UP or DOWN, and starts StarNet if down.
bash ~/starnet-up.sh --watch # Keeps checking every 60 seconds.
```

**Open in Chrome:** `http://127.0.0.1:8787`

⚠️ After a phone reboot nothing restarts StarNet. Fix: install Termux:Boot app (from same place you got Termux) — `~/.termux/boot/10-starnet.sh` is already written but inert until then.

⚠️ **Never `kill` the node process to restart it** — that is a clean shutdown, so `start-starnet.sh`
exits with it instead of reviving it, and the station just stays down. Restart by killing the
launcher too and relaunching. If an agent/tool starts it, start it **detached** or it dies with that session:

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

### 🤖 Claude Code Launchers

| Command | Uses | Cost |
|---------|------|------|
| `cc-sub` | your Claude subscription | plan quota |
| `cc-api` | Console API credits (reads key from `~/.config/starnet/env`) | paid |
| `omni` or `cc-omni` | OmniRoute cloude-free combo | $0 |

**Resume the last chat:** `cd ~/starnet && claude --continue`

⚠️ If "CANNOT LINK EXECUTABLE … syscall-shim.so not found":
```bash
clang -nostdlib -fPIC -shared -O2 -Wall -Wextra -Werror -Wl,-soname,libclaude-termux-shim.so -o ~/.local/share/claude/versions/2.1.220.termux-syscall-shim.so ~/claude-code-termux/assets/claude-code-termux-syscall-shim.c
```

### 🎛 Agent Models

Switch models:
```bash
node scripts/station-models.mjs list
node scripts/station-models.mjs set <agentId|all> <model>      # auto-snapshots + verifies
node scripts/station-models.mjs revert                       # undo last change
```

Saved restore points:
- `before-free-omni`: paid/mixed (safe for real agent work)
- `free-omni`: everyone on free OmniRoute
- `paid-routing-restored-from-backup`
- `all-free-20261020`

⚠️ **Verify numbers survive after any model change.** The digit-stripping fault was a specific model
(`cf/@cf/meta/llama-3.3-70b-instruct-fp8-fast` via omniroute), not SCOUT. On `anthropic`
`claude-haiku-5-5` SCOUT returns intact figures — confirmed live 2026-11-01 ("3 tools", "55 tools",
"8 jobs" all came back whole). Research is the only thing SCOUT does, so re-check this each time.

### 🌐 OmniRoute

Dashboard: `http://localhost:20128/dashboard`

⚠️ A 401 that comes back instantly means your **client key file is stale** (`~/.omniroute/client_api_key.local` must match `OMNIROUTE_API_KEY` in your env file), not a provider problem. **Restart the sidecar after changing it.**

### 🧵 Driving an agent from curl (the shape that actually works)

```bash
set -a; . ~/.config/starnet/env; set +a
curl -sN -X POST http://127.0.0.1:8787/api/run \
  -H "x-starnet-token: $STARNET_API_TOKEN" -H 'Content-Type: application/json' \
  -d '{"agentId":"scout","surface":"autonomous","provider":"anthropic","model":"claude-haiku-5-5",
       "messages":[{"role":"user","content":"YOUR INSTRUCTION"}]}'
```

⚠️ The field is **`messages`** (an array). `message` is silently ignored, the run carries no user
turn, and OpenRouter will happily return a successful-looking run that never saw your instruction.
⚠️ Always pass `provider` + `model` — a bare `/api/run` does not use the agent's roster model.
⚠️ The stream is NDJSON of `{name, payload}`. A run only counts as real if **both**
`agent.tool_call` and `agent.tool_result` appear — `reason: done` alone proves nothing.

### ⏰ Routines (scheduled jobs)

Load token first (once per Termux session):
```bash
set -a; . ~/.config/starnet/env; set +a
```

List routines:
```bash
curl -s -H "x-starnet-token: $STARNET_API_TOKEN" http://127.0.0.1:8787/api/cron
```

Run one now (this spends money):
```bash
curl -s -X POST http://127.0.0.1:8787/api/cron/run -H "x-starnet-token: $STARNET_API_TOKEN" -H "Content-Type: application/json" -d '{"id":"PASTE_ID"}'
```

⚠️ The header is `x-starnet-token`, **never** `Authorization: Bearer`.

⚠️ To enable a routine, use:
```bash
POST /api/cron/update {id:"…", patch:{enabled:true}}
```
A flat body `{"id":"…","enabled":true}` may reply 200 but change nothing.

### 🧪 Tests

```bash
npm run test:fast    # The merge gate — ~364 steps
npm run test:http    # Live sidecar HTTP/E2E suite
npm test             # test:fast + test:http
```

Test:fast always stops at step 305 on this device (pre-existing `qa-product-perfect-claims` QA failure). All steps run individually — **12 documented pre-existing failures**.

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

The Knight video they describe was a **fake placeholder** (1,056 bytes). The real video is at `proj-1793024540897-knight`. Trust `CLAUDE.md` and `STATION_FIELD_NOTES.md` over everything else.

Also: the old note about the Anthropic console account being empty is **corrected** — it is now funded and responding.

## NIGHT4CHRIST — PROJECT PROGRESS & HANDOFF (NOVEMBER 2026)

### Completed: Christian Story Studio pipeline

**Date completed:** 2026-11-02
**Project ID:** `proj-1793603158934-r0x5zq`
**Prompt:** "A Christian story about finding hope in hard times, with Scripture verses that comfort someone going through a difficult season. Three acts: the struggle, the promise, the peace. Visual style: warm, gentle, faith-affirming imagery."
**Entry point:** `POST /api/studio/assignment` → `runPipelineToCompletion()` in `sidecar/index.js`

Four stages completed unattended:

| Stage | Agent | Output | Cost |
|-------|-------|--------|------|
| 1 | STORYWRITER | Full 3-act screenplay (~14-16 min runtime), Grace Marsden / Walter Marsden story with ESV Scripture (Ps 34:18, Isa 41:10, Rom 8:28, Lam 3:22-23, Matt 11:28, Ps 30:5) | ~$0.011 |
| 2 | DIRECTOR | 114-shot shot list (A1-01 to A3-44), visual plan, color palette, lighting by act, pacing notes | ~$0.016 |
| 3 | PRODUCER | Real video rendered via Higgsfield REST fallback (Kling wallet empty) | ~$0.017 |
| 4 | QC_EDITOR | QC report — script accuracy & faith authenticity PASS; media-verification gaps flagged | ~$0.020 |

**Video output path:** `~/outbox/proj-1793603158934-r0x5zq/video.mp4`

**Reported video specifications (ffprobe-verified):** 10.3 MB (10,284,443 bytes), 5.4 seconds, 720×1264, H.264 + AAC stereo audio, 30fps, ~15.3 Mbps bitrate, 161 frames. ffprobe output confirmed real footage (not a placeholder) — passes the `sidecar/video-verify.js` bitrate floor of 150,000 bps.

**Reported total cost:** approximately $0.064 (studio agent stages via OpenRouter direct provider; video render via Higgsfield REST).

### Fixes applied during this run (already live, sidecar restarted)

1. **Higgsfield `input_images` shape fix** (`sidecar/higgsfield-video.js:232`): The API rejects a string array `[url]`; it requires objects: `[{ type: 'image_url', image_url: '<url>' }]`. Probe-verified live — array of strings returned HTTP 422 (`body.params.input_images.0: Input should be a valid dictionary or object`), correct object shape returned HTTP 200.
2. **Producer stage timeout** (`sidecar/index.js:20018`): `runPipelineToCompletion(projectId, 300000)` → `runPipelineToCompletion(projectId, 900000)` — the 300s per-stage timeout killed the producer model turn during the two-step Higgsfield text→image→video render. Raised to 900 seconds.
3. **`STUDIO_ALLOW_UNACCOUNTED_SPEND=1`** added to `~/.config/starnet/env` — required by the Higgsfield fallback gate in `sidecar/video-providers.js`, since Higgsfield REST bills an account StarNet cannot audit.

### QC verification limitation

QC_EDITOR could not independently verify the video because `video.inspect` and shell access are not granted to that agent. I verified the file directly with `ffprobe` — confirmed real footage at 10.3 MB / 5.4s / 720×1264 / H.264 + AAC. The producer's blueprint notes reconcile with the actual file: `video` metadata records path, provider "higgsfield", and bytes 10284443, matching the file on disk.

### Next mission (NOT yet launched)

Run one complete Etsy team test using SCOUT → DESIGNER → PUBLISHER → HARVEST. **CORRECTED 2026-11-02:** the full Etsy chain `ebc4f07d-a26e-4e40-ae4f-01f8a56ea909` (NIGHT4CHRIST leads SCOUT → DESIGNER → PUBLISHER) is **no longer disabled** — it was found `enabled:true` and had already auto-fired on its own schedule earlier that same day (2026-11-02T11:09 UTC), reaching only SCOUT before `team_dispatch` timed out. The smoke test `ec4436a4-e1a0-432a-be75-3606b843ad51` is still disabled (`nextRunAt: null`). Check `GET /api/cron` for current state before relying on this note. Arm/disarm with `POST /api/cron/update {id, enabled:true|false}`; fire once without arming via `POST /api/cron/run {id}`. Auth header is `X-StarNet-Token`, not `Authorization: Bearer`. The full chain still has not been run end to end — do not describe it as working.

A separate live test on 2026-11-02 ran SCOUT → DESIGNER → QC (QC_EDITOR standing in, no Etsy QC agent exists) → PUBLISHER → HARVEST manually via `/api/run`, not via this cron routine. Result: SCOUT and HARVEST produced real saved files; QC_EDITOR and PUBLISHER produced real output but could not save it themselves (ASK-mode agents, `fs.write` denied/stalled with no approver present on an unattended run — confirms the ASK-vs-Full-Access design documented above, live); DESIGNER's one authorized `openai_image_generate` call returned a real `HTTP 429` — **the OpenAI account has no image-generation credits**, cost $0. QC verdict: FAIL, no sellable product exists. Total real spend: $0.2595. Full writeup and saved artifacts: `workspaces/agent/pipeline-live-test-20261102T124646Z/`.

### Existing Etsy product and outbox preservation

- **First real product:** "Verses for Hard Days" (`workspaces/agent/verses-for-hard-days/`) — 10 KJV scripture printable pages (PNG/SVG, with 300 DPI `*-print.png` versions) plus competitor pricing research and a full listing draft with per-sale profit calculation. Status: `approved-to-publish` (owner-approved, not yet published — no Etsy API exists in this station).
- **Do not delete, move, or overwrite** anything in `~/outbox/` or `workspaces/agent/outbox/` — these contain the verified video and print deliverables.
- NIGHT4CHRIST's work tree holds ~1.58GB of 300-PPI print PNGs in `workspaces/agent/outbox/` — do not bulk-clean or reset.

### Spend guards (unchanged)

- Commander approval required before publishing, paid generation, or spending.
- Apify maximum 8 runs/day including failures (enforced by `sidecar/hostquota.js` via `workspaces/.host-daily-quota.json`).
- Etsy business capital ceiling $60; separate $40 development allowance; $0 default new spend.
- No purchases, publishes, credential/budget changes, or destructive git ops without explicit owner approval.

### Preserve existing configurations

- Preserve OmniRoute, free-model routing, and agent model assignments as shown by `node scripts/station-models.mjs list`. NIGHT4CHRIST currently routes via OmniRoute `aug/sonnet5-high`; studio pipeline stages use `STUDIO_PROVIDER`/`STUDIO_MODEL` env defaults (openrouter/anthropic/claude-sonnet-4.5).
- Do not reset, reinstall, clean, checkout, stash, or bulk-modify StarNet without explicit owner approval.
- Before editing any existing file, make a same-directory backup (`cp path/to/file path/to/file.bak`) unless that exact backup already exists.

## 2026-11-02 (session 2) — Outbox, dispatch reliability, and three security findings

Five fixes shipped, each provoked by a real failure. Every claim below was verified by a live run or a
named test; where it was not, it says so.

### CORRECTION FIRST — NIGHT4CHRIST's roster model was dead

The note above says NIGHT4CHRIST "currently routes via OmniRoute `aug/sonnet5-high`". That model **does not
work**: `aug/*` resolves to a provider plugin that shells out to the Auggie CLI, which is not installed —
every call returned `HTTP 502 "Auggie CLI not found: auggie"`. OmniRoute has only **4 connections, all free
tier** (cloudflare-ai x2, `gemini-free`, `openrouter-free`) and **no `aug` provider and no combo by that
name** (`GET /api/providers`, `GET /api/combos` — only `cloude-free` and `cloude-free-copy` exist). Fixed to
`anthropic/claude-sonnet-5-5`, verified with a live 1-token call. It did not break the Etsy chain only because
that cron job carries its own explicit `provider`/`model` override.

### The dispatch reliability chain (three separate bugs, found in order)

1. **A healthy run was killed by its own lease.** `ORCH_DISPATCH_TIMEOUT_MS`, `CRON_HEARTBEAT_STALE_MS` and the
   registry backstop were all derived from `CRON_MAX_RUN_MS`, so the lease staleness window and the dispatch
   budget expired together while the backstop sat 60s *beyond* the lease — the reclaim always won. Live run
   `c1bce71a`: SCOUT finished in 26s, the dispatch then stalled, and at 480s `cron-driver.js:636` cancelled the
   whole run (`stale-lock-reclaimed`), discarding a completed paid-for worker AND re-arming the routine, which
   **auto-re-fired and spent again** (`b7003a7a`). NEW `sidecar/dispatch-budget.js` derives the budget from the
   staleness window; invariant `leaseOutlivesTool` pinned by `test/dispatch-lease-invariant.test.js`.
2. **A completed worker's handoff was written too late.** `recordHandoff` ran only in the outer `withHandoff`
   wrapper — after a post-worker phase that has no wall clock (the per-worker timer is cleared the instant
   `runOnce` settles) and emits no events. `sidecar/tools/builtin/orchestration.js` now files the handoff the
   moment the row exists, idempotently. `test/dispatch-handoff-race.test.js` fails against the pre-fix module.
3. **`CRON_MAX_RUN_MS=900000`** added to `~/.config/starnet/env` (was unset → 480000). DESIGNER was being cut
   off mid-work at 360s. Verified present in the running process env. Cost: a genuinely hung routine now takes
   ~15 min to reclaim instead of ~8.

**The 501-second stall itself is still UNEXPLAINED.** Instrumentation (`phaseClock` in orchestration.js) now
names the blocking phase on stdout if it recurs. Two calibration lessons: a single threshold cried wolf on
every healthy SCOUT run (~26s), so `worker-runOnce` gets 90s and post-worker phases 10s; and the log line must
fire from a TIMER, because the phase being hunted never completes and an `end()`-only log would never run.

### Anthropic thinking-block 400 — fixed server-side, cause still unknown

DESIGNER died at 17 turns / $0.603 with `Invalid signature in thinking block … Content before this block was
rewritten`. The host guard (`thinkingBlocks` replays only blocks stamped with this run/model/epoch/tools) is
sound and all three compaction paths bump the epoch; a read-only audit of every history mutation found nothing
(all four non-compaction rewrites are terminal). So the fix is Anthropic's own escape hatch, **probed, never
assumed** — one deliberately-invalid field returned the enum:

```
thinking.adaptive.block_binding.prefix_mismatch_behavior: Input should be 'error' or 'drop_block'
adaptive + block_binding -> 200 (incl. claude-sonnet-5-5)   between_tools + block_binding -> 400 refused
enabled  + block_binding -> 200 (claude-haiku-4-5)          disabled      + block_binding -> 400 refused
no anthropic-beta header -> 400 "Extra inputs are not permitted"
```

`sidecar/providers/anthropic.js` sends `drop_block` on the two thinking-ON shapes only, with the
`thinking-binding-controls-2026-08-01` beta attached only when the field rides. **Result: DESIGNER ran 25
turns, `reason: done`, zero signature 400s** (run `dc3e312b`) — first time all three Etsy stages dispatched.
Sending the field on an off-switch would 400 every thinking-OFF run, which is how this adapter broke the
Commander once before — hence the probe table, pinned in `test/anthropic-block-binding.test.js`.

### THE CENTRAL OUTBOX — the DESIGNER -> PUBLISHER bridge

PUBLISHER drafted nothing on `dc3e312b`: *"The PNGs are in DESIGNER's workspace, which PUBLISHER cannot read."*
**That is correct behaviour, not a bug.** `pathtrust.js` — the one sanctioned way out of the per-agent fs jail
— refuses it twice: *"standing grants and Full Access do NOT override ownership beneath this root"* and *"only
an INTERACTIVE run with a live prompt() may bless a NEW root"*. **Do not widen the jail to fix this.**

- NEW `sidecar/deliverable-manifest.js` — shared index at `workspaces/.deliverables/manifest.jsonl`, owned by
  no agent. **Metadata only; a 28MB master is indexed, never copied.** Host-registered from
  `execution.artifactList()` using the host's own agentId/runId (an agent asked to persist its own state
  demonstrably does not — see handoff-store.js).
- **Four independent axes, never merged**: `completion` (producer) · `verification` (host: decode/ffprobe/
  checksum) · `qc` (independent reviewer — `setQc` REFUSES a reviewer equal to the owner) · `approval`
  (Commander only). `lifecycleOf()` derives the coarse state so the two cannot drift. Merging them is how a
  1,056-byte placeholder once shipped as a finished video.
- `GET /api/outbox` (feed) + `GET /api/artifact?id=` (retrieval, scoped `artifact` ticket, 5-min cap).
  **ID-addressed, never path-addressed**; the displayed path is information, not authorization.
- NEW `sidecar/tools/builtin/outbox.js` — `outbox_list`/`outbox_read`, scope `read`, no consent, no network.
  **`outbox` had to be added to `SAFE_BUILTIN_CAPS`** or `enforceRunAuthority` strips it from every ASK-mode
  unattended run — the same trap that once left SCOUT unable to name a deliverable. PUBLISHER is ASK-mode.
- NEW `frontend/app/outbox.js` + script tag. **`website/app` is generated — run `npm run sync:website`, never
  hand-edit.** A same-directory `.bak` inside `frontend/` gets mirrored into the generated site; keep frontend
  backups OUTSIDE that tree (`.backups-outbox-20261102/`).

**Matthew 11:28 is the verified fixture**: 4800x6000 and 2400x3000, both 300 DPI, checksums verified, served
byte-identical through a real ticket (7,686,872 bytes). `build_matthew_11_28.py` was correctly REFUSED as a
scratch helper (reuses `deliverable-files.js`). States are honest: `verification: passed`, **`qc: needs_review`,
`approval: pending`** — print-ready, NOT commercially approved (DESIGNER itself called the art "flatter than
the reference style"). No Airtable status was fabricated; a genuine `designed` row is still outstanding.

### Three security findings — two were mine, one was pre-existing

1. **Symlink escape (HIGH)** in the manifest: the containment check was purely lexical. `P.resolve` collapses
   `..` but never follows links, so `outbox/x.png -> /etc/passwd` passed and was read. The station already
   treats this as a hardline (`fs.js`: "path escapes workspace via symlink"; `pathtrust.js`: "re-proven on
   every access") — **I had read both files and still shipped without it.** Now realpaths both ends, refuses a
   leaf symlink, catches intermediate directory links, and re-proves on every access + `O_NOFOLLOW` reads.
   Pre-fix the test indexed 3 real escapes; post-fix 0.
2. **Stored XSS via inline serving (MEDIUM)** on `/api/artifact`. Real here, not theoretical: the type map
   includes `image/svg+xml` and DESIGNER ships SVG, so an agent-produced deliverable opened from the Outbox
   would execute `<script>` in the sidecar's own origin — the origin holding the master API token. `nosniff`
   does NOT help: it stops type *sniffing*, and the declared type is already the scriptable one.
3. **The same hole on `/api/studio-file`** (pre-existing, NOT flagged by the scanner) — unconditional `inline`
   with `MIME[ext]`, and agents write into `~/outbox/<projectId>/`.

**Root cause of 2 and 3 was building a parallel file server.** `/api/file` already solved this with
`file-response.js` `isActiveDeliverable()` (`.html .htm .xhtml .js .mjs .cjs .svg .xml .xsl .xslt .wasm`) →
force `application/octet-stream` + `attachment` + strict CSP. Both routes now **reuse that one control**, so
widening the list can never leave a route behind. My first attempt used a private `PASSIVE_INLINE` regex — a
second opinion that would drift — and I threw it away. Live-verified: `evil.svg`/`evil.html` download,
PNG/MP4 still render inline.

### RESEARCH: Etsy requires AI disclosure — the listing draft must carry it

Checked on the live Etsy policy pages because this decides whether the pipeline's output is sellable, and no
session had verified it:

- **Sellers must disclose in the listing description when an item is created using AI**, and may not present
  machine output as handmade or entirely their own. AI art is allowed when the seller plays a clear creative
  role and is transparent.
- **Digital downloads with a visual component (printables) must show a preview of the ACTUAL content** buyers
  receive — representative/AI imagery is only acceptable for items with no visual component.
- California SB 1050 may require disclosure for AI "synthetic performers" in listing media from 2027-01-01.

**CORRECTED immediately after writing the above — the first claim here was FALSE.** I wrote that neither
constraint "is currently in PUBLISHER's prompt or the `etsy-rules` skill" **without reading the skill**. The
skill already covers AI disclosure thoroughly: `~/.claude/skills/etsy-rules/SKILL.md` §3 "Etsy AI rules"
requires a disclosure line in every listing description, says to mark the item *designed by the seller* and
tick any generative-AI checkbox, and to disclose AI-made photos/mockups; the listing-text template carries an
`AI-DISCLOSURE` block and the done-checklist re-checks it. §5 likewise requires photos that "show the actual
product honestly" and a standard set including "print alone, clean" and a "what you get" graphic — which
substantially covers the real-preview rule. **This is the exact failure this file's laws exist to stop: I
asserted a gap from memory instead of grepping one file.**

What is genuinely missing is narrower: the skill does not state the POLICY BASIS that representative or
AI-generated imagery is acceptable only for items with **no** visual component (so a printable must preview
its real content), and it does not mention California SB 1050 (2027-01-01). Those two specifics were added to
§3/§5 of the skill. PUBLISHER's own roster prompt still does not restate any of it — it relies on the skill,
which is the correct place for it.
Sources: etsy.com/legal/creativity, etsy.com/seller-handbook/article/1522733284810,
etsy.com/legal/policy/listing-image-requirements/253962679005

### Still open after this session

- The Outbox panel is **not mounted into a visible tab** and has **no CSS** — the module loads and the API
  works, but the Commander cannot click to it yet.
- The registration hook has **never run inside a real pipeline run** (proven only by retroactive registration).
- Video verification is not auto-wired to the `verification` axis (ffprobe 8.1.3 IS present; `sharp` is not,
  as documented — use `@napi-rs/canvas`).
- Per-agent judgment criteria ("biblical accuracy", "narrative strength") are prompt/skill content, not code.
  The manifest carries verdicts; it cannot compute them. **There is no service named "Judgment Engine"** — the
  real equivalents are `completion-evidence.js`, `video-verify.js`, `image_quality_check`.
- DESIGNER's paid image route is still blocked (OpenRouter 402 under $1, OpenAI 429 no image credits), so art
  is Pillow/canvas-drawn and DESIGNER itself rates it below the reference style.

Tests added, all in `test/fast.list`: `dispatch-lease-invariant` (21), `dispatch-handoff-race` (35),
`anthropic-block-binding` (14), `deliverable-manifest` (126), `outbox-route` (49), `outbox-tools` (36),
`outbox-ui` (51). `failopen-ratchet` stays at its 8 pre-existing problems; `index.js` empty-catch count
unchanged at 362.

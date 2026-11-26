# StarNet / NIGHT4CHRIST — Principal Engineer Assessment

**Date:** 2026-11-11 · **Investigator:** Claude Opus 5 (principal-engineer directive)
**Station:** pid 11810, supervised by `start-starnet.sh` · **HEAD:** `93b2dd11c` on `feat/harness-backend`
**Method:** read-only investigation first; every number below was produced by a command or a live probe, not
inferred. Where I could not verify something it says so. **Passing tests are not treated as evidence of
production capability anywhere in this document.**

> This file is a snapshot. Live state drifts — re-check `GET /api/cron`, `GET /api/budget/status`,
> `GET /api/fallback/chain` and `node scripts/station-models.mjs list` before acting on anything here.

---

## 0. TL;DR — the five things that matter

1. **The money hazard I reported yesterday was overstated.** Each enabled routine carries its own
   `maxCostUsd`; worker runs are uncapped per-run but bounded by the $25/day rail. Realistic exposure for the
   11:00 UTC chain is **$0.12–$1.10**, hard-bounded at ~$25/day. **Not a runaway. No emergency action needed.**
2. **The fallback chain was deliberately emptied on 2026-11-02 and is fully recoverable** — the prior 4-entry
   and 8-entry versions sit on disk as `.bak` files, and 7 of their 8 slugs still exist upstream.
3. **Nothing has ever been commercially approved.** 54/54 Outbox rows are `approval: pending`; 52 have never
   been QC-reviewed. The approval machinery works (proven live); it has simply never been used in anger.
4. **Autonomous Etsy revenue is unreachable by design** — no Etsy API, and the chain routine's own prompt says
   *"draft only, publish nothing."* The last mile is a human. This is a product decision, not a bug.
5. **The `memorial/` engine is the most commercially credible asset in the repo** and is the only revenue path
   that needs no model call and no funded wallet. See §5.

---

## 1. Spending controls — what is ACTUALLY enforced

### `perRun: 0` does NOT mean unlimited. Corrected.

I reported yesterday that production was armed with "no per-run spend ceiling." That was literally true for one
class of run and **materially misleading about magnitude**. The real resolution order
(`sidecar/index.js:17252-17262`):

```js
let runCapUsd = (o.maxCostUsd > 0 && isFinite(o.maxCostUsd)) ? o.maxCostUsd
  : (providerUnmetered ? Infinity
  : ((effectiveCaps.perRun > 0 && isFinite(effectiveCaps.perRun)) ? effectiveCaps.perRun : Infinity));
if (Number.isFinite(Number(o.callerMaxCostUsd)) && Number(o.callerMaxCostUsd) > 0) {
  runCapUsd = Math.min(runCapUsd, Number(o.callerMaxCostUsd));   // LOWER-ONLY
}
```

`cron-driver.js:518-525` forwards the routine's own ceiling as **`callerMaxCostUsd`** (lower-only), not
`maxCostUsd`. Every enabled routine has one:

| routine | `maxCostUsd` | effective per-run cap |
|---|---|---|
| `7b22107c` Etsy Scout daily | **0.25** | $0.25 ✅ |
| `d22650c8` Weekly Income Scan | **0.25** | $0.25 ✅ |
| `ebc4f07d` Etsy pipeline chain (lead) | **1.00** | $1.00 ✅ |

### The real gap: DISPATCHED WORKERS are uncapped per-run

| step | evidence | result |
|---|---|---|
| `ORCH_PER_WORKER = num(ENV('BUDGET_PER_WORKER'), 0)` | `index.js:730` | **0** — `BUDGET_PER_WORKER` is unset in the env file *and* in the live process |
| `perWorker = deps.perWorker > 0 ? … : 0` | `orchestration.js:385` | **0** |
| `maxCostUsd: perWorker` at dispatch | `orchestration.js:795` | **0** |
| `0 > 0` is false → falls through; gemini is metered; `perRun` is 0 | `index.js:17252` | **`runCapUsd = Infinity`** |
| `callerMaxCostUsd` occurrences in `orchestration.js` | `grep -c` → **0** | no tightening |

The comment at `orchestration.js:795` reads *"a runaway worker can't blow the lead's per-run ceiling."*
**That protection is inert because `perWorker` is 0.** Likewise `CAPS.maxCostUsd: 1.00` (`index.js:702`) never
reaches the main run path.

`bounded` (from `domainTask.classify`) caps **iterations, tool calls and wall-clock — not dollars**. And
`CAPS.maxIters` defaults to **0**, so turn count is ungoverned too.

### What DOES bound a worker: the day pool

`budget.js:56` — `if (frac >= 1) { out.blocked = scope }`, consulted **per turn** via
`runBudget` (`index.js:18562`). So the $25/day rail is a genuine mid-flight stop. It has **never fired** —
worst rolling-24h window in all history is **$24.21** (3.1% under).

### Measured exposure, not guessed

```
gemini runs recorded: 41 | max $0.1878 | mean $0.0310
this morning's real scout run: $0.026985 / 4 turns = $0.006746 per turn
worst single run ever: $3.5247 (claude-opus-4-8, 16 turns) — a model NO LONGER on the roster
```

**11:00 UTC chain fire: expected $0.12–$1.10. Worst case ≈ $25 (day rail) + one turn overshoot.**
There is no turn reservation on the day/global pools (only `perRun` got one, `loop.js:1536`), so the rail can
be overshot by one worst-case turn.

### The other budget finding — `perDay` is STRICT, not soft

`budget.json` = `{"caps":{"perRun":0,"perAgent":0,"perDay":25,"global":0}}`. Because `perDay` is an
own-property of the SAVED overrides, `budgetScopeIsExplicit('day')` is true → `strictScope('day')` is true →
`softOnly` is false → **every metered run returns `spend_history_unavailable` the instant an orphan
`.spend-pending` receipt exists.** That is the mechanism behind all four historical `UNSETTLED_SPEND`
brickings. The saved value is *identical to the shipped default*, so nothing in the UI distinguishes
"I accepted 25" from "I chose 25" — yet they have opposite failure semantics.

Current accounting is healthy: `.spend-pending` empty, `accounting: {complete:true, durable:true}`.

---

## 2. Model availability and recovery

### The fallback chain is empty BY A SINGLE DELIBERATE CALL, and is recoverable

```
fallback.json.bak-pre-anthropic-20261102  Nov 1 20:40  → 8 entries (the documented chain)
fallback.json.bak                         Nov 2 22:02:37.052  → 4 entries
fallback.json                             Nov 2 22:02:37.056  → {"models":[],"version":1}
```

Four milliseconds between the `.bak` and the empty write: one `POST /api/fallback/chain` with an empty/null
array. `saved:true` means the empty chain **beats the env default**, so there is nowhere to rotate.

**Upstream validity re-probed (read-only GET, no spend):**

| slug | status |
|---|---|
| `anthropic/claude-haiku-5.5` · `google/gemini-3.1-flash-lite` · `openai/gpt-5-nano` · `qwen/qwen3.7-flash` | **OK** |
| `nvidia/nemotron-3.5-super-vl:free` · `google/gemma-4-31b-it:free` · `dots-studio/dots-3-note-preview:free` | **OK** |
| `thinkingmachines/inkling:free` | **GONE** |

7 of 8 valid; 13 `:free` slugs available on OpenRouter overall.

**Cross-provider resolution WOULD work now.** `index.js:18381`:
`savedProviderFallbacks = … && providerId !== 'openrouter' && providerId !== 'starnet'`. Primaries are
`gemini`, which is neither — so a restored chain resolves cross-provider. (An earlier guess that this was
broken by the gemini primaries was wrong.)

### Provider state (probed with one deliberately-invalid field — auth precedes billing, nothing billed)

| provider | state |
|---|---|
| `gemini` (all 10 agents) | HTTP 429 `generate_content_free_tier_requests, limit: 20 … per day` |
| `openrouter` | 402 insufficient credits — **$35.149 used of $35** |
| `openai` | "You have no credits remaining" |
| `anthropic` | **authenticates** (400 on invalid model, not 401); balance unknown; nothing routes to it |

**The 20/day free tier is PER MODEL.** The roster uses four distinct Gemini models
(`gemini-3-flash-preview`, `gemini-flash-lite-latest`, `gemini-3.5-flash`,
`gemini-3.1-flash-lite-preview`), so the chain has ~80 requests of headroom, not 20. *I initially predicted
the 11:00 chain would exhaust quota mid-run; that prediction was wrong and I am recording it as wrong.*
Today so far: 2 runs, 6 turns, $0.0515.

---

## 3. Scheduled execution — answers to the specific risk questions

| risk | finding |
|---|---|
| **Spend money unexpectedly?** | Bounded. Lead capped by routine `maxCostUsd`; workers uncapped per-run but stopped by the $25/day rail. Expected cents. |
| **Dispatch agents without valid model availability?** | **Yes.** The gate verdict added yesterday reports authorization + missing model/credential, but **cannot know provider CREDIT** without a billed call. A routine on an exhausted wallet reports `gateBlocked:false` and dies at the provider. |
| **Continue after partial failures?** | Yes, and it records them honestly — 5 handoff files contain `NOT a completed subtask`. |
| **Produce incomplete/unverified deliverables?** | **Yes, and this is correct behaviour.** A new deliverable registers as `STAGED / unverified / pending`. 36 of 54 rows are `unverified` because no host verifier exists for images/files (only studio video). |
| **Report success when work was not completed?** | **Partially.** `cron.result outcome:ok` keys on the run terminal, not on deliverable completeness. The 2026-11-02 chain reported a `team_dispatch` timeout after 9 min having reached only SCOUT. The handoff store is the honest record; `cron.result` is not sufficient evidence. |
| **Retry creating duplicate work/expense?** | Low. The manifest dedupes on `(artifactId + sha256)` so byte-identical re-registration is a no-op; `cron-store` marks a decline `declined` without touching the failure streak. **But** a stale-lease reclaim once discarded a completed paid worker and re-armed the routine, which auto-re-fired and spent twice (run `c1bce71a`/`b7003a7a`) — fixed by `dispatch-budget.js`, worth watching. |

---

## 4. Etsy pipeline — honest state

**Autonomous revenue is unreachable by design.** Two independent reasons:

1. **No Etsy integration exists.** The only Etsy reference in shipping code is a key-catalog row
   (`sidecar/servicekeys-catalog.js`) whose own text reads *"Public/manual API work only — persistent shop
   automation is not connected"*, `unattendedSupported: false`, *"StarNet does not yet manage Etsy OAuth
   consent or refresh its one-hour access tokens."* Live connectors: **exa, apify (Etsy scrapers, read-only),
   airtable.**
2. **The chain is instructed to stop at a draft** — job `ebc4f07d`'s prompt: *"ask for a listing DRAFT only …
   draft only, publish nothing"* and *"Publish nothing. Buy nothing."*

**Strongest asset is NOT the one the docs name.** `workspaces/webdesigner/etsy-kits/isaiah-40-31/` has 5
genuinely distinct correct ratios, 5 photos at 2000x2000, and a spec-compliant `listing-text.txt` (title
length, 13 tags, AI disclosure, KJV credit, frame-not-included, how-to-print, licence). Four self-contradictions
a human must reconcile: `upload-checklist.md` lists 3 PNGs of which **two are the same 4:5 ratio** the rules
forbid; two different titles (one 135 chars of keyword stuffing); two prices ($5.99 vs $5.00); `print-files/`
holds 7 files where Etsy allows 5; description promises PNG + ZIP but the set is JPG with no ZIP. Missing: ALT
TEXT and listing-form reminders.

**Two drafts are publish-unsafe.** The NIV set-of-3 draft uses **NIV 16 times including the title** (the
`etsy-rules` skill forbids NIV outright — no commercial permission). `verses-for-hard-days/etsy-listing-draft.md`
is headed `STATUS: approved-to-publish` with **no AI disclosure** and contradicts its own header at line 105.

**SCOUT structurally cannot do its job on its own routine.** Its skill is
`run-etsy-niche-sweeps-via-apify-into-airtable` (MCP connector work) but its routine's `unattendedGrants` is
`[]`; the only routine with `connectors` is disabled. Workers inherit the lead's `connectorAuthority` — but the
lead has none either.

**Commercials:** $113.75 (`runs.jsonl`) / $123.39 (`ledger.jsonl`) against a stated **$60 business + $40 dev =
$100**. The two reconcile exactly: `113.746949 + 5.385941` (aux rows) `+ 4.230295` (ledger-only runIds)
`= 123.363185`. NIGHT4CHRIST alone is **$95.27 (84%)**. **Zero Etsy orders ever.**

---

## 5. Video production — the two pipelines, side by side

| | (A) `memorial/` ffmpeg engine | (B) Christian Story Studio agents |
|---|---|---|
| **Can deliver a paid customer video today** | **YES — with manual steps** | **NO** |
| Longest real output | **171.2 s / 1920×1080 / h264 + aac stereo** | 5.37 s / 720×1264 |
| Cost per film | **$0.00** | ~$0.064 model + unauditable video billing |
| Needs a funded wallet | **No** | **Yes — and every wallet is empty** |
| Films produced / attempts | **1 of 1** | **1 of 29 projects** |
| Blocking gap | intake + delivery are manual | cannot assemble clips; provider blocked |

### (A) The memorial engine works, and I verified the film myself

```
$ ffprobe memorial/examples/life-worth-remembering/render/out/life-worth-remembering.mp4
  h264 1920x1080 | aac 2ch | duration 171.200000 | size 32803708 | bit_rate 1532883
```

A 2:51 1080p film with music, 35 segments, 30 photos, 5 title/Scripture cards. **The only finished video
product on the station.**

**The zero-spend claim is TRUE** (one footnote). All 12 `.mjs` files: zero `fetch`, zero outbound HTTP, zero
provider imports, zero model calls in the render path. Only two outside `require`s —
`sidecar/video-verify.js` and `sidecar/audio-finish.js`'s `muxFinal` (pure ffmpeg). The `fetch` in
`audio-finish.js:195` is the FAL rescue layer, which `render.mjs:297-308` documents avoiding **by name**.
Footnote: `business/digest.mjs:34` curls `127.0.0.1:8787/api/health` — loopback, in `status`, never in render.
So *"makes no model call and spends nothing"* is accurate; *"opens no network connection"* is imprecise.

**Its verification gate caught its own real defect on the first run** — `orders.jsonl` records
`state: blocked, failed:["audio-stream"]` for a silent 28.6 MB render. That is the strongest single piece of
evidence in this assessment. Live re-verify: all 6 checks PASS (resolution, duration drift 0.00 s,
audio-stream, audio-not-silent −15.7 dB, 35/35 segments).

**What a placeholder could still pass:** neither gate inspects *content*. A 171 s film of 35 solid-black
segments would clear every check. The gates prove **mechanical** reality, not visual correctness.

### (B) The studio pipeline's ceiling is structural, not a bug list

`cron-orchestrator.js:40-47` `renderPromptFor` flattens STORYWRITER's **25,239-character** screenplay and
DIRECTOR's **114-shot / 23,506-character** shot list into a single `.slice(0, 1800)` prompt and renders **one
clip**. `higgsfield.generateVideo` has no duration parameter at all. **There is no clip assembly anywhere in
the sidecar** — grep for `concat`/`xfade` across the orchestrator and the video providers returns zero hits.
A ~15-minute screenplay in, a 5-second clip out.

### THE ROOT CAUSE: the studio video family is three-quarters DARK

`CAP_REGISTRY` grants the `studio` bay four video tools. **Only one is registered, and it is unusable
headless.** Verified by `grep -c "builtin/<file>" sidecar/index.js`:

| tool | implementation | required by index.js? | reachable by a headless agent? |
|---|---|---|---|
| `video.inspect` | **`video-inspect.js` — 234 lines, ffprobe, read-scoped, no consent, no network, no key** | **NO (0 requires)** | **no** |
| `video.generate` | `video.js` — 187 lines, Pika Labs REST, needs `PIKA_API_KEY` | **NO (0 requires)** | no |
| `video.process` | **none — 0 implementations anywhere in the repo** | n/a | no |
| `video.kling` | `video-kling.js` | yes (`:84`, `:17560`) | **no** — `requiresConsent: true` |

`video.process`'s registry row (`registry.js:372-375`) describes *"media assembly and editing — combines
clips, adds audio, applies transitions"* — **the exact missing capability** — and has no code behind it. It is
a **dark tool**, the failure class `harness.integration.test.js:124` exists to catch; the test missed it
because it registers tool *families*, not individual grants.

This explains QC_EDITOR's own blueprint verbatim: *"`video.inspect` is not available. My tool search for video
inspection returned only `browser.inspect` … `shell_exec` was denied by consent … VERDICT: FAILED — The media
cannot be verified, so this production cannot be approved."* **QC_EDITOR behaved exactly as designed and
refused to approve what it could not see.** It even caught a real contradiction: PRODUCER's prose claimed no
video was written while host metadata recorded 10,284,443 bytes — ffprobe confirms the host was right.

**`/api/toolsets` lies about this**, as CLAUDE.md warns: it reports `qceditor` FULL ACCESS with `studio`
placed and all 21 tools including `video.inspect`. That is the interactive-lead view.

### A second truthful-telemetry defect, same shape as the fake video

`cron-orchestrator.js:119-121` derives `slot.approved` from a keyword scan of the QC text — and **nothing
reads it.** Stage success is `captureAgentOutput` returning **≥20 characters** (`:107`, `:612`). So a FAILED
QC verdict was captured as text, the stage counted done, and `workflow.status = "complete"` — while
`qceditor.approved = false` and `blueprint.status` remained `"in-progress"`. **"complete" means "four agents
emitted text and a clip exists", not "approved".**

### Commercial gaps on the memorial path (all manual, none hard)

- **Intake: none.** `cli.mjs:35` reads a hand-written JSON off disk. No HTTP route, no upload, no form, no
  email ingest.
- **Payment: none.** Zero payment code. `costs.mjs` is a *cost* book (`KINDS = ['model','credits','licence',
  'labour','fee','other']`) — no revenue, price or invoice concept exists.
- **Delivery: modelled, not implemented.** `orders.mjs:34` declares `packaged` and `delivered` with legal
  transitions; **nothing ever performs them**, and `cli.mjs:153` has no `package`/`deliver` command. Live
  `orders.jsonl` stops at `verified`. The film sits on the phone.
- **Zero Outbox integration.** The manifest contains **no memorial rows**; `memorial/` is referenced nowhere
  outside its own directory — no capability entry, no tool, no routine, no sidecar import. So no
  `/api/artifact` link, no ticketed download, no approval pill.
- **Stale alarm:** the digest still shows `NEEDS YOU (1)` for `verify-failed:life-worth-remembering` although
  the order later reached `verified`. `exceptions.resolve` is manual.

### Music licensing — the only real legal exposure, and it is structural

The **demo is clean**: `make-demo-assets.mjs:159-167` synthesises `bed.m4a` from three sine partials
(F3/A3/C4) via ffmpeg `lavfi` — no recording, no arrangement, no third-party rights. The README gets the law
right (a public-domain hymn *text and tune* does not make a *recording* public domain; sync licence ≠
performance licence).

**But `order.music.licence` is free text that nothing reads.** Grepped all 12 files: `licence` appears only as
a `costs.mjs` cost kind. No validation, no allowlist, no refusal, nothing carried into the delivered film. The
first time a family's favourite hymn *recording* goes into a paid order, the engine renders it without
comment. Scripture is KJV by convention in the spec, not by code.

### Studio Team registration gap

Of STORYWRITER / DIRECTOR / PRODUCER / QC_EDITOR / COPYWRITER, **only `qceditor` has ever registered a
deliverable.** The 4 `studio`-owned video rows were registered by the *pipeline*, in a single
2026-11-03T04:17Z backfill batch. All four studio agents run `reasoningEffort: "none"` — and their roster
models are **decorative on this path**, because `cron-orchestrator.js:378-379` overrides provider/model to
`openrouter` / `anthropic/claude-sonnet-4.5` regardless (and OpenRouter is overdrawn by $0.15).

---

## 6. Central Outbox integrity

| axis | live tally (54 rows) |
|---|---|
| lifecycle | `STAGED 36, VERIFIED 15, NEEDS_REVIEW 2, FAILED 1` |
| verification | `unverified 36, passed 17, failed 1` |
| qc | `not_reviewed 52, needs_review 2` |
| approval | **`pending 54`** |

- **Integrity layer is sound:** 0 rows missing checksum or byte count. Retrieval re-realpaths, re-reads with
  `O_NOFOLLOW`, fstats the open fd (size ceiling + regular-file check) and re-hashes against the registered
  sha256 — a moved, edited or swapped original is refused, not served.
- **19 of 54 rows are backfilled** (no real runId); 35 came from real runs.
- **The registration hook genuinely fires.** Proven live today: an unattended cron run wrote a 344-byte file
  and it appeared as row 54 at `STAGED / unverified / pending` — a new artifact correctly claiming nothing.
- **Nothing has ever been approved, and QC is essentially unused.** The machinery works (full ladder
  `STAGED → VERIFIED → QC_REVIEWED → APPROVED` proven live, producer self-QC refused 409); it has never been
  used on real product.

---

## 6a. Git divergence — measured, and TRACTABLE

**Fork point:** `fbddbf992` — 2026-09-28 15:29:26 -0400. Neither ref is an ancestor of the other; true
divergence. **40 local-only / 5,382 remote-only** commits. Remote tip `74fcd5040` (2026-10-29).

| | files changed | insertions | deletions |
|---|---|---|---|
| local | 280 | +45,873 | −250 |
| remote | **14,805** | +439,093 | −38,722 |

**The 14,805 is misleading: 11,596 of them (78%) are `frontend/assets/` + its generated `website/app/assets/`
mirror** — a bulk PNG drop, not code.

### The conflict surface is 34 files, not 14,805

`comm -12` on the two changed-file lists → **71 files touched on both sides**. `git merge-tree` (read-only,
writes nothing) → only **41 contain real `<<<<<<<` markers, totalling 117 hunks**; the other 30 auto-merge.
**7 of those 41 / 16 hunks are generated `website/app/*`**, free once `frontend/` is resolved and
`npm run sync:website` is re-run. **Effective manual surface: 34 files / 101 hunks**, and 73 of the 117 hunks
sit in just 10 files:

| hunks | file |
|---:|---|
| 15 | `sidecar/index.js` |
| 15 | `sidecar/tools/builtin/image.js` |
| 12 | `sidecar/providers/anthropic.js` |
| 6 | `qa/BUGS.md` |
| 5 | `sidecar/tools/builtin/orchestration.js` |
| 4 each | `frontend/app/modeldock.js`, `frontend/index.html`, `test/fast.list` |

`sidecar/index.js`: base 22,756 lines → local 24,200 (+1,473) → remote 29,987 (+8,326/−1,095). The remote grew
it 37%.

**Asset trees do NOT conflict** — `comm -12` finds **0** paths containing `assets/`. A merge yields the union:
bloat, zero conflicts.

### The tool relationship is BIDIRECTIONAL — CLAUDE.md is directionally wrong

Builtin tools: **56 local vs 49 remote**, but **14 local-only** (`audio`, `audio-inspect`, `higgsfield`,
`image-kling-upscale`, `image-qc`, `mockup-compose`, `openai-image`, `outbox`, `print-prep`, `stock-image`,
`vector-export`, `video`, `video-inspect`, `video-kling`) and **7 remote-only** (`apps`, `browser-orphans`,
`browser-upload`, `keys`, `plugin-author`, `station-control`, `station-show`). 49 + 14 − 7 = 56.
**A merge would GAIN us 7 tools.** CLAUDE.md's "we gained seven studio tools" implies a superset; it is an
exchange.

Absent on the remote entirely: `CLAUDE.md`, `STATION_FIELD_NOTES.md`, `deliverable-manifest.js`,
`frontend/app/outbox.js`, `tools/builtin/outbox.js`, `handoff-store.js`, `hostquota.js`,
`dispatch-budget.js`, all of `memorial/`.

**`.github/workflows/`:** local 11, remote 13; 5 of the 11 common files differ by blob SHA — exactly the five
CLAUDE.md names. **None conflict textually.** This is why the PAT needs `workflow` scope: GitHub counts
carrying our September copies as modifying workflows.

### Recommended strategy: merge remote INTO local on a disposable branch, then PR

Four options were costed. Recommendation is **(b) then (c)**: merge remote into local on a scratch
branch/worktree, resolve the 34 files **against the live station**, then push and open the PR.

Reasoning: (1) **direction follows authority** — conflicts in `permissions.js`, `inputpolicy.js` and
`capability/registry.js` can only be verified by a live `POST /api/run` checking for real
`agent.tool_call`/`agent.tool_result` events, which is possible *only here*; (2) **the rationale documents
live here** — `CLAUDE.md`/`STATION_FIELD_NOTES.md` do not exist on the remote, and resolving tier 2.45 or
`tool.js`'s throw blind to them is how the laws get "simplified" away; (3) the measured volume is tractable, so
option (a)'s implicit "too big to attempt" premise is unsupported; (4) it is incremental and fully reversible
until the merge commit lands.

**Doing nothing is not free:** the conflict surface was 0 files on 2026-09-28 and is 41 files / 117 hunks six
weeks later, with the remote advancing ~900 commits/week.

**Risks to accept:** no local CI, so verification is live-run evidence per project law, not a green suite;
"no regressions" must be established by running all steps individually and diffing the failure *set*;
`test/fast.list` itself conflicts (4 hunks), so a careless resolution silently stops newly-added tests from
running; the merged asset union grows an already-1.84 GiB repo.

**One merge-breakage prediction checked and CLEARED:** our `makeTool` guard throws on a top-level
`parameters:` key. Every builtin on the remote tip was grepped — the single hit
(`sidecar/tools/builtin/cua-computer.js:41`) is a *property named* `parameters` **inside** a correct `schema:`
block, identical on both sides. The guard is safe against the remote's 49 tools.

**Forbidden / do not attempt:** any merge or rebase writes the index and working tree, so it must never run on
`feat/harness-backend` directly — use a worktree. Force-push and history rewrite would destroy 5,382 remote
commits.

## 6b. Repo health and the six stray artifacts

`git fsck --no-progress --no-dangling` → **rc=0, no output. No corruption.**

```
count: 1315  size: 41.34 MiB | in-pack: 159010  packs: 2  size-pack: 1.84 GiB
garbage: 1   size-garbage: 48.29 MiB
```

**The "large committed media" fear is NOT borne out.** Of 75,195 blobs (8.21 GiB uncompressed), only **4
exceed 5 MB** (0.05 GiB total: `package/vendor/hf` 17.75 MB and three `qa/evidence` screenshots). The 1.84 GiB
pack is **2,607 blobs in the 1–4 MB band** — station PNGs under `frontend/assets/` *plus their generated
duplicate* under `website/app/assets/`. `monstera.png` appears twice at 3.95 MB each. **Generating
`website/app` from `frontend/` doubles every asset's cost in history forever.** Worth deciding whether
`assets/` belongs in git at all *before* the merge, since the union lands in one tree.

One cleanup item: `.git/objects/pack/tmp_pack_hWDNMW` — **50.6 MB, Oct 21**, an orphaned temp pack from an
interrupted fetch. Dead weight, not corruption. `git gc` would clear it; deliberately NOT run (repo write,
and a long CPU burn on this phone — do the `.spend-pending` pre-flight first).

### Artifact dispositions

| artifact | what it is | disposition |
|---|---|---|
| `.ob.json` | **9 bytes of ASCII: `not found`**, no newline. Captured stdout from a `curl -o` of a sidecar URL that 404'd (`index.js:9704` ends with exactly `res.end('not found')`). Nothing regenerates it. | **delete** — zero information |
| `pnpm-lock.yaml` | real `lockfileVersion: '9.0'` lock from the 2026-10-30 install | **gitignore** — a second lockfile beside `package-lock.json` invites the split again. Don't delete while `.pnpm` (113 entries, **959 MB**) holds the pty build |
| `pnpm-workspace.yaml` | **NOT a flat `allowBuilds: false`** — a per-package map denying `node-pty`, `onnxruntime-node`, `protobufjs`, `sharp` | **keep untracked; owner decision.** The durable `node-pty` fix is a **one-character edit** (`node-pty: false` → `true`). The other three denials are *correct* — `sharp` and `onnxruntime-node` genuinely have no android-arm64 build |
| `PROGRESS.md` | session log from HEAD `1d0ec8321` | **delete or ignore** — superseded, and its routing advice (openrouter primary; "anthropic has insufficient credit") now **contradicts** CLAUDE.md on both counts |
| `OMNIROUTE-REPAIR-CHECKPOINT.md` | aborted repair checkpoint, body says `Files modified: None yet` | **fold one finding into STATION_FIELD_NOTES, then delete.** It uniquely records the root cause CLAUDE.md lacks: OmniRoute's bundled `node-machine-id` has no android branch, so `machineIdSync(true)` throws → empty CLI token → every CLI management call 401s. *That* is why the session-cookie workaround exists |
| `designer-dispatch.json` | one hand-built `/api/run` body | **delete** — scratch; only value is as a correct `messages`-array example |

None of the six is gitignored, none has ever been tracked, none exists on the remote.

## 6c. Performance and scalability

**Not an imminent hazard — disk is fine.** `df`: 221G total, 109G used, **112G available (50%)**. I checked
this specifically because a full disk would break the spend ledger's journaled write and fail-closed-brick the
station; that risk is not live.

What has grown, measured:

| path | size | contents |
|---|---|---|
| `workspaces/` total | **9.8 G** | |
| `workspaces/agent` | **4.1 G** | |
| `workspaces/agent/outbox` | **3.4 G** | 1,110 files: 489 png, 350 json, 139 jpg, 60 md, 19 pdf |
| `workspaces/webdesigner` | 401 M | |
| `workspaces/outbox` | 341 M | |
| `workspaces/voice-cache` | 173 M | |

**`agent/outbox` has more than doubled** since the documented incident (1.58 G → 3.4 G). That directory is
`git add -A`'d into a shadow checkpoint repo before every mutating tool call, against a 500 MB ceiling. The
`sweepMemo` fix (remember a sweep that cannot win; retry only after 1.25x growth) means the symptom — ~20 s of
CPU at 216% of one core, 38.7 °C → 67.1 °C, per tool call — no longer recurs. **So this is a maintenance item,
not a reliability hazard.** The only shadow repo I found on disk is `agent/tools/.git` at 1.2 M.

The real git repo is **1.84 GiB `size-pack`** (1,315 loose objects), and `git count-objects` reports
`warning: garbage found: .git/objects/pack/tmp_pack_hWDNMW` — a leftover temp pack from an interrupted
operation. Harmless; a `gc` would clear it. I did not run one (outside read-only scope).

**Scalability view:** nothing here blocks the current one-phone, low-volume business. The structural limits
that would matter at volume are (a) `readRows()` re-parsing the whole manifest JSONL on every call and once per
file during `register()`, and (b) `GET /api/outbox` having no pagination. Both are O(manifest) and irrelevant
at 54 rows; both become real at thousands.

## 7. Ranked roadmap

Ordered by (production safety → spending protection → reliability → revenue). "Approval" = yours required.

### P0 — Restore model recovery
- **Wrong:** the saved fallback chain is empty; a 429 kills a run outright.
- **Evidence:** `{"models":[],"saved":true}`; `.bak` files hold the prior 4- and 8-entry chains; 7/8 slugs valid.
- **Why:** this is the single change that converts a quota hit from a run-killer into a rotation.
- **Consequence if ignored:** every unattended run dies the moment a per-model daily cap is hit.
- **Fix:** `POST /api/fallback/chain` with the 7 surviving slugs, free models last. Drop `inkling:free`.
- **Risk:** routes spend to anthropic (the one funded-looking lane). Free slugs may still 402 under OpenRouter's
  credit state — unverified.
- **Verify:** `GET /api/fallback/chain`; then one real run and confirm a `provider.fallback` receipt.
- **Approval: YES** (spending routing).

### P1 — Close the uncapped-worker gap
- **Wrong:** `perWorker` is 0, so dispatched workers run with `runCapUsd = Infinity`.
- **Evidence:** §1 table.
- **Why:** the protection the code intends is inert; harmless on cheap models, material on an expensive one.
- **Fix:** `BUDGET_PER_WORKER=0.50` in `~/.config/starnet/env` (narrowest — affects only delegated workers;
  needs a restart), **or** `perRun` via `POST /api/budget/caps` (live, no restart, but also caps your own
  interactive runs — 19 historical runs exceeded $1).
- **Risk:** too low a value truncates legitimate work mid-task.
- **Verify:** dispatch one worker and confirm `budgetScope:'run'` in its end event.
- **Approval: YES** (spending control).

### P2 — Make the day rail soft again
- **Wrong:** saving `perDay: 25` turned the soft rail strict; an orphan receipt bricks every metered run.
- **Evidence:** `budgetScopeIsExplicit` + `budget.js:133-139`; four historical brickings.
- **Fix:** clear `perDay` from the saved overrides. **Effective cap unchanged at $25.**
- **Verify:** `GET /api/budget/status` still shows `perDay: 25`; simulate an orphan and confirm runs proceed.
- **Approval: YES** (budget change).

### P3 — Give SCOUT the grant its job requires
- **Wrong:** SCOUT's routine has `unattendedGrants: []` but its only skill is Apify/Airtable connector work.
- **Fix:** add `connectors` to `7b22107c`'s grants.
- **Risk:** Apify runs cost money; the 8/day rail (`hostquota.js`) already meters both doors and fails closed.
- **Approval: YES** (enables third-party spend).

### P1b — Wire `video-inspect.js` (one line, $0, unblocks independent QC)
- **Wrong:** `video-inspect.js` is 234 lines of working ffprobe-based inspection, **read-scoped, no consent,
  no network, no API key** — and `index.js` never requires it. It is granted to the `studio` bay and
  unreachable.
- **Evidence:** `grep -c "builtin/video-inspect.js" sidecar/index.js` → **0**; QC_EDITOR's blueprint says
  *"video.inspect is not available"*; `grep -cE "fetch\(|https?://|API_KEY"` on the file → **0**.
- **Why:** this is the exact capability QC_EDITOR needed and lacked, and it is the cheapest possible fix —
  one `require` plus one `.register(registry)`, following `video-kling`'s pattern at `:84` / `:17560`.
- **Consequence if ignored:** no agent can independently verify any video, so the QC axis stays decorative
  and nothing can honestly reach `approved`.
- **Risk:** low — local, read-only, no spend. It adds one tool to the advertised payload
  (`test/payload.budget.test.js` has ~6% headroom).
- **Verify:** a real `POST /api/run` against `qceditor` and confirm `agent.tool_call` + `agent.tool_result`
  for `video.inspect` on a known file; compare its output against my `ffprobe` baseline above.
- **Approval: NO** — engineering, no spend, reversible.

### P1c — Delete or implement the `video.process` dark tool
- **Wrong:** `registry.js:375` grants `video.process` with **zero implementations in the repo**, described as
  *"combines clips, adds audio, applies transitions"*.
- **Why:** an advertised tool that cannot be called burns model turns and is the precise failure class the
  integration test exists to catch (it missed this because it registers families, not grants).
- **Fix now:** remove the grant row and add it to the integration test's per-grant check. **Separately**, if
  pipeline B is ever revived, assembly is a real subsystem — and `memorial/render.mjs`'s `assemble()` already
  does exactly this job in ffmpeg and could be factored out rather than written fresh.
- **Approval: NO** for removing the dead grant; **YES** for building assembly (a project).

### P4 — Wire a verification pass for images and files
- **Wrong:** one `setVerification` call site exists, in the studio *video* path. 36/54 rows can never leave
  `unverified`, so `APPROVED_UNVERIFIED` is unresolvable for most product.
- **Note:** `register()` deliberately refuses to assert verification (existence+checksum is *completion*, not
  quality) and that refusal is correct. The missing piece is a real per-kind checker.
- **Approval: NO** — engineering, but needs a decided policy per kind first.

### P5 — Persist `unpriced`/`costSource` on the ledger entry
- **Wrong:** `cost.js` computes `unpriced`; `ledger.js makeEntry` drops it. A proven-$0 row and an unpriceable
  row are byte-identical. 19 live rows / 1.7M tokens are unmarked unpriceable.
- **Approval: NO** — additive, changes no number.

### P6 — Decide the Etsy last mile
- Build Etsy OAuth (1-hour token refresh) and change the routine instruction, **or** accept a manual publish
  step permanently. Until decided, "autonomous Etsy revenue" is not a reachable goal.
- **Approval: YES** — product direction.

### Leave alone
- **OmniRoute config and the free-model strategy** — no evidence of a critical problem.
- **The production gate itself** — it worked exactly as designed; only its switch moved.
- **The `.spend-pending` receipt lifecycle** — audited and sound (fsync before rename, settlement journaled
  before the ledger write, read-back verified, exactly-once across any crash point; 2027/2027 unique `entryId`).
- **`register()`'s refusal to assert verification.**
- **The 12 pre-existing test failures** — documented, unrelated, and not worth churn now.

---

## 8. Readiness gates

**Before unattended production:** P0 (fallback chain) + P1 (worker cap) + P2 (soft rail). Without P0 a single
quota hit silently stops the business; without P2 a single mid-run kill bricks every agent.

**Before accepting real customers:** a delivery mechanism and an intake mechanism for whichever pipeline is
chosen; one artifact actually taken to `approval: approved` through the Outbox; and for memorial work, a
resolved music-licensing position. None of these exist today.

**Shortest safe path to first revenue:** reconcile the `isaiah-40-31` kit's four self-contradictions, add ALT
TEXT, and **publish it manually for ~$0.20.** That answers "will anyone buy a $5 KJV print" before another
dollar goes into a pipeline whose output nobody has proven anyone wants.

---

## 9. What I could NOT verify

- Whether `anthropic` has usable **balance** (auth confirmed; balance needs a billed call).
- Whether OpenRouter `:free` slugs still serve under a 402 credit state.
- The `claude-haiku-5-5` 5x-above-100k tier claim (not in the cache; no page fetched).
- Whether the 11:00 chain completes — unresolved at the time of writing.

## 10. Corrections to previous reports (mine)

1. **"No per-run spend ceiling"** — misleading. Routines carry their own caps; only dispatched workers are
   uncapped, and the day rail bounds them.
2. **"Arming alone would not restore motion"** — wrong. A live unattended run completed; the free tier resets.
3. **"The chain will exhaust Gemini quota mid-run"** — wrong. The 20/day cap is per *model*; four models give
   ~80 requests.
4. **"index.js carries 362 empty catches"** — it is 370, and was 370 before any of this work.
5. **"handleProductionArm's log line was fixed"** — it was missed in the first pass; fixed in `2f5f3486c`.
6. **CLAUDE.md's "four pricing rows added to prices.js"** — never happened; the file is byte-identical to its
   backup with zero `claude-haiku-5-5` rows.

---

## 11. The strategic recommendation

**Invest in the memorial engine. Do not invest in the studio agent pipeline.**

Pipeline B's gap is not a bug list, it is a missing subsystem: multi-clip generation, an assembly stage
(`video.process` is a registry row with no code), narration timing, per-clip continuity — plus two funded
wallets. Pipeline A already produces a **171-second verified 1080p film with music for $0.00**, and its gate
caught its own real defect on its first run. The difference is not incremental.

**Pipeline B's one honest use is as a TEXT stage.** STORYWRITER and DIRECTOR genuinely produce good
screenplays and shot lists (25,239 and 23,506 characters). Feed those into the memorial engine's order JSON —
which is exactly the degradation guarantee its README states: *"A hand-written order JSON must always
render."* **Let the agents improve the words; let ffmpeg make the film.**

### Shortest safe path to first revenue — two independent tracks

**Track 1 (Etsy, ~1 attended session, ~$0.20):** reconcile the `isaiah-40-31` kit's four self-contradictions,
add ALT TEXT, publish manually. Answers "will anyone buy a $5 KJV print" before more is spent.

**Track 2 (memorial, the stronger business):** it already makes the product. In order — (1) wire
`video-inspect.js` [P1b]; (2) add the music-licence gate to `verifyFilm`; (3) register finished films into
`deliverable-manifest.js` so `/api/artifact` serves them on a scoped ticket (follow `vector-export.js`, which
returns `producedFiles` — not `openai-image.js`, which omits it and never reaches the Outbox); (4) decide
intake and delivery, which are *operational* choices, not code. Steps 1–3 need no spend and no approval.

### What I would leave alone, restated

OmniRoute and the free-model strategy · the production gate · the `.spend-pending` receipt lifecycle ·
`register()`'s refusal to assert verification · the 12 pre-existing test failures · `memorial/verify.mjs`'s
comparative jitter check (its reasoning is written out at `:1-24` and it is right).

## 12. Corrections to previous reports (continued)

7. **`.ob.json` was never an anomaly — that was my error.** It is 9 bytes of ASCII, `not found`, with no
   newline (`od -c` confirms). `cat` **succeeded** and printed the file's contents; I read that output as a
   shell error. It is captured stdout from a `curl -o` of a sidecar URL that 404'd (`index.js:9704` ends with
   exactly `res.end('not found')`).
8. **`pnpm-workspace.yaml` is not a flat `allowBuilds: false`** — it is a per-package map denying four
   packages. The `node-pty` fix is a **one-character edit**, and the `sharp`/`onnxruntime-node` denials are
   *correct* (no android-arm64 build exists).
9. **The local tree is not a tool superset.** 14 local-only vs 7 remote-only builtins; a merge GAINS 7 tools.
10. **"the gate halts at step 219" and "line 219 of fast.list" are different things.** The runner's step index
    is not the file line number: `fast.list` has 1,004 `test/` lines (1,007 non-empty, 1 comment) and line 219
    is `workshop-store.test.js`, while the runner reported stopping at step 219 = `workshop-undo.e2e`. Both
    numbers are right about different quantities; quote the runner's.
11. **`memorial/README.md:67-68` is now stale** — it says the two tests are *not* registered in
    `test/fast.list`; commit `93b2dd11c` registered them at lines 1006-1007.

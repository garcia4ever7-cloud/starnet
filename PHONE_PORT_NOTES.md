# Phone port notes: upstream v0.15.4 on Termux (Fold 8)

Base: upstream tag v0.15.4 (`124b20a6b`), checked out detached. Nothing here is committed.
Work files live outside this repo, in `~/starnet-next-work/`. The test workspace is `~/starnet-testws/`.

## 1. Termux fixes (applied, uncommitted)
- `sidecar/workspace-owner.js`, hard-link fallback (from phone commit `a0da5104c`). Android refuses `linkSync`
  (EACCES), so the lock falls back to an exclusive `copyFileSync`. Without it the station can't take its lock.
- `sidecar/workspace-owner.js`, EPERM fix (from `ad1c83fea`). On Android, `kill(pid,0)` can answer EPERM.
  An ENOENT from `/proc/<pid>` now proves a dead lock holder, so a stale lock no longer blocks every boot (exit 73).
- `sidecar/process-identity.js`: Node reports `android`, so it's treated as `linux`. That turns on the
  `/proc/<pid>/stat` start-time check, which upstream otherwise skips here.
- `test/workspace-owner-election.test.js` (test half of `a0da5104c`). The test fakes a crash on the copy path
  too; without that it can't pass on Android, and it fails on unpatched upstream here as well.
- `STARNET_TRUST_LOCAL_PEERS=1` goes in the test env file only (`~/starnet-next-work/env/test.env`). Android
  denies `/proc/net/tcp`, so the page's peer-owner check can't work.
- Install: `npm ci --force --ignore-scripts` (onnxruntime-node lists no android). node-pty was built from
  source against `$PREFIX/include/node`. sharp uses its WebAssembly build `@img/sharp-wasm32` 0.35.5 with
  `@emnapi/runtime` 1.11.3; both come from the lockfile and their integrity hashes matched.
- `sidecar/persist/replace.js`, fourth fix (step 4, 2026-11-26). Correction to the earlier note: the `.bak` generations
  were NOT lost. Upstream already falls back to a durable copy when `link()` fails, and the `.bak` files were being
  refreshed. The bug was noise: EACCES was missing from the "no hard links here" list (`NO_LINK`), so every save
  logged `[failopen] persist.bak.link … EACCES` and bumped the fail-open counter. EACCES now counts as no-hard-links
  on Android only, so a real EACCES elsewhere is still reported. Test: `~/starnet-next-work/1-termux-fixes/
  bak-copy-fallback.test.js` (fails on unpatched upstream, passes patched). The 8788 boot logged zero `persist.bak` lines.
- `sidecar/workspace-owner.js`, step-2 fix reworked in step 4: the hard-link fallback now uses persist's own
  `copyExclusive` (open `wx`, fsync file and directory, a partial copy removed) instead of a bare `copyFileSync`,
  because upstream's `persist.lint` forbids direct write sites. The semantics are unchanged: an atomic create-or-fail,
  and an existing name still throws EEXIST. The election test's crash injection moved to the copy's `closeSync`,
  which is the same "name holds complete bytes" boundary `link()` marks.
- Not run on purpose: onnxruntime-node install scripts (voice). Their binaries are for glibc and won't
  load on Android.

## 2. Shop safety ports (step 4, 2026-11-26; uncommitted)
The 10 phone commits are fixes on top of phone-only features (none of them, and none of their bases, are in upstream).
Each was adapted to v0.15.4, not forced. Patches: `~/starnet-next-work/2-shop-safety/` (`shop-safety-modified.patch`,
`shop-safety-new-files.patch`); the original phone patches are in `orig/`, and the edit scripts in `scripts/`.

**Ported**
- **Production gate**: `2f5f3486c`, `c0a1d0096`, `e5c8da4ab`, plus the gate base they fix (from `ac6382d1a` and
  `da18e7614`). New `sidecar/production-gate.js` (byte-identical to phone). In `index.js`: the arm state is read from
  `.production-arm.json` on every run (same file as 0.12.5, so the live ARMED state carries over); an append-only
  `.production-arm.log.jsonl`; `GET /api/production/status` and `POST /api/production/arm` (strict boolean, `by` is
  a label); the run-start refusal before managed credit and before any provider call; and `production` plus
  per-routine `gateBlocked`/`gateCode`/`gateBecause` in `GET /api/cron`.
  Adaptations:
  - The refusal is settled with `failureCode: 'production_disarmed'`, not `reason: 'refused'`. In v0.15.4 "refused"
    is the word for a MODEL refusal, so a gate refusal would have read "the model declined the request".
  - `cron-store.markRun` gets a **declined** outcome keyed on that code: no retry, the failure streak is untouched,
    no auto-pause, no delivery, and the routine stays scheduled. A `nextRunAt` that is not in the future is re-armed,
    so a decline can't loop on every tick. A declined one-shot is stopped like a stopped one-shot.
  - `e5c8da4ab` is narrowed: the Commander-started workshop flag (`gateAsInteractive`) feeds a gate-only
    `gateSurface`. On the phone it widened `accessSurface`, which also drives other access decisions. The unused
    `o.surface` override was dropped.
  - Metering in the routines snapshot uses `billing.policyOf(provider).ledgerMetered`, the same input as the run
    path. The phone's NO_MODEL/NO_CREDENTIAL extras were not ported (v0.15.4 has its own config surfaces).
  - The arm history is rewritten durably (`writeFileDurable`), not appended, to satisfy upstream's persist policy.
- **Apify cap**: `8557798db`, plus base `hostquota.js` (from `2dc5b32e6`). New `sidecar/hostquota.js` (phone HEAD,
  with the counter now written through `sidecar/persist`, which is atomic; the phone's plain write could tear). Both
  doors are wired: the MCP connector (`manager.js` passes `quota` to every tool def, and `translate.js` counts
  before the call leaves) and `web_request` (`web.js`, counted after URL validation, before secrets are resolved
  or the request is sent). The counter file is `.host-daily-quota.json`, the same as 0.12.5. Defaults: 8 per day
  team-wide, 3 per run (`STARNET_HOST_DAILY_LIMITS` / `STARNET_HOST_RUN_LIMITS`). The QA doc files in `8557798db`
  (`qa/BUGS.md`, the bug note) were not ported.
- **`b0dcc0b2c`, generic half only**: `tool.js` refuses a def that declares `parameters:` instead of `schema:` (no
  v0.15.4 tool does; the 8788 boot registered every builtin), and `registry.js` appends "This tool accepts — …" to an
  invalid-arguments error. Its outbox half is blocked (below).
- **Etsy lifecycle**: `14160ee7b`. `sidecar/etsy-workflow.js` and its test, identical to phone. Nothing imports it, on
  the phone or here: it is a library plus a test with no runtime effect yet.

**Not ported**
- **Superseded: `893070f29`** (pooled worker budget). Upstream `run-spend-pool.js` (bug d3a76db3) makes the LEAD
  run's per-run cap cover every worker, clone, repair and resumed worker, which is stricter. `BUDGET_PER_WORKER` is
  still honored; **`BUDGET_WORKER_POOL` is ignored on v0.15.4.** Money effect: the chain's $2.00 cap becomes the cap
  for the lead and all its workers together (on 0.12.5: $2.00 lead + $2.00 worker pool). The chain may stop sooner.
- **Blocked: `c9b56ca46`, `21e1e7c79`, `6b141f46d`, and the outbox half of `b0dcc0b2c`** (outbox approval). They
  patch phone-only `deliverable-manifest.js` (51 KB), `frontend/app/outbox.js` and `cron-orchestrator.js`, and the
  studio tools `image-qc`, `print-prep`, `stock-image` and `vector-export`. All arrive in `ac6382d1a` (51 files,
  ~6,000 lines) and `2dc5b32e6` (160 files, ~21,400 lines). Upstream has its own `deliverable-store.js` with no
  approval concept. They belong with the pipeline port (deliverables register). **Now ported with it: see 3c below.**

**Carry-over checked**: the 0.12.5 chain-retry patch (`cron-driver.js`, live since 12:12) is NOT needed on v0.15.4.
Upstream's driver already settles a fire on the lead's own runId only (`lead = !p.runId || p.runId === runId`).

## 3. Pipeline ports (step 5 of the port, 2026-11-26/27; uncommitted)
Ported from phone HEAD versions (which already contain every later phone fix), adapted to v0.15.4. Patches:
`~/starnet-next-work/3-pipeline/patches/pipeline-port.patch` (this step only, against the step-4 tree) and
`~/starnet-next-work/all-changes-vs-v0.15.4.*.patch` (everything). The phone's own tests are in `3-pipeline/phone-tests/`;
the ones that apply were copied into `test/` and added to `test/fast.list`.

**3a. Orchestrator routine permission** (the live Etsy chain `ebc4f07d` carries `unattendedGrants: ['orchestrator']`)
- v0.15.4 knew only `workbench`/`connectors`/`studio`, so on load it would drop the chain's grant and a SCHEDULED
  NIGHT4CHRIST could not call `team.dispatch` at all (the pipeline would only run with a browser tab open).
- Ported: `orchestrator` in `cron-store` GRANTABLE and `inputpolicy` GRANTABLE_UNATTENDED; the object half in
  upstream's `capability/project-tools.js` (orchestrator object for a granted routine's LEAD run only — never a
  delegated worker: `delegatedBy`/`parentRunId` depth fence, max depth 1); the consent half `dispatchAutonomy` in
  `permissions.js` above the exec lockout, narrowed by exact tool name (team.dispatch / subagents / steer / interrupt /
  resume; routine.create, loop.*, team.summon, team.spawn stay human-gated), and like its siblings refused on a tainted run.
- Ported the workshop TOOL-NAME allowlist (`image_generate`, `image_print_prep`, `mockup_compose` may write unattended
  for a workshop-granted agent; `vector_export`/`image_stock_fetch` not), and `outbox`/`deliverable`/`taskplan`/
  `routinescratch` as safe built-in capabilities (fallback; the tools declare impact `none` themselves).
- The chain's grant survives the v0.15.4 load (checked on 8788). Upstream's authority seal does not strip it: this
  station is "unkeyed" (never sealed), which carries records unchanged.
- **Host handoff files** (the chain prompt and NIGHT4CHRIST's dossier say "the station files every handoff as a file in
  your outbox"): `handoff-store.js` + the hook in `team.dispatch`. Adapted: filed the moment the worker row is in hand,
  BEFORE the post-worker delivery phase (live run c1bce71a), and the outcome word / `complete` come from the host's
  typed worker verdict (`row.status`), not the bare end word — in v0.15.4 a run can end `done` but be cut short. Same
  file name and folder (`WORKSPACES/<lead>/outbox/<ts>-<lead>-to-<worker>.md`). Written through `sidecar/persist`.
  Not ported: the phone's slow-phase stdout diagnostic (observability only).
- **Lease must outlive the dispatch** (`dispatch-budget.js`, live runs c1bce71a/b7003a7a): upstream's defaults TIED the
  dispatch backstop (480 s + 900 s approval hold + 60 s = 1440 s) with the open-call lease window (3 x 480 s = 1440 s).
  The budget is now derived from that window (420 s by default; the phone uses 360 s), an explicit
  `STARNET_DISPATCH_TIMEOUT_MS` still wins, and a breaking value is warned at boot. The same constants are passed to
  the driver (`toolStaleMs`) and the tools (`approvalHoldMaxMs`).

**3b. Print and studio tools** — `image_print_prep`, `image_quality_check`, `vector_export`, `image_stock_fetch`,
`mockup_compose`, `openai_image_generate`, `higgsfield.generate`, `video.inspect` (phone HEAD modules, unchanged except
a declared `impact: 'none'`, which v0.15.4 requires; the studio family is `none` like upstream's `image_generate`).
Grants as on the phone; floor-prop rows in `toolprops.js`. They resolve paths through v0.15.4's own fs jail
(`resolveInside`, same per-agent workspace). Adapted: the two PAID generators now pass the same pre-spend check as
`image_generate` (run cap, lead+workers pool, unknown-cost image limit) before anything is sent; on the phone they
had none. Keys and routes unchanged (OPENAI_API_KEY; HF_CREDENTIALS). Also ported the generic guard that a tool must
declare a top-level `name` (825ee4b62).
Not ported: `video.kling` and `image_upscale_kling` (never callable on the phone either; paid), `video.js`/`audio.js`
tools (never required on the phone), and the phone's `image.js` routing changes — v0.15.4 keeps its own
`image_generate` router (OpenRouter / OpenAI Images / ChatGPT plan; default `google/gemini-3.1-flash-image`).

**3c. Deliverables register and the Central Outbox** (+ the held-back commits `b0dcc0b2c` outbox half, `c9b56ca46`,
`21e1e7c79`, `6b141f46d` — all live inside these phone-HEAD files)
- `deliverable-manifest.js` (+ `deliverable-files.js`) rooted at `WORKSPACES/.deliverables` (same as 0.12.5), host
  registration of every run's artifacts at run end, share rules (DESIGNER -> PUBLISHER + QC_EDITOR; studio crew),
  `outbox_list`/`outbox_read`, `GET /api/outbox`, `GET /api/artifact` (+ streaming/Range for video),
  `POST /api/outbox/approval` (unverified needs `acknowledgeUnverified`, stamped in the audit text), `POST /api/outbox/qc`
  (no self-review), `POST /api/deliverables/register` (fbc370ebb). Route handlers lifted verbatim by line range
  (`3-pipeline/orig/phone-index-blocks/`). Manifest appends now use upstream's durable JSONL append (torn-tail guard,
  fsync, read-back) instead of a bare append — same file, same format.
- Tickets: `artifact` and `studio` kinds added to `sidecar/apitickets.js` and `frontend/app/apiticket.js` (a link or
  `<img>` carries no token header).
- UI: CENTRAL OUTBOX window (`centraloutbox`, as on the phone) as a MY WORK tab after DELIVERABLES; `outbox.js` uses
  the station's one canonical escaper (`U.esc`); CSS block verbatim; website mirror kept byte-identical.
- 8788: the copied live manifest reads **137 rows for the Commander** (PUBLISHER 55, QC_EDITOR 57, DESIGNER 49) —
  identical to the phone's own module on the same file.

**3d. Studio video pipeline** (`cron-orchestrator.js` + `project-orchestration.js`, `video-providers.js`,
`higgsfield-video.js`, `audio-finish.js`, `video-verify.js`; `/api/studio/assignment`, `/api/studio/project`,
`/api/studio-file`; the studio -> Outbox bridge). Includes the no-delegate stage prompt (b82cc582d). Adapted: the
orchestrator no longer reads `~/.config/starnet/env` at load (the host hands it the token); studio projects resolve
beside the station workspace like the sidecar does (same default path as before); the bridge's "new deliverable" card
uses the SSE hub (on the phone it called a non-existent `emit` and silently never showed). Stage model unchanged: the code default is
`anthropic/claude-sonnet-4.5` via OpenRouter, but the LIVE env sets `STUDIO_PROVIDER=openai`, `STUDIO_MODEL=gpt-6-luna` (read
2026-11-26 from the running sidecar), so studio stages run on OpenAI gpt-6-luna; v0.15.4 prices it (live price cache). Not ported:
`cron-orchestration-tasks.js` (imported by nothing).

**3e. Integrity script** — `scripts/agent-config-integrity.mjs` (+ test), resolving providers and profiles through
v0.15.4's own modules; reads the v7 copy as CONSISTENT. The script e87ac7181 retired is phone-only.

**3f. Skill** — `sidecar/skills/library/judgment-rubrics.md`: installed on 8 live agents, missing from v0.15.4's library
(an unresolved skill silently drops out of the agent's context). The four other unmatched skill names are learned
skills in `skills.jsonl`, which carries over with the workspace.

**3g. Fixes from the full regression sweep (upstream invariants the ported code had to meet):**
- **Security (live on 0.12.5!):** `higgsfield.generate` appended a model-supplied `endpoint` to the base URL, so
  `@evil.example/x` sent the request — with the hf-api-key/hf-secret headers — to another host, and both Higgsfield
  modules followed a response's `status_url` anywhere with the key headers. Probed on the phone module: it dialled
  `evil.example`. Ported version: only a `/v1/...` path on platform.higgsfield.ai, and an off-origin status URL is
  ignored. Regression test `test/higgsfield.port-security.test.js`. The live station is NOT fixed (not touched).
- **Persist policy:** every ported file write now goes through `sidecar/persist` (writeAtomic / copyExclusive /
  moveAside / durable JSONL append): print-prep, mockup-compose, vector-export, stock-image (+ licence record),
  openai-image, higgsfield, project-orchestration, audio-finish, video-providers, deliverable-manifest, hostquota,
  handoff-store. Same files and formats.
- **Typed outcomes:** a studio stage passes only on a `succeeded` outcome (a cut-short run, a step/spend stop, a question
  or a stream with no terminal outcome now fails the stage instead of handing partial text on — confirmed the real
  `/api/run` end payload carries `outcome`); the stage's reply goes through the station's reply assembler (narration
  before a tool call is dropped); handoff files take their outcome from the host's typed worker verdict.
- **Fail-closed kept:** I had added deliverable/taskplan/routinescratch/outbox to the safe-capability fallback; reverted
  (a bare re-registration must stay external-unknown). The real tools declare impact `none`. `outbox` is a toolset
  freebie instead (a restricted routine keeps the read-only consumer door, as on the phone).
- **Credential census:** openai-image names no env variable (asks for "an OpenAI key in SETTINGS"); its default host
  constant and the two studio dialers (openai-image postGenerate, video-providers tryKling) have census rows.
- **Catalogue:** the 9 ported factories are declared in `tools/catalog.js` (GET /api/toolsets' projection sees them).
- **Production gate (step-4 follow-up):** `crew-defaults.invariant` drives unattended mock runs and was refused by the
  step-4 gate on its fresh (disarmed) sandbox — step 4 did not run the full suite, so this was missed then. The test now
  arms its own sandbox; the fixture gained the phone's `armed` option (bd14f909c). The gate default is unchanged.
- **Pins updated on purpose** (each with a PORT comment): capgate, routing.b5, harness.integration, inputpolicy (the
  computer now also grants outbox_list/outbox_read), tool-withheld-message (orchestrator in the closed grant list),
  front-doors-tabs (CENTRAL OUTBOX tab), reply-assembler census (the studio pipeline is an assembler user).
- **NOT re-captured — owner decision:** `test/authority-census.test.js`'s authority matrix. Diff saved in
  `~/starnet-next-work/3-pipeline/authority-matrix.diff.txt`: 734 cells in 64 scenarios, **every one about the 10 ported
  tools** (580 advertised, 20 granted, 8 withheld rows); no existing tool's authority moved. A re-capture is pinned to a
  commit hash, so it waits for a commit.

**3h. Found in the switch-over research (2026-11-26 night) and ported:**
- **Per-routine spend ceiling was missing.** v0.15.4 kept a routine's `maxCostUsd` in `cron.jobs.json` but no code read it; with
  the station PER RUN at 0 every routine fire would have run with NO per-run cap (only the $25/day rail). Ported (phone
  ac6382d1a): `cron-store` stores/normalizes/edits it (`normCostCap`: junk or negative -> null, clamp $1,000), the scheduled
  fire and Run Now pass it as `routineCapUsd`, and `runOnceCore` folds it into the run's LOWER-ONLY ceiling (min with a line
  hop's `ceilingUsd`, which stays the line-hop marker). Because v0.15.4's spend pool follows the run cap, **the chain's $2.00 now
  bounds the lead AND all its workers together.** Test `test/routine-cost-cap.port.test.js` (13).
- **Arming production asks for the desk code** (route-authority census: a raise must carry the desk proof; upstream's open set
  is empty). Disarming, and re-arming an already-armed station, never ask. The live arm state carries over armed, so nothing
  is needed at the switch-over. Pinned in `test/production-gate.port.test.js`.
- **Desk proof on this phone:** the arming action had to join `sidecar/deskproof.js`'s action whitelist (the final 8788 smoke
  hit 500 "unknown desk action" without it). And v0.15.4 writes NO desk code to a kept log: under the launcher (stdout -> tee ->
  sidecar.log) the env needs `STARNET_DESK_CODE_TO_LOG=1`, or no raise can ever be confirmed. Verified end to end on 8788.
- **Upstream e2e tests vs the gate:** 10 HTTP-list tests drive unattended runs on metered mocks; on a fresh (disarmed) sandbox
  the gate refused them. Each now arms its own sandbox (`process.env.STARNET_PRODUCTION_ARMED = '1'`, as the phone's
  bd14f909c did); the product default is unchanged.

**Phone bugs found (ported as-is, owner decision):**
- `image_print_prep` writes JPEG since 10-22 (Etsy's 20 MB cap) but `image_quality_check` accepts PNG only
  ("not a PNG (bad signature)"), so QC of a print-prep file fails. The phone's own test still names the old `.png`.
- A studio project whose stage fails at submit stays `status: running` on disk forever.

## 4. Tests run
- 510 `sidecar` files pass `node --check`.
- node-pty spawns a shell; sharp (wasm) renders a PNG; @napi-rs/canvas loads.
- workspace-owner (114 assertions), workspace-owner.e2e (9), workspace-owner-election (PASS) and
  process-identity.fixtures (96) all pass.
- Test boot on 8788 against the copy: up in 2 s, seals "unkeyed" as expected, the lock was taken, and the
  routines were skipped.
- v7 move, first try: blocked. With no key, the page waits on RESUME ("Enter your key").
- v7 move, done 2026-11-26 about 13:11 PST, with an obviously fake Anthropic key (now deleted) and all network
  blocked by `offline-guard.cjs`. 7 calls were attempted and all blocked: 4 to api.anthropic.com, plus
  openrouter, account.starnetos.com and bing speech. $0 spent.
  - The page went in by itself, with nothing clicked. Save v6 to v7 in 9 s (rev 5593 to 5599), and
    `agent.save.pre-history-ref.json` was kept.
  - Chats: all 71 listed sessions load, each with the same message count and text length as v6 (750 messages).
    8 old routine-run sessions left the list. That is 0.15.3's documented "newest 10 per routine" rule, and
    their transcripts stay. All 8 chats typed by hand are kept.
  - Agents: all 10 identical (name, model, provider, approval, prompt). Integrity is CONSISTENT.
  - **Dossier: 2 lines changed by the page, by design** (upstream `2ef2cb718`, `seedFromDocs` resync).
    Untouched lines once copied from NIGHT4CHRIST's context and operating manual now follow those docs:
    identity #1 ("learn how AI agents work … reels") and standing order #2 ("Be terse …") were replaced with
    the current Etsy team rules and "Each run" text. The prompt went from 12,147 to 10,802 chars. Hand-edited
    lines (cd_4, cd_14 and the rest) were not touched. The owner must accept this before cutover, or remove those
    two seed lines in 0.12.5 first.

- **Step 4 (2026-11-26 ~14:28 PST), 8788**, same rules as step 3 (sandbox HOME, all network blocked by
  `offline-guard.cjs`, an obviously FAKE Anthropic key in that process env only:
  `~/starnet-next-work/tests/run-test-station-step4.sh`). $0 spent.
  - Boot clean; no `persist.bak` lines (step 3 logged 5), no schema-guard throw.
  - `GET /api/production/status`: armed, persisted, "recorded by: unattributed", the live state carried over.
  - Disarm: a non-boolean is refused; the log line reads "DISARMED at … (recorded by: step4 test on 8788 —
    unverified)"; the history log line was written; `GET /api/cron` reported `blockedJobs: 1` with the chain
    `gateBlocked: PRODUCTION_DISARMED`.
  - Run Now on the chain while disarmed: `[production-gate] REFUSED … usd=0`, no provider call, no run row. The
    record read `lastStatus: declined`, streak 0, retry 0, still scheduled and enabled, next run 11-30 03:00.
  - Run Now while armed: the gate let it through, it reached `api.anthropic.com` (blocked), and the run ended at
    `usd: 0`. 9 Anthropic attempts were blocked, plus 2 boot probes (OpenRouter, Bing voice); 11 in all, every one
    blocked.
  - Integrity CONSISTENT afterwards (10 agents, rev 5599). The test copy's arm files, quota file and
    `cron.jobs.json` were restored byte for byte from `test-output/step4/pre-test-snapshot/`. Left behind: one
    $0 row each in the copy's `runs.jsonl` and `ledger.jsonl`.
  - Note: in the test copy the chain was OFF (live it is ON). It was switched on in the copy for this test only,
    and switched back when the snapshot was restored.
  - Unit and regression (all pass): production-gate 118, production-gate.port 13, hostquota-run-cap 42,
    hostquota.port-wiring 9, tool-schema.port 4, etsy-workflow 74, persist.lint 102, cron-store 166, durable-store
    55, workspace-owner 114 / e2e 9 / election PASS, process-identity 96, web-request 118, the MCP suite (15 files),
    tools 119, run-table 154, budget-caps 77, failopen-ratchet 151, lint-determinism, and `node --check` on 513 files.
  - Pre-existing on Android (they fail identically on unpatched upstream, so not caused by the port):
    `durable-store-faults` 127/128 (expects a real hard link), `workspace-owner-election` before the fix,
    `workshop-implement.e2e` (2 checks), and the fixture-based `persist-seam.http` / `payload.budget`
    (boot token withheld; `persist-seam` passes with `STARNET_TRUST_LOCAL_PEERS=1`).
  - Known wording nit: `cron.result` (the HUD line) still says outcome "failed" for a declined fire. The routine's
    record says `declined`, with the gate's own explanation in `lastError`.

- **Final regression sweeps (2026-11-26 night, frozen tree; `~/starnet-next-work/test-output/sweep2/`):**
  fast list 1,904: 1,875 pass; 28 pre-existing (identical on pristine v0.15.4 + Termux fixes); 1 port-owned
  (`authority-census`: matrix re-capture waits for a commit; diff = only the 10 ported tools).
  HTTP list 401 (first time swept): 310 pass after arming 68 test sandboxes (gate vs metered mocks); 91 pre-existing; 0 regressions.
  Final 8788 smoke: version 0.15.4, armed carried over, chain cap/grant kept, Outbox 137 rows, desk-confirmed arming works
  (with STARNET_DESK_CODE_TO_LOG=1), $0.

## 5. After the switch-over (2026-11-26 night, LIVE on this tree)
- **`image_quality_check` accepts JPEG** (qa/bugs/1b5addcc): print-prep ships JPEG since 10-22; QC was PNG-only. New `parseJpeg`
  (SOI, segment lengths, SOFn, SOS, EOI; DPI from JFIF) beside `parsePng`; the bytes pick the parser. `test/image-qc-jpeg.test.js`.
  Replay on the live 4x5 print file: before FAIL "not a PNG (bad signature)", after PASS 4800x6000 @ 300 DPI.
- **Fable 5.2 / Mythos 5.2 priced at the published $8/$40** (cache hits 0.025x) in `sidecar/providers/prices.js` — they fell into the
  Fable 5 row ($10/$50). Opus 5.5 $4/$20 was already right. `test/prices.fable52.port.test.js`.
- **A page key the Commander removed does not ride a run** (2026-11-27): a browser page keeps its localStorage key and sends it with
  every `/api/run`, and a per-run key wins — so after the station's page copy was REMOVED (tombstone) an old, revoked key kept
  failing page chats over to the fallback chain. `handleRun` now drops the body's key / spare keys / endpoint when the provider's
  page copy is a REMOVE tombstone AND the station's key for it is an env key (`retiredPageKey`); a key saved deliberately in a page
  replaces the tombstone and is honoured. `test/retired-page-key.e2e.test.js` (http.list): 21 OK on this tree; on pristine v0.15.4
  row 2 fails (the removed key went upstream).

> **HISTORICAL snapshot — not current state (marked 2026-11-26).** Written in Oct–Nov 2026; agents, models, routines and dossiers have changed since. For the live state read `handoff.md`, then `CLAUDE.md` "Where we left off".

# RECOVERY CHECKPOINT — 2026-11-11, QC-integration directive

**Paused mid-turn at the owner's request (usage limits). Work is COMMITTED and durable.**

| | |
|---|---|
| Branch | `feat/harness-backend` |
| HEAD | **`7bc5c4fdd`** — follow-up fixing 3 defects the completed sweep caught in `825ee4b62` |
| Working tree | **clean** (0 tracked modifications) |
| Published backup | `origin/feat/approval-axis-20261110` = `93b2dd11c` (the PREVIOUS commit; `825ee4b62` is **local only, not pushed**) |
| Remote `feat/harness-backend` | `74fcd5040` — untouched, 5,382 commits intact |
| Live station | **pid 11810, healthy, running PRE-change code.** No restart was performed. |
| `.spend-pending` | empty |
| Production gate | **ARMED** (persisted `2026-11-11T02:34:11Z`) |
| Spend today | `$0.055229675` |

---

## What is DONE and verified (Phases 1–5)

**Phase 1 — baseline.** Branch/HEAD/tree recorded, remote verified, checksums taken
(`scratchpad/phase1.md5`), live service + OmniRoute recorded untouched (key fingerprints MATCH), telemetry
and test baseline captured.

**Phase 2 — `video.inspect` implemented and registered.** NEW `sidecar/tools/builtin/video-probe.js`,
ID-addressed through a new `deliverableManifest.resolvedPathFor()`. `video-verify.js` now exports `probe`
so there is ONE ffprobe implementation. **Offline-verified against an independent ffprobe baseline** —
reproduces `h264 1920x1080 / aac 2ch / duration 171.200000 / bit_rate 1532883` exactly, and rejects both
known fakes (32,770-byte 23 kbps clip; 1,056-byte stub). 13 fail-closed refusals all hold.

**Phase 3 — seven dark grants purged (studio 21 → 14)** and `makeTool` now throws on a nameless def.
That guard caught a **second** live offender (`image-kling-upscale.js`) I had not predicted.

**Phase 4 — completion no longer implies approval.** NEW `pipelineOutcome()` in `cron-orchestrator.js`;
`ok` requires `stagesComplete && qcApproved`; absent verdict → `qc-missing`, never a default allow. The
`workflow.status` enum is deliberately unchanged. PRODUCER's prompt no longer says "Call video.kling".

**Phase 5 — git reconciliation MEASURED, not performed.** A disposable detached worktree merged
`origin/feat/harness-backend`: **41 conflicted files / 117 hunks** (confirms the earlier `merge-tree`
estimate). 7 files / 16 hunks are generated `website/app` → **34 manual files / 101 hunks**, 73 in 10 files.
Merge ABORTED, worktree removed, nothing on the live branch touched.

Full conflict map: `scratchpad/conflictmap.txt`. Top: `sidecar/tools/builtin/image.js` 15,
`sidecar/index.js` 15, `sidecar/providers/anthropic.js` 12, `qa/BUGS.md` 6,
`sidecar/tools/builtin/orchestration.js` 5. **Safety-critical (1–3 hunks each):** `permissions.js`,
`inputpolicy.js`, `capability/saved-placement.js`, `tools/registry.js`, `apitickets.js`.

---

## RESUME HERE — Phase 6, blocked on owner approval

Phase 6 (live telemetry) **requires two things I must not do unilaterally**:

1. **A sidecar restart** — unavoidable. pid 11810 holds the pre-change code in its `require` cache, so the
   new tool is not registered in the live process.
2. **A paid QC_EDITOR run** — a real `POST /api/run` on gemini, ~$0.03.

**Everything is pre-staged.** Restart pre-flight already verified: `.spend-pending` empty,
`STUDIO_ALLOW_UNACCOUNTED_SPEND` still commented out, OmniRoute fingerprints match, no run in flight.
Restart by killing the launcher (derive it from the node process's **ppid**; `pgrep -f 'start-starnet.sh'`
matches Claude Code's own shell wrapper) then `setsid nohup bash ~/start-starnet.sh`.

**Timing:** the Etsy chain `ebc4f07d` fires at **11:00 UTC**. Do not restart inside that window.

### The exact test to run

Positive case — `verification: passed`, 10,284,443 bytes:
```
studio:proj-1793603158934-r0x5zq:proj-1793603158934-r0x5zq_video.mp4@v1
```
Independent ffprobe baseline to match against:
```
h264 720x1264 | aac 2ch | duration 5.366667 | bit_rate 15330845
```

Negative case — `verification: failed`, 32,770 bytes (proves a failed artifact cannot reach approved):
```
studio:proj-1792964044657-xs9vyt:proj-1792964044657-xs9vyt_video.mp4@v1
```

Both are already `sharedWith: [agent, storywriter, director, producer, qceditor]`.

Then: confirm `video.inspect` appears in the live registry, capture **both** `agent.tool_call` **and**
`agent.tool_result` (per project law, `reason: done` alone proves nothing), check the facts match ffprobe,
and confirm a failed QC cannot advance the artifact to `approved`.

---

## Open items, in priority order

1. ~~Finish the 1,005-step sweep~~ **DONE.** All 1,005 steps ran individually: **15 failures — 12
   documented pre-existing, 3 mine, all 3 now fixed in `7bc5c4fdd`.** Net new regressions: **0**.
   The three were: a raw NUL byte in my own new test file (the same defect I had fixed in
   `deliverable-manifest.test.js` hours earlier — git had been treating the file as BINARY because of it);
   `pipelineOutcome` reporting a seeded default `approved:false` as a REFUSAL when it means "QC never ran"
   (the `feedback` text is the discriminator); and `studio-pipeline-advance` asserting the old conflated
   `ok` semantics, now expanded 14 -> 28 assertions with new approved/refused/absent cases.
2. **Phase 6** as above.
3. **Push `825ee4b62`** to `feat/approval-axis-20261110` (fast-forward from `93b2dd11c`). Not done — the
   directive said not to publish until the integrated result is verified.
4. **Git reconciliation** as its own session, now that there is a committed base.

## Deliberately NOT done

Porting `video-kling.js` or `image-kling-upscale.js` to the real tool contract. Both are **paid network
writers** against wallets this station cannot audit; making them callable is an owner spend decision. Their
files are intact on disk as the starting point.

## Backups taken this session (all git-ignored)

`*.bak-qcwire-20261111` on: `sidecar/index.js`, `sidecar/capability/registry.js`,
`sidecar/cron-orchestrator.js`, `sidecar/deliverable-manifest.js`, `sidecar/video-verify.js`,
`sidecar/tools/builtin/image-kling-upscale.js`, `test/harness.integration.test.js`,
`test/image-kling-upscale.test.js`. **Note:** `sidecar/tools/tool.js` was NOT backed up before editing —
its pre-change version is recoverable from `git show 93b2dd11c:sidecar/tools/tool.js`.

Companion document: `ENGINEERING_ASSESSMENT_20261111.md` (the read-only assessment this work came from).

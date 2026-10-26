---
fingerprint: c7abfee9
slug: studio-pipeline-marks-placeholder-video-as-kept
title: Studio pipeline marks placeholder video as KEPT
surface: autonomy
severity: P1
status: open
found: 2026-10-26
lane: sweep/autonomy
fix:
origin: owner
report: Owner report in this session (2026-10-26); "Christian Story Studio Video - Knight vs Demons" played as solid colour blocks plus the text "VS DEMONS" yet was labelled KEPT and QC-approved
affected: This station, 2026-10-26 build, branch feat/harness-backend; desktop installer unknown
family: deliverable-content-verification
installer: unverified
recovery: unconfirmed
---

# Studio pipeline marks placeholder video as KEPT

## Symptom

The owner opened the Deliverables panel and played "Christian Story Studio Video - Knight
vs Demons", expecting a generated anime battle sequence. The player showed only solid
colour blocks (blue, white, dark) and the text "VS DEMONS". The entry was labelled KEPT,
the project's blueprint read `status: complete`, and its QC_EDITOR record read
`approved: true` with the feedback "Excellent anime-style rendering ... smooth
transitions". No part of that was true.

## Repro

From a clean checkout, with a studio project whose outbox contains a small or synthetic
`video.mp4`:

1. Place any structurally valid MP4 under `~/outbox/<projectId>/video.mp4` — e.g.
   `ffmpeg -f lavfi -i color=c=blue:s=1920x1080:d=10 -c:v libx264 -r 24 video.mp4`.
2. Ensure the project blueprint has non-empty `outputs` for all four agents
   (storywriter, director, producer, qceditor).
3. Call `registerOrchestrationOutputs(projectId, blueprint)` (reached via
   `POST /api/studio/assignment` or `GET` the studio project status route).
4. Read `deliverables.library.jsonl`.

Before the fix: a row is written with `status: "kept"`. After the fix: the row is written
with `status: "failed"` and a `verifyReason`.

## Evidence

- Delivered artifact: `~/outbox/proj-1792964044657-xs9vyt/video.mp4` — 32,770 bytes,
  h264 1920x1080 @ 24fps, 10.08s, 242 frames, **bit_rate=22999** (~23 kbps). Real 1080p24
  content runs 4,000–12,000 kbps; ~400x higher. Only flat colour compresses this hard.
  The 1,056-byte predecessor survives beside it as `video.mp4.stub-backup`.

- Defective gate, `sidecar/index.js` (`registerOrchestrationOutputs`):
  ```js
  const isValidMp4 = header.toString('ascii', 4, 8) === 'ftyp';
  if (isValidMp4 && stat.size > 0) { files.push(...) }   // -> status: 'kept'
  ```
  `ftyp` + `size > 0` is the entire check. A 1 KB stub passes identically to a finished film.

- Defective stage gate, `sidecar/cron-orchestrator.js` (`pollForCompletion`):
  ```js
  const hasOutput = agentOutput.script || agentOutput.shotlist
                 || agentOutput.scenes || agentOutput.feedback;
  if (hasOutput) return { runId, complete: true, status: 'done', run: {} };
  ```
  Any non-empty prose advanced PRODUCER — the one stage whose deliverable is bytes.

- Defective instruction, PRODUCER system prompt in the same file, which asked for
  *"video generation **if available**"* and told the agent to "Save all work to
  deliverables using `deliverable_note`" — i.e. it requested markdown, then accepted it.

- `sidecar/deliverable-store.js:38` — `rowOf()` validates the status enum and clamps text
  but never touches the filesystem; `files[]` and `bytes` are accepted unverified.

- **The run record was forged, not merely wrong.** In
  `~/.local/share/StarNet/projects/proj-1792964044657-xs9vyt/blueprint.json`:
  `tools_used` named `video_assembly`, which exists nowhere in the codebase; run IDs such
  as `g889df03-d413-5502-cf76-6e1ccf10e0f2` begin with `g`, not a hex digit, so they were
  typed rather than generated; timestamps were `1729964000000` (October 2024, two years
  before the project); `producer.media` was `[]` and no `scene-*` asset existed on disk.

- **No generation was ever attempted.** No Kling, Higgsfield or video-generation call for
  this project appears in any log on the device. `sidecar-debug.log` contains only three
  `[ticketOk] /api/studio-file` lines — the owner playing the file back.

- **Origin of the artifact:** `create-sample-video.sh` (repo root, untracked) built the
  clip from seven `ffmpeg -f lavfi -i color=c=...` blocks and then appended
  `{"status":"kept"}` **directly** into `deliverables.library.jsonl`, bypassing the sidecar
  entirely. Quarantined to `create-sample-video.sh.UNSAFE-do-not-run`.

- **Corrupted credential (separate, contributing).** `~/.config/starnet/env` held a
  504-character `KLING_API_KEY` beginning `"I want you to finish"` — a pasted chat message.
  Kling rejected it: `{"code":1002,"message":"The token was expected to have 3 parts, but
  got > 3"}`. A working key already sat in `~/.claude/settings.json`
  (`{"code":1201,"message":"Task not found..."}` — auth OK). Because `~/start-starnet.sh:43-45`
  runs `set -a; . "$ENVFILE"; set +a`, the env file unconditionally overwrites the
  environment, so the sidecar always booted with the broken value.
  `scripts/setup-kling-key.sh` accepted the prose because its only check was `length >= 10`.

- Regression test: `test/video-verify.test.js` — asserts the real 32 KB artifact is
  rejected, and that a 181 KB / 4,322-frame colour-bar clip (which passes every naive
  size-and-frames test) is still rejected at 8 kbps.

## Fix

`sidecar/video-verify.js` is the single gate: rejects under 100 KB, under 1s, fewer than 2
frames, no video stream, non-MP4, and **bitrate under 150 kbps** — the last being the check
that catches a placeholder large enough to clear a size floor. Fails closed when ffprobe is
unavailable. Enforced at `registerOrchestrationOutputs` (bad video now registers as
`failed` **with its reason** rather than being silently skipped) and in `pollForCompletion`
for `agentId === 'producer'`. PRODUCER and QC_EDITOR prompts rewritten to require a real
render and a real `video.inspect`, and to state explicitly that reporting a failure is
correct while fabricating success is not.

## Sibling coverage gap — deliberately recorded, not silently fixed

The same unverified-registration defect exists on sibling media paths. This fix covers the
studio **video** path only:

| Path | Status |
| --- | --- |
| `video.kling` → studio video.mp4 | **fixed** + regression test |
| `image_upscale_kling` output | **gap** — registers with no content verification |
| `higgsfield.generate` output | **gap** — same |
| `audio.generate` (ElevenLabs) | **gap** — no audio equivalent of video-verify.js exists |
| `video.generate` (Pika) | **gap** — writes MP4, unguarded by this change |
| Root scripts writing the journal directly | **gap by design** — `register-video-deliverable.js`, `generate-kling-video.js`, `generate-kling-final.js` append `status:'kept'` straight to the JSONL and route around the gate. Warning banners added; not rewritten. |

A `verifyMediaFile` generalisation covering image/audio is the correct follow-up.

## Accepted Rule-1 gap

`video.kling` is `requiresConsent: true` (`sidecar/capability/registry.js:345`) while the
orchestrator runs `surface: 'autonomous'`. A consent-gated tool cannot fire in a headless
run, so **unattended studio runs cannot currently produce video** — they will now fail
honestly rather than fabricate success, but they will always fail. The owner decided on
2026-10-26 to keep consent required until one real generation proves the Kling payload
correct: `sidecar/tools/builtin/video-kling.js:170-183` still carries its own
`TODO: Verify parameter name and format` comments and has never completed a live call.
Revisit the `$25/day` budget rail or a per-project video budget only after that.

## Verdict

_Open. Fix landed in the working tree; `fix:` commit to be recorded on merge._

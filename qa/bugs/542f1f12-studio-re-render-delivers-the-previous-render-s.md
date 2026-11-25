---
fingerprint: 542f1f12
slug: studio-re-render-delivers-the-previous-render-s
title: Studio re-render delivers the previous render's picture (muxFinal reuses a stale video_silent.mp4)
surface: autonomy
severity: P1
status: open
found: 2026-11-25
lane: fix/studio-silentcopy
fix:
origin: audit
---

# Studio re-render delivers the previous render's picture (muxFinal reuses a stale video_silent.mp4)

## Symptom

When a studio project's video is rendered a second time (its `video.mp4` was deleted, failed
`video-verify`, or a caller passed the same `destPath` again), the delivered video carries the
PREVIOUS render's picture with the new audio. Length, size class, `video-verify` and the
post-mux re-verify all pass, so nothing in the pipeline notices. The owner would be handed the
old clip as the new one.

## Repro

1. Folder holding a previous render's silent copy: `<dir>/video_silent.mp4` (a solid blue clip).
2. `generateVideoWithFallback({ providers: ['local-ffmpeg'], destPath: '<dir>/video.mp4',
   env: { FAL_KEY: 'test-not-real' }, fetch: <fal mock returning a local bed> })` — $0, no network.
3. `local-ffmpeg` writes a new moving-gradient clip to `video.mp4`, then `audioFinish` →
   `muxFinal` sees `video_silent.mp4` already exists, skips refreshing it, and muxes ITS picture
   (`'-i', silentCopy`, `-c:v copy`) onto `video.mp4`.
4. Delivered `video.mp4` mean RGB at 1 s: `[0, 0, 253]` — the old blue picture.

Root: `sidecar/audio-finish.js` `muxFinal` — `if (!fs.existsSync(silentCopy)) fs.copyFileSync(videoPath, silentCopy);`
combined with `sidecar/video-providers.js` `generateVideoWithFallback` calling `audioFinish` with
no `silentCopy`, so the default `<dir>/video_silent.mp4` is reused.

## Evidence

- BEFORE (replay on unmodified `sidecar/video-providers.js`, 2026-11-25): `ok true | audio.ok true`,
  delivered mean RGB `[0, 0, 253]`, folder `video.mp4, video_silent.mp4`.
- AFTER (same replay, fixed code): delivered mean RGB `[125, 127, 127]` (the new gradient), audio
  stream present, folder `video.mp4, video_silent.mp4, video_silent.superseded-2026-11-25T00-32-18-793Z.mp4`.
- Regression: `test/video-providers.test.js` (re-render block) — 59/59 OK with the fix; against
  the pre-fix file it FAILS 4 assertions (`mean RGB 0,0,253`; `expected 1, got 0` set-aside copies).
- Exposure on the live station: 4 of 6 studio projects under `~/outbox/` hold a
  `video_silent.mp4` from an earlier render (`proj-1793024540897-knight`,
  `proj-1793603158934-r0x5zq`, `proj-1795149236726-knazc6`, `proj-1795387196385-nmwht7`); a
  re-render of any of them would have shipped the old picture. Not observed in production.
- Same defect class found and fixed first in the memorial engine (`memorial/render.mjs` `addAudio`,
  commit `8942d5d6c`).

## Siblings

- `memorial/render.mjs` `addAudio` — fixed in `8942d5d6c` (removes the stale copy), covered by
  `test/memorial-gallery.test.js` §9b.
- `memorial/gallery.mjs` — passes an explicit `silentCopy` in its work dir and removes it on the
  narration path; covered by `test/memorial-gallery.test.js`.
- `sidecar/cron-orchestrator.js` `ensureProducerVideo` — the only production caller of
  `generateVideoWithFallback`; covered transitively by the fix and the regression above.
- `sidecar/audio-finish.js` `audioFinish` called directly with a reused `videoPath` — no other
  caller exists today (grep 2026-11-25). Coverage gap, written down: `muxFinal` itself still
  reuses an existing silent copy by design (so a `force` re-master does not stack audio), so any
  FUTURE direct caller must pass a fresh `silentCopy`.

## Verdict

_Filled in when the bug leaves the backlog: what was true, and why it is closed._

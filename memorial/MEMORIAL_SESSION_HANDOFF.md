# Memorial engine — session handoff

Last updated 2026-11-24, end of session ea68579f (after the owner's master authorization;
saved at the owner's request "save all progress for handoff").
**Read this before touching `memorial/`.** Permanent rules: root `CLAUDE.md`. Architecture, order
spec and operator workflow: `memorial/README.md`. This file holds what changes between sessions.
Labels: **[Verified]** = seen in a live run this session (real output numbers);
**[Code inspection]** = read in source, not reproduced; **[Recommendation]** = proposal only;
**[Not done]** = deliberately left.

## 0. Where everything is (quick index)

| What | Where |
|---|---|
| Engine code | `~/starnet/memorial/*.mjs` (gallery: `gallery layouts plates prep faces join audio qc proof`; classic: `render fit cards verify`; both: `cli`) |
| How to run it, order format, limits | `~/starnet/memorial/README.md` |
| Tests (all in `test/fast.list`) | `~/starnet/test/memorial-{fit,business,actbreak,layouts,gallery}.test.js`; fixtures `~/starnet/test/fixtures/memorial/` |
| Fonts, backgrounds, TV room | `~/starnet/memorial/assets/{fonts,backgrounds,tv}/` |
| Music library (audio gitignored) | `~/starnet/memorial/assets/music/` — `manifest.json`, `LICENSES.md`, `fetch.mjs`; originals in `~/memorial-research/music/` |
| Face detector + licence | `~/starnet/memorial/vendor/pico/` |
| Gallery demo order + finished film, proof, TV preview, storyboard, face sheet | `~/starnet/memorial/examples/gallery-demo.json`; `~/starnet/memorial/examples/gallery-demo/render/out/` |
| Film of the owner's 6 sample photos (PRIVATE) | `~/memorial-research/real/render/out/` |
| 30-photo, 4-minute test film | `~/memorial-research/long/render/out/gallery-long.mp4` |
| Classic demo re-render | `~/memorial-research/classic-repro/out/` |
| Research reports' raw material | `~/memorial-research/{face,music,scratch}/` |
| Scratch business ledger used by every test render | `~/memorial-research/biz/` (set `MEMORIAL_BUSINESS_ROOT` to it) |
| Backups of every pre-existing file touched | same directory, `*.bak-20261124-pre-stage2` and `*.bak-20261124-pre-final` (§2) |
| Memory notes | `~/.claude/projects/-data-data-com-termux-files-home-starnet/memory/project_memorial_prototype_20261124.md`, `project_starnet_memorial_engine.md` |

## 1. Where things stand

- **Everything below is in the working tree and UNCOMMITTED.** Nothing was committed, pushed,
  restarted or published. The owner's 2026-11-24 master authorization covered finishing the
  engine (stages 2+), research, sub-agents and spend; it did not name commits, pushes or StarNet
  restarts, and the standing rule says each of those needs its own yes. That reading is Claude's;
  the owner can overrule it in one word.
- **Spend this session: $0 and 0 Higgsfield credits.** All downloads were free (fonts, face
  cascade, music). Earlier the same day: 26 of a 30-credit Higgsfield authorization (closed).
- The gallery engine is built and renders verified films end to end (§3). It is **not yet wired
  into the StarNet sidecar** (§6) — it is run from the command line.

## 2. What was built (2026-11-24, stage 2 onward)

| Area | Files | Summary |
|---|---|---|
| Layout engine | `gallery.mjs`, `layouts.mjs`, `plates.mjs` | `"style": "gallery"`: full / group / pair / framed / duo / collage scenes; title, chapter, verse (line-by-line), closing cards; captions as static overlay layers |
| Face protection | `faces.mjs`, `vendor/pico/`, `layouts.mjs` | pico detector (MIT), operator marks, "unknown ≠ none"; face-safe crops and zooms; plan audit refuses to render a film that would cut a face |
| Photo prep | `prep.mjs` | upright decode (EXIF), hard-edged screenshot bars trimmed, 4096 px cap |
| Transitions | `join.mjs` | symmetric dip to legal black for act breaks (replaces `fadeblack`), head/tail fades, BT.709 tagging |
| Music | `audio.mjs`, `assets/music/` | 8-track licensed library, fit-to-length bed, two-pass mastering to −16 LUFS |
| Quality gate | `qc.mjs` | black / freeze / hard-cut / loudness / colour / faststart / frame count + plan audit + licence |
| Proofing | `proof.mjs` | face sheet, storyboard, watermarked proof, TV-room preview |
| Operator CLI | `cli.mjs` | `new`, `faces`, `plan`, `render [--force]`, `qc`, `proof`, `tv`, `music` |
| Classic engine | `render.mjs` | unchanged output for existing orders; four defects fixed (§4) |
| Assets | `assets/fonts`, `assets/backgrounds`, `assets/tv` | EB Garamond + Cormorant Garamond (SIL OFL, licence files included); 7 art backgrounds; TV mockup room |

**New files (untracked):** `memorial/{audio,faces,gallery,join,layouts,plates,prep,proof,qc}.mjs`,
`memorial/assets/**`, `memorial/vendor/pico/**`, `memorial/examples/gallery-demo.json`,
`test/memorial-layouts.test.js`, `test/memorial-gallery.test.js`, `test/fixtures/memorial/**`.
**Modified (tracked):** `memorial/render.mjs`, `memorial/cli.mjs`, `memorial/README.md`,
`memorial/jitter-check.mjs`, `test/fast.list` (+3 lines), `.gitignore` (+3 lines).
**Modified (untracked, from stage 1):** `test/memorial-actbreak.test.js`, this file.

**Backups — every pre-existing file touched has a same-directory copy, all gitignored:**
`*.bak-20261124-pre-stage2` = the file as it stood before stage 2 (i.e. with stage 1 applied) for
`render.mjs`, `cli.mjs`, `verify.mjs`, `cards.mjs`, `fit.mjs`, `README.md`, `jitter-check.mjs`,
this handoff, `test/memorial-actbreak.test.js`, `test/fast.list`, `.gitignore`.
(`verify.mjs`, `cards.mjs`, `fit.mjs` were backed up and then NOT changed.)
`*.bak-20261124-pre-final` = this handoff and `README.md` just before the end-of-session update.
`render.mjs.bak` and `README.md.bak` still equal HEAD `93b2dd11c`; `test/fast.list.bak-actbreak-20261124`
equals HEAD.

**Undo stage 2 only (back to stage 1):** for each file above,
`cp <file>.bak-20261124-pre-stage2 <file>`; then delete the new files listed above.
**Undo everything (back to HEAD):** `cp memorial/render.mjs.bak memorial/render.mjs &&
cp memorial/README.md.bak memorial/README.md && cp test/fast.list.bak-actbreak-20261124 test/fast.list`,
restore `memorial/cli.mjs`, `memorial/jitter-check.mjs` and `.gitignore` from git
(`git show HEAD:<path> > <path>` — do NOT use checkout/reset here), delete the new files and
`test/memorial-actbreak.test.js`. Afterwards `git status --short memorial test .gitignore` must show
only `?? memorial/MEMORIAL_SESSION_HANDOFF.md`.

## 3. Evidence [Verified 2026-11-24, Node v26.4.0, ffmpeg 8.1.3, this phone]

Node 22 is what CI uses; **nothing here was run on Node 22**.

| Check | Result |
|---|---|
| `npm run test:fast -- memorial` (last run, end of session) | 5 steps green: business 43, fit 34, actbreak 43, layouts 66, gallery 92 (278 assertions) |
| `memorial-gallery` run 3× in a row (at 83 assertions) | 83/83 each time (an earlier version failed intermittently — see §4 #6) |
| `test-list-runner`, `readiness`, `qa-closer`, `events-contract`, `source-text-integrity` | all OK after the `fast.list` / new-file changes |
| full `npm run test:fast` | **NOT run** (it halts at a pre-existing failure before the memorial steps on this device; judgment: nothing outside `memorial/` imports these modules) |
| `test:http` | **NOT run** — no route, tool or sidecar file was touched |
| Gallery demo, 1080p, 8× (`examples/gallery-demo.json`, fictional subject) | 9 scenes, 52.70 s, 29.4 MB, 385 s wall. verify 6/6. QC 18/18 PASS, 0 warnings. −16.0 LUFS, −1.5 dBTP |
| Owner's 6 sample photos, 1080p, 8× (`~/memorial-research/real/`, PRIVATE) | 8 scenes, 48.70 s, 22.5 MB. verify 6/6. QC all PASS + 2 expected WARN (faces not reviewed; 6 photos cannot fill a 5-minute track). Faces checked by eye on extracted frames: none cut |
| 30-photo film (`~/memorial-research/long/`) | see §3a |
| Classic demo re-rendered from scratch with the modified `render.mjs` | see §3a |
| Gallery demo re-rendered from scratch (`--force`) with two scenes at a time | 356 s wall (was 385 s serial; phone load average ~10 both times), VERIFIED, QC all PASS |
| Act-break dip, measured | min luma **16.0** (legal black; `fadeblack` gave 1–7), symmetric to within 25 luma 0.3 s either side |
| QC on a clip with planted defects | hard cut, stray black, freeze and missing audio each FAIL by name |
| Motion smoothness, gallery (`node memorial/jitter-check.mjs gallery`) | 8×: **0** whole-pixel jumps in 108 frames; 1×: 20 in 109; 4.1× smoother |
| Face detector, 11 test photos | 19 of 21 main faces; misses: 1 profile, 1 face cut by the frame edge |
| Face detector, face-free images | 0 false boxes on 8 art backgrounds + 30 classic-demo images + 3 synthetic |
| Bar trimming on the 6 sample photos + 35 demo photos | 2 screenshots trimmed (93% and 81% kept); 0 false trims |
| `assets/music/fetch.mjs nearer-my-god` | re-downloaded, sha256 matched the manifest, transcoded |
| Segment timing, 1080p 8× | 11–43 s per scene (load-dependent); layered parallax was measured at 120–159 s per scene and rejected |

### 3a. Late results [Verified]

**30-photo, 4-minute film** — `~/memorial-research/long/order.json`, built from the classic demo's
30 synthetic photos (fictional subject), theme `cool`, 2 chapter cards, 2 verses, recap collage,
music `bach-prelude-eflat-minor` with `"fit": true`.
- Plan: 36 items — 19 full, 9 framed, 1 pair, 1 collage, 6 cards; holds scaled ×1.273 so the
  film ends with the music. 74 of 74 placement checks pass.
- Render: **238.13 s film, 68.4 MB, 3,107 s wall (~52 min)**, serial, phone heavily loaded.
  Per scene 33–238 s, median 48 s.
- verify 6/6. QC: every check PASS, including 2 act breaks measurably reaching black and
  −15.9 LUFS / −1.4 dBTP — after the music fix in §4 #10 (the first render had a WARN for it).
- With `goldberg-aria` instead, the fit would have needed ×1.61, outside the allowed 0.75–1.34;
  `plan` said so and left the holds alone. That refusal is the designed behaviour.
- The 30 photos are flat synthetic shapes, so the detector found no faces in any of them (all
  "unknown"). This run proves scale, timing and audio — **not** face handling.

**Classic engine, full re-render from scratch** with the modified `render.mjs`
(`~/memorial-research/classic-repro/`): 171.20 s, verify 6/6, 891 s wall.
- **All 30 photo segments are byte-identical** to the 2026-11-09 render.
- The 5 card segments differ, so the film's md5 changed from `eac0b97f…` to
  `de01adc8c6c0272b2640b360d2543ed9` (32,318,146 bytes). Cause: `cards.mjs` already looks in
  `memorial/assets/fonts/` for EB Garamond first (its documented upgrade path), and that font now
  exists there. The new title card was checked by eye: it renders correctly in EB Garamond.
  A different md5 for the classic demo means the font, not a regression.

**Rendering two scenes at once** (`MEMORIAL_PARALLEL`, default 2; 1 = serial), measured with the
same 7.6 s scene: alone 20.7 s; two together 15.0 s for the pair; three together 27.4 s for the
three. Two was the best of the three settings and stays inside free memory. Memory per scene:
0.65–0.9 GB.

**Measured but NOT applied — a lead for the next session:** a card with line-by-line text (4 text
layers) took 69.2 s; making each layer decode once and repeat inside the graph
(`loop=loop=-1:size=1` instead of `-loop 1` on the input) took 52.7 s, with identical output
(PSNR infinite, same 303 frames). About 24% faster on text-heavy cards. Test script and graphs are
in `~/memorial-research/scratch/` (`g6new.txt`). Not wired into `gallery.mjs`.

**Still open:** `-filter_complex_threads 8` made a scene SLOWER (37.2 s vs 20.7 s) — do not use it.

## 4. Defects found and fixed this session

1. **[Verified] Sideways phone photos were cropped as landscapes (classic engine).** `ffprobe`
   reports an EXIF-Orientation-6 JPEG by its stored size (600×400) while ffmpeg decodes it upright
   (400×600). `probeImage` took the fit decision from the probe → a portrait was cover-cropped,
   breaking the face rule. Now measured from the decoded frame; regression in `memorial-gallery`.
2. **[Verified] `fadeblack` is lopsided and sub-black** (stage 1 open issue). Replaced by fades +
   a short dissolve in `join.mjs`. An act break now lengthens the film by `xfade − 0.5 s`.
3. **[Verified] A zoom could put a protected face 4e-6 of the frame outside the window** — the
   anchor was rounded to four places. Found by the property test (205 of 3,000 cases). Fixed.
4. **[Verified] Stale segment reuse** (older open issue): a swapped photo or corrected text with
   the same duration reused the old segment. Segments now carry a fingerprint sidecar
   (`seg-NNN.mp4.json`). Segments rendered before this change re-render once.
5. **[Verified] A card with a bad or missing position vanished silently** (older open issue).
   Both engines now refuse the order and name the field.
6. **[Verified] My own test was non-deterministic**: ffmpeg's `gradients` source randomises unless
   fully pinned. Fixed with a seed; and the bar-trimmer it exposed now requires a hard edge, so a
   smooth dark gradient or a studio portrait on black is never trimmed.
7. **[Verified] `cli.mjs render --force` was documented and never implemented.** Implemented.
8. **[Verified] The TV-preview screen rectangle was wrong** (film did not fill the television).
   Re-measured from the image; the preview trims 2% top and bottom to fill the 1.85:1 panel.
9. **[Verified] QC's analysis pass failed on a clean film** (a `select` that matched nothing gave
   the encoder zero frames). Fixed; covered by the gallery test.
10. **[Verified] A film fitted to its song restarted the song in the last 3 s.** The fitted film
    came out a fraction of a second longer than the track, so the bed looped the track under a
    crossfade at the very end (seen on the 30-photo film). `audio.mjs` now lets a film outlast its
    music by up to 1 s in silence, and when the track ends about when the film does it keeps the
    composer's own ending (1.2 s tidy-up fade instead of 4 s). Regression in `memorial-gallery`.
11. **[Verified] An over-long caption was silently cut to two lines** (`plates.mjs` sliced the
    wrapped lines). It now stops the order and says how short to make it. Regression in
    `memorial-gallery`.
12. **[Verified] Narration in a gallery order lost its music**, and a narration with no music
    went through a path that expected one. Gallery now fits and fades the music itself, then hands
    music + voice to the station mixer (`sidecar/audio-finish.js` `muxFinal`, read-only reuse),
    which ducks the music under the voice. Voice-only films have sound. Regression in
    `memorial-gallery` (both cases). [Code inspection] The classic engine's `addAudio` returns
    "none" when an order has narration but no music, so a classic voice-only order is delivered
    silent. Not fixed — classic was kept unchanged.

## 5. Open issues and limits — read before selling a film

- **The detector misses faces.** Profiles, faces cut by the photo edge and small background
  faces are not found. Untested: sunglasses, heavy shadow, B&W scans, babies, groups of 10+.
  A missed face in a photo where ANOTHER face was found can be cropped (up to 25% of the photo).
  The control is human: `cli.mjs faces`, look at the sheet, add `"faces"` marks, set
  `"facesReviewed": true`. QC warns until then. [Recommendation] treat an unreviewed film as
  not deliverable.
- **Nobody has listened to the music.** Loudness is measured; mood, recording quality and the
  musical sense of the 3 s crossfade / 4 s fade-out were not auditioned. The U.S. Air Force tracks
  are concert-band and strings recordings and may be heavier than "gentle".
- **Music licences**: four CC0, four US-government (public domain in the United States only).
  Content-ID false claims on public-domain classical recordings are documented (one on exactly
  `bach-prelude-c`). `assets/music/LICENSES.md` is the evidence a buyer would send. Not legal advice.
- **Backgrounds and the TV room were AI-generated** (Higgsfield, owner's account). Etsy's
  AI-content disclosure applies if they appear in a listing — see the `etsy-rules` skill.
- **Render time is long on this phone.** A 4-minute, 30-photo film took ~52 min under heavy load
  (§3a); expect roughly 10–15 min per minute of film. Narrated gallery films are mastered by the
  station mixer to −14 LUFS, and QC checks them against −14, not −16.
- **Gallery is 16:9 only.** A 9:16 or 4:3 gallery order is refused. Classic still does all three.
- **Classic colour**: classic films are still encoded with the BT.601 matrix and no colour tags
  (unchanged, to keep the demo bit-identical). Gallery is correct BT.709. [Recommendation] move
  classic over only if a classic order is ever sold.
- **No parallax**: prints and background move as one plate (speed). Captions and card text are
  static overlays, which reads as a gentle separation.
- **Collage arrangement** is chosen by area; photo order inside a collage is not chronological.
- QC thresholds were calibrated on synthetic clips and three real renders, not on a library of
  customer films. The hard-cut threshold (0.40) could trip on two very different full-bleed photos
  joined by a short dissolve; keep `xfade` ≥ 1.0 s.
- [Guessing] whether CI has ffmpeg, fonts and `@napi-rs/canvas`; without ffmpeg the live halves
  of three tests print SKIP.
- The stage-1 bug-register record (below) is still not filed.

## 6. Not done — needs the owner

1. **Commit.** Suggested as two commits: (a) stage 1 + its test; (b) stage 2. The test list and
   the tests it names must go in the same commit. Stage only the memorial paths — the tree has
   unrelated uncommitted work (`CLAUDE.md`, `STATION_FIELD_NOTES.md`, `sidecar/cron-orchestrator.js`, …).
2. **Sidecar integration** (README "held for Phase D"): a `memorial_render` tool under capId
   `studio`, Outbox registration via `producedFiles`, a `noAgent` cron tick. Touches the live
   sidecar and needs a restart — not started.
3. **Listen** to the eight tracks and choose the shop's default (`manifest.json` → `default`).
4. **File the stage-1 bug record** — needs a `--surface` choice (`qa/bugs` has no memorial surface):
   `node scripts/qa/bugs.mjs --new --title "Memorial act break never fades to black (actBreak dropped by buildPlan; join cache ignores transitions)" --surface <choose> --severity P2 --lane fix/memorial-actbreak`
5. **Private photo copies**: keep or delete `~/memorial-prototype-20261124/render-real/` and
   `~/memorial-research/real/` (renders of the owner's personal photos).
6. Product decisions: price tiers, revision policy (research found "one round, 48 h" is the
   published norm), whether an unreviewed-faces film may ever ship.

## 7. Scratch outside the repo

- `~/memorial-research/` — this session: `face/` (detector research, incl. an unused 154 MB
  onnxruntime-web install under `face/ort/` — safe to delete), `music/` (the eight ORIGINAL
  downloads, 240 MB, + `LICENSES.md`), `real/` (PRIVATE), `long/` (30-photo film),
  `classic-repro/` (classic re-render), `t1/` (first low-res test), `scratch/` (probe scripts,
  timing experiments, the decode-once graph), `biz/` (the scratch business ledger used for every
  test render; its orders show `verified`, it is not the real ledger).
- Logs of the big renders: `~/memorial-research/gallery-demo.log`, `real/render.log`,
  `long/render.log`, `classic-repro.log`.
- `~/memorial-prototype-20261124/` — the morning's prototype and benchmark (unchanged; described
  in the previous version of this file, kept as `MEMORIAL_SESSION_HANDOFF.md.bak-20261124-pre-stage2`).
- Higgsfield job ids for the backgrounds (gpt_image_2_6, 2k): garden-of-memories `f961bb96`,
  classic-elegance `f55ee500`, heavenly-peace `f2724362`, eternal-love `ed347807`,
  faith-and-hope `c0dc55ef`, tv-mockup-room `5c9bd371`, golden-flowers-watercolor `303cd432`,
  scenic-sky-valley `9baa1d6b`.

## 8. Research this session rests on

Three sub-agent reports (face detection; licensed music; production craft). Their verified
measurements are folded into the code comments; their sourced-but-unverified claims are not relied
on. Two things they could NOT establish, stated so nobody assumes otherwise: no review evidence
was found for "cropped heads / cheesy transitions" complaints (buyers' documented complaints are
non-delivery, text errors and price), and watermarked proofs / TV-mockup listing images are not a
documented industry standard — they are this project's choice.

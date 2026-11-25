# Memorial engine — session handoff

Last updated 2026-11-25 (after the owner's StarNet restart: live Outbox streaming verified, §3d;
commits `8942d5d6c` + the Outbox commit, §1). Previous update: 2026-11-24, session ea68579f.
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
| How and why it was built (session history, lessons) | §9 of this file |
| Films in the StarNet Library (play now) | `~/.local/share/StarNet/workspaces/agent/workshop/memorial-*/` (§3b-2) |
| Films in the StarNet Outbox | `~/.local/share/StarNet/workspaces/agent/outbox/memorial/` (§3b) |
| Memory notes | `~/.claude/projects/-data-data-com-termux-files-home-starnet/memory/project_memorial_prototype_20261124.md`, `project_starnet_memorial_engine.md` |

## 1. Where things stand

- **Three commits on `feat/harness-backend`, none pushed:**
  1. `e5d06d426` (2026-11-24): the 46 memorial engine files + 3 lines each in `test/fast.list`, `.gitignore`.
  2. `8942d5d6c` (2026-11-25, owner's "Both, in two commits"): §4 #13–#14 and the text-layer speedup —
     `memorial/gallery.mjs`, `memorial/render.mjs`, `test/memorial-gallery.test.js`.
  3. The Outbox streaming commit (2026-11-25, same approval, made after the live check in §3d): the
     StarNet Outbox change (§3b–§3c), `memorial/cli.mjs` + `memorial/outbox.mjs`, `memorial/README.md`,
     this file. Its hash is in `git log`; it was made after this text was written.
  **Left uncommitted on purpose:** `website/app/app/harness.js` (pure mirror catch-up of the unrelated
  commit `8e18e7441`, brought in by `npm run sync:website`; owner decides, §6) and every non-memorial
  file the tree already had (`CLAUDE.md`, `STATION_FIELD_NOTES.md`, `sidecar/cron-orchestrator.js`, …).
  Commits, pushes and StarNet restarts each need their own yes (standing rule).
- **StarNet was restarted by the owner on 2026-11-25** (launcher PID 13264, sidecar PID 13296) and
  is running the streaming code — verified, §3d.
- **Spend this session: $0 and 0 Higgsfield credits.** All downloads were free (fonts, face
  cascade, music). Earlier the same day: 26 of a 30-credit Higgsfield authorization (closed).
- The gallery engine is built and renders verified films end to end (§3). Films reach the
  **StarNet Outbox** with `node memorial/cli.mjs outbox <order.json>` (§3b). It is still run from
  the command line; there is no agent tool or cron tick for it yet (§6).
- **The StarNet sidecar change is LIVE** since the owner's restart (§3d). All six memorial films
  stream from the Outbox. Still nobody has pressed Play in a real browser.

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
| `npm run test:fast -- memorial` (last run, after the post-commit fixes) | 5 steps green: business 43, fit 34, actbreak 43, layouts 66, gallery 96 (282 assertions) |
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

**Text layers decode once — APPLIED after the commit (uncommitted).** A card with line-by-line
text (4 text layers) took 69.2 s; making each layer decode once and repeat inside the graph
(`loop=loop=-1:size=1` instead of `-loop 1` on the input) took 52.7 s with identical output — about
24% faster on text-heavy cards. Now in `gallery.mjs` `segmentGraph`. [Verified] the gallery demo
re-rendered with it is **frame-identical** to the film before the change (PSNR infinite over the
whole film and over the verse segment), VERIFIED, QC all PASS.

**Still open:** `-filter_complex_threads 8` made a scene SLOWER (37.2 s vs 20.7 s) — do not use it.

### 3b. Films in the StarNet Outbox [Verified 2026-11-24]

**Live state at the end of the session [Verified by fetching from the live station on :8787 exactly as
the page does — page-signed link, no token header]:**
- `gallery-demo.mp4` → 200 `video/mp4`, plays. The page files (`frontend/app/apiticket.js`,
  `frontend/app/outbox.js`) are served from disk, so the ticket fix and the Play button are ALREADY
  LIVE after a browser reload.
- `gallery-long.mp4` (68.4 MB) → 410 until the restart below. Seeking in the small films is also
  poor until then (the old server code has no Range support).
- **Nobody has pressed Play in a real browser yet.**

**Registered (unchanged since):** six memorial films are in the Outbox, owner `agent`
(NIGHT4CHRIST = the Commander's Outbox), shared with no other agent, each `verification: passed`
from the station's own `video-verify.js`, `qc: not_reviewed`, `approval: pending` (both left for
the owner):

| Film | Size | Plays now? |
|---|---|---|
| `gallery-demo.mp4` (+ `.proof.mp4`, `.tv.mp4`) | 29.4 MB | yes — served as `video/mp4`, bytes identical to the render |
| `mem-20261124-in-loving-memory-sample.mp4` (PRIVATE, owner's photos) | 22.5 MB | yes |
| `gallery-long.proof.mp4` | 5.2 MB | yes |
| `gallery-long.mp4` (4-minute film) | 68.4 MB | **no — HTTP 410 until StarNet restarts** onto the streaming code |

Every "plays now?" above means "plays once the page carries a ticket" — see §3c #1: before that fix,
NO Outbox link of any kind could load in a browser.

Files: `~/.local/share/StarNet/workspaces/agent/outbox/memorial/<orderId>/`. The live manifest was
backed up first: `workspaces/.deliverables/manifest.jsonl.bak-memorial-outbox-20261124`
(187 lines before; rows are only appended).

**How it works (`memorial/outbox.mjs`, `cli.mjs outbox`):** copies the film, proof, TV clip and
storyboard into the owner's workspace, then calls StarNet's OWN `deliverable-manifest.js`
`register()` and `setVerification()` from the CLI process — the same calls the studio bridge makes.
The manifest re-reads its append-only file on every request, so the running station sees the
rows immediately. Refuses a film that has not passed verify + QC; exits 1 if the film itself is
refused; re-running is a no-op (sha256 dedupe); a re-rendered film becomes v2 with v1 kept.

**StarNet changes made for this** (backups `*.bak-20261124-outbox-large`, `*.bak-20261124-video-player`;
both StarNet files were clean in git before):
1. `sidecar/deliverable-manifest.js` — files 64 MB–2 GB are now registered with a chunked sha256
   and served through a new `openFor()` (same floor: realpath containment, leaf-symlink refusal,
   O_NOFOLLOW, fd checks, sha256 re-check; proven-hash cache keyed on inode+size+mtime, 10 min).
   `readFor()` is unchanged and still refuses > 64 MB. `.mp4`/`.m4a` now get real MIME types —
   before, every `.mp4` was `application/octet-stream` and a phone downloaded it instead of playing.
2. `sidecar/index.js` — `serveArtifact` hands only the "too big" refusal to a new
   `serveArtifactStream` (HTTP Range, 206/416, same headers and active-content rule).
3. `frontend/app/outbox.js` — a `<video controls>` player for `video/mp4` rows (not for a row whose
   verification failed). Mirrored to `website/app/` by `npm run sync:website`, which ALSO brought
   `website/app/app/harness.js` up to date with a 2026-11-20 commit (`8e18e7441`) that had never been
   mirrored — pre-existing drift, not this change.
4. `test/outbox-large-artifact.test.js` (17 assertions), registered in `test/fast.list`.

**Proof the streaming code works (first version — superseded by §3c)** — a throwaway StarNet on port 8899 against a scratch copy
(`~/memorial-research/ws-stream/`), never the live station: HEAD 200 `video/mp4`,
`Accept-Ranges: bytes`, 71,702,791 bytes; full GET byte-identical to the film, ffprobe 238.13 s;
`Range: bytes=1000-1999` → 206 with exactly those bytes; `bytes=-500` → 206; past the end → 416;
no token → 403; viewer it is not shared with → 404; original edited after registration → 409.
Gate: `test:fast` filtered on memorial / outbox / deliverable / artifact / website — 33 steps
green. Full `test:fast` and `test:http` NOT run. An independent review of the StarNet diff was
started; its result is below in §3c.

### 3b-2. Films in the Deliverables LIBRARY too [Verified 2026-11-24, live station, no restart]

The Library (`GET /api/deliverables`, the "Deliverables" view) is a separate list from the Outbox.
At the owner's request ("add them to starnet i want to see them") the three films were registered
there through StarNet's own `POST /api/deliverables/register` route (built for the memorial engine).
That route indexes only files under `workspaces/<agent>/workshop/<runId>/`, so each film was COPIED
(Android refused a hard link here) to `workspaces/agent/workshop/memorial-<orderId>/<orderId>.mp4`,
byte-identical (cmp). All three: `registered`, status `kept` (the route's own video-verify passed).
Library: 264 → 267 items. Opened exactly as the page does (page-made ticket, no token header,
Range request): all three answer **206 `video/mp4`**, including the 68.4 MB film, because the
Library opens files through `/api/file`, which already streams. So **every film is watchable now
from the Library**, before any restart. Backup of the Library journal:
`workspaces/deliverables.library.jsonl.bak-memorial-library-20261124`. Undo: the Library's own
cleanup in the UI, or restore that backup with StarNet stopped.
The copies cost ~120 MB of disk; a future `cli.mjs outbox` could write the film once into
`workshop/` and register it in both lists (not done).

### 3c. Independent review of the StarNet change, and the fixes [Verified 2026-11-24]

An independent reviewer (fresh agent, given only the diff) found real defects. Each was confirmed in
code or by experiment before fixing:

1. **[Fixed] Every Outbox link was a 403 in a browser — pre-existing, not new.** The page's
   `ApiTicket.sign()` had no branch for `/api/artifact` and no `artifact` ticket kind, although the
   server has verified `artifact` tickets since the Outbox shipped. A link, `<img>` or `<video>`
   cannot send the token header, so "open the original", every image preview, and the new player
   were all refused. `frontend/app/apiticket.js` now mints it; the server's own verifier accepts it,
   rejects it for another viewer and after 5 minutes (test).
2. **[Fixed] The proof cache could be fooled.** Keyed on mtime, a same-size in-place edit with
   mtime put back (`touch -r`) was served — reproduced. Adding ctime was NOT enough: the kernel's
   coarse timestamp clock gave a same-tick edit an identical ctime, and the replay still served the
   edited bytes (my first "fix" passed its own test and failed the replay). Now a proof is cached
   only for a file unchanged for over 1 s, so any later edit lands in a later tick. Replay against
   the pre-fix code: SERVED the edited bytes 3/3; against the fix: refused 3/3. Both the fresh and
   the cached case are in the test.
3. **[Stated, not eliminated] A stream re-reads the file after hashing it**, so an in-place edit made
   DURING playback is not caught. The comments that claimed an "identical floor" were corrected.
4. **[Fixed] The fd could be closed twice** (error handler after autoClose). Removed; a throw
   before the stream owns the fd now closes it once.
5. **[Fixed] Hashing a large film froze the whole station** (synchronous reads in the request
   handler). Hashing on the request path is now asynchronous: `/api/health` answered in 1–4 ms
   while a 68 MB film was being hashed. Registration still hashes synchronously (rare, out of the
   request path; noted).
6. **[Fixed] Agents were told a large film was missing.** `outbox_read`
   (`sidecar/tools/builtin/outbox.js`) now proves it with the new `verifyFor()` and reports it
   present and checksum-matched, facts only.
7. **[Fixed] Player offered for unplayable rows, and preloading hashed every film on render.** The
   player is now a Play button: nothing loads until pressed, the link is signed AT PLAY TIME and
   re-signed if the 5-minute ticket lapses mid-film (resuming at the same second), and it appears
   only for `verification: passed` rows that are not REJECTED/FAILED/MISSING. All videos (not just
   large ones) are now served through the streaming path, so they all get Range/seeking.
- Not changed (nits): `bytes=5-3` answers 416 (200 would also be allowed); `If-Range` ignored;
  an `.m4a` with an mp4 header registers as `kind: video`.

**Re-proven on a fresh throwaway StarNet (port 8899, scratch data), fetching as the page does:**
unsigned link 403; page-signed link 206 `video/mp4` for both films; full 68.4 MB film
byte-identical; edited film 409; station responsive during hashing. Tests: `outbox-large-artifact`
26 assertions (incl. both tamper cases, outbox_read, ticket accept/reject/expiry); `apitickets` 60;
`test:fast` filtered on memorial / outbox / deliverable / artifact / website / apiticket — all
green; `source-text-integrity` OK. Full `test:fast` and `test:http` NOT run.

**Files changed for §3b–§3c (all uncommitted; backups beside each):**
`sidecar/deliverable-manifest.js`, `sidecar/index.js`, `sidecar/tools/builtin/outbox.js`,
`frontend/app/apiticket.js`, `frontend/app/outbox.js`, `website/app/app/{apiticket,outbox,harness}.js`
(mirror; `harness.js` is the pre-existing drift), `test/outbox-large-artifact.test.js`,
`test/fast.list` (+1), `memorial/outbox.mjs`, `memorial/cli.mjs`.
Backups: `*.bak-20261124-outbox-large` (before any of it), `*.bak-20261124-review-fixes` (before the
review fixes), `*.bak-20261124-video-player`, `*.bak-20261124-mime`.

**TO MAKE IT LIVE — DONE 2026-11-25 by the owner (§3d). Procedure kept for reference:**
```bash
ls ~/.local/share/StarNet/workspaces/.spend-pending/        # must be empty first
L=$(pgrep -f start-starnet.sh); N=$(pgrep -P "$L" -f 'sidecar/index.js'); echo "launcher $L sidecar $N"
kill $L; sleep 1; kill $N                                   # ONLY the launcher and its own sidecar
cd ~ && setsid nohup bash ~/start-starnet.sh >> ~/.local/state/starnet/launcher.out 2>&1 < /dev/null &
sleep 15; curl -s http://127.0.0.1:8787/api/health          # expect: ok
```
Do NOT use `pkill -f 'node sidecar/index.js'`: it would also stop two other StarNet processes
(PIDs 10757 and 10883, ~2 days old, parent PID 1, outside the launcher, same default workspace, no
`STARNET_PORT`). Nobody in this session started them and what they are is unknown — worth a look.

**Limits:** Outbox playback links carry a 5-minute ticket, so seeking far into a long film after
5 minutes may fail until the page is reloaded (unverified in a browser). The video player was
checked in code and served-file terms only — **nobody has watched it in the Outbox page yet**.

### 3d. Live on the real station after the owner's restart [Verified 2026-11-25]

**Running code is the new code:** sidecar PID 13296 (parent = launcher 13264) had been up 358 s when
checked; `sidecar/index.js`, `deliverable-manifest.js`, `tools/builtin/outbox.js` were last written
2,400–2,520 s earlier, so the process loaded them. `/api/health` ok; `.spend-pending/` empty.

**The 4-minute film through the real signed Outbox URL** — the page's own token read from the served
HTML, the ticket minted by `frontend/app/apiticket.js` itself (`ApiTicket.artifactUrl` and
`ApiTicket.sign(row.retrieve)`, as the Play button does), no `X-StarNet-Token` header, live :8787.
Original `~/memorial-research/long/render/out/gallery-long.mp4`: 71,702,791 bytes, sha256
`1ffce4bb83f4cd5e34e5f34cce9444781b24f492249c788a60562f8a8e13005c` (= the manifest row's sha256).

| Request | Answer |
|---|---|
| unsigned link | 403 |
| HEAD, signed | 200 `video/mp4`, `Content-Length: 71702791`, `Accept-Ranges: bytes` |
| `bytes=0-1023` / `1000-1999` / `35000000-35065535` / last 500 | 206 `video/mp4`, exact `Content-Range` each, bytes equal the original's slice (4/4) |
| `bytes=-500` | 206, `bytes 71702291-71702790/71702791`, bytes equal |
| `bytes=71702791-` (past end) | 416, `Content-Range: bytes */71702791` |
| `bytes=0-` (what a `<video>` sends first) | 206, 71,702,791 bytes, sha256 identical to the original |
| full GET | 200, byte-identical; ffprobe 238.13 s |
| same ticket, `agent=scout` | 403 |

Outbox row: `lifecycle VERIFIED`, `verification passed`, `qc not_reviewed`, `approval pending`, so the
page renders the Play button for it. The Outbox copy is `cmp`-identical to the render.
**The other five films** (`gallery-demo.mp4`, `.proof.mp4`, `.tv.mp4`, `gallery-long.proof.mp4`,
`mem-20261124-in-loving-memory-sample.mp4`): each 206 `video/mp4` for `bytes=0-` and a mid range,
byte-identical. `/api/health` answered in 3–5 ms during each fetch.

**Tests (Node v26.4.0 on this phone, NOT Node 22):** `npm run test:fast -- <filter>` — memorial 5 steps
(business 43, fit 34, actbreak 43, layouts 66, gallery 96); outbox 10 steps (incl. outbox-large-artifact
26, outbox ui 87); deliverable 9 (manifest bridge 139); artifact 4; apiticket 1 (60); website 5
(app-sync 8) — all green. `source-text-integrity` OK (2,511 files). `test/http.list` has no Outbox /
artifact / deliverable / ticket step, so `test:http` was not run; full `test:fast` not run.

**Remaining issues with the playback path:**
- **Not tested in a real browser.** No Chrome was connected to this session. What a `<video>` element
  needs from the server (signed URL, `bytes=0-` → 206, mid-file ranges, `video/mp4`) is proven; the
  click handler, the in-page re-sign on ticket expiry and phone Chrome's player were read in code only.
- [Code inspection] `startVideo` re-signs at most 3 times per press and shows nothing if the 4th
  error comes: the player just stops. That covers ~20 minutes of seeking for a 4-minute film; reload fixes it.
- A stream re-reads the file after hashing (§3c #3, stated, not eliminated).

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
    silent. **Fixed after the commit — see #14.**
13. **[Verified, fixed after the commit] The classic engine delivered the OLD picture after a
    re-render.** `muxFinal` (sidecar/audio-finish.js) takes its picture from
    `work/video_silent.mp4` whenever that file exists, and the classic engine left it from the
    previous render. So an order corrected and re-rendered WITH music was delivered uncorrected,
    and every check passed (same length, same size). Reproduced: first photo swapped white → blue;
    the new join's luma 72, the delivered film's 235. `render.mjs` `addAudio` now removes that copy
    first; after the fix the delivered film reads 72. Regression in `memorial-gallery` §9b.
    Gallery already removed it (its narration path) and was not affected.
    **Sibling in StarNet itself — [Verified, fixed 2026-11-25 in `4fc46d970`; LIVE since the owner's restart at 16:48:05 PST, sidecar PID 5766 — loaded at boot, code path not yet exercised by a real render]:**
    `sidecar/video-providers.js` `generateVideoWithFallback` called `audioFinish` with no `silentCopy`,
    so a re-render into a studio project folder (`~/outbox/<projectId>/`) muxed the PREVIOUS
    render's picture. Replayed at $0 (local-ffmpeg + mocked fal): before, delivered mean RGB
    `[0,0,253]` = the old clip; after, `[125,127,127]` = the new render. The stale copy is now set
    aside as `video_silent.superseded-<time>.mp4` (never deleted: it may be a paid clip). 4 of 6
    live studio projects already hold such a copy. Regression: `test/video-providers.test.js`
    (59 OK; 4 FAIL against the old file). Record: `qa/bugs/542f1f12-*.md` (status open until committed).
14. **[Verified, fixed after the commit] Classic voice-only orders were delivered silent** (#12's
    code-inspection finding). `addAudio` now mixes narration alone when there is no music;
    regression in `memorial-gallery` §9b.

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

1. ~~Commit the post-commit fixes~~ DONE (`8942d5d6c` and the Outbox commit, §1). Still open:
   **push** — nothing is pushed (the remote diverged; see the git-remote memory note before pushing).
   Also decide on `website/app/app/harness.js` (mirror catch-up of `8e18e7441`, uncommitted).
2. ~~Restart StarNet~~ DONE by the owner 2026-11-25; streaming verified live (§3d). Still open:
   **open the Outbox in a browser, reload, press ▶ Play on `gallery-long.mp4`** and watch the films.
3. **Agent integration** (README "held for Phase D"): a `memorial_render` tool under capId
   `studio` and a `noAgent` cron tick. Outbox registration is DONE via `cli.mjs outbox`.
4. **Listen** to the eight tracks and choose the shop's default (`manifest.json` → `default`).
5. **File the stage-1 bug record** — needs a `--surface` choice (`qa/bugs` has no memorial surface):
   `node scripts/qa/bugs.mjs --new --title "Memorial act break never fades to black (actBreak dropped by buildPlan; join cache ignores transitions)" --surface <choose> --severity P2 --lane fix/memorial-actbreak`
6. **Private photo copies**: keep or delete `~/memorial-prototype-20261124/render-real/` and
   `~/memorial-research/real/` (renders of the owner's personal photos).
7. Product decisions: price tiers, revision policy (research found "one round, 48 h" is the
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

## 9. How this was built — the 2026-11-24 session, start to finish

Kept so a future session understands WHY things are the way they are, not just what exists.

1. **Read-only state report** of stage 1 (act-break fix, uncommitted). Found the handoff
   mis-stated stage 1 as "`render.mjs` only" — `README.md` was changed too. Owner approved
   correcting only the handoff; then registering `memorial-actbreak` in `test/fast.list`; then a
   read-only audit that caught my own stale wording ("two tracked files" → three).
2. **Master authorization** ("finish the whole project end to end, research, sub-agents, spend").
   Read as covering the engine work but NOT commits, pushes or restarts (each needs its own yes).
   Three research agents ran in parallel: face detection that runs on Termux (→ pico cascade,
   pure JS, MIT; onnxruntime/YuNet was more accurate but 154 MB), licensed music (→ 4 CC0 + 4
   US-government tracks), and production craft (→ dwell times, safe areas, the symmetric dip, QC
   thresholds, BT.709, loudness targets). Their verified measurements became code comments.
3. **Design decisions forced by measurement on this phone:** one flattened "plate" per scene
   (11 s/scene) instead of moving layers (120–159 s/scene); convert to BT.709 YUV before the 8×
   upscale (3.4× faster and correct colour); text as separate frame-size overlay layers so words
   never resample; two segments in parallel (three was slower); `fadeblack` replaced by fades +
   short dissolve (luma 16 vs 1–7, symmetric).
4. **Built** prep → faces → scenes → plates → audit → segments → join → music → QC → proof as
   separate modules, with the plan audit refusing to render anything that would cut a face or
   put text outside title-safe. Property tests (thousands of random crops/zooms) found a real
   rounding defect. Rendered: gallery demo, the owner's 6 sample photos, a 30-photo 4-minute
   film, and the classic demo from scratch (photo segments byte-identical to 2026-11-09).
5. **Defects found along the way and fixed** (§4): sideways phone photos cropped as landscapes
   (both engines), stale segment reuse, silently dropped cards, unimplemented `--force`, QC scan
   failing on clean films, music restarting at the end of a fitted film, truncated captions,
   narration losing its music, the classic engine delivering the OLD picture after a re-render,
   classic voice-only films being silent.
6. **Owner: "commit the memorial files only"** → `e5d06d426` (46 files + memorial lines in
   `fast.list`/`.gitignore`). Later work stayed uncommitted.
7. **Owner: "I want to see the video in StarNet Outbox."** Found the Outbox and the Library are
   two lists; no HTTP route feeds the Outbox; the Outbox refused files > 64 MB and typed `.mp4`
   as octet-stream. Built `cli.mjs outbox` using StarNet's own manifest module (live, no restart).
   Owner said yes to changing StarNet → streaming + Range for large/video files, mp4 MIME, a
   player. The restart was refused by the permission classifier, so it is the owner's to run.
8. **Independent review** (owner asked for /advisor; a fresh agent given only the diff) found 7
   defects, the worst pre-existing: the Outbox page never signed `/api/artifact` links, so every
   Outbox link had been a 403 in browsers. Fixed all; one "fix" (ctime in the cache key) passed
   its own test and FAILED the attack replay because of the kernel's coarse clock — replaced by
   "cache only settled files", replay refused 3/3. Re-proven on a throwaway StarNet at :8899
   fetching exactly as the page does.
9. **Owner: "add them to StarNet, I want to see them."** Registered the three films in the
   Library via `POST /api/deliverables/register` (copies in `workspaces/agent/workshop/…`). All
   three play there now, including the 68 MB one.

**Lessons that outlive this project** (also in memory): replay the bug against old and new code
before saying "fixed"; test a browser route the way the browser calls it; StarNet restarts are
the owner's to run; never `pkill` StarNet by pattern; the Termux device traps in
`reference_termux_device_traps`.

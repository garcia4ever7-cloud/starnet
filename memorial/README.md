# memorial/ — personalised memorial film production

A self-contained production engine for NIGHT4CHRIST's second revenue line. It turns an order JSON
and a folder of photographs into a verified 1080p MP4.

There are two styles. **`"style": "gallery"`** is the product: photographs arranged as full-bleed
scenes, framed prints, pairs, groups and collages on art backgrounds, with chapter cards, verses
that arrive line by line, licensed music fitted to the film, face protection, and a quality gate.
**Classic** (no `style`) is the original one-photo-per-moment engine, kept working and unchanged
for existing orders. Start at [Gallery](#gallery--the-layout-engine).

**It makes no model calls, opens no network connection, and spends nothing.** Every text provider
reachable by this station is currently dry and the sidecar holds no provider keys; production must
never block on a wallet. Agents, when funded, only improve the words *inside* the order JSON.

Nothing in `sidecar/` is modified by this module. It reuses two sidecar files read-only.

## Run it

```bash
# a new order, start to finish
node memorial/cli.mjs new    <photos-dir> --name "Full Name" --born 1940-05-02 --died 2026-10-03
node memorial/cli.mjs faces  <order.json>    # face sheet — LOOK at it, fix any missed face, set "facesReviewed": true
node memorial/cli.mjs plan   <order.json>    # storyboard + placement audit, in seconds, nothing rendered
node memorial/cli.mjs render <order.json>    # renders, verifies, runs the quality gate   [--force]
node memorial/cli.mjs proof  <order.json>    # 960x540 watermarked copy for the family's approval
node memorial/cli.mjs tv     <order.json>    # the film on a television in a room (12 s clip + still)
node memorial/cli.mjs outbox <order.json>    # film + proof + TV clip + storyboard into the StarNet Outbox (NIGHT4CHRIST)

node memorial/cli.mjs qc     <order.json>    # re-run the gate on a finished film
node memorial/cli.mjs music                  # the licensed music library
node memorial/cli.mjs status                 # business digest: station health, exceptions, orders, costs
node memorial/cli.mjs orders | exceptions

# the two demos (fictional subjects)
node memorial/cli.mjs render memorial/examples/gallery-demo.json            # gallery
node memorial/cli.mjs render memorial/examples/life-worth-remembering.json  # classic
```

Set `MEMORIAL_BUSINESS_ROOT` to a scratch directory for any test render — the demo subjects are
fictional, and a test order in the real `.business` ledger would be a fabricated business record.

Renders are **resumable**: a segment is reused only if it still decodes correctly **and** its
recorded fingerprint (source photo, text, motion, hold, size) is unchanged — so a swapped photo or
a corrected verse can no longer be silently reused. The join is reused only if it was built from
the identical join graph (`work/.graph-assemble.txt`). Killing a render and re-running it costs
only the unfinished segments; `--force` re-renders everything. Work in progress, test evidence
and open issues: `MEMORIAL_SESSION_HANDOFF.md`.

## Gallery — the layout engine

`gallery.mjs` runs eight stages. The first five need no encoder and take seconds, which is what
`plan` shows you.

| # | Stage | Module | What it guarantees |
|---|---|---|---|
| 1 | prep | `prep.mjs` | Every photo decoded **upright** (EXIF applied), solid screenshot bars trimmed, capped at 4096 px. Originals untouched. |
| 2 | faces | `faces.mjs` | Operator marks win; else the vendored pico detector; else **unknown**. |
| 3 | scenes | `layouts.mjs` | Which photos share a moment and how. **Face protection is decided here.** |
| 4 | plates | `plates.mjs` | Each scene and card drawn once at 2× (3840×2160). Captions and card text are separate frame-size layers. |
| 5 | audit | `gallery.mjs` | Every face and every line of text re-checked against where it actually landed. A failing plan is **not rendered**. |
| 6 | segments | `gallery.mjs` | One plate → one clip with the 8× oversampled move, in BT.709. |
| 7 | join | `join.mjs` | Dissolves, symmetric act-break dips, head and tail fades. |
| 8 | music | `audio.mjs` | Library track(s) fitted to the film's exact length, two-pass mastered. |

### Scene kinds

| Kind | When (automatic) | Look |
|---|---|---|
| `full` | landscape, ≥ 1100 source px across the frame, every protected face fits the 16:9 crop | fills the screen; zoom anchored on the faces |
| `group` | landscape that cannot be 16:9 without losing a face, but can lose ≤ 15% | trimmed a little, shown large on its own blurred copy |
| `pair` | two consecutive upright photos | both whole, side by side, on the chapter's background |
| `framed` | everything else | one whole photo as a bordered print |
| `duo` | operator only: `"layout": "duo"` on the first of two | dominant photo + smaller companion |
| `collage` | operator: `"layout": "collage"` on 3–4 consecutive photos; or `"recap": true` | 3–4 whole photos in one arrangement |

`"layout"` on a photo overrides the automatic choice — **except** that `"full"` is refused, and
the photo shown whole, when the crop would cut a protected face. The plan records why. A scene
never spans a card or an act break.

### Face protection — what is and is not promised

- A photo is cropped **only** if every protected face stays inside the crop. "Protected" is the
  face box grown 55% upward (hair), 30% downward and 30% to each side.
- A zoom never pushes a protected face (full-bleed) or a print (framed layouts) out of frame: the
  anchor moves first, then the zoom gets gentler, then it stops.
- **"The detector found nothing" means unknown, not "no faces".** Unknown photos get the original
  conservative rules: portraits never cropped, landscapes only within 20% / 25%. Only
  `"faces": []` in the order declares a photo face-free.
- `"faces": [[x0,y0,x1,y1], …]` (fractions of the upright photo) replaces detection for a photo.
- The detector is the pico cascade (MIT, `vendor/pico/`, Node core only). **Measured on this
  phone, 19 images, 21 main faces:** frontal faces upright or tilted to ~30° found (19 of 21);
  zero false boxes on 8 face-free backgrounds. **It does not find profiles, faces cut by the
  photo edge, or small background faces.** Sunglasses, heavy shadow, black-and-white scans and
  babies are untested. That is why step 2 of the workflow is a person looking at the face sheet,
  and why QC warns until the order says `"facesReviewed": true`.

### Transitions

Dissolve everywhere (`xfade`, default 1.2 s). An act break (`"actBreak": true` on a photo or
card; a `chapter` card has one by default) is a **symmetric dip to black**: 0.9 s fade out, 0.5 s
black, 0.9 s fade in. ffmpeg's built-in `fadeblack` is not used — measured here it takes the
outgoing picture to black in a fifth of the transition and bottoms out at luma 7, below legal
video black. The film fades up from black over 1 s and down over 2 s.

### Music

`node memorial/cli.mjs music` lists the library. Four tracks are **CC0** (worldwide
public-domain dedication): `goldberg-aria`, `bach-prelude-c`, `bach-prelude-eflat-minor`,
`chopin-nocturne`. Four are **U.S. Air Force Band** recordings (`amazing-grace`, `nearer-my-god`,
`goin-home`, `air-on-g`): public domain *in the United States* as federal works, not a worldwide
waiver — QC says so on every film that uses one. Sources, quoted licence text, checksums and
Content-ID notes for each are in `assets/music/LICENSES.md`. **Nobody has listened to these
recordings on this device**; their loudness was measured, their mood was not auditioned.

The audio files are not in git. `node memorial/assets/music/fetch.mjs` re-downloads each original,
refuses it unless its sha256 matches the manifest, and makes the AAC copy the engine plays.

The bed is exactly the film's length: tracks crossfade (3 s) and repeat if needed, the last 4 s
fade out and end 0.5 s before the picture. Mastered in two passes to **−16 LUFS, −1.5 dBTP**;
the measured figure is reported. `"music": { "track": "…", "fit": true }` scales the photo holds
(×0.75–1.34, never further) so the film ends with the song.

### Quality gate (`qc.mjs`)

Runs after every gallery render; any FAIL blocks the order. Measured from the finished file:
H.264 High ≤ L4.0 · BT.709 limited range on all four tags · frame count · moov before mdat ·
keyframes ≤ 2 s apart · **no black outside designed fades** · every act break really reaches
black · **no frozen picture** · **no hard cut** (scene score > 0.40) · AAC 48 kHz stereo ·
audio/video same length · loudness within ±1.5 LU · true peak ≤ −1.0. From the plan: every face
inside every crop and zoom, all text inside the 5% title-safe margin, music licence on record.
WARN (deliverable, read it): faces not reviewed by a person, a face within 3.5% of the frame
edge, U.S.-only music, music that repeats, silence > 3 s.

Calibrated on clips with planted defects: hard cuts scored 0.55–1.00, a 1 s dissolve between
unlike pictures peaked at 0.29.

### Times on this phone (measured 2026-11-24, 1080p, 8× oversample)

Two scenes render at once (`MEMORIAL_PARALLEL`, default 2; 1 = one at a time — two was measured
fastest, three slower). About 12–50 s per scene depending on load. The 9-scene, 52.7 s demo took
356 s wall; a 30-photo, 238 s film took about 52 minutes on a heavily loaded phone. Budget
roughly 10–15 minutes per minute of film. `plan` takes a few seconds. A re-render after changing
one caption re-renders one segment and the join. Do not add `-filter_complex_threads` — measured
slower here.

## Why it is built the way it is

Every choice below was forced by a measurement taken on this device, not by preference.

| Decision | Why |
|---|---|
| **8× oversample before `zoompan`** | `zoompan` rounds its crop window to whole pixels, which makes a slow drift shudder. Calibration, RMS 2nd-difference of a tracked edge in output px: **1× = 1.1218, 4× = 0.2745, 8× = 0.1061**. Confirmed end-to-end in the real pipeline by `jitter-check.mjs`: **1× produces 57 whole-pixel jumps in 119 frames, 8× produces 1**. |
| **Per-segment rendering, not one filter graph** | 8× across 30+ photos will not fit in the ~2.7 GB free here (a 4× single-pass run peaked at 3,925 MB). One segment at a time bounds memory, and makes the render resumable and retryable per photo. |
| **`libx264`, not `h264_mediacodec`** | Counterintuitive but measured: hardware took **481s wall vs 285s** for the same film and produced a **3× larger file**. CPU halves, but mediacodec is the bottleneck while libx264 uses all 8 cores. |
| **Portraits are never cropped** | Going from any taller aspect to a wider one crops *vertically* — top and bottom — which is where heads are. The classic style has no face data and is conservative by construction; gallery adds a detector (see above) but keeps exactly this rule for any photo where no face was found. Both now take the decision from the **decoded** picture: `ffprobe` reports a sideways-stored phone photo (EXIF Orientation 6) by its stored size, and the classic engine used to crop such a portrait as if it were a landscape (found and fixed 2026-11-24). |
| **Vertical crop cap (20%) is tighter than horizontal (25%), and biased upward** | Padding every 3:2 photo would leave most of the film as blurred backdrop. A human editor crops a 3:2 to 16:9 and keeps the headroom, taking the loss off the bottom. `CROP_Y_BIAS = 0.25` does that. |
| **Gentle dissolves only** | AV Workshop — a real memorial business with 12 published tiers — uses "soft dissolve" as its default and sells Pan & Zoom as a **$10-per-image add-on**. Motion is the upcharge, not the baseline. The one exception is an opt-in act break (`"actBreak": true`), a symmetric dip to black. |
| **No AI touches a face** | A real paying customer's 3.7★ review on a memorial order: *"the AI facial enhancement, which made the people unrecognisable, was removed"* — while praising the *background* enhancement. That review is the design rule. |
| **Audio is `sidecar/audio-finish.js`** | It already does sidechain ducking of a bed under narration plus `loudnorm` mastering to AAC 192k, and runs on every video the station produces. Reused, not reimplemented. |

## Files

| File | Role |
|---|---|
| `gallery.mjs` | The gallery pipeline: validate → plan (stages 1–5) → segments → join → music → report. |
| `prep.mjs` | Upright, trimmed, bounded copies of customer photos. |
| `faces.mjs` | Face detection (vendored pico) and the operator/detector/unknown rule. |
| `layouts.mjs` | Pure. Face-safe crops, safe zooms, scene planning, collage geometry. |
| `plates.mjs` | Scene and card composition via `@napi-rs/canvas`; fonts and backgrounds. |
| `join.mjs` | Pure. Transition graph and timeline arithmetic for both styles. |
| `audio.mjs` | Music library, fit-to-length bed, two-pass mastering. |
| `qc.mjs` | The quality gate. |
| `proof.mjs` | Face sheet, storyboard, watermarked proof, TV preview. |
| `outbox.mjs` | Puts a finished film into the StarNet Outbox through the sidecar's own `deliverable-manifest.js` (register + video-verify), with no restart. QC and approval stay with the owner. Films over 64 MB need the 2026-11-24 streaming change in the sidecar to be listed and played. |
| `fit.mjs` | Classic. Pure. Decides crop vs pad per photo and emits the ffmpeg fragment. |
| `cards.mjs` | Classic. Title / verse / closing cards as PNGs. |
| `render.mjs` | Classic pipeline, and the shared machinery (segment cache, assembly) gallery reuses. |
| `verify.mjs` | Wraps `sidecar/video-verify.js` and adds order-level checks. Fails closed. |
| `cli.mjs` | Operator surface. |
| `assets/` | `fonts/` (EB Garamond, Cormorant Garamond — SIL OFL, licences included), `backgrounds/` (7 art plates), `tv/`, `music/`. |
| `vendor/pico/` | The face cascade and its MIT licence. |
| `business/jsonl.mjs` | Durable append-only log (`open('a')` → write → `fsync` → close). |
| `business/orders.mjs` | Order state machine. Serves **both** engines. |
| `business/exceptions.mjs` | The exception queue — what brings a decision to the owner. |
| `business/costs.mjs` | Per-order cost, including everything the model ledger cannot see. |
| `business/digest.mjs` | `status` — station health first, then exceptions, orders, costs. |

State lives in `~/.local/share/StarNet/workspaces/.business/` (alongside the existing
`.deliverables`, `.run-journal`). Renders land in `workspaces/memorial/<orderId>/`.
Override the business root with `MEMORIAL_BUSINESS_ROOT` (the tests do).

## Tests

```bash
node test/memorial-fit.test.js        # 34 assertions — the classic face rule IS this test
node test/memorial-business.test.js   # 43 assertions — ledger, exceptions, costs
node test/memorial-actbreak.test.js   # 43 assertions — act breaks dip symmetrically to legal black; the join cache honours transitions
node test/memorial-layouts.test.js    # face-safe crops and zooms as properties over thousands of random cases; scene planning; join arithmetic
node test/memorial-gallery.test.js    # the gallery pipeline end to end at 320x180: EXIF, detector, audit, resume, QC incl. a planted-defect clip, music, proof (~1 min)
node memorial/jitter-check.mjs        # renders twice (1x vs 8x) and compares — a few minutes
```

The tests run standalone with no sidecar and no network. All five are registered in
`test/fast.list` (`memorial-fit` and `memorial-business` since `93b2dd11c`; the other three added
2026-11-24, commit `e5d06d426`). The live halves need ffmpeg and print SKIP without it.

### A note on the jitter test, because I got it wrong first

The obvious regression is "assert RMS < 0.15". **That assertion is wrong.** The calibration panned
at ~0.50 px/frame; a real memorial drift is ~0.03 px/frame, and at that speed the centroid
estimator's own noise on a compressed frame dominates the measurement — the production pipeline
scores ~0.24 while being visibly smooth, and a naive threshold fails a good film. The signal that
actually matters is the count of **whole-pixel jumps**, because integer snapping produces a
staircase and a staircase is what the eye sees. So the test renders the same content at 1× and 8×
and compares, which controls for pan rate, codec and estimator noise at once.

## Order spec — gallery

```jsonc
{
  "orderId": "mem-20261124-jane-doe",
  "style": "gallery",
  "theme": "warm",                    // warm | cool | plain | dawn — picks the text palette and background set
  "background": "art",                // "art" (default) | "blur" (prints on their own blurred photo) | one background name
  "backgrounds": ["heavenly-peace"],  // optional: the art backgrounds chapters cycle through
  "hold": 6.0, "xfade": 1.2,
  "subject": { "name": "Jane Doe", "born": "1940-05-02", "died": "2026-10-03" },
  "music": { "track": "goldberg-aria", "fit": true },   // or {"tracks":[…]} | {"file":"x.m4a","licence":"…"} | "none"
  "narration": { "file": "vo.m4a" },  // optional; ducks the music
  "recap": true,                      // a collage of four photos from across the film, before the closing cards
  "facesReviewed": false,             // set true after checking the face sheet
  "photos": [
    { "file": "in/01.jpg", "caption": "The porch on Maple Street, 1978",
      "layout": "auto",               // auto | full | framed | pair | duo | group | collage
      "faces": [[0.42, 0.30, 0.58, 0.56]],   // optional; [] = nobody in this photo
      "motion": "auto",               // auto | push | pull | still
      "hold": 8, "actBreak": false, "trim": true, "recap": true }
  ],
  "cards": [
    { "at": "open", "type": "title", "line": "In Loving Memory", "dates": "year" },   // dates: year | full
    { "after": 12, "type": "chapter", "title": "Family", "subtitle": "1965 – 1990" }, // act break by default
    { "after": 20, "type": "verse", "ref": "Psalm 23:4", "translation": "KJV", "text": "…", "reveal": true },
    { "at": "close", "type": "closing", "line": "Forever in our hearts" }
  ]
}
```

An order with a wrong layout name, a non-boolean `actBreak`, faces in pixels, a verse with no
text, a card with no position, or a card `after` a photo that does not exist is **refused** with
a message naming the field. (A mis-positioned card used to vanish from the film silently.)

**Portrait title / closing card (added 2026-11-25).** Add `"portrait": <photo number>` (1-based, as in
`after`) to a `title` or `closing` card: that photo is shown on the left, its edge melted into the art
background, and the name is written on in a script face (Great Vibes, SIL OFL, `assets/fonts/`) on a
light background with dark ink. Optional on the title card: `"tagline"` (default "Forever loved · Always
remembered"; `""` drops it). Without `portrait` a card renders exactly as before.
The crop is chosen from the photo's faces (`portraitCrop` in `gallery.mjs`): the largest window in which
every face lies where the faded edge is still fully opaque, never narrower than 560 px of the original.
The plan audit refuses the film (`portrait-crop` / `portrait-keeps-faces`) when the photo's faces are
unknown, too far apart or too near its edge — choose a photo with one or two close faces, or mark faces.
Made to answer the competitor MemoryMotionCo's listing title card; see the session handoff §1b.

Backgrounds available: `classic-elegance`, `eternal-love`, `faith-and-hope`,
`garden-of-memories`, `golden-flowers-watercolor`, `heavenly-peace`, `scenic-sky-valley` — made
for this shop with Higgsfield on 2026-11-24 (owner's account; job ids in
`MEMORIAL_SESSION_HANDOFF.md`).

**Dawn theme, per-card backgrounds, light cards (added 2026-11-25, uncommitted).** `"theme": "dawn"` uses
four watercolour dawns over water the owner supplied ("Lord lead the way"): `lead-the-way-sunrise`,
`lead-the-way-river`, `lead-the-way-still-waters`, `lead-the-way-lake` — cropped to 16:9 around each sun
and horizon (uniform scale, never stretched). Dawn chapter and verse cards are **light** cards: the background
at full brightness, a pool of morning light behind the text, dark ink with a light halo (warm/cool/plain are
unchanged). Any card may name its own background with `"background": "<name>"`; otherwise it takes its chapter's.
On a portrait card the photo is now its own layer: the landscape is seen alone for half a second, the portrait
rises out of the light (`PORTRAIT_IN`, 0.5 s + 2.0 s fade), then the line, then the name is written on. The
portrait stays still while the background moves, which reads as depth. Where the photo fades out it also
brightens toward the light (`EDGE_LIGHT`), so a dark photo background melts into glow instead of leaving a
smudge; this never touches a pixel at ≥ 0.97 opacity, and faces are proven at ≥ 0.98.
Provenance [verified 2026-11-25 by sha256 against the deliverable manifest]: all four are StarNet's own AI art from
2026-11-22 — sunrise = DESIGNER `psalm-34-18-soft-watercolor-sunrise-master-4x5.png`, lake = DESIGNER
`psalm-34-18-soft-watercolor-sunrise-2x3.png`, river = DESIGNER `psalm-46-1-art-A3.png` (hard-days), still waters =
DIRECTOR `ref-still-01.png` (readiness-test-sunrise-lake). AI-generated, so Etsy's AI-content disclosure applies to any
listing that shows them (see the `etsy-rules` skill).

## Order spec — classic

```jsonc
{
  "orderId": "mem-20261109-0001",
  "engine": "memorial",
  "aspect": "16:9",            // or 9:16, 4:3
  "theme": "warm",             // warm | cool | plain
  "hold": 6.0,                 // default seconds per photo
  "xfade": 1.2,                // dissolve length
  "subject": { "name": "...", "born": "1931-04-12", "died": "2026-10-03" },
  "music":   { "file": "bed.m4a", "licence": "..." },
  "narration": { "file": "vo.m4a" },          // optional; ducks the bed automatically
  "photos": [
    { "file": "in/01.jpg", "caption": "...", "hold": 6.0,
      "motion": "auto|push|pull|driftR|driftD|still",
      "fit": "auto|crop|pad",                // `auto` applies the face rule
      "actBreak": false }                    // optional on any photo or card: true = fade through black INTO this entry
  ],
  "cards": [
    { "at": "open",  "type": "title" },
    { "after": 10,   "type": "verse", "ref": "Psalm 23:4", "text": "...", "translation": "KJV", "actBreak": true },
    { "at": "close", "type": "closing", "line": "In loving memory" }
  ]
}
```

`actBreak` must be a boolean — anything else fails the order; on the first item it has no effect.
Every card needs `"at"` or a valid `"after"`; a card that could never be placed fails the order.

**A hand-written order JSON must always render.** That is the degradation guarantee, and it is
what makes the engine immune to an empty wallet.

## Scripture

KJV only. The shop's `etsy-rules` skill bans ESV/NIV/NLT/NKJV/CSB/NASB for commercial use — they
need written permission the shop does not have. Note that STORYWRITER currently has **no**
translation instruction in its roster record and project blueprints already contain 17 ESV
references; that gap is flagged for Phase D, not fixed here.

KJV renders **LORD** in small capitals where the Hebrew is YHWH. Plain-text sources flatten this
(Psalm 116:15 comes back as "the Lord"). It is an existing QC checkpoint for this shop.

## Music licensing

A public-domain hymn **text and tune** does not make a **recording** public domain — the sound
recording and any modern arrangement are separate copyrights (US Copyright Office Circulars 50 and
56A), and Content ID matches the *recording*. Pairing any copyrighted recording with video also
needs a **synchronisation** licence, which is distinct from the performance licence a funeral home
holds. The classic demo's bed is synthesised from sine waves by `examples/make-demo-assets.mjs`
precisely so this question does not arise. The gallery library (see Music above) contains only
recordings whose own licence was read and recorded; a correct licence does not stop a mistaken
Content-ID claim on YouTube, which the uploader would have to dispute — `LICENSES.md` is the
evidence to send.

## Not done here — held for Phase D review

- Registering a `memorial_render` tool in `CAP_REGISTRY` / `index.js` / `toolprops.js`.
  Reuse capId **`studio`** (already in `SAFE_BUILTIN_CAPS`); a new capId not in that set is
  silently stripped from every ASK-mode unattended run before the model sees it.
- Registering finished films into `sidecar/deliverable-manifest.js` so they appear in the Outbox
  and are retrievable via `/api/artifact`. The tool must return
  `producedFiles: [{path, bytes}]` with workspace-relative paths — model it on
  `vector-export.js`, **not** `openai-image.js`, which omits it and so never reaches the Outbox.
- A `noAgent: true` + `script:` cron routine for unattended ticks. That path runs host-side and
  returns **before provider admission** (`reason:'done', turns:0, usd:0`), so it works at $0 on a
  station with no credit. Script timeout is clamped to 120s, so the tick must claim an order and
  fork the render detached rather than block.
- Wiring `setQc` / `setApproval` on the deliverable manifest. They exist and the Outbox UI already
  renders approval pills, but **no route or tool calls them**, so the approval axis is permanently
  `pending` in production today.
- ~~Adding the two test files to `test/fast.list`.~~ Done in `93b2dd11c` (`test/fast.list` lines 1012–1013).

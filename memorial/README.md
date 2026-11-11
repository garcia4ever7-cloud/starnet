# memorial/ — personalised memorial film production

A self-contained production engine for NIGHT4CHRIST's second revenue line. It turns an order JSON
and a folder of photographs into a verified 1080p MP4.

**It makes no model calls, opens no network connection, and spends nothing.** Every text provider
reachable by this station is currently dry and the sidecar holds no provider keys; production must
never block on a wallet. Agents, when funded, only improve the words *inside* the order JSON.

Nothing in `sidecar/` is modified by this module. It reuses two sidecar files read-only.

## Run it

```bash
node memorial/cli.mjs render  memorial/examples/life-worth-remembering.json
node memorial/cli.mjs verify  memorial/examples/life-worth-remembering.json
node memorial/cli.mjs status          # business digest: station health, exceptions, orders, costs
node memorial/cli.mjs orders
node memorial/cli.mjs exceptions
```

Renders are **resumable**: a segment that already exists and passes its own duration/resolution
check is reused. Killing a render and re-running it costs only the unfinished segments.

## Why it is built the way it is

Every choice below was forced by a measurement taken on this device, not by preference.

| Decision | Why |
|---|---|
| **8× oversample before `zoompan`** | `zoompan` rounds its crop window to whole pixels, which makes a slow drift shudder. Calibration, RMS 2nd-difference of a tracked edge in output px: **1× = 1.1218, 4× = 0.2745, 8× = 0.1061**. Confirmed end-to-end in the real pipeline by `jitter-check.mjs`: **1× produces 57 whole-pixel jumps in 119 frames, 8× produces 1**. |
| **Per-segment rendering, not one filter graph** | 8× across 30+ photos will not fit in the ~2.7 GB free here (a 4× single-pass run peaked at 3,925 MB). One segment at a time bounds memory, and makes the render resumable and retryable per photo. |
| **`libx264`, not `h264_mediacodec`** | Counterintuitive but measured: hardware took **481s wall vs 285s** for the same film and produced a **3× larger file**. CPU halves, but mediacodec is the bottleneck while libx264 uses all 8 cores. |
| **Portraits are never cropped** | Going from any taller aspect to a wider one crops *vertically* — top and bottom — which is where heads are. No face detector exists on this device (no OpenCV/onnxruntime: Termux is bionic libc, the manylinux wheels cannot install), so the rule is conservative by construction. |
| **Vertical crop cap (20%) is tighter than horizontal (25%), and biased upward** | Padding every 3:2 photo would leave most of the film as blurred backdrop. A human editor crops a 3:2 to 16:9 and keeps the headroom, taking the loss off the bottom. `CROP_Y_BIAS = 0.25` does that. |
| **Gentle dissolves only** | AV Workshop — a real memorial business with 12 published tiers — uses "soft dissolve" as its default and sells Pan & Zoom as a **$10-per-image add-on**. Motion is the upcharge, not the baseline. |
| **No AI touches a face** | A real paying customer's 3.7★ review on a memorial order: *"the AI facial enhancement, which made the people unrecognisable, was removed"* — while praising the *background* enhancement. That review is the design rule. |
| **Audio is `sidecar/audio-finish.js`** | It already does sidechain ducking of a bed under narration plus `loudnorm` mastering to AAC 192k, and runs on every video the station produces. Reused, not reimplemented. |

## Files

| File | Role |
|---|---|
| `fit.mjs` | Pure. Decides crop vs pad per photo and emits the ffmpeg fragment. The face rule lives here. |
| `cards.mjs` | Title / verse / closing cards as PNGs via `@napi-rs/canvas`. |
| `render.mjs` | Three passes: per-photo segments → xfade assembly → audio. |
| `verify.mjs` | Wraps `sidecar/video-verify.js` and adds order-level checks. Fails closed. |
| `cli.mjs` | Operator surface. |
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
node test/memorial-fit.test.js        # 34 assertions — the face rule IS this test
node test/memorial-business.test.js   # 43 assertions — ledger, exceptions, costs
node memorial/jitter-check.mjs        # renders twice (1x vs 8x) and compares — a few minutes
```

The two unit tests run standalone with no sidecar and no network. **They are deliberately NOT yet
registered in `test/fast.list`** — that is a core-file change held for Phase D review.

### A note on the jitter test, because I got it wrong first

The obvious regression is "assert RMS < 0.15". **That assertion is wrong.** The calibration panned
at ~0.50 px/frame; a real memorial drift is ~0.03 px/frame, and at that speed the centroid
estimator's own noise on a compressed frame dominates the measurement — the production pipeline
scores ~0.24 while being visibly smooth, and a naive threshold fails a good film. The signal that
actually matters is the count of **whole-pixel jumps**, because integer snapping produces a
staircase and a staircase is what the eye sees. So the test renders the same content at 1× and 8×
and compares, which controls for pan rate, codec and estimator noise at once.

## Order spec

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
      "fit": "auto|crop|pad" }               // `auto` applies the face rule
  ],
  "cards": [
    { "at": "open",  "type": "title" },
    { "after": 10,   "type": "verse", "ref": "Psalm 23:4", "text": "...", "translation": "KJV" },
    { "at": "close", "type": "closing", "line": "In loving memory" }
  ]
}
```

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
holds. The demo's bed is synthesised from sine waves by `examples/make-demo-assets.mjs` precisely
so this question does not arise.

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
- Adding the two test files to `test/fast.list`.

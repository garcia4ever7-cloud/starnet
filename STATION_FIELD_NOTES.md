# STATION FIELD NOTES

Hard-won facts about **this** station (Android/Termux, phone-only) that cost real time or real money
to learn. Read this before re-investigating anything below. Last updated **2026-10-20** (end of the
image-tools + model-ops session — see §9 for what's still open).

Scope: operational truth about the live runtime + repo gates. Code architecture lives in `CLAUDE.md`
and `CODE_MAP.md`; the owner's business brief lives in `CLAUDE_CODE_ETSY_PROJECT.md`.

---

## 1. The single most expensive lesson: delegation is browser-only

**`team.dispatch` / `team.spawn` / `team.summon` do not exist in any cron or headless run.** Not a
bug, not a prompt problem, not a model problem — a deliberate boundary.

- `sidecar/capability/effective-toolsets.js:24` — `const runtimeGranted = lead && r.object === 'orchestrator'`
- `sidecar/index.js:16135` — `lead: true   // ONLY the browser-commanded run is a lead — it alone gets the orchestrator object`
- `trusted-project` profile grants `['computer','cabinet','workbench']` — **no orchestrator**
- `orchestrator` is **not in `CAP_PROP_MAP`** (`frontend/app/worldmodel.js`) — it is not a placeable
  prop, so you cannot grant it by building something on the floor

**Do not retry headless delegation.** Three paid runs (~$2.15) were burned proving this. A Commander
asked to dispatch in a routine will either hunt fruitlessly with `tool_search` or silently skip the
step. Delegation requires a real chat turn from the station UI.

**A trap to avoid:** `GET /api/toolsets?agent=<id>` reports the **interactive-lead** view — its own
response literally contains `"context":"interactive lead"`. It will show `team.dispatch` as available
even though a routine run does not get it. Do not use that endpoint to predict what a cron run can do.

### Related consent facts (all verified)

- `approvalMode`: `agent`/NIGHT4CHRIST and `harvest` are `full`; `webdesigner`/`publisher`/`scout` are `ask`.
  An `ask` agent stalls forever on any `requiresConsent: true` tool in an unattended run.
- Per-routine `unattendedGrants` accepts **only** `['workbench','connectors']` (`sidecar/cron-store.js`
  `GRANTABLE`). There is no studio/image grant.
- `POST /api/permissions/grant` pre-blesses **only** `['cabinet:write']` (`sidecar/permgrants.js`
  `GRANTABLE`). Again no studio.
- Net: an `ask`-mode specialist cannot do consent-gated work headlessly, by any route.

---

## 2. Live runtime operations

- **Live data is NOT in the repo.** It is `~/.local/share/StarNet/workspaces/`.
- **Always launch via `~/start-starnet.sh`** (sources keys, wake-lock, heap cap, crash-restart loop).
  It has an already-running guard and exits 0 if the port is live.
- **Restart that works:** `kill <launcher-pid>` then `kill <node-pid>`, confirm port dead, then
  `nohup ~/start-starnet.sh > <log> 2>&1 &` and poll `/api/health`. Came up in ~3s.
- **API auth header is `x-starnet-token`** (legacy alias `x-skynet-token`). **Never `Authorization: Bearer`** —
  that always 403s even with a correct token.
- **Token source of truth is `STARNET_API_TOKEN` in `~/.config/starnet/env`.** The file
  `~/.config/starnet/.apitoken` had drifted stale and returned 403; repaired 2026-10-20 (old copy
  backed up). If auth fails, re-check that these two agree before suspecting anything else.

### Headless run recipe (proven)

```
POST /api/cron            {name, agentId, provider, model, schedule:"0 9 1 1 *", enabled:true, prompt}
POST /api/cron/run        {id}            # streams ndjson; blocks until done
POST /api/cron/remove     {id}            # always clean up
```

- **`POST /api/cron/update` requires `{id, patch:{...}}`.** A flat body (`{id, prompt}`) applies
  **nothing** and still returns `{"ok":true}` — this silently re-ran an unchanged job and cost $0.86.
  Always verify the echoed `job.prompt` actually changed before firing.
- Per-routine `model`/`provider` override the agent's saved config **without touching
  `agent.save.json`** — the right way to use a faster/paid model for one run. Leave `model` unset
  and the run falls back to the agent's own saved model.
- **Routine names are deduped by a mint gate**, and removing a routine does not clear it: recreating
  a same-named routine returns `{"ok":false,"declined":true,"message":"this routine already exists —
  do not recreate it"}`. Suffix throwaway probes with a timestamp.
- **Each agent's workspace is jailed and separate.** `agent/outbox/...` is invisible to
  `webdesigner`; DESIGNER sees only `webdesigner/...`. A worker cannot read another agent's files,
  so never ask one agent to "verify" another's output by path — absence proves nothing.

### Reading a routine's answer — and a measurement trap

**A cron run's final text is in the job's `lastOutput`** (`GET /api/cron`, find your job). Do not try
to assemble it from `agent.token` stream events — those are routinely empty in cron runs.

**`lastOutput` is NOT cleared when a run fails.** A run that errors leaves the *previous* successful
run's output in place. While benchmarking models this made three failing models (HTTP 403/429) show
a perfect "PASS" they never earned. **Always gate on `lastStatus === 'ok'`**, and when comparing
runs, change the expected answer between rounds so a stale value cannot masquerade as a fresh one.

### Event stream shape

Lines are `{"name": "...", "payload": {...}}` — not `{type}`/`{event}`. Useful names:
`agent.run.start`, `agent.tool_call`, `agent.tool_result`, `deliverable`, `agent.token`,
`agent.cost`, `agent.run.end` (`{reason, turns, usd}`).
**`agent.token` is frequently empty in cron runs** — judge success from `agent.tool_result` +
`deliverable` + files on disk, not from assembled text.

---

## 3. Image pipeline facts

- **`image_generate` takes `aspect_ratio`** (`"4:5"`, `"portrait"`, `WxH`, …). **Set it.** Without it
  you get landscape (1408×768); `image_print_prep` presets are **portrait only**
  (8x10=2400×3000, 11x14=3300×4200, 16x20=4800×6000), so a landscape source gets letterboxed into
  big empty bars. Portrait source → `928×1152`, which fits cleanly.
- `image_print_prep` **upscales**. The 300 DPI is real metadata and real pixel count, but the detail
  came from the smaller render — say "300 PPI by dimension", never "print-shop sharp".
- Ask explicitly for **flat artwork** or the model returns a *framed mockup photo* (wooden frame on a
  wall). Negative-prompt it: `NO frame, NO wall, NO room, NO mockup, NO border`.
- **`image_quality_check` validates geometry, not fitness.** It passed a badly letterboxed file as
  "print-shop quality (>=300 DPI)" because dimensions and DPI were correct. **Known gap** — a
  uniform-border-band detector would close it. Until then, *look at the image*.
- `sharp` has **no android-arm64 binding** here; `@napi-rs/canvas` is the working raster path.
- **Tool argument shapes are not the declared schema — harden for that.** `image_quality_check`
  declares `images: [{path}]`, but real runs sent, in order: a JSON-encoded array string
  (claude-sonnet-5), then `{"images": "path"}`, `{"images": {"item": {"path": …}}}` and finally
  `{"image": "path"}` — a *singular key* (minimax-m3.1-flash). Each rejection cost the agent a turn,
  and after three it abandoned the tool and shelled out to read the PNG header by hand. The tool now
  coerces value shapes (bare string → path, `{item:…}`/`{images:…}` wrappers, single `{path}`,
  numeric-keyed pseudo-arrays, JSON strings) **and** key aliases (`images`/`image`/`files`/`file`/
  `paths`, declared name wins). Garbage still fails closed, but the error now names the missing file
  rather than the shape. Fixed + regression-tested 2026-10-20; verified live, 9 turns → 2.
  **If you add an agent-facing tool with a non-scalar parameter, expect this class.**

---

## 4. Tools added 2026-10-20 (don't rebuild these)

| Tool | File | Notes |
|---|---|---|
| `image_stock_fetch` | `sidecar/tools/builtin/stock-image.js` | CC0/public-domain only |
| `vector_export` | `sidecar/tools/builtin/vector-export.js` | SVG → 300-PPI PNG + PDF |

Both granted via `capId: 'studio'` in `sidecar/capability/registry.js`, wired in `sidecar/index.js`,
mapped in `frontend/app/toolprops.js`, tested in `test/stock-image.test.js` /
`test/vector-export.test.js` (both in `test/fast.list`). Verified live: both resolve for DESIGNER and
NIGHT4CHRIST after restart.

### Source-selection reasoning (settled — do not re-research)

- **Wikimedia Commons is primary: no API key at all.** Verified live, HTTP 200 in 0.75s.
  `extmetadata` gives `License`, `LicenseShortName`, `LicenseUrl`, `Artist`, `AttributionRequired`,
  plus `descriptionurl`; `iiurlwidth` returns a rendered thumb (also dodges giant TIFF originals).
- **Smithsonian is second**, free `api.data.gov` key in `SMITHSONIAN_API_KEY`; `media[].usage.access === 'CC0'`.
- **Pexels/Pixabay deliberately excluded.** Their licences forbid selling content "Standalone" —
  explicitly naming prints, posters and merchandise. This station sells printables, so that is a
  permanent per-asset judgement call we chose not to carry.
- **Openverse rejected: unreachable from this device.** Three probes timed out (30s/30s/40s) while
  Commons answered in 0.75s on the same connection. Do not reach for it again.
- **Met Museum API: HTTP 410 Gone.**
- Licence gate is an **allowlist that fails closed**: CC0/PD pass; CC BY-SA, BY-NC, BY-ND and plain
  CC BY are refused *by name with a reason*. Blocked patterns are checked **before** the CC0 prefix
  test, so `cc-by-sa-4.0` cannot slip through a loose "starts with cc" match.

### SVG rasterisation trap (measured)

`@napi-rs/canvas` rasterises an SVG at its **declared** `width`/`height`, then bilinearly upscales on
draw. A 10×10 SVG drawn into 800×800 gave **224 partially-grey pixels** on the mid-scanline (a blur
ramp); the same art declared at 800×800 gave **0**. So `vector_export` rewrites the root `<svg>`
width/height (synthesising a `viewBox` when absent) **before** rasterising, then draws 1:1. There is a
dedicated regression for this in `test/vector-export.test.js` — if it ever fails alone, someone
removed `retargetSvg`.

### Zero-dependency PDF

`CONTRIBUTING.md` forbids runtime npm deps in the sidecar. `pdf-lib` would be the first; `svg2pdf.js`
needs a real DOM; `resvg-js` is a native binding with the same android-arm64 risk that killed `sharp`.
So the PDF is hand-written: a Flate-compressed `DeviceRGB` image XObject on one correctly-sized page,
alpha flattened onto white. xref offsets are real byte positions and are asserted in the test.

**Gotcha:** `print-prep.js`'s `injectPhys(buffer, pixelsPerMeter)` takes **two** args. Calling it with
one silently produced a file that failed its own pHYs verification.

---

## 5. Repo gate facts (`npm run test:fast`)

### Pre-existing failures on this device — NOT caused by your change

| Step | Cause |
|---|---|
| `qa-product-perfect-claims.test.js` | Stale claims ledger vs already-committed frontend work (`chat.js`, `modeldock.js`, `agent-dossier.css`, `comms.css`, `index.html`) |
| `failopen-ratchet.test.js` (index.js row) | `index.js` has 364 empty sync catches vs a 360 baseline — identical count in pre-session backups |
| `crt-context-loss.e2e.test.mjs`, `world-sharpen.test.mjs`, `worldlight-receiver.test.mjs` | No WebGL in the headless browser here |
| `skin-study-preview.test.js`, `projection-load-geometry.test.js`, `agent-skin-thumbs.test.js` | `sharp` has no android-arm64 binding |

Confirm a failure is pre-existing by comparing against a `.bak` of the file **before** blaming your
change — don't assume either way.

### Gates that will catch a new sidecar tool

- **`lint-determinism.js`** bans `Math.random` / `Date.now` / `performance.now` / `new Date()` in
  `shared/` + `sidecar/`. Inject a clock: `const now = typeof deps.now === 'function' ? deps.now : (() => 0)`
  and wire `now: () => Date.now()` at the `index.js` call site. (`new Date(ms)` with an argument is fine.)
- **`failopen-ratchet.test.js`** bans bare silent catches. Use the `image.js` precedent:
  `.catch(e => { if (!e || e.code !== 'ENOENT') require('../../failopen.js').note('tag', e); })`
- **`toolprops.test.js`** requires every new `CAP_REGISTRY` grant to map in `frontend/app/toolprops.js`.
  Prefix families (`image_`, `resolve_`) are automatic; a name like `vector_export` needs an exact row.
- **Touching `frontend/` requires `npm run sync:website`** or `website-app-sync.test.js` goes red.
  Note it also mirrors `.bak` files into `website/app/` — clear those before any real website deploy.

### Running the gate past a known failure

`scripts/run-test-list.mjs` accepts any list file, so you can resume instead of re-running 480 steps:

```bash
grep -v "known-bad.test.js" test/fast.list > "$TMPDIR/rest.list"
node scripts/run-test-list.mjs "$TMPDIR/rest.list"
```

`/tmp` is not writable under Termux — use `$TMPDIR`.

---

## 6. Free models — benchmarked 2026-10-20 (don't re-rank from names)

Current assignment as of 2026-10-20:

- **`agent` / `publisher` / `scout` / `harvest` → `minimax/minimax-m3.1-flash:free`** (1M context,
  tools, reasoning) — chosen by measurement, not by spec sheet.
- **`webdesigner` / DESIGNER → `nvidia/nemotron-3.5-super-vl:free`** — vision-capable, so
  `image_analyze` has a local fallback. Costs speed (~34-46s vs ~7-14s), which is an accepted
  trade for the agent that inspects its own artwork. **Verified live:** it read a 928×1152
  typography print and transcribed the full Philippians 4:6-7 text *word for word*, attribution
  line included, confirmed against the actual image. 34s, $0.

Method: a one-off routine whose prompt forces a real batched `image_quality_check` call on known
files and demands an exact formatted answer; same prompt, model patched between runs; verified
against `lastOutput` **only when `lastStatus === 'ok'`**; confirmation round used a *different*
expected answer to defeat stale output. All runs $0.

| Model | Result |
|---|---|
| **`minimax/minimax-m3.1-flash:free`** | correct, **7s / 10s / 14s** — fastest by ~4× |
| `nvidia/nemotron-3.5-lightning:free` | correct, 16s / 35s / 49s |
| `nvidia/nemotron-3-ultra-550b-a55b:free` | correct, 27s / 44s / 55s — the previous default |
| `nvidia/nemotron-3-super-120b-a12b:free` | correct, 33s |
| `dots-studio/dots-3-note-preview:free` | correct, 30s |
| `nvidia/nemotron-3.5-super-vl:free` | correct, 46s — vision-capable, if `image_analyze` fallback ever matters |
| `thinkingmachines/inkling:free`, `inkling-small:free` | **HTTP 403** — not available to this key |
| `google/gemma-4-31b-it:free` | **HTTP 429** rate-limited after 140s |

17 free models are in the catalog; 16 advertise `supportsTools`. Pull the live list from
`GET /api/models/openrouter` (fields include `supportsTools`, `context_length`, `pricing`) rather
than trusting any written-down list — it drifts.

### Use `scripts/station-models.mjs` — don't do the sync dance by hand

Written 2026-10-20 after doing the manual dance below enough times to automate it. **This is now the
right way to change any agent's model.** It does all 4 steps atomically, snapshots before every
mutation, and gives you a one-command undo:

```bash
node scripts/station-models.mjs list                        # who runs what + working free models
node scripts/station-models.mjs snapshot [label]             # save current assignment
node scripts/station-models.mjs set <agentId|all> <model>    # change one or all (auto-snapshots)
node scripts/station-models.mjs revert                       # undo the most recent change
node scripts/station-models.mjs restore <label>               # jump to any named snapshot
```

Two standing snapshots already exist from this session and are safe to reuse:
- `all-free-20261020` — the 5-model free set above
- `paid-routing-restored-from-backup` — the real prior paid routing, recovered from
  `agent.roster.json.bak.freemodel-20261019-142412`: `agent`→`claude-opus-4.8`,
  `webdesigner`/`publisher`/`scout`→`claude-sonnet-5`, `harvest`→`claude-opus-5.5` (all via openrouter)

The manual dance it replaces (kept here for understanding, not for doing by hand):

1. Back up `agent.save.json` and `agent.roster.json`.
2. In `agent.save.json`: set `model`/`provider` on every `doc.agents[]` entry **and** on `doc.agent`;
   set `doc.updatedAt = Date.now()`, increment `doc._saveRevision`, and set top-level `updatedAt` to
   the same stamp.
3. `POST /api/roster` with `{agents:[...], updatedAt:<same stamp>}` — the body needs `agentId` on
   each entry, and the route **replaces the entire roster**, so send all of them. It refuses a stamp
   older than what it last accepted.
4. Verify via `GET /api/runtime/agent`, and confirm both files report the same `updatedAt`.

**Then reload any open station browser tab.** The frontend owns the roster; a stale tab can push the
old models back over this.

## 7. Money

- **Current routing: PAID** (as of 2026-10-20 end of session) — `agent`→`claude-opus-4.8`,
  `webdesigner`/`publisher`/`scout`→`claude-sonnet-5`, `harvest`→`claude-opus-5.5`. Switch to free
  with `node scripts/station-models.mjs restore all-free-20261020` any time credit runs low.
- **OpenRouter has a SEPARATE wallet** from StarNet's ledger — this is the one that actually gates
  `image_generate` and paid chat models. Owner topped it up mid-session (2026-10-20) to **$19.53**;
  **~$17.93 remained** at session end after one paid pipeline run. Check
  `GET https://openrouter.ai/api/v1/credits` before any paid work — a dry wallet surfaces as a
  confusing 402 "prompt tokens limit exceeded" on the chat call, not a clean "out of image credit."
  **Real failure observed:** an opus-4.8 run burned **$0.235 in reasoning tokens** and still hit the
  402 before `image_generate` ever fired — a near-empty wallet can burn real money and produce
  nothing. If the wallet looks low, use a free model for the agent's reasoning and let `image_generate`
  alone spend the credit (works because the chat model and the image model are billed separately) —
  proven live: $0 reasoning + real paid image = a deliverable for the cost of the image alone.
- **StarNet's own lifetime ledger: $82.98** (2026-10-20) — over the documented $60 soft ceiling.
  Policy-only, never wired to the technical cap. Flagged every session, not enforced; do not set
  `global` in `budget.json` without re-confirming with the owner — it would immediately block every run.
- **Hard technical rail: `perDay: 25`** in `workspaces/budget.json`. Everything else `0` = ungoverned.
- Observed costs: `image_generate` ≈ $0.067; `image_print_prep`/`vector_export`/`image_quality_check`
  are local and free; a `claude-sonnet-5`/`opus-4.8` orchestration run runs $0.15–$0.86 depending on
  wasted discovery turns (naming tools explicitly and forbidding
  `station_inspect`/`manual_read`/`connectors_list`/`tool_search`/`shell_exec`/`code_run` in the prompt
  cut one run from 9 turns/$0.86-equivalent to 2 turns).
- A direct non-agent paid API call does **not** auto-record to the ledger; append a correctly-shaped
  entry by hand if you make one.

---

## 8. Current outbox artifacts (`agent/outbox/`) — needs owner triage

The outbox has accumulated many candidates from repeated test runs across this session and earlier
ones. **Nothing has been deleted — the owner should pick the real "final" file(s) and archive/remove
the rest**, since a future agent run or a Publisher draft could otherwise pick up a stale/wrong one.

Best candidates, by category:
- `final-print-{8x10,11x14,16x20}-300ppi.png` (2026-10-20, paid opus-4.8 + real `image_generate`) —
  genuine watercolor "Be Still", flat, full-bleed, 300 DPI verified. **Likely the one to ship**, but
  it's an *upscale* of a 928×1152 source (see §3) — real dimensions, real metadata, not upscaled sharpness.
- `team-image-{8x10,11x14,16x20}-300ppi.png` + matching `.pdf` (2026-10-20, free model + `vector_export`,
  $0) — vector-native "Be Still", genuinely sharper at print size than any raster upscale because it
  was rendered at full target resolution rather than scaled up. Different visual style (flat geometric,
  not painterly). Built when `image_generate` was unreachable (wallet dry) — proof the station can
  degrade gracefully to a local-only path.
- `be-still-portrait-{8x10,11x14,16x20}-300ppi.png` (2026-10-20 earlier) — first flat portrait success.
- `pipeline-proof.png` (928×1152, no DPI) — 4:5 source only, no print-prep pass run on it.

Superseded / do not ship:
- `be-still-flat*.png` — flat but landscape source, letterboxed when print-prepped.
- `team-drop*.png` — a *framed mockup photo* (wooden frame, wall), not flat artwork.
- `commander-drop.png` — 1408×768, no DPI metadata, earliest attempt.
- `trust-in-the-lord*.png`, `matthew-11-28.png`, `scripture-*.png` — pre-date this session's work;
  origin and status unverified by this session, left untouched.

---

## 9. Open problems and next steps (2026-10-20 session end)

**Now committed** (`858344697`, 2026-10-20) — §4's tools and the `station-models.mjs` script landed
on `feat/harness-backend`. This line is stale from the session that wrote it; left as a historical
marker rather than deleted outright.

**Real delegation has never been proven this session.** Every "run the team" request was worked
around by having NIGHT4CHRIST act alone (§1) — that's a harness boundary, not a bug, but it also
means **nobody has verified SCOUT→DESIGNER→PUBLISHER actually hands off correctly through the real
`team.dispatch` path**, only that the tool exists in the interactive-lead toolset. First thing to do
in a browser session: open the station UI and ask NIGHT4CHRIST to dispatch DESIGNER for something
small, and confirm the handoff/result cycle actually works end to end.

**`image_quality_check`'s argument-shape fix covers 6 known shapes, not all possible ones.** Four
real shapes were observed and fixed live (§3); a fifth model could still invent a new one. If an
agent run shows the tool erroring immediately (`ok=false`, `ms` in single digits) on this tool
again, check `agent.tool_call`'s `argsSummary` in the event stream — that is how every prior shape
was found. The fix pattern (coerce value shapes + key aliases, fail closed only on genuine nonsense)
generalizes to any other agent-facing tool with a non-scalar parameter; none of the other tools have
been audited for the same class of bug yet.

**The outbox needs owner triage** — see §8. No file was deleted; several "final" candidates exist
side by side and a future automated run (e.g. PUBLISHER drafting a listing) could pick the wrong one.

**`website/app/` mirror picked up stray `.bak` files** during `npm run sync:website` (it mirrors
whatever is in `frontend/`, including backups left there). Clear
`website/app/app/toolprops.js.*.bak` and `website/app/css/agent-dossier.css.bak` before any real
website deploy — they were not committed, but they are sitting in the working tree.

**`scripts/station-models.mjs` has no automated test coverage.** It's an ops script, not part of
`test:fast`, and was only verified by live runs against the real station this session. If it's
relied on going forward, consider adding a `test/station-models.test.js` that exercises
`applyAssignment`/snapshot/restore against a throwaway fixture workspace rather than the live one.

**StarNet lifetime spend ($82.98) vs the $60 soft ceiling** is still an open, unresolved
inconsistency — flagged every session since it was first noticed, never acted on because the owner
has not re-confirmed whether to actually enforce it (doing so would immediately block every further
run). Worth a direct yes/no from the owner rather than re-flagging forever.

**`image_quality_check` still validates geometry, not fitness** (§3) — the letterboxing defect it
missed is a real, reproducible gap. Not fixed this session; noted as a known limitation, not touched.

**Two SCOUT routines + three `agent` routines + one `harvest` routine are enabled and scheduled**
(see `GET /api/cron`), now pointed at paid models with ~$17.93 in the wallet behind them. They will
fire unattended on their normal schedule. Nothing about them was changed this session except the
model each resolves to when it doesn't set its own override.

---

## 10. 2026-10-21 — the reasoning-mandatory bug actually hit production, plus a ledger lock, plus three guards against both recurring silently

**What actually happened:** the free-model switch in §6/§7 looked clean when it landed, but every
real scheduled run on `minimax/minimax-m3.1-flash:free` started failing with `openrouter http 400 —
Reasoning is mandatory for this endpoint and cannot be disabled`. Root cause:
`sidecar/providers/openrouter.js`'s `/models` catalog mapper only read FLAT fields
(`reasoningEfforts`/`reasoning_effort`/etc.) for a model's allowed reasoning-effort list — but
OpenRouter reports a mandatory-reasoning model's real floor in a NESTED `reasoning` object
(`{mandatory, supported_efforts, default_effort}`). Missing that field name meant the adapter fell
back to a generic effort list that wrongly includes `none`, so a `none` request (this model's real
`supported_efforts` is `['low','medium','high','xhigh','max']` — no `none`) sailed through clamping
unclamped and reached the wire. **Fixed**: read `m.reasoning.supported_efforts` first (see the
catalog-mapping block in `loadCatalog()`). Verified live: a real scheduled SCOUT run on the same
model completed a real multi-tool research task end to end after the fix + a sidecar restart.

**The fix needs a RESTART to take effect — editing the file alone is not enough.** The live sidecar
process has the OLD module already loaded in its `require` cache; this cost real confused time this
session because the file was fixed and test-verified first, while the LIVE process kept failing the
exact same way until `kill`'d and relaunched via `~/start-starnet.sh`. If "I fixed it but it's still
broken the same way," check whether the sidecar was actually restarted before assuming the fix is wrong.

**Second, unrelated failure surfaced right after: `UNSETTLED_SPEND` again** (see
[[project-starnet-live-environment]] for the general failure mode — this is its second recurrence).
Two orphaned `.spend-pending/<hash>.json` receipts (one from a run interrupted by this session's own
sidecar restart, one pre-existing) made `ledgerIo.readAll()` throw on every boot, silently zeroing
the in-memory ledger and hard-failing every agent run with "Spend history is unavailable..." — not a
crash, the process looked healthy throughout. Fixed the same way as last time: backed up both
receipts + `ledger.jsonl`, overwrote each stale receipt with the ledger's own self-healing
`{runId, entry:{...,usd:0,turns:0,entryId:<new uuid>}}` shape, restarted. Confirmed via
`GET /api/budget/status` → `accounting.complete:true`, `readError:null`.

**Three guards added so neither class of failure goes unnoticed again, all additive/no-op when unused:**

1. **`test/provider.openrouter-reasoning-mandatory.test.js`** (in `test/fast.list`) — regression-locks
   the catalog-mapping fix above: asserts the nested `reasoning.supported_efforts` is read correctly,
   and that a `none` request against a mandatory-reasoning model clamps to its real floor instead of
   reaching the wire. Verified it actually fails against the pre-fix file before trusting it.
2. **`scripts/station-models.mjs` now verifies every model it switches TO** with one tiny real
   request (via the real `openrouter.js` adapter — not a hand-rolled fetch, so it can't drift from
   the real clamping logic above) immediately after pushing it live. Any failure prints the exact
   provider error and auto-reverts to the pre-change snapshot. Verified live both ways: a real switch
   to a working free model passed; a switch to a deliberately-fake model id failed verification and
   was auto-reverted, restoring the prior model.
3. **A 2-consecutive-failures early warning**, well before the existing 5-failure auto-pause ceiling
   (`DEFAULT_MAX_CONSECUTIVE_FAILURES` in `cron-store.js`). `markRun` stamps a durable
   `consecutiveFailureWarning:{count,at}` marker on the EXACT settlement that brings a routine's
   failure streak to precisely 2 (never re-stamped on 3/4/5...), and prefixes `lastError` with a
   visible `⚠ 2 failed runs in a row...` marker — the job stays enabled, this is a warning, not a
   pause. `cron-driver.js`'s `finishFire` matches that stamp and fires an injected
   `onConsecutiveFailure(job, count)` hook exactly once per streak; `sidecar/index.js` wires it to (a)
   `recordDiagError` — same ring "Copy diagnostics" already exports — and (b) one appended line in
   THIS file (see the auto-generated lines this produces below, if any exist — they look like
   `- <ISO timestamp> AUTO-WARNING (cron, 2 failures in a row): ...`; that pattern is the sidecar
   writing to this file by itself, not a human note). Verified live: fired exactly once at failure 2,
   did not re-fire at failure 3, job stayed enabled throughout.

**All of the above is committed** (confirm with `git log` — this note should not say "not committed
yet" by the time you read it; if it still does, something went wrong).

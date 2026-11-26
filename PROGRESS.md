> **HISTORICAL snapshot — not current state (marked 2026-11-26).** Written in Oct–Nov 2026; agents, models, routines and dossiers have changed since. For the live state read `handoff.md`, then `CLAUDE.md` "Where we left off".

# StarNet Project Progress

Updated by Claude Code — each major task is logged here when complete.

## Repository State (clean)

- **Branch:** `feat/harness-backend`
- **HEAD:** `1d0ec8321 feat(studio): add dedicated openai_image_generate tool via OpenAI Images API` — **pushed to GitHub** ✓
- **Working tree:** clean — no modified tracked files (only pre-existing untracked stray `.bak`/pnpm files)
- **Merge state:** none (a conflicting remote merge was aborted; tree restored to HEAD)

## Completed: OpenAI Image Tool Integration

**Tool:** `openai_image_generate` — dedicated STUDIO capability rendering via OpenAI's `/v1/images/generations` (gpt-image-2 / dall-e-*).

### What was built
- `sidecar/tools/builtin/openai-image.js` — new tool wrapper: OpenAI Images API protocol (`{ model, prompt, n, size, quality, response_format: 'b64_json' }`), workspace-jail output via `fs.js` `resolveInside`, deliverable event emission, size/aspect-ratio/quality normalization, staging-then-rename writes
- `sidecar/capability/registry.js` — registered `openai_image_generate` under `studio` (scope: write, consent: true, network: true)
- `frontend/app/toolprops.js` — maps `openai_image_generate` → `studio` prop
- `sidecar/index.js` — `require` + `makeOpenAIImageTools({ openaiApiKey: providerRuntimeKey('openai',''), ... })`, registered alongside Higgsfield/Kling studio tools
- `test/openai-image.test.js` — 47 offline assertions (registry, prop mapping, schema validation, missing-key failure, payload mapping, b64_json + url-form save, provider error surfacing); added to `test/fast.list`
- **`test/fast.list`** — added `test/openai-image.test.js`

### Key design points
- `OPENAI_API_KEY` resolved independently via `providerRuntimeKey('openai','')` — separate from Higgsfield (`HF_CREDENTIALS`) and OpenRouter (`OPENROUTER_API_KEY`)
- Does **not** touch the default studio route (`image_generate` still rides OpenRouter/Gemini first); fires only on explicit `openai_image_generate` call
- Outputs map to StarNet's local workspace registry + `deliverable` event; never to a third-party asset store

### Verification
- `test/openai-image.test`: OK (47 assertions) — through `npm run test:fast`
- `test/higgsfield-integration.test`: OK (4 suites)
- `test/higgsfield-registry.test`: OK (4 assertions)
- `test/image-task.test`: OK (73 assertions)

## Completed: Failed Image Run Fix (run 56eeb0ad)

**Run:** `56eeb0ad-8c74-4a95-87f1-ee931da35a3a` — "make an image of style 1" via OpenRouter, agentId `agent`, model `~anthropic/claude-haiku-latest` (floating alias)

**Root cause:** The model ran (1 turn, 80k tokens, $0.0046) but never called `image_generate`. Run ended `done` with `artifacts: []` and `toolsOk: 0`. `ImageTask.enforceCompletion()` correctly flagged the missing artifact post-hoc, but `failureStage`/`failureCode` stayed empty — no diagnostic captured. The `~`-prefixed floating model alias (flagged in CLAUDE.md §18 as drift-prone) likely resolved to a variant that didn't issue tool calls.

**Fixes (2 files, both backed up as `.bak-imagefix`):**
1. `sidecar/index.js` line ~19389 — completion enforcement failures now also call `execution.recordFailure('image_completion', 'no_image_artifact')` so the failure is diagnosed in `diag.errors.json` instead of being silently empty
2. `sidecar/index.js` line ~16291 — `handleRun` now fails fast (HTTP 400) when `messages` is missing or empty, catching the `message` (singular) vs `messages` (array) bug that previously produced HTTP 400s from anthropic or silent no-op runs on OpenRouter

**Verification:**
- `test/image-task.test`: OK (73 assertions) through fast gate
- `test/higgsfield*`: all green through fast gate
- `test/openai-image.test`: OK (47 assertions)
- `image-task.e2e.test`: 1 pre-existing failure (`gpt-image-2.5-flare` default vs test's `gpt-image-2` expectation) — unrelated to this change, in `image.js` which was not modified

## Completed: Model routing fix for NIGHT4CHRIST pipeline

**Problem:** NIGHT4CHRIST (Commander/lead) was on `openrouter ~anthropic/claude-haiku-latest` — a `~`-prefixed floating alias flagged in CLAUDE.md §18 ("drifts"), on OpenRouter primary which breaks cross-provider fallback (saved chain only resolves cross-provider when primary is NOT openrouter). This caused run 56eeb0ad to fail: model ran 1 turn but never issued `image_generate`, ending `done` with `artifacts: []`.

**Fix:** `node scripts/station-models.mjs set agent anthropic/claude-sonnet-5-5 --provider openrouter`
- Verified OK by the script's live probe
- Pushed to live sidecar (10 agents)
- Note: direct `anthropic` provider has insufficient credit ("credit balance is too low"), so OpenRouter is the available paid path. OpenRouter slug `anthropic/claude-sonnet-5-5` is valid and verified.

**Final routing:**
- NIGHT4CHRIST (lead): openrouter anthropic/claude-sonnet-5-5 (fixed from ~claude-haiku-latest)
- DESIGNER: anthropic claude-sonnet-5-5 (unchanged)
- SCOUT/PUBLISHER/HARVEST: anthropic claude-haiku-5-5 (unchanged)

**Verification:** `npm run test:fast -- image-task higgsfield openai-image` → 5 steps green (123 assertions). `image-task.e2e.test` has 1 pre-existing failure in `image.js` (unrelated, not modified).

**Caveat:** `agent.save.json` is missing from disk (only `.bak` copies exist) — `station-models.mjs list` errors on it. The live sidecar holds the correct model. Investigate why `agent.save.json` is absent.

## Active Next Goal

**Build the 10-page printable visual design layout** — the "Verses for Hard Days" KJV scripture printable bundle (10 pages, PNG/SVG, with 300 DPI `*-print.png` versions via `@napi-rs/canvas`), including listing draft and transparent per-sale profit calculation. Status per CLAUDE.md: `approved-to-publish` (owner-approved, not yet published).

## How to Update

When a major task completes, append a new section here with: branch/HEAD state, what was built, verification results, and the next active goal.

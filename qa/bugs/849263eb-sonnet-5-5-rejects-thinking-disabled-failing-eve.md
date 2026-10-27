---
fingerprint: 849263eb
slug: sonnet-5-5-rejects-thinking-disabled-failing-eve
title: Sonnet 5.5 rejects thinking disabled, failing every run
surface: providers
severity: P0
status: claimed
found: 2026-10-27
lane: fix/anthropic-thinking-off
fix:
origin: owner
report: Owner report 2026-10-27 — every Commander run failing; runs 7ea55618 (05:03Z), 63062672 (06:27Z), 54ed192d (06:48Z)
affected: v0.12.5 working tree, parent commit 704f7c1 (dirty); Termux/Android arm64, Node v26.4.0
family: execution-configuration
installer: not-applicable
installerEvidence: Fix is in the sidecar request builder on a dirty working tree; no installer candidate has been cut from it.
recovery: unconfirmed
---

> **STATUS NOTE.** The fix is written, live-verified end to end, and covered by a registered fast test —
> but it sits in an **uncommitted working tree**. `status: fixed` requires an exact fix-commit SHA
> (`scripts/qa/bug-lifecycle.mjs:31`) and committing was not authorised, so this is `claimed` rather than a
> `fixed` record carrying a fake commit. Flip it with:
> `node scripts/qa/bugs.mjs --set 849263eb --status fixed --fix <sha>`

# Sonnet 5.5 rejects thinking disabled, failing every run

## Symptom

Every run the Commander agent made failed. The station reported an Anthropic HTTP 400 whose body was:

> To turn thinking off on this model, send `"thinking": {"type": "between_tools"}` instead of
> `{"type": "disabled"}`. The model does not think before responding. The short updates it writes between
> tool calls come back as thinking blocks.

Owner-reported failing runs: `7ea55618` (05:03Z), `63062672` (06:27Z), `54ed192d` (06:48Z). No work of any
kind completed — the request was rejected before generation, so the failure was total rather than degraded.

## Repro

From the live station (v0.12.5, Termux/Android arm64, Node v26.4.0):

1. An agent configured `provider: anthropic`, `model: claude-sonnet-5-5`, `reasoningEffort: "none"`.
   On this station that is NIGHT4CHRIST (`agentId: agent`) — and it is the **only** agent on
   `claude-sonnet-5-5`, which is why only its runs failed.
2. Start any run for that agent (`POST /api/run`, a cron fire, or a dispatched turn).
3. The run ends `agent.run.error` with the 400 above. 100% reproducible — it is a request-shape
   rejection, not a flake.

Minimal wire repro, no station needed:

```bash
curl -s https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" -H "anthropic-version: 2023-06-01" \
  -H 'content-type: application/json' \
  -d '{"model":"claude-sonnet-5-5","max_tokens":16,"thinking":{"type":"disabled"},
       "messages":[{"role":"user","content":"hi"}]}'
```

## Evidence

**The defect**, one line — `sidecar/providers/anthropic.js`, `applyThinking()`, modern path:

```js
if (effort === 'none') { body.thinking = { type: 'disabled' }; return; }
```

`claude-sonnet-5-5` is not in `LEGACY_CLAUDE` (so it takes the modern path) and not in
`ALWAYS_THINKING_CLAUDE` (so `effortsFor()` offers `'none'`), so a saved effort of `none` emitted the one
shape this model refuses.

**Measured against the live wire, not inferred.** The published catalog (13 ids) was swept with
`{type:'disabled'}`; a rejection validates before anything bills, so the sweep was effectively free. Thinking
"off" has **three** different answers, and the 5.5 generation splits across all three — so no generation
heuristic can be correct:

| behaviour | models |
| --- | --- |
| `{type:'disabled'}` accepted | haiku-5-5, opus-5, sonnet-5, opus-4-8, opus-4-7, sonnet-4-6, opus-4-6, opus-4-5-20251101, haiku-4-5-20251001 |
| `{type:'between_tools'}` required | **sonnet-5-5** |
| no off-switch at all | opus-5-5, fable-5-1, fable-5 — all three answer `"thinking.type.disabled" is not supported for this model. Use "thinking.type.adaptive" and "output_config.effort"` |

The schema's full enum, from a deliberately-bogus `type` (free probe):

```
thinking: Input tag '__bogus__' found using 'type' does not match any of the expected tags:
  'adaptive', 'between_tools', 'disabled', 'enabled'
```

**Before/after, both on the live wire, same prompt, bodies built by the adapter itself:**

```
PRE-FIX  (sidecar/providers/anthropic.js.bak)  thinking = {"type":"disabled"}
  -> 400  To turn thinking off on this model, send "thinking": {"type": "between_tools"} …

POST-FIX (sidecar/providers/anthropic.js)      thinking = {"type":"between_tools"}
  -> 200  event: message_start … content streamed
```

**End to end through the restarted sidecar**, the exact failing combination:

```
POST /api/run  agentId=agent provider=anthropic model=claude-sonnet-5-5 reasoningEffort=none
  -> agent.run.end  reason=done  usd=0.097633
  -> reply: "FIXED"
```

## Verdict

Fixed. `applyThinking()` now asks `thinkingOffType(model)` for the off-switch SPELLING:
`BETWEEN_TOOLS_OFF_CLAUDE` (currently `claude-sonnet-5-5` / `claude-sonnet-5.5`, both spellings because
dotted ids reach this adapter from hand-typed fields and imported dossiers) gets `between_tools`; everything
else keeps `disabled`, unchanged.

**`between_tools` was deliberately NOT sent to every modern model.** It is not a synonym for `disabled`:
`disabled` means no thinking at all, while `between_tools` still emits thinking blocks between tool calls,
which this adapter must then replay signed and in order (`thinkingBlocks()`). A blanket switch would change
behaviour on the nine models that work today and take on that replay contract for no benefit.

`'none'` remains offered for sonnet-5-5, correctly — the model *does* have an off-switch, just a differently
spelled one. The three no-off-switch models keep clamping a saved OFF up to adaptive, as before.

**Siblings checked** (the protocol's requirement, not just the reported path):

- `grep -rn "type: *'disabled'"` across the tree: `sidecar/providers/anthropic.js` was the **only**
  emitter. The openrouter/openai-compatible adapters use `reasoning:{effort}`, a different shape with no
  `disabled` type, so they cannot carry this defect.
- Every entry point that can set effort `none` (roster, cron fire, Run Now, `team.dispatch`, the model dock,
  `POST /api/run`) funnels through this one `applyThinking()` call, so there is no second code path to fix.
- The other four `anthropic` agents (STORYWRITER, DIRECTOR, PRODUCER, QC_EDITOR) are all
  `claude-opus-5` + effort `none` — measured as `disabled`-accepting, so they were genuinely unaffected,
  which matches the owner seeing only Commander runs fail.

**Coverage** — `test/provider.anthropic.test.js` (136 assertions, in `test/fast.list`), case `G3b`: asserts
`between_tools` for both spellings of sonnet-5-5, that a real effort on that model still takes the ordinary
adaptive contract, that the six measured `disabled` models still send `disabled`, and that the three
no-off-switch models publish no `'none'` and clamp to adaptive. Each row is annotated with the live
measurement it encodes, so a future Anthropic change shows up as a named failure rather than a silent 400.

**Known gap, written down rather than papered over:** the `BETWEEN_TOOLS_OFF_CLAUDE` list is explicit, so a
*future* model that also requires `between_tools` will 400 the same way until it is added. That is the same
staleness the file's own `LEGACY_CLAUDE`/`ALWAYS_THINKING_CLAUDE` lists carry, and it is preferred here over a
heuristic that is already demonstrably false across the 5.5 generation. The free one-bogus-field probe in
Evidence re-derives the whole map in seconds when a new model lands.

## Regression

**Before-fix failure**, the pre-fix adapter's own body on the live wire:

```
PRE-FIX  (sidecar/providers/anthropic.js.bak)  thinking = {"type":"disabled"}
  -> HTTP 400  To turn thinking off on this model, send "thinking": {"type": "between_tools"}
               instead of {"type": "disabled"}. …
```

**After-fix proof**, same adapter, same prompt, same key:

```
POST-FIX (sidecar/providers/anthropic.js)      thinking = {"type":"between_tools"}
  -> 200  event: message_start … content streamed

POST /api/run  agentId=agent provider=anthropic model=claude-sonnet-5-5 reasoningEffort=none
  (through the restarted sidecar, so require() cache cannot mask it)
  -> agent.run.end  reason=done  usd=0.097633   reply: "FIXED"
```

**Automated:** `test/provider.anthropic.test.js` case `G3b` fails on the pre-fix adapter (it asserts
`{type:'between_tools'}` where the old line emitted `{type:'disabled'}`) and passes after — 136 assertions
total, registered in `test/fast.list`.

## Sibling coverage

```json
{
  "adapters": [
    { "target": "providers/anthropic.js applyThinking (modern path)", "state": "covered",
      "test": "test/provider.anthropic.test.js", "gate": "fast",
      "scenario": "G3b: effort 'none' on claude-sonnet-5-5 and claude-sonnet-5.5 emits thinking:{type:'between_tools'}, and a real effort still takes the adaptive contract" },
    { "target": "providers/anthropic.js applyThinking (disabled-accepting models)", "state": "covered",
      "test": "test/provider.anthropic.test.js", "gate": "fast",
      "scenario": "G3b: the six live-measured disabled-accepting models still emit thinking:{type:'disabled'} — between_tools is not a synonym and must not spread" },
    { "target": "providers/anthropic.js applyThinking (no-off-switch models)", "state": "covered",
      "test": "test/provider.anthropic.test.js", "gate": "fast",
      "scenario": "G3b: opus-5-5 / fable-5-1 / fable-5 publish no 'none' and clamp a saved OFF up to adaptive rather than emitting any off-switch" },
    { "target": "providers/openai-compatible.js + openrouter reasoning", "state": "not-applicable",
      "reason": "Those adapters send reasoning:{effort}, a different wire shape with no thinking.type at all; a repo-wide grep for type:'disabled' found sidecar/providers/anthropic.js as the only emitter, so they cannot carry this defect." }
  ],
  "entrypoints": [
    { "target": "POST /api/run with an explicit reasoningEffort", "state": "covered",
      "test": "test/provider.anthropic.test.js", "gate": "fast",
      "scenario": "G3b drives buildBody through the provider's own stream() exactly as /api/run does, per-request effort included" },
    { "target": "roster-sourced effort (cron fire, Run Now, team.dispatch, model dock)", "state": "not-applicable",
      "reason": "Every one of these resolves an effort and hands it to the same applyThinking() call in the same adapter; there is no second request-building path to cover, and G3b asserts that single function directly." }
  ],
  "displays": [
    { "target": "reasoningEfforts() publishing 'none' per model", "state": "covered",
      "test": "test/provider.anthropic.test.js", "gate": "fast",
      "scenario": "G3b asserts 'none' stays offered for sonnet-5-5 (it has an off-switch, just a differently spelled one) and is absent for the three models that have none" }
  ],
  "lifecycle": [
    { "target": "a saved OFF effort surviving into a later run", "state": "covered",
      "test": "test/provider.anthropic.test.js", "gate": "fast",
      "scenario": "G3b exercises both the construction-time default effort and the per-request override, which is how a persisted roster 'none' reaches the wire on every subsequent turn" },
    { "target": "thinking-block replay when between_tools emits blocks mid-run", "state": "blocked",
      "reason": "between_tools still returns thinking blocks between tool calls, which thinkingBlocks() must replay signed and in order. The off-switch path is now verified, but a multi-turn tool-using run on sonnet-5-5 that exercises that replay has NOT been run; it needs a real tool-calling session and is written down here rather than claimed." }
  ]
}

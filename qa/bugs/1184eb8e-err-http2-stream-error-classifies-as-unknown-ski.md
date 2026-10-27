---
fingerprint: 1184eb8e
slug: err-http2-stream-error-classifies-as-unknown-ski
title: ERR_HTTP2_STREAM_ERROR classifies as unknown, skipping the stream retry ladder
surface: providers
severity: P1
status: open
found: 2026-10-22
lane: fix/http2-retry
fix:
origin: owner
report: Owner's own diagnostics in this session (2026-10-22); last 5 runs failed with "fetch failed (ERR_HTTP2_STREAM_ERROR)" calling OpenRouter, 07:59-08:11 UTC
affected: Android/Termux, Node v26.4.0, this station's 2026-10-22 build; other platforms unverified
family: provider-stream-retry
installer: unverified
recovery: unconfirmed
---

# ERR_HTTP2_STREAM_ERROR classifies as unknown, skipping the stream retry ladder

## Symptom

A live 3-agent team job (NIGHT4CHRIST → SCOUT/DESIGNER via team.dispatch) failed/stalled around
00:45-01:00 AM. Three different runs across three different models all died with the identical
`failureStage: "provider_stream"`, `failureCode: "unknown"`, zero retries logged. The owner's own
separate diagnostics named the real cause: `fetch failed (ERR_HTTP2_STREAM_ERROR)` calling OpenRouter,
Node v26.4.0 on Android.

## Repro

1. On a network path prone to brief interruption (observed: Android/Termux, Node v26 global `fetch`,
   which auto-negotiates HTTP/2 via ALPN against OpenRouter's edge), run any streaming chat completion.
2. A network blip mid-stream resets the h2 STREAM (not the whole socket), surfacing as
   `TypeError: fetch failed` with `.cause.code` = `ERR_HTTP2_STREAM_ERROR` (or a sibling HTTP2 code).
3. Before the fix: `sidecar/providers/errorClass.js`'s transport-code regex didn't match any
   `ERR_HTTP2_*` code, so it fell through to `reason:'unknown'`. If this exhausts the OpenRouter
   adapter's own quick internal pre-stream retry ladder first (common — that ladder is fast), the loop's
   own ladder refuses to continue: `sidecar/recovery-policy.js`'s `PRESTREAM_CONTINUABLE` deliberately
   excludes `unknown` from `ladderOpen` once `preStreamRetriesExhausted` is set, so the run dies on the
   FIRST reset with zero real (multi-second) backoff.

## Evidence

Live run records (`~/.local/share/StarNet/workspaces/runs.jsonl`, 2026-10-22 ~07:59-08:00 UTC): lead
run `f33abf21` (model `minimax/minimax-m3.1-flash:free`) shows a visible retry ladder
(`recoveryAttempts` with `reason:"timeout"`, 3 escalating attempts, 3.8s/9.7s/26.3s delays) before
dying `unknown` — it had enough prior activity to exhaust the budget gradually. Sibling runs `e932e310`
(scout, same model), `030e6883` and `96c929cf` (ephemeral team.dispatch sub-workers, same model) all
show `recoveryAttempts: []` — zero logged retries, instant `unknown` death — consistent with the
adapter's own pre-stream ladder burning the ENTIRE shared budget before the loop's own ladder ever got
a turn. Confirmed live (2026-10-22, this session): `transportCode(err)` in
`sidecar/providers/errorClass.js:106` already correctly unwraps `err.cause.code`, but the regex at
(pre-fix) line 363 — `/ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EPIPE|ECONNABORTED|UND_ERR/i`
— has no entry for the `ERR_HTTP2_*` namespace (a distinct Node core error family, not
`UND_ERR`-prefixed), confirmed by writing a failing/then-passing regression test for exactly this shape.

Fix: added `ERR_HTTP2_(?:STREAM_ERROR|INVALID_STREAM|STREAM_CANCEL|SESSION_ERROR|GOAWAY_SESSION|ERROR)`
to the transport regex, so this error class now classifies as `'timeout'` (same bucket as
ECONNRESET/ETIMEDOUT) — which IS in `PRESTREAM_CONTINUABLE`, restoring the full patient backoff ladder
(up to `RETRY_DELAYS_MS.length` = 6 attempts, satisfying the "max 3" ask with margin) instead of an
instant unrecoverable death. Investigated and explicitly declined: forcing HTTP/1.1 globally
(`undici.setGlobalDispatcher`) — verified technically functional in isolation, but requires importing
the `undici` npm package, which `CONTRIBUTING.md` forbids ("the sidecar itself has no runtime npm
dependencies"); the classification fix achieves the same resilience without that dependency.

```json
{
  "adapters": [
    {"target":"sidecar/providers/errorClass.js pickReason", "state":"covered", "test":"test/errorclass.test.js", "scenario":"ERR_HTTP2_STREAM_ERROR and 5 sibling codes -> timeout/retryable; an unaudited ERR_HTTP2_* code still falls to unknown (no loose substring match)", "gate":"fast"}
  ],
  "entrypoints": [
    {"target":"sidecar/recovery-policy.js providerFailure ladder", "state":"covered", "test":"test/loop.prestream-outage-ladder.test.js", "scenario":"pre-existing ladder-continuation tests still pass unchanged after the classification fix", "gate":"fast"}
  ],
  "displays": [
    {"target":"live team-job rerun", "state":"blocked", "reason":"the rerun itself could not be completed headlessly in this session (team.dispatch requires a genuine interactive browser turn, confirmed separately this session, not a symptom of this bug) — the owner was given the exact prompt to paste into the live app; this fix has not yet been proven against a real repeated HTTP2 reset in production, only against the reconstructed error shape in tests."}
  ],
  "lifecycle": [
    {"target":"OpenRouter adapter pre-stream retry ladder (sidecar/providers/provider.js markPreStreamRetriesExhausted)", "state":"covered", "test":"test/loop.prestream-outage-ladder.test.js, test/provider.error-body.test.js", "scenario":"pre-stream spend correctly continues into the loop's own ladder rather than multiplying or resetting it", "gate":"fast"}
  ]
}
```

## Verdict

_Filled in when the bug leaves the backlog: what was true, and why it is closed._

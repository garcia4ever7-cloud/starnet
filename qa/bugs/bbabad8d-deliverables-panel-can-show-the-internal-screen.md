---
fingerprint: bbabad8d
slug: deliverables-panel-can-show-the-internal-screen
title: Deliverables panel can show the internal screen-capture wrapper as the Commander's request
surface: sessions
severity: P2
status: open
found: 2026-10-22
lane: fix/deliverables-panel
fix:
origin: owner
report: Owner report in this session (2026-10-22); "What you asked for" shows "[BEGIN EXTERNAL SCREEN CAPTURE..." junk
affected: This station, 2026-10-22 build; desktop installer unknown
family: deliverable-request-text
installer: unverified
recovery: unconfirmed
---

# Deliverables panel can show the internal screen-capture wrapper as the Commander's request

## Symptom

The owner's Deliverables card "What you asked for" section showed
`[BEGIN EXTERNAL SCREEN CAPTURE — the actual pixel output of the tool call above...]` — harness
plumbing, not anything the owner actually typed.

## Repro

1. Run an agent turn where the LAST user-role message in the transcript ends up being the synthetic
   tool-screenshot wrapper `sidecar/loop.js` injects after an image-returning tool call (common: a tool
   call returns an image and the run ends right after, with no further real text).
2. Open that run's Deliverables card.
3. Before the fix: "What you asked for" shows the raw `[BEGIN EXTERNAL SCREEN CAPTURE...]` fence text.

## Evidence

`~/.local/share/StarNet/workspaces/runs.jsonl`, runId `ee34721b-0b53-415e-829d-2ecd92b42873`: stored
`title` is literally `'[BEGIN EXTERNAL SCREEN CAPTURE — the actual pixel output of the tool call above.
Read this image directly rather than re'` (truncated at runstore's 120-char `TITLE_MAX`). Root cause:
`sidecar/index.js:19173` (now ~shifted) sets `run.title = latestUserText(msgs)`, which walks the
message list backward via `userMsgText()` and returns the text of the LAST `role:'user'` turn with no
filtering; `sidecar/loop.js` (~2208) pushes exactly this wrapper as a synthetic `role:'user'` turn.
`deliverableRows()` then sets `ask = run.title` verbatim, and
`frontend/app/deliverables.js:287` renders it with only HTML-escaping, no stripping.

Fix: `userMsgText()` was pulled out to the new pure module `sidecar/user-text.js` and now returns
`null` (not the text) for a message whose content starts with `[BEGIN EXTERNAL SCREEN CAPTURE` —
treated as "nothing here," so the backward walk in `latestUserText()`/`recentUserText()` keeps going to
the actual last human turn. This also fixes every OTHER consumer of those two functions (memory-recall
ranking, `DomainTask`/`ImageTask` classification, the retry-directive match, the study directive) which
were equally polluted whenever the wrapper was the latest turn, not just the Deliverables card.

**Caught in review, corrected before landing:** an earlier version of this fix also matched
`group-sessions.js`'s superficially-similar `"Shared conversation context ("` wrapper — but that one is
typically the ONLY user-role turn for a group run, with the real ask embedded INSIDE it, not a
supplementary turn alongside a separate real one. Matching it made `latestUserText()` return `''` for
every group turn, which silently zeroed `taskBriefStore.prepare()`'s `if (latestUser)` gate and disabled
`brief_ask` station-wide. `test/group-sessions.http.test.js` caught this before any commit; the
narrower, screen-capture-only pattern is what shipped (see `sidecar/user-text.js`'s header for the
full reasoning — deliberately NOT matching the group-context wrapper, by design, not an oversight).

Also fixed retroactively (an already-recorded `run.title` is immutable; fixing `userMsgText()` only
prevents a NEW bad title): `sidecar/index.js`'s `ask` computation now also runs
`isInternalUserTurnText(run.title)` and treats a match as `''` rather than ever rendering it, cleaning
up every EXISTING bad record too. Verified live post-fix: `GET /api/deliverables` across all 74 current
rows (which included 6 historical screen-capture-polluted titles pre-fix) returns zero rows with the
wrapper text as `ask`.

```json
{
  "adapters": [
    {"target":"userMsgText / latestUserText / recentUserText", "state":"covered", "test":"test/user-text.test.js", "scenario":"screen-capture wrapper reads as null (skippable); group-context wrapper deliberately NOT matched; prefix-anchoring; non-user/unreadable shapes", "gate":"fast"},
    {"target":"group-sessions.js brief_ask availability", "state":"covered", "test":"test/group-sessions.http.test.js", "scenario":"judgment-proof group turn still gets brief_ask and resumes correctly", "gate":"http"}
  ],
  "entrypoints": [
    {"target":"deliverableRows ask field (retroactive)", "state":"covered", "test":"live verification via GET /api/deliverables post-fix", "scenario":"0 of 74 rows (6 pre-fix) show wrapper text as ask", "gate":"none"},
    {"target":"taskBriefStore.prepare latestUser gate", "state":"covered", "test":"test/group-sessions.http.test.js", "scenario":"brief_ask still fires for a group turn whose only user message is the context wrapper", "gate":"http"}
  ],
  "displays": [
    {"target":"frontend/app/deliverables.js WHAT YOU ASKED FOR section", "state":"covered", "test":"live verification", "scenario":"renders empty rather than the fence text for a cleaned-up row", "gate":"none"}
  ],
  "lifecycle": [
    {"target":"memory-recall ranking / DomainTask/ImageTask classification / retry-directive match / study directive", "state":"blocked", "reason":"all consume the same now-fixed latestUserText(), but none has a dedicated regression test proving THIS specific wrapper-skip behavior at that call site yet — the fix is structural (one shared function) and test/user-text.test.js covers the function itself, not every downstream consumer individually."}
  ]
}
```

## Verdict

_Filled in when the bug leaves the backlog: what was true, and why it is closed._

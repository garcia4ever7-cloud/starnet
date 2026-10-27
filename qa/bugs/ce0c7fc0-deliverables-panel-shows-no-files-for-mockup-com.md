---
fingerprint: ce0c7fc0
slug: deliverables-panel-shows-no-files-for-mockup-com
title: Deliverables panel shows no files for mockup_compose/print_prep/vector_export/stock_fetch output
surface: sessions
severity: P2
status: open
found: 2026-10-22
lane: fix/deliverables-panel
fix:
origin: owner
report: Owner report in this session (2026-10-22); "Isaiah 40:31" and "Philippians 4:13 - listing photos" show "no files"
affected: This station, 2026-10-22 build; desktop installer unknown
family: deliverable-artifact-ledger
installer: unverified
recovery: unconfirmed
---

# Deliverables panel shows no files for mockup_compose/print_prep/vector_export/stock_fetch output

## Symptom

The owner's "Isaiah 40:31 — listing photos" and "Philippians 4:13 — listing photos" Deliverables cards
showed "This run recorded no files" even though the agent's own `deliverable_note` correctly named the
real hero-mockup file and all 5 listing photos genuinely exist on disk.

## Repro

1. Have an agent produce a file using `mockup_compose`, `image_print_prep`, `vector_export`, or
   `image_stock_fetch`, then call `deliverable_note`.
2. Open the Deliverables panel and expand that card.
3. Before the fix: "This run recorded no files" (files:[]), despite the file existing on disk.

## Evidence

`~/.local/share/StarNet/workspaces/runs.jsonl`, runId `a5a985ad-5098-4d51-854f-b791485ce393` (webdesigner,
Isaiah) and `55634ca4-2237-4713-a31d-d0fb8a795277` (Philippians): both have `deliverable.main` correctly
naming a real file under `workspaces/webdesigner/outbox/.../listing-photos/` (verified present on disk,
along with its 4 siblings), but `artifacts: []`. Root cause: `sidecar/artifacts.js`'s `observe()`
(pre-fix) only recognized `fs.write`/`fs.append`/`fs.edit`/`fs.patch`/`image_generate`/MCP-send tool
names — `mockup_compose`, `image_print_prep`, `vector_export`, and `image_stock_fetch` matched none of
them, so their real output never entered `run.artifacts`, and `sidecar/index.js`'s `deliverableRows()`
builds a named run's `files` purely from `arts.filter(a => a.path)`.

Fix: each of the 4 tool files now attaches `producedFiles: [{path, bytes}]` to its own result (the
files it already proved it wrote), and `sidecar/artifacts.js:observe()` gained a generic
`result.producedFiles` branch (checked before the name-matched branches) that folds those into the
ledger via the existing `addFile()` helper — closing the gap for all 4 tools and any future tool that
adopts the same convention. For the two ALREADY-RECORDED historical runs above (whose `run.artifacts`
can never be retroactively repopulated — it's an immutable append-only log), `deliverableRows()`'s
named-run branch also gained a fallback: when `arts`-derived `files` is empty but `deliverable_note`
named a `main` file that is independently proven to exist on disk, that one file is shown instead of
nothing (`sidecar/index.js` ~line 14432-14440). Verified live post-fix: both cards now show 1 real,
inline-previewable file (`preview:"image"`, `previewUrl` set).

Regression coverage: `test/artifacts.test.js` section F2 (one case per tool, real result shapes).

```json
{
  "adapters": [
    {"target":"mockup_compose", "state":"covered", "test":"test/artifacts.test.js", "scenario":"producedFiles folds 5 listing photos into the ledger", "gate":"fast"},
    {"target":"image_print_prep", "state":"covered", "test":"test/artifacts.test.js", "scenario":"producedFiles folds print-kit sizes into the ledger", "gate":"fast"},
    {"target":"vector_export", "state":"covered", "test":"test/artifacts.test.js", "scenario":"producedFiles mixes image (png) and file (pdf) kinds correctly", "gate":"fast"},
    {"target":"image_stock_fetch", "state":"covered", "test":"test/artifacts.test.js", "scenario":"producedFiles includes the image AND its .license.json provenance doc", "gate":"fast"}
  ],
  "entrypoints": [
    {"target":"deliverableRows named-run branch", "state":"covered", "test":"live verification via GET /api/deliverables post-fix (manual, not yet a fast/http test)", "scenario":"Isaiah/Philippians cards show 1 real file via the main-file-exists fallback", "gate":"none"}
  ],
  "displays": [
    {"target":"Deliverables panel inline image preview", "state":"covered", "test":"live verification", "scenario":"preview:'image' and previewUrl set on the recovered file", "gate":"none"}
  ],
  "lifecycle": [
    {"target":"historical runs recorded before this fix", "state":"covered", "test":"live verification", "scenario":"main-file-exists fallback recovers the named file even though run.artifacts is permanently empty for these runs", "gate":"none"}
  ]
}
```

## Verdict

_Filled in when the bug leaves the backlog: what was true, and why it is closed._

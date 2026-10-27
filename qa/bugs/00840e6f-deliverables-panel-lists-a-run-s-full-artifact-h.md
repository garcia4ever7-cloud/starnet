---
fingerprint: 00840e6f
slug: deliverables-panel-lists-a-run-s-full-artifact-h
title: Deliverables panel lists a run's full artifact history including deleted scratch scripts
surface: sessions
severity: P2
status: open
found: 2026-10-22
lane: fix/deliverables-panel
fix:
origin: owner
report: Owner report in this session (2026-10-22); "Mockup room template 2: living room" lists 21 files, mostly deleted helper scripts giving a "not found" page
affected: This station, 2026-10-22 build; desktop installer unknown
family: deliverable-artifact-ledger
installer: unverified
recovery: unconfirmed
---

# Deliverables panel lists a run's full artifact history including deleted scratch scripts

## Symptom

The owner's "Mockup room template 2: living room" Deliverables card listed 21 files, almost all of
them deleted calibration helper scripts (`cal.py`, `cal2.py`, `grid.py`, ...) that 404 ("not found")
when opened, instead of only the 2 real finished outputs.

## Repro

1. Have a run that writes throwaway helper/calibration files via `fs.write` (or any artifact-observed
   tool) alongside its real deliverable, then delete the helpers once done, then call `deliverable_note`.
2. Open that run's Deliverables card.
3. Before the fix: every file the run EVER wrote is listed, including the deleted ones (each one still
   rendering a clickable "OPEN" link that errors), with no distinction from the real output.

## Evidence

`~/.local/share/StarNet/workspaces/runs.jsonl`, runId `ee34721b-0b53-415e-829d-2ecd92b42873` (agentId
`agent`): `deliverable.main` = `outbox/mockup-templates/room-2-living-room.png`, but `run.artifacts` has
21 entries — the real `room-2-living-room.png` + `.json` (both exist on disk) plus 3 `_cand-*.png`
candidate renders and 14 bare-workspace-root `.py` calibration scripts (`cal.py`...`cal5.py`,
`grid.py`...`grid4.py`, `edges.py`, `detect.py`, `corners.py`, `overview.py`, `minline.py`,
`measure.py`), 19 of which are confirmed deleted from disk. Root cause: `sidecar/index.js`'s
`deliverableRows()` (both the named-run and unnamed-run branches) built `files` from `run.artifacts`
with no existence check and no extension filter at all — `sidecar/index.js:14306` `deliverableFile()`
only stat'd a file when `bytes` was already unknown, and even then a failed stat only nulled `bytes`,
never dropped the row; `openUrl` was still built unconditionally.

Fix: `deliverableFile()` now resolves existence UNCONDITIONALLY for non-workshop rows (not gated on
`bytes` being unknown) and returns an explicit `exists` flag; `deliverableRows()` filters both
branches to `a.path && !isScratchHelperPath(a.path)` before mapping, then `.filter(f => f.exists)`
after. `isScratchHelperPath` (new pure module `sidecar/deliverable-files.js`) denylists
`.py`/`.pyc`/`.sh`/`.ipynb` — this station's real deliverables (prints, kits, listing photos, listing
text) are never shipped in these formats. Verified live post-fix: the card now shows exactly 2 files
(`room-2-living-room.png`, `room-2-living-room.json`), both `exists:true`.

Explicitly NOT fixed this round (documented gap, not silently skipped): the Workshop-manifest path
(`validateWorkshopManifest`, `sidecar/index.js:13590`) and the "kept" deliverable-store path
(`sidecar/index.js` ~14378) are siblings that could carry the same scratch-extension issue if a
manifest or a kept copy ever lists a `.py` helper beside real outputs — no report shows that happening
today, so only the run-sourced branches were touched.

```json
{
  "adapters": [
    {"target":"deliverableRows named-run branch", "state":"covered", "test":"live verification via GET /api/deliverables post-fix", "scenario":"21-file entry drops to its 2 real surviving files", "gate":"none"},
    {"target":"deliverableRows unnamed-run branch", "state":"covered", "test":"test/deliverable-files.test.js (predicate only)", "scenario":"scratch/dead-file skip applied identically to the one-row-per-artifact path", "gate":"fast"}
  ],
  "entrypoints": [
    {"target":"isScratchHelperPath predicate", "state":"covered", "test":"test/deliverable-files.test.js", "scenario":"cal.py/grid.py/etc denylisted; real outputs (jpg/png/pdf/svg/md/txt/csv/json) never flagged; case/separator/dotfile edge cases", "gate":"fast"}
  ],
  "displays": [
    {"target":"Deliverables panel file list + OPEN links", "state":"covered", "test":"live verification", "scenario":"no dead OPEN links remain in the recovered card", "gate":"none"}
  ],
  "lifecycle": [
    {"target":"Workshop-manifest path", "state":"not-applicable", "reason":"validateWorkshopManifest already fails the WHOLE manifest closed if any listed file is missing, and no report shows a scratch-extension file ever listed alongside real output there — watched, not fixed this round."},
    {"target":"kept deliverable-store path", "state":"not-applicable", "reason":"files only enter this path via the Commander's explicit Keep action on an already-rendered card; no report shows a scratch file surviving to that stage — watched, not fixed this round."}
  ]
}
```

## Verdict

_Filled in when the bug leaves the backlog: what was true, and why it is closed._

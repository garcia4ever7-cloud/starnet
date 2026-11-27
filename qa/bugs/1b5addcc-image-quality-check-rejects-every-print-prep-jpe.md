---
fingerprint: 1b5addcc
slug: image-quality-check-rejects-every-print-prep-jpe
title: image_quality_check rejects every print-prep JPEG as not a PNG
surface: skills
severity: P1
status: open
found: 2026-11-27
lane: fix/image-qc-jpeg
fix:
origin: owner
report: owner-switchover-decision-3-2026-11-26
affected: phone station 0.12.5 (since 2026-10-22) and the v0.15.4 port 3c9c1fac3, Android/Termux
family: studio-print-file-qc
installer: not-applicable
installerEvidence: Phone station tool fix in sidecar code; no desktop installer is built or shipped from this station.
recovery: unconfirmed
---

# image_quality_check rejects every print-prep JPEG as not a PNG

## Symptom

Introduced 2026-10-22 (phone): image_print_prep switched its output PNG -> JPEG for Etsy's 20 MB cap; image-qc.js stayed PNG-only. Reported by the owner (switch-over open decision 3).


The Etsy chain's QC stage reports every print file DESIGNER's `image_print_prep` made as FAILED: `image_quality_check` answers "FAIL — not a PNG (bad signature)" for each `.jpg` print file, so a kit that is actually fine never passes independent QC and QC_EDITOR falls back to hand-rolled shell checks (seen in P5 run `effc21bc`, 2026-11-27).

## Repro

1. Any print-prep output, e.g. live `webdesigner/outbox/psalm-46-1-kit/download/psalm-46-1-ratio-4x5-4800x6000.jpg` (JFIF, 300 PPI).
2. Call `image_quality_check` with `images: [{path: <that file>, claimedWidth: 4800, claimedHeight: 6000}]` as agent `webdesigner`.
3. Before the fix: `0/1 passed`, "FAIL — not a PNG (bad signature)" (`parsePng` checks only the PNG signature).
Automated: `node test/image-qc-jpeg.test.js` (fails against `sidecar/tools/builtin/image-qc.js.bak-20261126-jpeg-qc`, passes on the fix).

## Evidence

Replay on the real live file (read only; sha256 unchanged afterwards), 2026-11-26 ~23:20 PST:
```
BEFORE (old module): image_quality_check -> 0/1 passed   FAIL — not a PNG (bad signature)
AFTER  (new module): image_quality_check -> 1/1 passed   PASS — well-formed JPEG (SOI, segment chain, frame header, scan data, EOI all present)
                     4800x6000px, 300 DPI (from file metadata) · decoded pixel data matches header · claim PASS
PNG from the same kit (3600x5400): PASS before and after
```
`test/image-qc-jpeg.test.js`: 21 assertions OK on the fix; 1 problem on the old module. Siblings re-run green: `test/studio-qc-integration.test.js` (59), `test/print-prep.test.js` (46), `test/studio-orchestration.test.js` (11).

## Siblings

- `sidecar/tools/builtin/print-prep.js` — the writer; unchanged (its `injectJfifDpi`/`readJfifDpi` define the JFIF density bytes the QC parser now reads). Covered by `test/print-prep.test.js` and reused by the new test's fixtures.
- `mockup_compose`, `vector_export` outputs are PNG — unaffected; still parsed by `parsePng`.
- Existing kits are NOT regenerated (owner decision): the fix only changes the checker.
- Coverage gap (written down): a JPEG that carries EXIF/APP1 instead of JFIF reports no DPI (treated as "no metadata", never guessed); print-prep never writes one.

## Verdict

_Filled in when the bug leaves the backlog: what was true, and why it is closed._

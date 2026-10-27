# QC EDITOR Agent Manual

## Mission
Independently verify video quality, accuracy, technical correctness, and readiness for delivery.

## Key Responsibilities
- Inspect video technical properties (codec, resolution, frame rate, duration)
- Verify audio quality and sync
- Check narrative accuracy and Scripture correctness
- Evaluate continuity and visual consistency
- Identify defects and recommend specific fixes
- Create comprehensive QC report

## Inputs
Receive from PRODUCER:
- video_ASSIGNMENT_ID.mp4 (assembled video)
- production_ASSIGNMENT_ID.md (production log)

Also receive from STORYWRITER:
- script.md (for accuracy verification)
- outline.md (for narrative structure check)

Also receive from DIRECTOR:
- storyboard.md (for visual consistency check)

## Tools Available
- `video.inspect` — Technical video analysis
- `audio.inspect` — Audio quality and sync verification
- `fs.read` — Read video, scripts, storyboards
- `fs.write` — Save QC report and findings
- `notebook.write` — Detailed notes

## QC Checklist

### Technical Quality ✓
- [ ] Video plays without errors
- [ ] Resolution is 1280x720 or better
- [ ] Frame rate is 24/30fps (constant)
- [ ] Duration matches target ±5%
- [ ] No visible compression artifacts
- [ ] No frame drops or stuttering
- [ ] File codec is h.264 or h.265 (standard MP4)

### Audio Quality ✓
- [ ] Audio track present (not muted)
- [ ] Audio level appropriate (not clipping, not too quiet)
- [ ] Narration intelligible and clear
- [ ] Sync with video acceptable
- [ ] No background noise or hum
- [ ] Fade-in/fade-out smooth if present

### Narrative Accuracy ✓
- [ ] Dialogue matches script exactly
- [ ] Narration matches script exactly
- [ ] Scene order matches script and storyboard
- [ ] No missing scenes or cuts

### Scripture Accuracy ✓
- [ ] All Scripture references quoted exactly
- [ ] Verse references correct (book:chapter:verse)
- [ ] No misquotes or paraphrasing without label
- [ ] Theological accuracy (consult script research)

### Visual Consistency ✓
- [ ] Same character looks consistent across scenes
- [ ] Environment consistent (same church, same light, etc.)
- [ ] Props appear in expected scenes
- [ ] No discontinuities (character teleporting, prop vanishing)
- [ ] Color grading consistent across cuts

## QC Report Format

Save `qc/report_ASSIGNMENT_ID.md`:

```markdown
# QC Report: ASSIGNMENT_ID

## Overall Assessment
**Status**: [APPROVED / APPROVED_WITH_NOTES / REQUIRES_FIXES / REJECTED]

## Detailed Findings

### Technical Quality
- ✓ Resolution: 1280x720 (standard)
- ✓ Frame rate: 24fps (stable)
- ✓ Duration: 120.3 seconds (target 120s ±5%) ✓
- ⚠ Artifact at 45-50 seconds (minor compression block, acceptable)

### Audio
- ✓ Narration clear and well-synced
- ✓ No background noise
- ✓ Level good (no clipping)

### Scripture Accuracy
- ✓ Luke 15:11 quoted exactly: "A man had two sons..."
- ✓ Luke 15:32 quoted exactly: "But we had to celebrate..."
- ✓ Theological context accurate

### Visual Consistency
- ✓ Father character consistent across all scenes
- ✓ Church environment consistent
- ⚠ Younger son's clothing changes between scenes (expect this for time jump)

## Issues Found

### Critical (Must Fix)
None

### Minor (Recommend Fix)
1. Scene 3 (45-50s): Minor compression artifact (brief block in upper left)
   - Recommend: Re-render scene with slightly lower bitrate
   - OR: Accept as-is (barely visible)

## Defect Summary
- Critical: 0
- Minor: 1 (cosmetic)
- Approved: YES

## Recommendation
✅ **APPROVED FOR DELIVERY** (with note about cosmetic artifact)

---
QC Report: 2026-10-25 14:45:22 UTC
QC Agent: QC_EDITOR
```

## Verdict Types

- **APPROVED**: Zero defects, ready for immediate delivery
- **APPROVED_WITH_NOTES**: Minor cosmetic issues (barely visible artifacts, not worth fixing)
- **REQUIRES_FIXES**: Specific defects that must be corrected before delivery
- **REJECTED**: Critical flaws (broken audio sync, missing scenes, wrong narration, Scripture error)

## Handoff to PRODUCER (if fixes needed)
Format defect report:
```
PRODUCER:
- Scene 3 (45-50s): Compression artifact at (1150, 75)
  Action: Re-render scene_003 with cleaner prompt or slightly higher bitrate
- Missing audio sync in scene 5
  Action: Re-check audio timing in assembly
```

## Handoff to PUBLISHER (if approved)
Notify with:
- ✅ QC Status: APPROVED
- 📄 QC Report path
- 🎬 Video ready for delivery

---
Generated: 2026-10-25
Next Manual: docs/agents/PUBLISHER.md

# CHRISTIAN STORY STUDIO — Architecture & Design

## Overview

Autonomous five-agent video production team integrated into StarNet for creating complete, quality-checked Christian narrative videos. Each agent owns a distinct phase of the production pipeline with clear handoffs, persistence, and recovery.

**Status**: Design phase (implementation pending video API research completion)

---

## Agent Roster

### 1. STORYWRITER (research-focused specialist)
**Mission**: Research assignments, develop compelling Christian narratives, scripts, accurate Scripture.

**Capabilities**:
- Research tools (web search, document analysis, Scripture lookup)
- Memory (notebook for story versions, research notes)
- Skill management (reusable story templates, narrative structures)
- Script generation (dialogue, narration, arc development)

**Inputs**:
- Assignment JSON: `{topic, format, duration, scriptureFocus, tonalStyle, audience, constraints}`

**Outputs**:
- `script.md` (full dialogue, scene descriptions, narration, Scripture references with book/verse)
- `story-outline.md` (three-act structure, key beats, character list)
- `research-summary.md` (sources, theological notes, accuracy verification)

**Authority**:
- Can iterate and publish script revisions (own workspace)
- Escalates creative conflicts to DIRECTOR
- May request PRODUCER preview if script needs visual validation

**Quality Gates**:
- Scripture accuracy verified against official versions (KJV, NIV, NASB)
- Dialogue fits target duration estimate (±10%)
- Character consistency within story

---

### 2. DIRECTOR (visual planning specialist)
**Mission**: Plan cinematic language, scenes, camera movement, visual style, character design, environment consistency.

**Capabilities**:
- Storyboarding (sketch generation, composition planning)
- Visual research (reference imagery, style guides)
- Design consistency (character sheets, color palette, location reference)
- Tool: Higgsfield integration for reference imagery

**Inputs**:
- Script from STORYWRITER
- Visual style preferences (realistic, animated, cinematic, documentary)
- Duration and scene breakdown

**Outputs**:
- `storyboard.md` (scene-by-scene shot list with camera angles, lighting notes)
- `visual-style.md` (character design, environment references, color palette, consistent props)
- `scene-list.json` (structured scene data for PRODUCER)
- `reference-images/` (visual inspiration, color mood, character appearance)

**Authority**:
- Owns visual decisions (framing, composition, character consistency)
- Can request script revisions for pacing/dramatic impact
- Approves all PRODUCER source materials before generation

**Quality Gates**:
- Visual consistency across all scene descriptions
- Scene breakdown aligns with script timing
- Reference materials sourced (credited if needed)
- No visual anachronisms or inconsistencies in set design

---

### 3. PRODUCER (execution specialist — generation + assembly)
**Mission**: Generate actual scenes (video/images/audio), manage render jobs, edit and assemble complete video.

**Capabilities**:
- Video generation (text-to-video, image-to-video) via selected API
- Image generation (Higgsfield for stills, backgrounds)
- Audio generation (text-to-speech, voice cloning for consistent narration)
- Media processing (video editing, clip assembly, timing)
- Audio editing (mixing, fade, duration adjustment)
- File management (workspace persistence, job tracking)

**Inputs**:
- Storyboard + visual style from DIRECTOR
- Script from STORYWRITER
- Scene list (structured JSON with prompts, duration, audio cues)

**Outputs**:
- `scenes/` directory (individual MP4 files, one per scene)
- `audio/` directory (narration tracks, background audio, SFX)
- `assembled-video.mp4` (rough cut, all scenes in sequence)
- `production-log.md` (job IDs, costs, generation times, any failures)

**Authority**:
- Owns technical decisions (video API parameters, quality settings, encoding)
- Can request scene retakes from DIRECTOR
- Manages job state and recovery (can retry failed generations)
- Escalates missing capabilities to PUBLISHER

**Quality Gates**:
- All scenes generate without errors
- Video matches scene timing within ±2s
- Audio sync acceptable (lips/action aligned where relevant)
- File formats correct and playable
- No visible generation artifacts (distortion, flicker, frame drops)

**Job Persistence**:
- Track each scene generation: job ID, status, retry count, cost
- Persist across producer runs (can resume partial productions)
- Clean failure modes (missing audio → continue with silent scene; retryable API error → requeue)

---

### 4. QC EDITOR (independent verification specialist)
**Mission**: Independently inspect video, audio, continuity, accuracy, technical quality. Return defects for correction.

**Capabilities**:
- Video inspection (frame rate, resolution, codec, duration)
- Audio inspection (presence, levels, sync, clarity)
- Narrative inspection (dialogue accuracy, pacing, Scripture accuracy)
- Continuity check (character appearance, environment consistency, prop placement)
- Technical analysis (compression artifacts, color banding, motion smoothness)

**Inputs**:
- Assembled video from PRODUCER
- Original script, storyboard, visual style guide
- Production log

**Outputs**:
- `qc-report.md` (structured issues, severity, line item for each defect)
- `qc-checklist.json` (pass/fail on each QC dimension)
- Video segments flagged (time range, defect, recommended fix)

**Authority**:
- Independent of PRODUCER (separate agent, separate workspace)
- Can reject video and send back for fixes
- Owns defect classification (critical blocker vs. minor, cosmetic)

**Quality Gates**:
- Scripture accuracy verified independently (matches source texts)
- Dialogue matches script exactly
- No visible continuity breaks
- Audio intelligible, properly synced
- Technical quality acceptable (no heavy artifacts, smooth playback)
- Duration within ±5% of target

**Defect Handoff**:
- Critical issues → return to PRODUCER with specific fix requests
- Minor issues → flag but allow PUBLISHER to decide whether to fix
- No issue → sign off, video ready for delivery

---

### 5. PUBLISHER / DELIVERY (final assembly + outbox delivery)
**Mission**: Package verified video with supporting files; deliver to Outbox for playback/sharing.

**Capabilities**:
- File assembly (video + metadata + supporting assets)
- Thumbnail generation (from video frame)
- Caption generation (from script)
- Metadata writing (title, description, duration, Scripture references)
- Outbox delivery (copy video to agent workspace for playback)

**Inputs**:
- Verified video from QC EDITOR
- QC report (for review/transparency)
- Script, storyboard, visual style (for packaging)
- Production metadata (costs, generation times, tool versions)

**Outputs**:
- `outbox/{video_id}/` directory:
  - `video.mp4` (main deliverable)
  - `thumbnail.png` (preview image)
  - `captions.vtt` (subtitle file for accessibility)
  - `script.md` (original script)
  - `storyboard.md` (visual guide)
  - `metadata.json` (title, description, Scripture refs, production info)
  - `qc-report.md` (transparency: QC findings)
  - `production-log.md` (costs, generation details)

**Authority**:
- Owns final packaging and delivery
- Can batch multiple videos
- Decides when video is "ready to play" (passes all gates)

**Quality Gates**:
- Video file is valid MP4, playable
- All supporting files present and correct
- Metadata complete (title, description, Scripture references)
- Outbox delivery successful

**No Public Publishing** (by design):
- Videos delivered to private Outbox only
- Owner must explicitly approve any sharing/publishing
- Metadata includes production/cost information for transparency

---

## Data Flow & Handoff Chain

```
ASSIGNMENT
    ↓
STORYWRITER (research, script, outline)
    ↓ (script.md + story-outline.md)
    ↓
DIRECTOR (visual planning, storyboard, reference)
    ↓ (storyboard.md + visual-style.md + scene-list.json)
    ↓
PRODUCER (generation, assembly)
    ↓ (rough-cut video.mp4 + production-log.md)
    ↓
QC EDITOR (independent verification)
    ↓ (qc-report.md + checklist.json)
    ↓
[IF defects] → PRODUCER (fix specific issues) → QC EDITOR (re-verify)
    ↓
PUBLISHER (final packaging)
    ↓
OUTBOX DELIVERY (ready for owner review/sharing)
```

---

## Persistence & Recovery

**Workspace Isolation**:
- Each agent has its own workspace folder: `{agentId}/`
- No cross-agent file access (security + isolation)
- Persistent across runs (can resume partial productions)

**Job State Management**:
- PRODUCER maintains job tracking: `production-log.md`
  - Scene ID, video API job ID, status (pending/running/complete/error), cost
  - Retry count, error message if failed
  - Timestamps (started, completed)
- Can resume: read log, re-queue failed scenes, re-generate only missing clips

**QC State**:
- QC EDITOR creates checkpoint: `qc-report.md` with defect list
- PRODUCER reads report, applies fixes, updates production log
- QC EDITOR re-inspects specific scenes or full video

**Cross-Agent Communication**:
- Use structured JSON files (scene-list.json, qc-report.json) as the interface
- No direct agent-to-agent calls (all async, file-based)
- Timestamps and versioning for conflict detection

---

## Tool Requirements by Agent

### STORYWRITER
- `web.search` (research)
- `notebook.read` / `notebook.write` (story versions, research notes)
- `skill.view` / `skill.manage` (story templates, narrative structures)

### DIRECTOR
- `fs.read` / `fs.write` (storyboard, reference images)
- `higgsfield.generate` (reference imagery from Higgsfield, already integrated)
- `web.search` (visual research, reference materials)
- `notebook.read` / `notebook.write` (design consistency notes)

### PRODUCER
- `fs.read` / `fs.write` (scene files, audio, assembled video)
- `video.generate` (NEW: text-to-video via selected API)
- `image.generate` (potentially Higgsfield for backgrounds)
- `audio.generate` (NEW: text-to-speech for narration)
- `media.process` (NEW: video editing, clip assembly, timing)
- `notebook.write` (production log)

### QC EDITOR
- `fs.read` (video, script, storyboard)
- `video.inspect` (NEW: technical analysis, frame rate, codec, duration)
- `audio.inspect` (NEW: audio presence, sync, clarity)
- `notebook.read` (script for verification)
- `fs.write` (QC report)

### PUBLISHER
- `fs.read` (video, metadata files)
- `fs.write` (outbox delivery)
- `image.generate` (potentially: thumbnail from video frame)
- `notebook.write` (delivery confirmation)

---

## New Tools Needed

**Not yet integrated into StarNet** (to be added):

1. **video.generate** — Text-to-video generation
   - Input: prompt, duration, scene description, style reference
   - Output: MP4 file
   - Provider: [TBD pending research]

2. **audio.generate** — Text-to-speech / voice synthesis
   - Input: text, voice ID, speaking rate
   - Output: MP3/WAV file
   - Provider: Google Cloud TTS, ElevenLabs, or similar

3. **video.inspect** — Technical video validation
   - Input: MP4 file path
   - Output: JSON with codec, resolution, frame rate, duration, bitrate, quality issues
   - Implementation: ffprobe wrapper

4. **audio.inspect** — Audio track validation
   - Input: audio file path or MP4 file
   - Output: JSON with duration, channels, sample rate, loudness, sync issues
   - Implementation: ffmpeg analysis

5. **media.process** — Video editing / clip assembly
   - Input: clip list with times, audio sync, transitions
   - Output: assembled MP4
   - Implementation: FFmpeg command wrapper

6. **image.thumbnail** — Extract video frame as thumbnail
   - Input: video file, frame time (or middle frame)
   - Output: PNG thumbnail
   - Implementation: FFmpeg frame extraction

---

## Testing Strategy

**Unit Tests** (per agent capability):
- STORYWRITER: Script generation, Scripture verification, outline structure
- DIRECTOR: Storyboard generation, consistency checks, scene list format
- PRODUCER: Scene generation (mocked), job state tracking, retry logic
- QC EDITOR: Defect detection, report structure
- PUBLISHER: Outbox packaging, metadata completeness

**Integration Tests**:
- Full pipeline with mocked video generation (quick validation)
- Real sample video (single scene) with real API (end-to-end validation)
- Defect injection + recovery (QC → PRODUCER → re-verify)

**E2E Test** (if feasible):
- 30-60 second Christian story (e.g., simple parable scene)
- Real video generation (actual cost: likely $0.50-$2.00)
- Full pipeline: research → script → storyboard → generation → QC → delivery
- Verification: video is playable, matches script, passes QC

---

## Implementation Phases

**Phase 1: Research & Design** (current)
- Finalize video generation API selection
- Confirm tool feasibility and cost
- Create tool interface definitions
- Draft agent manuals

**Phase 2: Core Infrastructure**
- Register 5 new agents in StarNet
- Implement tool wrappers (video.generate, audio.generate, media.process, etc.)
- Set up workspace isolation and job persistence
- Create structured file interfaces (scene-list.json, qc-report.json)

**Phase 3: Agent Implementation**
- Implement each agent's core logic and tools
- Create individual agent manuals
- Build handoff tests (file-based, async)

**Phase 4: Integration & Testing**
- Full pipeline test with mocks
- Real single-scene sample video
- QC + recovery testing
- Outbox delivery verification

**Phase 5: Documentation & Deployment**
- Complete agent manuals
- Operation guide for assignment submission
- Cost tracking and transparency
- Ready for owner to submit Christian content

---

## Cost & Timing Estimates

**Per 2-5 minute video** (estimated):
- Video generation (Pika/Runway): $0.10-$0.50
- Audio generation (TTS): $0.02-$0.10
- Media processing (local): $0.00
- **Total**: $0.12-$0.60 per finished video (subject to API choice)

**Development**:
- Implementation + testing: 20-40 agent turns
- Sample video generation: 1-2 real API calls
- **Total dev cost**: $2.00-$5.00

**Time** (with parallel agent work):
- Phase 2-3: 2-4 hours
- Phase 4: 1-2 hours
- Phase 5: 0.5 hours

---

## Success Criteria

✅ **Must Achieve**:
1. All 5 agents created and registered in StarNet
2. Each agent has a complete, functional manual (MD file loaded into execution)
3. Full pipeline completes: assignment → video → Outbox
4. Real sample video generated, independently QC'd, delivered
5. Video is playable, matches script, passes technical checks
6. Recovery works: defects → producer fix → re-verify
7. No regressions: existing Etsy pipeline untouched

⚠️ **Nice to Have**:
- Automated character/environment consistency checking
- Batch video processing (multiple assignments)
- Cost dashboard and transparency reporting
- Live progress streaming (studio status UI)

---

## Open Questions (Pending Research)

1. **Video API**: Which provider (Pika, Runway, Seedance, other)?
   - Cost per video?
   - API reliability and rate limits?
   - How to handle long-running jobs in StarNet's async model?

2. **Audio Synthesis**: Which TTS provider and voice quality?
   - Can we use a consistent "narrator" voice across stories?
   - How to handle multilingual Scripture quotes?

3. **Consistency Enforcement**: Can DIRECTOR storyboard ensure PRODUCER generates consistent characters?
   - Do we need character image references or prompt engineering?
   - What's the cost/quality trade-off?

4. **Outbox Integration**: Where exactly does video land?
   - Same structure as Etsy deliverables?
   - Can owner easily find and watch videos?
   - Metadata structure for Scripture references?

5. **Handoff Scalability**: File-based async handoffs work for 5 agents?
   - Any known issues with large video files (~100 MB)?
   - Persistence across agent runs reliable?

---

**Next Step**: Wait for video API research agent results, finalize tool choices, proceed to Phase 2 implementation.

#!/usr/bin/env node
/* Setup script for Christian Story Studio agents and infrastructure.
   Creates 5 agents, tool registrations, and workspace structure.
   Usage: node scripts/setup-christian-studio.mjs [--dry-run] */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const WORKSPACES = path.join(ROOT, 'workspaces');

const AGENTS = [
  {
    id: 'storywriter',
    name: 'STORYWRITER',
    color: '#a78bfa',
    model: 'claude-opus-5',
    provider: 'anthropic',
    personaId: 'researcher',
    purpose: 'Research and develop compelling Christian narratives, scripts, and accurate Scripture',
    docs: {
      identity: 'You are the STORYWRITER, a narrative specialist focused on Christian content. Your gift is finding compelling stories within Scripture and real faith, developing them into engaging scripts with accurate Biblical references.',
      purpose: 'Research assignments, develop three-act Christian narratives, write dialogue and narration with accurate Scripture quotations, create story outlines and character notes.',
      manual: 'See: /docs/agents/STORYWRITER.md',
      context: 'You work in the Christian Story Studio, a specialized autonomous video production team. Your scripts feed directly to DIRECTOR for visual planning, then PRODUCER for generation.',
    },
  },
  {
    id: 'director',
    name: 'DIRECTOR',
    color: '#60a5fa',
    model: 'claude-opus-5',
    provider: 'anthropic',
    personaId: 'designer',
    purpose: 'Plan cinematic language, storyboards, visual style, character design, and environment consistency',
    docs: {
      identity: 'You are the DIRECTOR, a visual storyteller and cinematographer. Your responsibility is translating scripts into vivid visual language that brings stories to life on screen.',
      purpose: 'Create storyboards with shot-by-shot breakdowns, develop character designs, establish visual style and color palette, generate reference imagery, ensure scene consistency.',
      manual: 'See: /docs/agents/DIRECTOR.md',
      context: 'Your storyboards and visual guides become the PRODUCER\'s generation prompts. Quality visual direction directly impacts video quality.',
    },
  },
  {
    id: 'producer',
    name: 'PRODUCER',
    color: '#f87171',
    model: 'claude-opus-5',
    provider: 'anthropic',
    personaId: 'executor',
    purpose: 'Execute video generation, manage production jobs, assemble final videos, and coordinate with QC',
    docs: {
      identity: 'You are the PRODUCER, a technical specialist managing the actual generation of video and audio. Your coordination ensures scripts become real, playable videos.',
      purpose: 'Submit text-to-video generation jobs via Pika/Runway APIs, manage audio synthesis, assemble clips into complete videos, track production state and costs, handle retries and failures.',
      manual: 'See: /docs/agents/PRODUCER.md',
      context: 'You receive storyboards from DIRECTOR, scripts from STORYWRITER. Your output is the rough assembly that QC_EDITOR will independently verify.',
    },
  },
  {
    id: 'qceditor',
    name: 'QC_EDITOR',
    color: '#34d399',
    model: 'claude-opus-5',
    provider: 'anthropic',
    personaId: 'auditor',
    purpose: 'Independently verify video quality, accuracy, technical correctness, and readiness for delivery',
    docs: {
      identity: 'You are the QC EDITOR, an independent quality auditor. Your role is to catch defects before final delivery, protecting the integrity of the final product.',
      purpose: 'Inspect video and audio for technical quality, verify narrative accuracy and Scripture correctness, check continuity and consistency, create detailed QC reports, recommend specific fixes.',
      manual: 'See: /docs/agents/QC_EDITOR.md',
      context: 'You work independently from PRODUCER. Your QC report guides PRODUCER\'s corrections. Only defects you approve for delivery reach the Outbox.',
    },
  },
  {
    id: 'publisher',
    name: 'PUBLISHER',
    color: '#fbbf24',
    model: 'claude-opus-5',
    provider: 'anthropic',
    personaId: 'curator',
    purpose: 'Package verified videos with supporting files, metadata, and deliver to Outbox for owner review',
    docs: {
      identity: 'You are the PUBLISHER, a curator and delivery specialist. Your role is making the final video easy to find, play, and understand.',
      purpose: 'Organize verified video with metadata, generate thumbnails and captions, create delivery packages, coordinate final Outbox delivery, ensure playability.',
      manual: 'See: /docs/agents/PUBLISHER.md',
      context: 'Videos only reach the Outbox through you. You are the final quality gate before owner access.',
    },
  },
];

async function setupStudio(dryRun = false) {
  console.log('🎬 Christian Story Studio Setup');
  console.log('================================\n');

  if (dryRun) console.log('[DRY RUN MODE]\n');

  // 1. Create workspace directories for each agent
  console.log('📁 Creating agent workspaces...');
  for (const agent of AGENTS) {
    const agentDir = path.join(WORKSPACES, agent.id);
    try {
      await fs.mkdir(agentDir, { recursive: true });
      await fs.mkdir(path.join(agentDir, 'scenes'), { recursive: true });
      await fs.mkdir(path.join(agentDir, 'scripts'), { recursive: true });
      await fs.mkdir(path.join(agentDir, 'assets'), { recursive: true });
      await fs.mkdir(path.join(agentDir, 'output'), { recursive: true });
      console.log(`  ✓ ${agent.name}: ${agentDir}`);
    } catch (err) {
      console.error(`  ✗ ${agent.name}: ${err.message}`);
    }
  }

  // 2. Create agent save files
  console.log('\n📝 Creating agent configuration files...');
  for (const agent of AGENTS) {
    const saveDoc = {
      version: 1,
      agentId: agent.id,
      updatedAt: Date.now(),
      savedAt: Date.now(),
      doc: {
        schema: 'starnet.save',
        version: 5,
        updatedAt: Date.now(),
        agent: {
          id: agent.id,
          name: agent.name,
          color: agent.color,
          model: agent.model,
          provider: agent.provider,
          personaId: agent.personaId,
          purpose: agent.purpose,
          createdAt: Date.now(),
          docs: agent.docs,
          stats: { xp: 0, level: 1, lifetimeXp: 0, confidence: 50, samples: 0, counters: {}, milestones: [] },
        },
        agents: [],
        usage: { tokens: 0, cost: 0, calls: 0 },
        prov: agent.provider,
        station: null,
        stationStats: { xp: 0, level: 1, lifetimeXp: 0, confidence: 50, samples: 0, counters: {}, milestones: [] },
        profile: { v: 1, tags: { studio: true, 'christian-story': true }, seed: null, enabled: true, total: 0 },
        dossier: { v: 1, dims: { identity: [], stack: [], goals: [], style: [], standing_orders: [] }, seededFrom: {}, updatedAt: 0 },
        workstreams: [],
        activeId: null,
        generalId: null,
      },
    };

    const savePath = path.join(WORKSPACES, agent.id, 'agent.save.json');
    if (!dryRun) {
      await fs.writeFile(savePath, JSON.stringify(saveDoc, null, 2));
    }
    console.log(`  ✓ ${agent.name}: ${savePath}`);
  }

  // 3. Create agent manual files
  console.log('\n📖 Creating agent manuals...');
  const docsDir = path.join(ROOT, 'docs', 'agents');
  try {
    await fs.mkdir(docsDir, { recursive: true });
  } catch (err) {}

  for (const agent of AGENTS) {
    const manualPath = path.join(docsDir, `${agent.name}.md`);
    const manualContent = generateAgentManual(agent);
    if (!dryRun) {
      await fs.writeFile(manualPath, manualContent);
    }
    console.log(`  ✓ ${agent.name}: ${manualPath}`);
  }

  // 4. Create shared studio documentation
  console.log('\n📚 Creating shared documentation...');
  const studioGuide = generateStudioGuide();
  const studioGuidePath = path.join(docsDir, 'STUDIO_GUIDE.md');
  if (!dryRun) {
    await fs.writeFile(studioGuidePath, studioGuide);
  }
  console.log(`  ✓ Studio guide: ${studioGuidePath}`);

  console.log('\n✅ Setup complete!');
  console.log('\nNext steps:');
  console.log('1. Review docs/agents/ for individual agent manuals');
  console.log('2. Set environment variables: PIKA_API_KEY, ELEVENLABS_API_KEY, ANTHROPIC_API_KEY');
  console.log('3. Submit assignments via STORYWRITER agent');
  console.log('4. Monitor production via PRODUCER logs');
  console.log('5. Review QC reports before final delivery');
}

function generateAgentManual(agent) {
  const manuals = {
    STORYWRITER: `# STORYWRITER Agent Manual

## Mission
Develop compelling Christian narratives, research topics, write scripts with accurate Scripture, and create story outlines.

## Key Responsibilities
- Research Christian topics and Scripture passages
- Develop three-act story structures with hooks and emotional arcs
- Write dialogue, narration, and action descriptions
- Verify Scripture accuracy (quote exact verses with book/chapter/verse)
- Create character descriptions and background notes
- Produce shooting scripts (formatted for visual translation)

## Inputs
Receive assignments as JSON:
\`\`\`json
{
  "topic": "The Prodigal Son parable",
  "duration_target": "120 seconds",
  "scripture_focus": "Luke 15:11-32",
  "tonal_style": "emotional, redemptive",
  "audience": "faith community",
  "constraints": "no explicit violence, family-friendly"
}
\`\`\`

## Outputs
Save to your workspace:
- \`scripts/ASSIGNMENT_ID.md\` — Full script (dialogue, action, narration)
- \`scripts/outline_ASSIGNMENT_ID.md\` — Three-act outline with scene breakdown
- \`scripts/research_ASSIGNMENT_ID.md\` — Research notes, Scripture sources, theological context

## Tools Available
- \`web.search\` — Research Biblical context, theological insights
- \`notebook.read/write\` — Save story versions, research notes
- \`skill.view/manage\` — Access narrative structure templates

## Quality Standards
✓ Scripture quoted exactly (book:chapter:verse format)
✓ Dialogue fits target duration (±10%)
✓ Characters distinct and consistent
✓ Story arc clear (setup → conflict → resolution)
✓ Emotionally resonant for Christian audience

## Handoff to DIRECTOR
When script is complete:
1. Save script.md with full visual descriptions
2. Notify DIRECTOR with script path
3. Answer DIRECTOR's questions about tone, pacing, character intent
4. Iterate on rewrites if DIRECTOR requests script revisions

## Error Recovery
- If Scripture verification fails, use official Bible sources (Bible.com, ESV API)
- If story feels weak, iterate 2-3 times before hand off
- Always get script to at least 80% confidence before DIRECTOR review

---
Generated: 2026-10-25
Next Manual: docs/agents/DIRECTOR.md
`,

    DIRECTOR: `# DIRECTOR Agent Manual

## Mission
Plan cinematic language, create storyboards, develop visual style, ensure scene consistency across the production.

## Key Responsibilities
- Read scripts and translate to visual language
- Create shot-by-shot storyboards with camera angles, lighting, movement
- Design characters and environments
- Establish color palette and visual mood
- Generate reference imagery (via Higgsfield integration)
- Ensure consistency across all scenes

## Inputs
Receive from STORYWRITER:
- script.md (full dialogue, action descriptions, narration)
- outline.md (three-act structure, scene breakdown)
- research.md (thematic context)

## Outputs
Save to your workspace:
- \`storyboard/storyboard_ASSIGNMENT_ID.md\` — Scene-by-scene shot list
- \`storyboard/visual_style_ASSIGNMENT_ID.md\` — Character design, color palette, environment references
- \`storyboard/scenes_ASSIGNMENT_ID.json\` — Structured scene data for PRODUCER
- \`storyboard/references/\` — Visual inspiration images

## Tools Available
- \`higgsfield.generate\` — Generate reference imagery for visual inspiration
- \`fs.read/write\` — Save storyboards and visual assets
- \`web.search\` — Research visual styles, cinematography references
- \`notebook.read/write\` — Design consistency notes

## Storyboard Format (scenes_ASSIGNMENT_ID.json)
\`\`\`json
{
  "scenes": [
    {
      "id": "scene_1",
      "duration_sec": 10,
      "shot_type": "wide establishing",
      "visual_prompt": "Golden light streaming through stained glass in empty church, peaceful, reverent",
      "camera_movement": "slow pan across windows",
      "character_description": "None (environment focus)",
      "narration": "Every great journey begins with a choice..."
    }
  ]
}
\`\`\`

## Quality Standards
✓ Storyboard matches script duration (±2 seconds per scene)
✓ Visual consistency (same character looks consistent)
✓ Shot variety (not all wide shots, mix angles/distances)
✓ Lighting and mood support narrative tone
✓ Scene descriptions detailed enough for video generation

## Handoff to PRODUCER
When storyboard complete:
1. Save scenes_ASSIGNMENT_ID.json with all prompts
2. Notify PRODUCER with storyboard path
3. PRODUCER uses visual prompts as video generation inputs
4. Respond to PRODUCER's clarification requests

## Error Recovery
- If character inconsistency found, create character sheet with specific details
- If visual style unclear, use reference images from Higgsfield
- If scenes don't fit duration, request script adjustments from STORYWRITER

---
Generated: 2026-10-25
Next Manual: docs/agents/PRODUCER.md
`,

    PRODUCER: `# PRODUCER Agent Manual

## Mission
Execute video generation, manage media production jobs, assemble final video, coordinate with QC.

## Key Responsibilities
- Submit text-to-video generation jobs (Pika Labs, Runway)
- Generate or source audio (narration, background music)
- Manage video assembly and timing
- Track production state, costs, and job IDs
- Handle retries and error recovery
- Prepare rough-cut video for QC

## Inputs
Receive from DIRECTOR:
- storyboard.md (shot descriptions and visual style)
- scenes_ASSIGNMENT_ID.json (structured scene list with prompts)
- visual_style.md (character design, color palette, reference images)

Also receive from STORYWRITER:
- script.md (narration text for audio generation)

## Tools Available
- \`video.generate\` — Submit text-to-video jobs via Pika/Runway APIs
- \`audio.generate\` — Generate narration via ElevenLabs TTS
- \`video.process\` — Assemble clips, sync audio, add transitions
- \`fs.read/write\` — Save video files and production logs
- \`notebook.write\` — Track production state

## Workflow

### 1. Setup Production
- Create production log: \`production_ASSIGNMENT_ID.md\`
- Read scenes_ASSIGNMENT_ID.json
- Parse narration timing from script

### 2. Generate Audio
Call \`audio.generate\`:
\`\`\`json
{
  "text": "[full narration text from script]",
  "voiceId": "rachel",
  "filename": "narration_ASSIGNMENT_ID"
}
\`\`\`
- Save result path and duration

### 3. Generate Video Scenes
For each scene in scenes_ASSIGNMENT_ID.json:
- Call \`video.generate\` with visual prompt
- Track job ID and generation time
- Log cost and file size
- Retry up to 3x on failure with modified prompt

Example:
\`\`\`json
{
  "prompt": "[visual_prompt from scene]",
  "duration": [scene duration_sec],
  "aspect_ratio": "16:9",
  "filename": "scene_001"
}
\`\`\`

### 4. Assemble Final Video
- Combine all scene MP4s in sequence
- Sync narration audio with video timing
- Add transitions between scenes
- Render final MP4
- Log total duration and file size

### 5. Document Production
Save \`production_ASSIGNMENT_ID.md\`:
\`\`\`markdown
# Production Log: ASSIGNMENT_ID

## Scenes Generated
- scene_001: OK (job_xxx, 8.2 seconds, $0.20)
- scene_002: OK (job_yyy, 10.1 seconds, $0.25)
...

## Audio
- narration: OK (115 seconds, $0.12)

## Assembly
- Final video: 120.3 seconds, 145MB
- Total cost: $0.92
- Timestamp: 2026-10-25 14:32:15 UTC

## Issues & Retries
(log any failures and recoveries here)
\`\`\`

## Quality Standards
✓ All scenes generate without permanent errors (retry 3x if needed)
✓ Final video duration matches script timing (±2 seconds)
✓ Audio properly synced (narration matches scene timing)
✓ No visible compression artifacts or frame drops
✓ File is valid MP4, playable by standard players
✓ Production log complete and accurate

## Error Recovery
- Scene generation fails → Modify prompt, remove confusing descriptors, retry
- Audio sync off → Adjust timing in video.process call
- Final video corrupt → Re-render from clips, verify codec

## Cost Awareness
- Pika: $0.20 per 5-second clip
- Audio: $0.001-0.01 per second (TTS)
- Total typical video: $0.50-$2.00
- Track costs per assignment

## Handoff to QC_EDITOR
When complete:
1. Save assembled video: \`output/video_ASSIGNMENT_ID.mp4\`
2. Save production log: \`production_ASSIGNMENT_ID.md\`
3. Notify QC_EDITOR with video path
4. Await QC report
5. Process corrections if needed

---
Generated: 2026-10-25
Next Manual: docs/agents/QC_EDITOR.md
`,

    QC_EDITOR: `# QC EDITOR Agent Manual

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
- \`video.inspect\` — Technical video analysis
- \`audio.inspect\` — Audio quality and sync verification
- \`fs.read\` — Read video, scripts, storyboards
- \`fs.write\` — Save QC report and findings
- \`notebook.write\` — Detailed notes

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

Save \`qc/report_ASSIGNMENT_ID.md\`:

\`\`\`markdown
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
\`\`\`

## Verdict Types

- **APPROVED**: Zero defects, ready for immediate delivery
- **APPROVED_WITH_NOTES**: Minor cosmetic issues (barely visible artifacts, not worth fixing)
- **REQUIRES_FIXES**: Specific defects that must be corrected before delivery
- **REJECTED**: Critical flaws (broken audio sync, missing scenes, wrong narration, Scripture error)

## Handoff to PRODUCER (if fixes needed)
Format defect report:
\`\`\`
PRODUCER:
- Scene 3 (45-50s): Compression artifact at (1150, 75)
  Action: Re-render scene_003 with cleaner prompt or slightly higher bitrate
- Missing audio sync in scene 5
  Action: Re-check audio timing in assembly
\`\`\`

## Handoff to PUBLISHER (if approved)
Notify with:
- ✅ QC Status: APPROVED
- 📄 QC Report path
- 🎬 Video ready for delivery

---
Generated: 2026-10-25
Next Manual: docs/agents/PUBLISHER.md
`,

    PUBLISHER: `# PUBLISHER Agent Manual

## Mission
Package verified videos with supporting files, create metadata, and deliver to Outbox for owner review and sharing.

## Key Responsibilities
- Organize video with supporting materials
- Generate thumbnail images from video
- Create captions/subtitles from script
- Write metadata (title, description, Scripture references)
- Prepare delivery package in Outbox
- Ensure video is playable and accessible

## Inputs
Receive from QC_EDITOR:
- video_ASSIGNMENT_ID.mp4 (verified, QC-approved)
- qc_report.md (QC findings and approval)

Also receive from STORYWRITER:
- script.md (for caption generation and metadata)
- research.md (for description content)

Also receive from PRODUCER:
- production_ASSIGNMENT_ID.md (for production credits)

## Tools Available
- \`fs.read/write\` — Access video, scripts, and create delivery files
- \`image.generate\` (potentially) — Generate custom thumbnail if needed
- \`notebook.write\` — Delivery confirmation and metadata
- Outbox delivery mechanism (via fs.write to Outbox directory)

## Delivery Structure

Create directory: \`outbox/{assignment_id}/\`

Contents:
\`\`\`
outbox/assignment_001/
├── video.mp4                 (the main deliverable)
├── thumbnail.png             (preview image)
├── captions.vtt              (subtitles for accessibility)
├── script.md                 (full script, transparent)
├── metadata.json             (title, description, Scripture refs)
├── storyboard_summary.md     (brief visual summary)
├── qc_report.md              (transparency: QC findings)
├── production_log.md         (transparency: costs, generation details)
└── README.md                 (how to watch this video)
\`\`\`

## metadata.json Format

\`\`\`json
{
  "id": "assignment_001",
  "title": "The Prodigal Son",
  "description": "A contemporary retelling of Jesus' parable about the son who left home and returned to his father's love. This 2-minute narrative explores themes of repentance and radical grace.",
  "duration_seconds": 120,
  "scripture_references": [
    {
      "book": "Luke",
      "chapter": 15,
      "verses": "11-32",
      "quote": "A man had two sons..."
    }
  ],
  "created_at": "2026-10-25T14:45:22Z",
  "team": {
    "storywriter": "STORYWRITER",
    "director": "DIRECTOR",
    "producer": "PRODUCER",
    "qc_editor": "QC_EDITOR",
    "publisher": "PUBLISHER"
  },
  "production": {
    "duration_minutes": 15,
    "total_cost": 0.92,
    "video_api": "Pika Labs",
    "audio_api": "ElevenLabs",
    "status": "approved"
  },
  "format": "MP4 (h.264, 1280x720, 24fps)",
  "content_type": "Christian narrative",
  "audience": "faith community, family-friendly"
}
\`\`\`

## captions.vtt Format

\`\`\`
WEBVTT

00:00:00.000 --> 00:00:05.000
A man had two sons. The younger one said to his father...

00:00:05.000 --> 00:00:10.000
'Father, give me my share of the inheritance.'

... (continue for full narration)
\`\`\`

## Workflow

### 1. Validate Inputs
- [ ] Video file exists and is playable
- [ ] QC report shows APPROVED status
- [ ] Script available for captions
- [ ] All supporting files present

### 2. Generate Thumbnail
- Extract frame at middle of video (60 seconds into 120s video)
- Resize to 1280x720 or 16:9 aspect ratio
- Save as thumbnail.png in Outbox

### 3. Generate Captions
- Parse narration from script.md
- Convert to VTT format with timing
- Ensure each caption is readable (not too long)
- Save as captions.vtt

### 4. Create Metadata
- Extract title from assignment or script
- Write compelling description (2-3 sentences)
- List all Scripture references with exact quotes
- Record production team and costs
- Save as metadata.json

### 5. Prepare Delivery Package
Copy to Outbox:
- video.mp4
- thumbnail.png
- captions.vtt
- script.md
- metadata.json
- storyboard_summary.md (brief version of visual guide)
- qc_report.md (for transparency)
- production_log.md (for cost/detail transparency)
- README.md (how to watch, links to resources)

### 6. Create README.md

\`\`\`markdown
# {video_title}

## How to Watch
This video is saved as \`video.mp4\`. Open in any modern media player (VLC, QuickTime, Windows Media Player, Chrome, etc.).

**Subtitles:** Open \`captions.vtt\` to display captions while watching.

## About This Video
{description from metadata}

## Scripture References
{list of Bible verses with references}

## Production Details
- Duration: {seconds}
- Created: {date}
- Team: {agent names}
- Cost: \${cost}

## Use Cases
- Share with your faith community
- Watch with family
- Meditation or devotional time
- Teaching or small group discussion

## Files Included
- **video.mp4** — The main video file
- **captions.vtt** — Subtitles for accessibility
- **script.md** — Full script (read along)
- **metadata.json** — Structured metadata
- **qc_report.md** — Quality assurance details
- **production_log.md** — Production credits and costs

---
*Created by Christian Story Studio*
*Delivered: {timestamp}*
\`\`\`

## Quality Standards
✓ Video file is valid, playable MP4
✓ All metadata fields complete and accurate
✓ Captions present and synced
✓ Thumbnail is readable and representative
✓ Delivery directory has all required files
✓ README clear and accessible
✓ All files in correct directory structure

## Delivery Confirmation
Save \`delivery_ASSIGNMENT_ID.md\`:
\`\`\`markdown
# Delivery Confirmation

Video: ASSIGNMENT_ID
Title: {title}
Status: DELIVERED TO OUTBOX
Timestamp: {timestamp}
Path: outbox/{assignment_id}/

Files:
- video.mp4 ({filesize})
- captions.vtt
- metadata.json
- thumbnail.png
- script.md
- qc_report.md
- production_log.md
- README.md

✅ Ready for owner review and sharing
\`\`\`

## Privacy & Publishing
- Videos are PRIVATE by default (saved in Outbox, not public)
- Owner must explicitly approve any sharing to external platforms
- Metadata includes all production details for transparency
- No video is published to social media without owner consent

## Error Recovery
- If metadata incomplete, request from STORYWRITER
- If captions don't sync, adjust timing or regenerate
- If thumbnail unrepresentative, extract from different frame
- If any file missing, request from appropriate agent

---
Generated: 2026-10-25
End of Agent Manuals
`,
  };

  return manuals[agent.name] || `# ${agent.name} Manual\n\n(Manual template)\n`;
}

function generateStudioGuide() {
  return `# Christian Story Studio — Complete Operations Guide

## Studio Overview
The Christian Story Studio is an autonomous five-agent video production team integrated into StarNet. Each agent owns a distinct phase of the pipeline with clear handoffs and quality gates.

## Agent Roles

1. **STORYWRITER** — Scripts & Narrative
   - Researches Christian topics
   - Writes scripts with accurate Scripture
   - Creates story outlines and character notes

2. **DIRECTOR** — Visual Planning
   - Creates storyboards with shot lists
   - Develops character design and visual style
   - Generates reference imagery

3. **PRODUCER** — Video Generation & Assembly
   - Submits video generation jobs (Pika, Runway)
   - Generates audio narration (ElevenLabs)
   - Assembles final video

4. **QC_EDITOR** — Independent Quality Verification
   - Inspects video and audio quality
   - Verifies Scripture accuracy
   - Checks continuity and consistency

5. **PUBLISHER** — Final Packaging & Delivery
   - Organizes video with supporting files
   - Creates captions and metadata
   - Delivers to Outbox for owner review

## Assignment Workflow

### Step 1: Submit Assignment
Send JSON to STORYWRITER:
\`\`\`json
{
  "topic": "The Prodigal Son",
  "duration_target": "120 seconds",
  "scripture_focus": "Luke 15:11-32",
  "tonal_style": "emotional, redemptive",
  "audience": "faith community"
}
\`\`\`

### Step 2: Script Development
STORYWRITER produces:
- Full script with dialogue and narration
- Scene breakdown and character notes
- Research summary with Scripture sources

### Step 3: Visual Planning
DIRECTOR produces:
- Shot-by-shot storyboard
- Character and environment design
- Visual style guide with references

### Step 4: Video Generation
PRODUCER:
- Generates video scenes (Pika/Runway API)
- Synthesizes narration (ElevenLabs)
- Assembles final video

### Step 5: Quality Verification
QC_EDITOR:
- Inspects technical quality
- Verifies Scripture accuracy
- Creates detailed QC report

### Step 6: Final Delivery
PUBLISHER:
- Packages video with metadata
- Creates captions and thumbnail
- Delivers to Outbox

## Cost Tracking

**Per typical 2-minute video:**
- Video generation (Pika): $0.40-$0.60
- Audio narration (ElevenLabs): $0.10-$0.15
- Total: $0.50-$0.75 per finished video

**Monthly at 4 videos/week:**
- Approximately $8-15/month
- Tracked transparently in production logs

## Quality Standards

Every video must pass:
✓ Technical quality (codec, resolution, frame rate)
✓ Audio quality (clear, well-synced)
✓ Narrative accuracy (script faithful)
✓ Scripture accuracy (exact quotes verified)
✓ Visual consistency (characters and environments consistent)

## Environment Setup

### Required API Keys
\`\`\`bash
export PIKA_API_KEY="your_pika_key"
export ELEVENLABS_API_KEY="your_elevenlabs_key"
export ANTHROPIC_API_KEY="your_anthropic_key"
\`\`\`

### Agent Workspaces
Each agent has isolated workspace:
\`\`\`
workspaces/
├── storywriter/      # Scripts, research
├── director/         # Storyboards, visuals
├── producer/         # Video scenes, assembly
├── qceditor/         # QC reports, inspection
└── publisher/        # Deliverables, metadata
\`\`\`

### Outbox Directory
Final videos delivered to:
\`\`\`
outbox/
├── assignment_001/   # Video + supporting files
├── assignment_002/   # ...
└── ...
\`\`\`

## Error Recovery

- **Script issues:** STORYWRITER iterates, DIRECTOR waits
- **Storyboard issues:** DIRECTOR revises, PRODUCER waits
- **Video generation failure:** PRODUCER retries (up to 3x)
- **QC rejection:** PRODUCER makes specific fixes, QC re-verifies
- **Delivery issues:** PUBLISHER verifies files and re-packages

## Next Steps

1. Set up environment variables (API keys)
2. Submit first assignment to STORYWRITER
3. Monitor production logs in PRODUCER workspace
4. Review QC report in QC_EDITOR workspace
5. Find final video in Outbox

## Support

- Agent Manuals: docs/agents/{AGENT_NAME}.md
- Production Logs: workspaces/{agent}/production_*.md
- QC Reports: workspaces/qceditor/qc/report_*.md
- Video Delivery: outbox/{assignment_id}/

---
Generated: 2026-10-25
Maintained by: Christian Story Studio Team
`;
}

// Main execution
const dryRun = process.argv.includes('--dry-run');
setupStudio(dryRun).catch(err => {
  console.error('Setup failed:', err.message);
  process.exit(1);
});

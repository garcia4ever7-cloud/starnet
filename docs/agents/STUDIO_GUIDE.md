# Christian Story Studio — Complete Operations Guide

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
```json
{
  "topic": "The Prodigal Son",
  "duration_target": "120 seconds",
  "scripture_focus": "Luke 15:11-32",
  "tonal_style": "emotional, redemptive",
  "audience": "faith community"
}
```

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
```bash
export PIKA_API_KEY="your_pika_key"
export ELEVENLABS_API_KEY="your_elevenlabs_key"
export ANTHROPIC_API_KEY="your_anthropic_key"
```

### Agent Workspaces
Each agent has isolated workspace:
```
workspaces/
├── storywriter/      # Scripts, research
├── director/         # Storyboards, visuals
├── producer/         # Video scenes, assembly
├── qceditor/         # QC reports, inspection
└── publisher/        # Deliverables, metadata
```

### Outbox Directory
Final videos delivered to:
```
outbox/
├── assignment_001/   # Video + supporting files
├── assignment_002/   # ...
└── ...
```

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

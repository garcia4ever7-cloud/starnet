# PUBLISHER Agent Manual

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
- `fs.read/write` — Access video, scripts, and create delivery files
- `image.generate` (potentially) — Generate custom thumbnail if needed
- `notebook.write` — Delivery confirmation and metadata
- Outbox delivery mechanism (via fs.write to Outbox directory)

## Delivery Structure

Create directory: `outbox/{assignment_id}/`

Contents:
```
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
```

## metadata.json Format

```json
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
```

## captions.vtt Format

```
WEBVTT

00:00:00.000 --> 00:00:05.000
A man had two sons. The younger one said to his father...

00:00:05.000 --> 00:00:10.000
'Father, give me my share of the inheritance.'

... (continue for full narration)
```

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

```markdown
# {video_title}

## How to Watch
This video is saved as `video.mp4`. Open in any modern media player (VLC, QuickTime, Windows Media Player, Chrome, etc.).

**Subtitles:** Open `captions.vtt` to display captions while watching.

## About This Video
{description from metadata}

## Scripture References
{list of Bible verses with references}

## Production Details
- Duration: {seconds}
- Created: {date}
- Team: {agent names}
- Cost: ${cost}

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
```

## Quality Standards
✓ Video file is valid, playable MP4
✓ All metadata fields complete and accurate
✓ Captions present and synced
✓ Thumbnail is readable and representative
✓ Delivery directory has all required files
✓ README clear and accessible
✓ All files in correct directory structure

## Delivery Confirmation
Save `delivery_ASSIGNMENT_ID.md`:
```markdown
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
```

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

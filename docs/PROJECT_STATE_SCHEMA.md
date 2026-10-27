# Christian Story Studio — Shared Project State Schema

This document defines the durable state objects that coordinate the autonomous video production pipeline.

## Project Directory Structure

Each assignment creates a project at:
```
/workspaces/projects/{projectId}/
├── blueprint.json         # Original vision, creative decisions, requirements
├── workflow.json          # Orchestration state and progress tracking
├── script.md              # Story Writer output
├── storyboard.json        # Director output
├── production_log.md      # Producer's tracking and artifact inventory
├── qc_report.json         # QC Editor's findings and defect list
└── artifacts/             # All generated media (videos, audio, images)
```

## blueprint.json

The Creative Blueprint—single source of truth for the project vision. All agents read this; no agent modifies it except to track outputs.

```json
{
  "id": "{projectId}",
  "createdAt": 1719432000000,
  "updatedAt": 1719432000000,
  
  "userPrompt": "The Prodigal Son parable for Sunday school",
  "clarifiedIntent": "Show redemption through father's love and son's repentance",
  "assumptions": [
    "Audience: children aged 6-12",
    "Duration: 60-90 seconds",
    "Style: bright, hopeful, emotional"
  ],
  
  "visualReferences": [
    {"source": "higgsfield", "description": "warm lighting", "path": "artifacts/ref_warm_lighting.png"},
    {"source": "user", "description": "family setting", "url": "https://..."}
  ],
  
  "requirements": [
    "Must include Scripture reading (Luke 15:11-32)",
    "Show three characters: father, prodigal son, elder son",
    "Include pivotal moment of reconciliation",
    "Narrator voice present throughout",
    "No violence, family-friendly"
  ],
  
  "exclusions": [
    "No modern settings",
    "No graphic imagery",
    "No loud music (soft underscore only)"
  ],
  
  "creativeDecisions": {
    "colorPalette": "warm earth tones, gold accents",
    "characterStyle": "illustrated, compassionate expressions",
    "narratorVoice": "warm, gentle, male",
    "pacing": "slow, meditative",
    "ending": "fade to white with message overlay"
  },
  
  "mediaFormats": {
    "aspectRatio": "16:9",
    "resolution": "1920x1080",
    "frameRate": 30,
    "codec": "h264",
    "audioCodec": "aac"
  },
  
  "budgetCeiling": 5.00,
  "estimatedCost": 2.50,
  
  "outputs": {
    "storywriterScript": "",
    "directorStoryboard": "",
    "producerVideo": "",
    "qcReport": "",
    "publisherDelivery": ""
  }
}
```

## workflow.json

Orchestration state—tracks which agent should run next and what's been completed.

```json
{
  "projectId": "{projectId}",
  "createdAt": 1719432000000,
  "updatedAt": 1719432000000,
  
  "status": "ready|storywriter|director|producer|qc_editor|publisher|complete|failed",
  "currentAgent": "storywriter|director|producer|qc_editor|publisher|null",
  "stage": 1,
  
  "progress": [
    {
      "agent": "storywriter",
      "status": "pending|running|complete|failed",
      "startedAt": 0,
      "completedAt": 0,
      "attempts": 1,
      "runId": "{uuid}",
      "error": null
    }
  ],
  
  "rejections": [],
  "corrections": {
    "defects": [
      {
        "id": "qc001",
        "agent": "producer",
        "scene": "3-reconciliation",
        "severity": "critical|major|minor",
        "description": "Father's expression not warm enough in close-up",
        "reproductionSteps": "Watch 0:45-0:52 frame-by-frame",
        "importance": "This is the emotional peak of the narrative",
        "suggestedFix": "Re-generate scene 3 with prompt: 'father shows overwhelming joy and tears'",
        "status": "pending|in_progress|fixed|acknowledged"
      }
    ],
    "lastQcApproval": null,
    "approvalChain": []
  },
  
  "metadata": {
    "initiatedBy": "user|cron|api",
    "estimatedTimeRemaining": "30 minutes",
    "estimatedCostRemaining": 1.50,
    "costSpent": 1.00,
    "autoRetryLimit": 3,
    "qcApprovalRequired": true
  }
}
```

## Coordination Rules

### Agent Responsibilities

**Story Writer**:
1. Read `blueprint.json`
2. Generate script based on clarified intent
3. Save script to `script.md`
4. Update `workflow.json`: set `progress[0].status = "complete"` and increment `stage`
5. Return structured output

**Director**:
1. Wait for `workflow.json` to show `currentAgent == "director"`
2. Read `blueprint.json` and `script.md`
3. Create storyboard with scene structure
4. Save to `storyboard.json`
5. Update `workflow.json`: mark Director complete, advance to Producer

**Producer**:
1. Wait for `workflow.json` to show `currentAgent == "producer"`
2. Read blueprint, script, storyboard
3. Generate video scenes and assemble
4. Save final video to `artifacts/video.mp4`
5. Update `workflow.json`: mark complete, advance to QC
6. If corrections exist: read defects from `corrections.defects`, regenerate affected scenes only, update status tracking

**QC Editor**:
1. Read blueprint, script, storyboard, and watch actual video
2. Evaluate against requirements and creative decisions
3. Create detailed report
4. Either: approve (set `corrections.lastQcApproval = now`) or reject with specific defects
5. Save report to `qc_report.json`
6. Update `workflow.json`: set QC status, add defects if rejected

**Publisher**:
1. Wait for QC approval
2. Read final video and all supporting materials
3. Generate metadata, captions, thumbnails
4. Package to `/workspaces/projects/{projectId}/outbox/`
5. Update `workflow.json`: mark complete

### State Transitions

```
ready
  ↓ (Orchestrator triggers Story Writer run)
storywriter (agent runs, updates progress)
  ↓ (Orchestrator detects completion)
director (agent runs)
  ↓
producer (agent runs)
  ↓
qc_editor (agent runs)
  ├─ → corrections.defects != empty
  │    └─ → producer (agent runs again, fixes specific scenes)
  │         └─ → qc_editor (re-evaluates)
  │
  └─ → corrections.lastQcApproval set
       ↓
publisher
  ↓
complete
```

### Orchestration Loop

A background process (cron or sidecar daemon) monitors `workflow.json` and:

1. Checks if current status has a `nextAgent`
2. If yes and agent's process is complete:
   - Determines which agent should run next
   - Constructs system prompt (blueprint + context)
   - Submits run to that agent via API
   - Updates `currentAgent` and timestamps
3. Polls for completion
4. On completion: updates progress array and advances status
5. On failure: increments attempt count, retries (up to `autoRetryLimit`)

### Error Recovery

- **Agent timeout**: Increment attempt count, retry with same agent (up to limit)
- **Agent failure**: Log error, pause, notify operator
- **Cost overrun**: Stop production, log warning
- **Network error**: Retry after 30 seconds

## Implementation Notes

- All file writes are atomic (write to .tmp, fsync, rename)
- All timestamps are `Date.now()` (milliseconds since epoch)
- All UUIDs are v4, generated server-side
- No agent modifies another agent's output (read-only access)
- Blueprint is effectively immutable after creation (exception: outputs tracking)
- Workflow state is the single orchestration source of truth

---

Last updated: 2026-10-25
Used by: Story Writer, Director, Producer, QC Editor, Publisher, Orchestrator

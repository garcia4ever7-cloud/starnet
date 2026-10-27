# Multi-Agent Project Orchestration

The Christian Story Studio uses autonomous orchestration to manage multi-agent projects without browser intervention. This document describes the infrastructure, architecture, and usage.

## Architecture

### Core Components

**1. Project State Management** (`sidecar/project-orchestration.js`)
- Blueprint: User intent + requirements + agent outputs
- Workflow: Current execution status + attempt counts + run history
- Both stored atomically in `~/.local/share/StarNet/workspaces/../projects/{projectId}/`

**2. Orchestrator Engine** (`sidecar/cron-orchestrator.js`)
- Polls workflow state every 30 seconds (via cron)
- Determines next agent based on current stage
- Builds agent-specific system prompt with full blueprint context
- Submits run via HTTP POST /api/run
- Polls for completion (~60 second timeout)
- Updates blueprint and workflow on success
- Advances to next stage

**3. Cron Task Registration** (`sidecar/cron-orchestration-tasks.js`)
- Registers/unregisters cron tasks for projects
- Manages `cron.jobs.json` file (read/write safe)
- Creates "orchestrator" agent tasks that run every 30 seconds

**4. CLI Tools**
- `submit-studio-assignment.mjs` — Create new project
- `run-orchestrator.mjs` — Manually trigger orchestration steps
- `manage-orchestration.mjs` — List, monitor, or cancel projects

### Data Flow

```
User submits prompt
    ↓
submit-studio-assignment.mjs creates:
  - project/{id}/blueprint.json (user intent + metadata)
  - project/{id}/workflow.json (status = "running")
  - Registers cron task
    ↓
Every 30 seconds, cron-orchestrator.js:
  1. Loads workflow.json
  2. Determines next agent (storywriter → director → producer → qceditor)
  3. Loads blueprint.json
  4. Builds agent-specific system prompt
  5. Submits POST /api/run with payload containing:
     - model, provider, messages
     - system prompt (includes full blueprint)
     - agentId, surface:'autonomous'
  6. Polls for run completion (max 60s)
  7. On success:
     - Updates blueprint.outputs[agentId] with agent's work
     - Advances workflow.currentStage
     - Saves both files atomically
  8. Returns status
    ↓
Agent runs and produces deliverables
  - Uses deliverable_note tool to save outputs
  - Orchestrator will capture these from run journal
    ↓
Next agent gets automatic turn within 30s
    ↓
Pipeline complete when all 4 agents finish
```

## Usage

### Create a New Project

```bash
# Basic
node scripts/submit-studio-assignment.mjs --prompt "The Prodigal Son"

# With options
node scripts/submit-studio-assignment.mjs \
  --prompt "The Good Samaritan" \
  --duration 180 \
  --format video \
  --style animated
```

Output:
```
📋 Creating project: abc-123-def-456
✅ Blueprint created
✅ Workflow initialized
✅ Orchestration task registered: orch-abc-123-def-456

🎬 Project created successfully!
   Project ID: abc-123-def-456
   Prompt: "The Good Samaritan"
   Duration: 180s
   Format: video
   Style: animated

📂 Project files:
   /home/user/.local/share/StarNet/workspaces/../projects/abc-123-def-456/blueprint.json
   /home/user/.local/share/StarNet/workspaces/../projects/abc-123-def-456/workflow.json

⏱️  Pipeline Status:
   Orchestrator will dispatch STORYWRITER within 30 seconds
   Check workflow.json to monitor progress
```

### Monitor Progress

```bash
# Check workflow status
node scripts/manage-orchestration.mjs status abc-123-def-456

# Watch live progress
node scripts/manage-orchestration.mjs monitor abc-123-def-456 --interval 5

# See all active projects
node scripts/manage-orchestration.mjs list

# View full project details
node scripts/manage-orchestration.mjs show abc-123-def-456
```

### Manually Run a Step

```bash
# Run next agent once
node scripts/run-orchestrator.mjs abc-123-def-456

# Run until complete
node scripts/run-orchestrator.mjs abc-123-def-456 --all

# Run with longer timeout
node scripts/run-orchestrator.mjs abc-123-def-456 --wait 120000
```

### Cancel a Project

```bash
node scripts/manage-orchestration.mjs cancel abc-123-def-456
```

## Blueprint Structure

Located at: `~/.local/share/StarNet/workspaces/../projects/{projectId}/blueprint.json`

```json
{
  "projectId": "abc-123-def-456",
  "userPrompt": "The Prodigal Son",
  "createdAt": 1792956300000,
  "updatedAt": 1792956300000,
  "status": "in-progress",
  "metadata": {
    "duration": 120,
    "outputFormat": "video",
    "style": "documentary",
    "submittedAt": "2026-10-25T14:30:00Z",
    "submittedBy": "cli"
  },
  "outputs": {
    "storywriter": {
      "script": "INT. DISTANT LAND - DAY\n...",
      "outline": "Three-act structure focusing on...",
      "notes": "Used KJV translation...",
      "revisions": [],
      "lastRun": {
        "runId": "run-uuid-123",
        "status": "done",
        "timestamp": 1792956400000
      }
    },
    "director": {
      "shotlist": "SCENE 1: Wide establishing shot...",
      "references": ["Golden hour lighting", "Natural outdoor setting"],
      "notes": "Suggested warm color palette...",
      "revisions": []
    },
    "producer": {
      "scenes": ["scene1.md", "scene2.md"],
      "media": ["/path/to/image1.png", "/path/to/image2.png"],
      "status": "",
      "revisions": []
    },
    "qceditor": {
      "approved": false,
      "feedback": "Script accurate, images aligned with direction",
      "adjustments": [],
      "revisions": []
    }
  },
  "rejections": []
}
```

## Workflow Structure

Located at: `~/.local/share/StarNet/workspaces/../projects/{projectId}/workflow.json`

```json
{
  "projectId": "abc-123-def-456",
  "status": "running",
  "currentStage": 1,
  "attempts": {
    "storywriter": 1,
    "director": 0,
    "producer": 0,
    "qceditor": 0
  },
  "lastUpdate": 1792956400000,
  "runHistory": [
    {
      "agent": "storywriter",
      "runId": "run-uuid-123",
      "startedAt": 1792956300000,
      "completedAt": 1792956400000,
      "status": "done"
    }
  ]
}
```

## Agent System Prompts

When the orchestrator submits an agent run, it constructs a system prompt that includes:

1. **Role Description** — what this agent does
2. **Assignment** — what to produce
3. **Context** — user's original prompt + previous outputs
4. **Output Requirements** — specific format and tools to use
5. **Full Blueprint** — JSON serialized for reference

Example for DIRECTOR:
```
You are DIRECTOR, a visual planning specialist for the Christian Story Studio.

ASSIGNMENT: Create a shot list and visual plan from the script you received:

PREVIOUS AGENT'S WORK (STORYWRITER):
{
  "script": "INT. DISTANT LAND - DAY...",
  "outline": "Three acts...",
  ...
}

CONTEXT:
The Prodigal Son

OUTPUT REQUIREMENTS:
1. Analyze the script for visual storytelling opportunities
2. Create a detailed shot list with:
   - Scene number and description
   - Shot type (wide, medium, close-up, etc)
   - Camera movement (if any)
   - Duration estimate in seconds
   - Visual references or mood
...
```

Agents use `deliverable_note` tool to save their work, which the orchestrator captures and adds to the blueprint for the next agent.

## Error Handling

### Timeouts
- Default timeout: 60 seconds per agent
- If agent doesn't complete, orchestrator retries up to 3 times
- Retry attempts tracked in `workflow.attempts`

### Failures
- If an agent fails after 3 retries, pipeline pauses
- Manual intervention needed: review logs, adjust blueprint, resume

### Rejections
- If QC rejects work, feedback goes to `blueprint.rejections`
- Prior agent is re-run with rejection feedback in system prompt
- Cycle repeats until QC approval

### Missing Prior Outputs
- If an agent doesn't find expected prior outputs, it proceeds with defaults
- Documented in agent's deliverable notes
- QC will flag consistency issues

## Integration with Cron System

The orchestrator is NOT integrated into the main cron scheduler (index.js). Instead:

1. `submit-studio-assignment.mjs` writes a task to `cron.jobs.json`
2. If the station's cron system is enabled, it will fire orchestrator tasks
3. Alternatively, tasks run via manual `run-orchestrator.mjs` calls
4. Future: Can integrate `orchestrateNextAgent` as a periodic background task in index.js

Each orchestration cron job carries:
- agentId: "orchestrator"
- schedule: interval 30 seconds
- messages: generic "advance the pipeline" request
- Special marker: `_orchestrationProject: projectId`

## Files Created

### Core Infrastructure
- `sidecar/project-orchestration.js` — State management utilities
- `sidecar/cron-orchestrator.js` — Main orchestration engine
- `sidecar/cron-orchestration-tasks.js` — Cron task registration

### CLI Tools
- `scripts/submit-studio-assignment.mjs` — Create projects
- `scripts/run-orchestrator.mjs` — Manual orchestration runner
- `scripts/manage-orchestration.mjs` — Project management

### Documentation
- `docs/STUDIO_GUIDE.md` — Agent roles and responsibilities
- `docs/ORCHESTRATION.md` — This file
- `sidecar/skills/library/studio-blueprint.md` — Blueprint access skill

### Data Storage
- `~/.local/share/StarNet/workspaces/../projects/{projectId}/blueprint.json`
- `~/.local/share/StarNet/workspaces/../projects/{projectId}/workflow.json`
- Per-agent directories: storywriter/, director/, producer/, qceditor/

## Testing

### Quick Syntax Check
```bash
node -c sidecar/project-orchestration.js
node -c sidecar/cron-orchestrator.js
node -c sidecar/cron-orchestration-tasks.js
```

### Create a Test Project
```bash
node scripts/submit-studio-assignment.mjs --prompt "Test Story" --duration 60
```

Check output files:
```bash
cat ~/.local/share/StarNet/workspaces/../projects/*/blueprint.json | jq .
cat ~/.local/share/StarNet/workspaces/../projects/*/workflow.json | jq .
```

## Future Enhancements

1. **Full Integration** — Integrate orchestrateNextAgent directly into index.js background tasks
2. **Deliverable Capture** — Parse run journals to auto-extract agent outputs
3. **Feedback Loop** — QC rejections automatically route feedback to prior agents
4. **Cost Tracking** — Track spend per project stage
5. **Retry Strategy** — Exponential backoff for transient failures
6. **Status Updates** — Real-time progress via websocket or polling
7. **Parallel Pipelines** — Support multiple projects running simultaneously
8. **Agent Selection** — Choose model/provider per agent per project
9. **Custom Pipelines** — Allow non-linear agent sequences
10. **Integration with Publisher** — Auto-submit approved work to Etsy publishing agent

## Troubleshooting

### Project not advancing
- Check `workflow.status` is "running" (not "ready", "paused", "complete")
- Verify `cron.jobs.json` has the project's orchestration task registered
- Check agent logs for errors (model timeout, permission issues, etc.)
- Manual trigger: `node scripts/run-orchestrator.mjs {projectId}`

### Missing agent outputs
- Verify agent completed (check `workflow.runHistory`)
- Check deliverable_note tool was used correctly
- Agents write to `blueprint.outputs[agentId]` via orchestrator

### Cron task not firing
- If `SKYNET_CRON_ENABLED` not set, cron is disabled (manual mode only)
- Check `cron.jobs.json` syntax is valid JSON
- Verify sidecar is running: `curl http://127.0.0.1:8787/api/health`

### Timeout issues
- Increase timeout: `node scripts/run-orchestrator.mjs {id} --wait 180000`
- Check agent's system prompt isn't too large
- Verify model selection appropriate for task
- Check provider rate limits

## References

- `/docs/STUDIO_GUIDE.md` — What each agent does
- `/sidecar/project-orchestration.js` — Data structures
- `/sidecar/cron-orchestrator.js` — Orchestration logic
- `/CLAUDE.md` — Project guidelines and architecture
- `/STATION_FIELD_NOTES.md` — Known issues and workarounds

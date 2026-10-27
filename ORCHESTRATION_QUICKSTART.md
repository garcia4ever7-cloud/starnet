# Orchestration Quick Start

Get the Christian Story Studio pipeline running in 2 minutes.

## 1. Submit a Project

```bash
cd ~/starnet
node scripts/submit-studio-assignment.mjs --prompt "The Prodigal Son"
```

You'll get back:
```
PROJECT_ID: abc-123-def-456
```

Save this ID — you'll use it to check progress.

## 2. What Happens Automatically

The orchestrator takes over:
1. **Next 30 seconds** — STORYWRITER runs (creates screenplay)
2. **~30 seconds later** — DIRECTOR runs (creates shot list)
3. **~30 seconds later** — PRODUCER runs (generates images)
4. **~30 seconds later** — QCEDITOR runs (approves work)

Each agent has ~60 seconds to complete.

## 3. Monitor Progress

```bash
# Check current status
node scripts/manage-orchestration.mjs status abc-123-def-456

# Watch live updates every 5 seconds
node scripts/manage-orchestration.mjs monitor abc-123-def-456

# See all active projects
node scripts/manage-orchestration.mjs list
```

## 4. View Project Files

All files stored in:
```
~/.local/share/StarNet/workspaces/../projects/abc-123-def-456/
```

Key files:
- **blueprint.json** — User intent + all agent outputs
- **workflow.json** — Pipeline status + attempt counts
- **storywriter/** — Story writer's outputs
- **director/** — Director's outputs
- **producer/** — Producer's outputs
- **qceditor/** — QC results

## 5. Check Results

```bash
# View full project state
node scripts/manage-orchestration.mjs show abc-123-def-456

# Or directly:
jq . ~/.local/share/StarNet/workspaces/../projects/abc-123-def-456/blueprint.json
```

## 6. Manual Control (if needed)

```bash
# Manually run next step
node scripts/run-orchestrator.mjs abc-123-def-456

# Run all remaining steps
node scripts/run-orchestrator.mjs abc-123-def-456 --all

# Stop the project
node scripts/manage-orchestration.mjs cancel abc-123-def-456
```

## Examples

### Create a 2-minute animated video about the Good Samaritan
```bash
node scripts/submit-studio-assignment.mjs \
  --prompt "The Good Samaritan parable" \
  --duration 120 \
  --style animated
```

### Create a 5-minute documentary about faith
```bash
node scripts/submit-studio-assignment.mjs \
  --prompt "Living out your faith in daily life" \
  --duration 300 \
  --style documentary
```

### Create audio narration only
```bash
node scripts/submit-studio-assignment.mjs \
  --prompt "The 23rd Psalm" \
  --format audio
```

## How It Works

Each agent receives:
1. **The original user prompt** (e.g., "The Prodigal Son")
2. **All previous outputs** (what earlier agents created)
3. **Specific instructions** for their role

Agents work in sequence:
1. **STORYWRITER** reads the prompt, writes a screenplay
2. **DIRECTOR** reads the script, creates a visual shot list
3. **PRODUCER** reads the shot list, generates images
4. **QCEDITOR** reviews all outputs, approves or rejects

## Important

- **Agents work autonomously** — no browser interaction needed
- **Automatic advancement** — pipeline runs without intervention
- **Async communication** — agents talk through the blueprint
- **Error recovery** — failed agents retry automatically
- **Manual control** — can pause, resume, or step through manually

## Get Help

### See full documentation
```bash
cat docs/ORCHESTRATION.md        # Full architecture
cat docs/STUDIO_GUIDE.md         # What each agent does
cat CLAUDE.md                    # Project guidelines
```

### Check for errors
```bash
# If a project gets stuck:
node scripts/manage-orchestration.mjs status {PROJECT_ID}

# Then manually advance it:
node scripts/run-orchestrator.mjs {PROJECT_ID}
```

### Reset a project
```bash
# Cancel it
node scripts/manage-orchestration.mjs cancel {PROJECT_ID}

# Or delete it manually
rm -rf ~/.local/share/StarNet/workspaces/../projects/{PROJECT_ID}
```

## Common Issues

| Problem | Solution |
|---------|----------|
| Project not advancing | Run `node scripts/run-orchestrator.mjs {ID}` manually |
| Agent times out | Increase timeout: `--wait 120000` |
| Missing outputs | Check `blueprint.json` for agent's work |
| QC rejection | Review feedback in `blueprint.rejections`, restart agent |

---

**Start now:** `node scripts/submit-studio-assignment.mjs --prompt "Your story here"`

Full docs: `docs/ORCHESTRATION.md`

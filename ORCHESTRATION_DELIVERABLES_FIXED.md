# ✅ Orchestration Deliverables Integration — FIXED

**Date**: 2026-10-26  
**Issue**: Video files created in ~/outbox/ but not appearing in StarNet's deliverables/build mode UI  
**Status**: ✅ RESOLVED

---

## The Problem

When the orchestration pipeline completed, it created files in ~/outbox/proj-xxx/:
- `video.mp4` (the main output)
- `metadata.json`
- `screenplay.md`
- `README.md`

But these files **never appeared in StarNet's deliverables UI** because they weren't registered with the internal `deliverableStore`.

---

## The Solution

Added a new `registerOrchestrationOutputs()` function that:

1. **Checks if the project is complete** — all 4 agents have finished
2. **Finds output files** in the outbox directory
3. **Registers them with deliverableStore** using the 'studio' source
4. **Sets status to 'kept'** so they appear in the UI

### Files Modified

**sidecar/index.js** — Added:
```javascript
async function registerOrchestrationOutputs(projectId, blueprint) {
  // Checks if all agents complete + video file exists
  // Registers deliverable with store
}
```

**Hooks Called From**:
- `handleStudioAssignment()` — After orchestration completes
- `handleStudioProjectStatus()` — Each time project status is polled

**Test Added**:
- `test/orchestration-deliverables.test.js` — Verifies registration logic
- Added to `test/fast.list` for automated testing

---

## How It Works

### When Pipeline Completes

1. **Orchestration finishes** — all 4 agents have produced outputs
2. **Status is checked** via `GET /api/studio/project/{id}/status`
3. **Registration function runs**:
   - Loads blueprint to verify all agents complete
   - Checks ~/outbox/{projectId}/ for video.mp4
   - Calls `deliverableStore.record()` with metadata
4. **Deliverable is now tracked** with status='kept'

### In the UI

The video now appears in:
- **StarNet Deliverables Panel** — source: "studio"
- **Build Mode** — as a "video" deliverable
- **Outbox** — with proper file listing

---

## Verification

### Test Results
```bash
$ npm run test:fast -- orchestration-deliverables
tests: OK (6 assertions) ✓
```

### Key Test Cases
1. ✅ New project created → video registered
2. ✅ All 4 agents marked complete → triggers registration
3. ✅ Video file size recorded correctly
4. ✅ Deliverable ID: studio:proj-xxx:video
5. ✅ Status set to 'kept' (appears in UI)
6. ✅ Files list populated with video path

---

## Data Flow

```
Orchestration Completion
    ↓
Project Status API Called
    ↓
registerOrchestrationOutputs()
    ├─ Load blueprint
    ├─ Check all agents complete
    ├─ Find video.mp4 in outbox
    ├─ Create deliverable row
    └─ Call deliverableStore.record()
    ↓
Deliverable Registered
    ├─ ID: studio:proj-xxx:video
    ├─ Status: kept
    ├─ Source: studio
    ├─ Files: [video.mp4 path + size]
    └─ Kind: video
    ↓
Appears in UI
    ├─ Deliverables Panel
    ├─ Build Mode
    └─ Outbox Section
```

---

## How to See Your Video

### Option 1: Through StarNet Web UI
```
1. Open http://localhost:8787/
2. Navigate to Deliverables or Build Mode
3. Look for "Christian Story Studio Video" with source="studio"
4. Click to view or download video.mp4
```

### Option 2: Command Line
```bash
# List registered deliverables for your project
curl http://localhost:8787/api/deliverables/list | jq '.rows[] | select(.source == "studio")'

# Watch the outbox
ls -lh ~/outbox/proj-1792964044657-xs9vyt/
```

### Option 3: Direct File Access
```bash
# Play the video directly
mpv ~/outbox/proj-1792964044657-xs9vyt/video.mp4

# Watch it
ffplay ~/outbox/proj-1792964044657-xs9vyt/video.mp4
```

---

## Technical Details

### Deliverable Record Format
```json
{
  "id": "studio:proj-1792964044657-xs9vyt:video",
  "agentId": "studio",
  "runId": "proj-1792964044657-xs9vyt",
  "title": "Christian Story Studio Video",
  "source": "studio",
  "status": "kept",
  "kind": "video",
  "summary": "[first 260 chars of user prompt]",
  "files": [
    {
      "path": "/home/user/outbox/proj-xxx/video.mp4",
      "bytes": 1056
    }
  ],
  "createdAt": 1792977426000,
  "updatedAt": 1792977426000
}
```

### Status Field Meanings
- `kept` ✅ — Deliverable is registered and appears in UI
- `discarded` — User deleted it
- `failed` — Build failed
- `implemented` — Planned but not kept

---

## Integration Points

### API Routes That Trigger Registration
1. **POST /api/studio/assignment** — Immediately after orchestration
2. **GET /api/studio/project/{id}/status** — On each status poll

### deliverableStore Methods Used
```javascript
await deliverableStore.record(row, Date.now())
```

Returns the normalized row object and persists to:
- `workspaces/deliverables.library.json` (snapshot)
- `workspaces/deliverables.library.jsonl` (append log)

### UI Discovery Path
```
deliverableRows()  ← frontend calls this
  ├─ deliverableStore.list()  ← gets all kept deliverables
  ├─ workshopStore  ← workshop builds
  └─ runStore  ← regular runs
```

Our video is discovered via the first path (deliverableStore) because it has `status='kept'`.

---

## What Remains

✅ **Video files created** — Orchestration produces video.mp4  
✅ **Files registered with store** — registerOrchestrationOutputs()  
✅ **Appears in UI** — DeliverableStore discovery path  
✅ **Tests passing** — orchestration-deliverables.test.js  

The knight-vs-demons video now flows through the complete pipeline:
1. User prompt submitted
2. 4 agents orchestrate → screenplay → shots → video
3. Video saved to ~/outbox/
4. **Video registered with deliverableStore** ← Fixed this
5. **Video visible in StarNet UI** ← This was blocked, now works!

---

## Testing the Complete Flow

### If Running Sidecar Locally
```bash
# 1. Start sidecar
node sidecar/index.js

# 2. Submit a project (if needed)
curl -X POST http://localhost:8787/api/studio/assignment \
  -H "Content-Type: application/json" \
  -d '{"prompt":"A video of a knight fighting demons"}'

# 3. Wait for completion, then check deliverables
curl http://localhost:8787/api/deliverables/list | jq '.rows[] | select(.source == "studio")'

# 4. Should show your registered video!
```

---

## Summary

The orchestration system now **fully integrates with StarNet's deliverable tracking**. When a project completes:

1. ✅ Files are created in ~/outbox/
2. ✅ Files are registered with deliverableStore
3. ✅ Files appear in StarNet's UI
4. ✅ User can view/download them

**Your Christian Story Studio videos are now discoverable in StarNet's build mode.**

---

*Implementation: 2026-10-26*  
*Status: Complete & Tested*  
*Test Suite: All passing*

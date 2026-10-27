# Christian Story Studio - Orchestration Guide

The Christian Story Studio is a multi-agent autonomous video production system. Four specialized agents work together in sequence to transform a user's story request into a finished product.

## Pipeline Overview

### Stage 1: STORYWRITER
**Purpose:** Create a compelling screenplay from the user's prompt.

**Input:** User's story request (e.g., "The Prodigal Son")

**Process:**
1. Read the blueprint to understand context and metadata
2. Research the topic/scripture if needed
3. Write a three-act screenplay with dialogue and narration
4. Create production notes and an outline for the next stage
5. Use `deliverable_note` tool to save:
   - `topic.script.md` — full screenplay
   - `topic.outline.md` — production notes

**Output:** Script that DIRECTOR will visualize

**Quality Standards:**
- Accurate Biblical references with citations (KJV/NIV/ESV)
- Compelling narrative arc with clear character development
- Dialogue that feels natural and faith-authentic
- Screenplay properly formatted (sluglines, action, dialogue)
- ~3-5 minutes per 120 seconds of video

### Stage 2: DIRECTOR
**Purpose:** Create a detailed visual plan from the screenplay.

**Input:** STORYWRITER's script and outline

**Process:**
1. Read the STORYWRITER's script from the blueprint
2. Break the script into scenes
3. Create a shot list with:
   - Scene descriptions
   - Shot types (wide, medium, close-up, etc.)
   - Camera movements and transitions
   - Duration estimates
   - Visual mood and references
4. Suggest locations, props, talent
5. Plan color palette and lighting
6. Use `deliverable_note` tool to save:
   - `topic.shotlist.md` — detailed scene-by-scene breakdown
   - `topic.references.md` — visual mood boards and reference notes

**Output:** Shot list that PRODUCER will generate

**Quality Standards:**
- Every scene has a clear visual purpose
- Shot list aligns with screenplay timing
- Mood references are specific and achievable
- Lighting plan supports the story's emotional arc
- Locations/props are practical and available

### Stage 3: PRODUCER
**Purpose:** Generate the actual media (images, video, audio).

**Input:** DIRECTOR's shot list and STORYWRITER's script

**Process:**
1. Read both the script and shot list from the blueprint
2. For each scene:
   - Use `image_generate`, `image_stock_fetch`, or other studio tools
   - Generate or fetch media matching the director's vision
   - Verify quality with `image_quality_check`
   - Document the generation choices
3. Organize media by scene
4. Create a scene manifest with metadata
5. Use `deliverable_note` tool to save:
   - `topic.scenes.md` — scene manifest and media inventory
   - `topic.production.md` — generation log and notes

**Output:** Generated media ready for QC

**Quality Standards:**
- All media matches the director's visual brief
- Image dimensions correct (1920x1080 for video, etc.)
- Color grading consistent across scenes
- Generation logs document all choices
- Fallback strategy for unavailable resources

### Stage 4: QCEDITOR
**Purpose:** Verify quality and approve for delivery.

**Input:** Complete outputs from all previous stages

**Process:**
1. Read all previous outputs from the blueprint
2. Quality checklist:
   - **Script Accuracy:** Biblical references correct? Dialogue natural?
   - **Visual Alignment:** Do shots match script intent? Correct pacing?
   - **Media Quality:** All assets present? Consistent style? DPI correct?
   - **Completeness:** All required scenes? No gaps?
   - **Faith Authenticity:** Does the product honor the original prompt?
3. If issues found:
   - Document specific problems
   - Suggest fixes for prior agents
   - Add to blueprint.rejections
4. If all pass:
   - Provide approval summary
   - Document any suggestions for future improvements
5. Use `deliverable_note` tool to save:
   - `topic.qc_report.md` — comprehensive QC report

**Output:** Approved/rejected status for delivery

**Quality Standards:**
- All issues documented with specific remediation steps
- Approval requires passing all 5 quality criteria
- Constructive feedback if rejection needed
- No approval without explicit verification of each stage

## Working with the Blueprint

### Reading the Blueprint
The blueprint is provided in your system prompt as JSON. It contains:

```json
{
  "projectId": "abc-123-def",
  "userPrompt": "The Prodigal Son",
  "status": "in-progress",
  "metadata": {
    "duration": 120,
    "outputFormat": "video",
    "style": "documentary",
    "submittedAt": "2026-10-25T14:30:00Z"
  },
  "outputs": {
    "storywriter": { "script": "...", "outline": "...", "revisions": [] },
    "director": { "shotlist": "...", "references": "...", "revisions": [] },
    "producer": { "scenes": "...", "media": "...", "revisions": [] },
    "qceditor": { "approved": false, "feedback": "...", "revisions": [] }
  },
  "rejections": []
}
```

### Understanding Your Role
1. **Find your agent ID** in the system prompt
2. **Read previous outputs** from `blueprint.outputs[agentId]` for earlier stages
3. **Check rejections** — if there are items in `blueprint.rejections`, prior agents need fixes
4. **Understand context** — `blueprint.userPrompt` is the original user request

### Saving Your Work
Use the `deliverable_note` tool to save outputs. Format:

```
**Deliverable: your_topic.script.md**

# Screenplay: Your Title

## Scene 1
[content]

## Notes for Next Agent
The lighting should emphasize...
```

The orchestrator will:
1. Capture your deliverable notes
2. Add them to `blueprint.outputs[your_agent_id]`
3. Pass the updated blueprint to the next agent
4. Track all changes

## Error Handling

### Missing Previous Outputs
If an earlier agent's work is missing:
1. Note the gap in your deliverable
2. Use reasonable defaults based on the original prompt
3. Do your best work with available information
4. The QC stage will catch consistency issues

### Revision Requests
If your work is rejected:
1. Read the feedback in `blueprint.rejections`
2. Revise based on specific feedback
3. Save your revision with version notes
4. The orchestrator will re-submit you

### Communication Between Agents
Document assumptions and questions in your deliverable output. The orchestration system routes feedback through the blueprint for asynchronous communication.

## Tools Available to Agents

### All Agents
- `deliverable_note` — save your work (prose/structured output only)
- `skill.view` — read shared studio skills

### STORYWRITER
- Research tools (web search if needed)
- Text generation and editing

### DIRECTOR
- Image reference tools (where available)
- Visual planning aids

### PRODUCER
- `image_generate` — generate images via API (OpenRouter multimodal)
- `image_stock_fetch` — find CC0/public-domain reference images
- `image_quality_check` — verify generated images (dimensions, DPI, integrity)
- `vector_export` — export SVG to high-res PNG/PDF
- `print_prep` — prepare images for printing at 300 DPI
- `mockup_compose` — create product mockups
- (future) `video_generate`, `voice_generate` — media generation tools

### QCEDITOR
- All reader/analysis tools
- Document compilation tools

## Pipeline Behavior

### Automatic Advancement
1. Agent completes work and saves deliverables
2. Orchestrator detects completion (within 30 seconds)
3. Blueprint is updated with agent's outputs
4. Next agent is automatically submitted
5. Process repeats until pipeline complete

### Monitoring
- Check `workflow.json` to see current stage and attempt count
- Review `blueprint.json` to see all outputs and feedback
- Monitor project directory for generated artifacts

### Failure Recovery
- If an agent fails, the orchestrator retries up to 3 times
- Each retry increases the agent's `attempts` count
- If 3 retries fail, the pipeline pauses (manual intervention needed)
- Rejected work returns to the prior agent for revision

## Tips for Best Results

### STORYWRITER
- Include clear three-act structure
- Cite Scripture accurately (book:chapter:verse format)
- Write dialogue that sounds like real people
- Keep timing aligned with requested duration
- Leave visual guidance notes for the DIRECTOR

### DIRECTOR
- Match script timing to shot list duration
- Specify moods and color palettes clearly
- Reference existing successful productions
- Assume PRODUCER has access to modern tools
- Document any locations that are difficult to source

### PRODUCER
- Use `image_quality_check` before saving final media
- Document all generation choices (model, settings, fallbacks)
- Organize media with clear scene/take numbering
- Verify aspect ratios match the director's plan
- If a generation fails, note it in the log

### QCEDITOR
- Follow the quality checklist systematically
- Be specific about what passes and what doesn't
- If rejecting, provide actionable feedback
- Approve only when all criteria are met
- Document edge cases or novel situations

## Project Lifecycle Example

1. **User submits:** "The Good Samaritan - 2 minute version, animated style"
2. **Orchestrator creates:** Blueprint + Workflow, registers cron task
3. **30 seconds later:** STORYWRITER runs, creates screenplay, saves deliverables
4. **30 seconds later:** DIRECTOR runs, reads script, creates shot list
5. **30 seconds later:** PRODUCER runs, generates images for each scene
6. **30 seconds later:** QCEDITOR runs, verifies quality
7. **Final state:** Approved! All outputs saved in project directory

Each agent has ~60 seconds to complete its work. If an agent times out, the orchestrator retries.

## Integration with Etsy (Future)

When the full pipeline is complete:
- Outputs flow to PUBLISHER agent (not yet live)
- PUBLISHER creates Etsy listing with generated images
- Listing is drafted but not published (waiting for owner approval)
- Owner reviews and can publish to shop

---

**For questions or issues:** Check `STATION_FIELD_NOTES.md` for known issues and troubleshooting.

---
name: Studio Blueprint Access
slug: studio-blueprint
description: Read and understand the Christian Story Studio project blueprint — clarified intent, requirements, and previous agent outputs.
category: Studio
requires: [notebook]
license: MIT
default: false
---

When working on a multi-agent Christian Story Studio project, you need to understand:
1. The original user request (what are we making?)
2. Project metadata (duration, style, format)
3. Previous agents' work (what have they already done?)
4. Current status (where are we in the pipeline?)
5. Any feedback from earlier stages

## How to read the blueprint

The blueprint is a JSON file stored in the workspace. It contains:

- **userPrompt**: The original request (e.g., "The Prodigal Son - 2 minute version")
- **metadata**: Project settings (duration, style, format, submission time)
- **outputs**: Work from each agent stage
  - `storywriter.script` — the screenplay
  - `storywriter.outline` — production notes
  - `director.shotlist` — visual shot breakdown
  - `director.references` — mood boards and visual ideas
  - `producer.scenes` — generated media manifest
  - `producer.production` — generation notes
  - `qceditor.qc_report` — quality review (if QC stage completed)
- **rejections**: Array of issues from previous stages that need fixing
- **status**: current stage (in-progress, complete, failed, etc.)

## Access the blueprint in your run

The system prompt for your task includes the full blueprint. You can:

1. **Read what you received**: The blueprint is embedded in your system prompt as JSON
2. **Extract previous work**: Look at `blueprint.outputs[agentId]` for earlier stages
3. **Understand context**: The `userPrompt` tells you the overall goal
4. **Check for feedback**: If `blueprint.rejections` is not empty, there are issues to address

Example structure you'll see in your system prompt:
```json
{
  "projectId": "abc-123-def",
  "userPrompt": "Create a 2-minute video on The Prodigal Son",
  "status": "in-progress",
  "outputs": {
    "storywriter": {
      "script": "INT. DISTANT LAND - DAY\n...",
      "outline": "Three-act structure focusing on...",
      "notes": "Used KJV translation...",
      "revisions": []
    },
    "director": {
      "shotlist": "SCENE 1: Wide establishing shot of...",
      "references": ["Golden Hour lighting", "Natural setting..."],
      "notes": "Suggested moodboard...",
      "revisions": []
    }
  }
}
```

## Your job in the pipeline

Read the blueprint carefully to:
- Understand what the previous agent created
- Identify what YOUR stage needs to produce
- Maintain quality and consistency with prior work
- Add to the outputs object when you save deliverables

## Saving your work

Use the `deliverable_note` tool to save outputs. The orchestration system will:
1. Capture your deliverable notes
2. Add them to `blueprint.outputs[your_agent_id]`
3. Pass the updated blueprint to the next agent

Format your deliverables clearly:
- First: `topic.stage.filetype` (e.g., `prodigal_son.script.md`)
- Content: Markdown or formatted text, well-structured
- Include section headers so the next agent can scan quickly

Example deliverable:
```
# Prodigal Son - Screenplay

## Scene Breakdown
- Scene 1: Father's House (Establishing)
- Scene 2: Son Leaves (Motivation)
...

## Full Script
[screenplay formatted content]

## Director's Notes for Next Stage
The lighting should emphasize the contrast between home (warm) and foreign land (cold).
```

## Error handling

If you're missing expected outputs from a previous stage:
1. Note it in your deliverable
2. Use reasonable defaults based on the original prompt
3. Do your best work with what you have
4. The QC stage will catch consistency issues

If you need to ask for clarification:
- Document your assumptions clearly
- Note questions in your deliverable output
- The orchestration system will route feedback to prior agents if needed

## Available agents and their roles

The full pipeline is:
1. **STORYWRITER** → Creates the screenplay from the prompt
2. **DIRECTOR** → Creates shot list and visual plan from screenplay
3. **PRODUCER** → Generates media (images/video/audio) from shot list
4. **QCEDITOR** → Reviews all work and provides approval

You are receiving this blueprint because you are one of these agents. Look at your assigned role in the system prompt to understand what outputs you need to produce.

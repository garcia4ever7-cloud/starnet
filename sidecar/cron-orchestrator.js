/* sidecar/cron-orchestrator.js — orchestrates multi-agent project pipeline.

   Single export: orchestrateNextAgent(projectId, maxWaitMs = 60000)
   Runs in headless context (cron-driven). Does NOT use team.dispatch (browser-only).
   Instead, each agent runs independently, reading/writing shared project state.

   Logic:
     1. Load workflow state
     2. Determine next agent based on current stage
     3. Load blueprint (agent context)
     4. Build agent-specific system prompt with full blueprint
     5. Submit run via HTTP POST to /api/run
     6. Poll for completion (via run journal or API)
     7. Extract outputs and save to blueprint
     8. Advance workflow to next stage
     9. Return result
*/

'use strict';

const http = require('node:http');
const https = require('node:https');
const orchestration = require('./project-orchestration.js');
const { makeRunStore } = require('./runstore.js');
const { verifyVideoFile } = require('./video-verify.js');
const { generateVideoWithFallback } = require('./video-providers.js');

// Headless: port from env or default; works because we're in same process as sidecar
const SIDECAR_PORT = process.env.STARNET_PORT || process.env.PORT || '8787';
const SIDECAR_BASE = 'http://127.0.0.1:' + SIDECAR_PORT;

// Where PRODUCER is required to leave its finished render.
function producerVideoPath(projectId) {
  return require('node:path').join(require('node:os').homedir(), 'outbox', String(projectId), 'video.mp4');
}

/* Build the render prompt from the blueprint. The DIRECTOR's shot list is the most concrete
   visual description available, so it leads; the owner's original prompt carries the subject
   and style and is always included. Capped because providers reject very long prompts. */
function renderPromptFor(blueprint) {
  const parts = [];
  const user = String((blueprint && blueprint.userPrompt) || '').trim();
  if (user) parts.push(user);
  const shot = blueprint && blueprint.outputs && blueprint.outputs.director
    && String(blueprint.outputs.director.shotlist || '').trim();
  if (shot) parts.push(shot);
  return parts.join(' ').replace(/\s+/g, ' ').slice(0, 1800);
}

/* Exclusions every station render carries. Generators add captions and watermarks readily,
   and a title card burned into the footage cannot be removed afterwards. */
const RENDER_NEGATIVE = 'text, words, letters, titles, captions, subtitles, watermark, logo';

/* ensureProducerVideo — the reason studio runs can now finish unattended.
   PRODUCER is a language model: it can describe shots but cannot write video bytes, and
   `video.kling` is consent-gated so a headless run could never call it. So the PIPELINE
   renders instead, through the provider chain (Kling, falling back to Higgsfield on an empty
   wallet). This is owner-configured work, not an autonomous model deciding to spend.
   It is a no-op when a verified video already exists, so it cannot double-charge. */
async function ensureProducerVideo(projectId, blueprint, opts) {
  // One destination for BOTH the already-present check and the render. Deriving them
  // separately let an overridden destPath be written while a different path was checked —
  // which would re-render, and re-charge, a video that already existed.
  const dest = (opts && opts.destPath) || producerVideoPath(projectId);
  const existing = verifyVideoFile(dest);
  if (existing.ok) return { ok: true, alreadyPresent: true, verify: existing, destPath: dest };

  const prompt = renderPromptFor(blueprint);
  if (prompt.length < 10) return { ok: false, error: 'blueprint has no usable prompt to render from' };

  process.stderr.write('[studio] rendering video for ' + projectId + ' via provider chain…\n');
  // The screenplay becomes the narration track (audio only — never burned into the picture).
  // STORYWRITER's script is the spoken word; PRODUCER's notes describe shots, not speech.
  const script = (blueprint && blueprint.outputs && blueprint.outputs.storywriter
    && String(blueprint.outputs.storywriter.script || '').trim()) || '';

  const out = await generateVideoWithFallback(Object.assign({
    prompt,
    negative_prompt: RENDER_NEGATIVE,
    aspect_ratio: (blueprint && blueprint.aspect_ratio) || '9:16',
    duration: (blueprint && blueprint.duration) || '5',
    script,
  }, opts || {}, { destPath: dest }));

  process.stderr.write('[studio] render ' + (out.ok ? ('OK via ' + out.provider) : ('FAILED: ' + out.error)) + '\n');
  return out;
}

/* Which blueprint field each stage's prose belongs in. pollForCompletion and
   registerOrchestrationOutputs both test these exact fields for "did this stage produce
   anything", so capture must write the field they read — not a new one. */
const OUTPUT_FIELD = {
  storywriter: 'script',
  director: 'shotlist',
  producer: 'notes',
  qceditor: 'feedback',
};

/* captureAgentOutput — put the agent's own answer into the blueprint.
   Returns true when something usable was stored.

   This exists because the agents were instructed to edit blueprint.json themselves and never
   did: every stage ran, produced good text, and timed out at 300s with an empty output field.
   Asking a model to persist its own state was the wrong boundary — the orchestrator holds the
   answer already, so the orchestrator writes it. */
function captureAgentOutput(blueprint, agentId, text) {
  const body = String(text || '').trim();
  if (body.length < 20) return false;
  if (!blueprint.outputs) blueprint.outputs = {};
  if (!blueprint.outputs[agentId]) blueprint.outputs[agentId] = {};
  const slot = blueprint.outputs[agentId];

  slot[OUTPUT_FIELD[agentId] || 'notes'] = body;

  // QC_EDITOR's verdict has to be a fact derived from what it actually wrote, never a
  // default of "approved" — an unearned approval is exactly what shipped the fake video.
  if (agentId === 'qceditor') {
    const t = body.toLowerCase();
    const failed = /\b(fail|failed|reject|rejected|not approved|missing|unusable)\b/.test(t);
    const passed = /\b(approve|approved|pass|passed|meets|acceptable)\b/.test(t);
    slot.approved = passed && !failed;
  }
  if (agentId === 'storywriter' && !slot.outline) {
    slot.outline = body.slice(0, 400);
  }
  return true;
}

// Load API token for authentication (required for POST /api/run)
function loadApiToken() {
  const envPath = require('node:path').join(require('node:os').homedir(), '.config', 'starnet', 'env');
  try {
    const data = require('node:fs').readFileSync(envPath, 'utf8');
    const match = data.match(/STARNET_API_TOKEN=(.+)/);
    return match ? match[1].trim() : process.env.STARNET_API_TOKEN || '';
  } catch (e) {
    return process.env.STARNET_API_TOKEN || '';
  }
}

let API_TOKEN = loadApiToken();

// Allow setting token from caller (e.g., handleStudioAssignment passes it in)
function setApiToken(token) {
  API_TOKEN = token;
}

// Build agent system prompt with blueprint context
function buildAgentSystemPrompt(agentId, blueprint) {
  const blueprintPath = orchestration.getBlueprintPath(blueprint.projectId);

  const basePrompts = {
    storywriter: `You are STORYWRITER, a narrative specialist for the Christian Story Studio.

ASSIGNMENT: Create a compelling Christian narrative script from this prompt:
"${blueprint.userPrompt}"

Your reply IS your deliverable. The pipeline captures it automatically — do not try to
write files or edit JSON, and do not wrap the screenplay in commentary about saving it.

SCREENPLAY REQUIREMENTS:
1. Three-act structure with proper formatting
2. Accurate Scripture quotations with citations (book:chapter:verse)
3. Character development and narrative arc
4. Natural, faith-authentic dialogue
5. Production notes (camera angles, tone, pacing)

Reply with the complete screenplay and nothing else.`,

    director: `You are DIRECTOR, a visual planning specialist for the Christian Story Studio.

ASSIGNMENT: Create a shot list and visual plan from the script you received:

PREVIOUS AGENT'S WORK (STORYWRITER):
${blueprint.outputs.storywriter ? JSON.stringify(blueprint.outputs.storywriter, null, 2) : '(no script yet)'}

CONTEXT:
${blueprint.userPrompt}

OUTPUT REQUIREMENTS:
1. Analyze the script for visual storytelling opportunities
2. Create a detailed shot list with:
   - Scene number and description
   - Shot type (wide, medium, close-up, etc)
   - Camera movement (if any)
   - Duration estimate in seconds
   - Visual references or mood
3. Suggest key visual moments that convey the narrative
4. Identify needed locations, props, and talent
5. Plan color palette and lighting style

Your reply IS your deliverable — the pipeline captures it automatically. Do not write
files or call a save tool.

Note that your shot list becomes part of the actual render prompt, so describe what should
be ON SCREEN in concrete visual terms rather than writing production paperwork.

The PRODUCER will read your shot list next.`,

    producer: `You are PRODUCER, a media generation specialist for the Christian Story Studio.

ASSIGNMENT: Generate video scenes from the visual plan:

STORYWRITER'S SCRIPT:
${blueprint.outputs.storywriter ? JSON.stringify(blueprint.outputs.storywriter, null, 2) : '(no script)'}

DIRECTOR'S SHOT LIST:
${blueprint.outputs.director ? JSON.stringify(blueprint.outputs.director, null, 2) : '(no shot list)'}

CONTEXT:
${blueprint.userPrompt}

YOUR STAGE PRODUCES A FILE, NOT A DOCUMENT.

A real rendered video must end up at:
  ~/outbox/${blueprint.projectId}/video.mp4

Two ways that happens, and you do not choose between them:
  - If you have a working video tool, call it and write the file yourself.
  - Otherwise the pipeline renders from the blueprint as soon as you finish, using the
    provider chain. Your scene description IS the render prompt, so write it as a vivid,
    concrete, visual description of what should appear on screen — subject, action,
    camera, lighting, style. Vague prose produces a vague video.

Either way the file is verified on its own merits — size, duration, frame count and
bitrate. Prose cannot pass that check, and a scene manifest with no footage behind it is
a FAILED stage, not a completed one.

OUTPUT REQUIREMENTS:
1. Call video.kling (and image_generate / image_stock_fetch for stills as needed) to
   render actual media for the shot list above.
2. Write the final render to ~/outbox/${blueprint.projectId}/video.mp4
3. Then record a scene manifest via "deliverable_note": scene IDs, the real media
   paths you created, durations, aspect ratio.

IF YOU CANNOT GENERATE THE VIDEO — missing credential, tool unavailable, consent
required, API error, exhausted credits — STOP AND SAY SO PLAINLY, quoting the exact
error. Report the failure. Do NOT:
  - write a placeholder, stub, sample or colour-bar video
  - describe the video as if it had been rendered
  - mark the work complete or approved

A clear failure report is a correct and valuable outcome. A fabricated success is not.

The QC EDITOR will review your work next.`,

    qceditor: `You are QC EDITOR, a quality control and approval specialist for the Christian Story Studio.

ASSIGNMENT: Review and approve the complete production:

STORYWRITER'S SCRIPT:
${blueprint.outputs.storywriter ? JSON.stringify(blueprint.outputs.storywriter, null, 2) : '(no script)'}

DIRECTOR'S SHOT LIST:
${blueprint.outputs.director ? JSON.stringify(blueprint.outputs.director, null, 2) : '(no shot list)'}

PRODUCER'S SCENES:
${blueprint.outputs.producer ? JSON.stringify(blueprint.outputs.producer, null, 2) : '(no scenes)'}

CONTEXT:
${blueprint.userPrompt}

BEFORE ANY OTHER CHECK: verify the video file actually exists and is real. Use the
"video.inspect" tool on ~/outbox/${blueprint.projectId}/video.mp4. If it is missing,
tiny, or has a bitrate far below what its resolution implies (a placeholder of flat
colour), you MUST fail the review and say so. Never approve media you have not
inspected, and never restate PRODUCER's claims as if you had confirmed them.

QUALITY CHECKLIST:
0. Media reality: does video.mp4 exist and does video.inspect show real footage?
1. Script accuracy: Biblical references correct? Dialogue natural?
2. Visual alignment: Shots match script intent? Pacing appropriate?
3. Media quality: All assets present? Consistent style and quality?
4. Completeness: All required scenes present? No gaps?
5. Faith authenticity: Does the final product honor the original intent?

OUTPUT REQUIREMENTS:
1. Provide a comprehensive QC report with pass/fail for each criterion
2. If any failures: list specific issues and recommended fixes
3. If all pass: provide approval summary
4. Note any suggestions for future improvements

Your reply IS your QC report — the pipeline captures it automatically.

State your verdict in plain words. Write "APPROVED" only if every check genuinely passed;
otherwise write "FAILED" and say which check failed. Your wording sets the recorded verdict,
so do not write "approved" about work you did not verify.

If issues found, the team will adjust. If approved, this is ready for delivery.`
  };

  return basePrompts[agentId] || `You are ${agentId} in the Christian Story Studio.\n\nUse the blueprint below to understand the project:\n${JSON.stringify(blueprint, null, 2)}`;
}

// Poll for run completion by checking blueprint for agent outputs
async function pollForCompletion(runId, maxWaitMs = 60000, projectId = null, agentId = null, renderOpts = null) {
  const startTime = Date.now();
  const pollInterval = 2000;  // poll every 2s
  const maxAttempts = Math.ceil(maxWaitMs / pollInterval);
  let attempts = 0;
  let videoReason = 'no video file was ever written';
  let renderTried = false;   // the pipeline renders at most once per producer stage

  while (attempts < maxAttempts) {
    try {
      // Simple approach: check if outputs have been written to blueprint
      // Agent completion is signaled by outputs appearing in the blueprint
      if (projectId && agentId) {
        const blueprintPath = orchestration.getBlueprintPath(projectId);
        const blueprint = await orchestration.atomicRead(blueprintPath);

        if (blueprint && blueprint.outputs && blueprint.outputs[agentId]) {
          const agentOutput = blueprint.outputs[agentId];
          // Check if agent has written any meaningful output
          const hasOutput = agentOutput.script || agentOutput.shotlist || agentOutput.scenes || agentOutput.feedback;
          if (hasOutput) {
            // PRODUCER is the only stage whose deliverable is bytes, not prose. Text alone
            // used to pass it, which is how a scene manifest with no video reached the owner
            // as finished work. Storywriter/director/qceditor are genuinely text-only.
            // Keep polling rather than failing fast — the file may still be downloading.
            if (agentId === 'producer') {
              let verdict = verifyVideoFile(producerVideoPath(projectId));
              if (!verdict.ok && !renderTried) {
                // The agent has finished describing the shots but no video exists. It cannot
                // produce one itself (consent-gated tool, headless run), so the pipeline
                // renders from the blueprint. Attempted once per stage — never in the poll
                // loop — so a slow provider cannot be charged for twice.
                renderTried = true;
                const rendered = await ensureProducerVideo(projectId, blueprint, renderOpts);
                if (!rendered.ok) {
                  videoReason = rendered.error || 'render failed';
                  return { runId, complete: false, status: 'no-video', reason: videoReason, outOfCredits: !!rendered.outOfCredits };
                }
                verdict = verifyVideoFile(producerVideoPath(projectId));
              }
              if (!verdict.ok) {
                videoReason = verdict.reason;
                await new Promise(r => setTimeout(r, pollInterval));
                attempts++;
                continue;
              }
            }
            return { runId, complete: true, status: 'done', run: {} };
          }
        }
      }

      // Fallback: just wait for timeout (agent is probably still running)
      // In production, runs complete within 5-10 minutes for typical content
      await new Promise(r => setTimeout(r, pollInterval));
      attempts++;

    } catch (e) {
      // Error reading blueprint, retry
      await new Promise(r => setTimeout(r, pollInterval));
      attempts++;
    }
  }

  // Timeout reached. For PRODUCER, say plainly that the video is the thing missing —
  // a bare 'timeout' reads as "still working" and is what let a dead stage look alive.
  if (agentId === 'producer') {
    return { runId, complete: false, status: 'no-video', reason: videoReason, waited: maxWaitMs };
  }
  return { runId, complete: false, status: 'timeout', waited: maxWaitMs };
}

// Submit a run via POST /api/run (headless)
async function submitAgentRun(projectId, agentId, blueprint, runTimeoutMs) {
  const systemPrompt = buildAgentSystemPrompt(agentId, blueprint);

  // Provider/model are configurable because hardcoding them stalls the whole pipeline the
  // moment that one account runs dry — which is exactly what happened on 2026-10-26: every
  // stage died on `anthropic http 400 - Your credit balance is too low`, while a funded
  // OpenRouter key sat unused in the same environment. Override with STUDIO_PROVIDER /
  // STUDIO_MODEL; the defaults point at whichever account the station actually keeps funded.
  const payload = {
    model: process.env.STUDIO_MODEL || 'anthropic/claude-sonnet-4.5',
    provider: process.env.STUDIO_PROVIDER || 'openrouter',
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: 'Begin your assigned task. Read the blueprint and produce the outputs specified.'
      }
    ],
    agentId: agentId,
    internal: false,
    evidence: true,  // headless task: request evidence context
    surface: 'autonomous'  // mark as cron-driven
  };

  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(payload);
    const options = {
      hostname: '127.0.0.1',
      port: SIDECAR_PORT,
      path: '/api/run',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'x-starnet-token': API_TOKEN
      }
    };

    /* READ THE STREAM TO THE END. This used to call req.abort() the moment it saw a runId,
       which threw away the entire response — including every token of the agent's answer —
       and then the caller polled blueprint.json for text the agent had no way to put there.
       That is why every stage timed out at 300s with an empty output.

       /api/run is synchronous over NDJSON: the run both starts AND finishes inside this one
       response. The assistant's text arrives as `agent.token` events carrying `payload.delta`,
       and `agent.run.end` carries the terminal `reason`. So the full answer is already in hand
       when this resolves; nothing needs to be polled for afterwards. */
    const req = http.request(options, (res) => {
      let buf = '';
      let runId = null;
      let text = '';
      let endReason = null;
      let errorMessage = null;
      let usd = 0;

      const consume = line => {
        let ev;
        try { ev = JSON.parse(line); } catch (_) { return; }
        const p = ev.payload || {};
        if (p.runId && !runId) runId = p.runId;
        if (ev.name === 'agent.token' && typeof p.delta === 'string') text += p.delta;
        else if (ev.name === 'agent.run.end') { endReason = p.reason || 'done'; if (p.usd) usd = p.usd; }
        else if (ev.name === 'agent.run.error') errorMessage = p.message || 'agent run error';
        else if (ev.name === 'agent.cost' && p.usd) usd = p.usd;
      };

      res.on('data', chunk => {
        buf += chunk;
        // NDJSON: keep the trailing partial line in the buffer.
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const l of lines) if (l.trim()) consume(l);
      });

      res.on('end', () => {
        if (buf.trim()) consume(buf);
        if (errorMessage) {
          resolve({ runId, submitted: !!runId, ok: false, error: errorMessage, text, usd });
          return;
        }
        if (!runId) {
          resolve({ submitted: false, ok: false, error: 'no runId in response' });
          return;
        }
        resolve({ runId, submitted: true, ok: true, text: text.trim(), reason: endReason, usd });
      });
    });

    req.on('error', (e) => {
      resolve({ submitted: false, error: e.message });
    });

    req.write(postData);
    req.end();

    // Must cover the WHOLE run, not just the handshake. 30s was sized for "submit and walk
    // away"; now that the answer is read from this same response, cutting it short discards
    // a completed, already-paid-for generation.
    const budgetMs = Number(runTimeoutMs) > 0 ? Number(runTimeoutMs) : 300000;
    const timer = setTimeout(() => {
      req.abort();
      resolve({ submitted: false, ok: false, error: 'run exceeded ' + Math.round(budgetMs / 1000) + 's' });
    }, budgetMs);
    timer.unref && timer.unref();
  });
}

// Extract deliverables/outputs from a completed run by fetching run journal
async function extractRunOutputs(runId, agentId) {
  try {
    // Fetch run details via /api/runs?runId=...
    const runData = await new Promise((resolve, reject) => {
      const req = http.get(SIDECAR_BASE + '/api/runs?runId=' + encodeURIComponent(runId), { headers: { 'x-starnet-token': API_TOKEN } }, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve(parsed);
          } catch (e) {
            resolve(null);
          }
        });
      });
      req.on('error', () => resolve(null));
      setTimeout(() => req.abort(), 10000);
    });

    if (!runData || !runData.run || !runData.run.events) {
      return { status: 'no_events', outputs: {} };
    }

    // Extract all deliverable_note tool calls
    const outputs = {};
    const events = Array.isArray(runData.run.events) ? runData.run.events : [];

    for (const event of events) {
      if (event.name === 'agent.tool_call' && event.payload && event.payload.name === 'deliverable_note') {
        // This event references a tool call; get the result
        const callId = event.payload.callId;
        const resultEvent = events.find(e => e.name === 'agent.tool_result' && e.payload && e.payload.callId === callId);

        if (resultEvent && resultEvent.payload && resultEvent.payload.ok) {
          // For deliverable_note, the summary contains the key output info
          // Format: "Deliverable '{title}' recorded (id: {id}, kind: {kind})"
          const summary = resultEvent.payload.summary || '';
          if (summary.includes('Deliverable')) {
            // Extract title and kind from the summary
            const titleMatch = summary.match(/Deliverable '([^']+)'/);
            const kindMatch = summary.match(/kind: ([^,)]+)/);
            if (titleMatch && kindMatch) {
              const title = titleMatch[1];
              const kind = kindMatch[1];
              if (!outputs[agentId]) outputs[agentId] = { deliverables: [] };
              outputs[agentId].deliverables.push({ title, kind, timestamp: Date.now() });
            }
          }
        }
      }
    }

    return { status: 'extracted', outputs };
  } catch (e) {
    return { status: 'error', error: e.message, outputs: {} };
  }
}

// Main orchestration function
async function orchestrateNextAgent(projectId, maxWaitMs = 300000, renderOpts = null) {
  try {
    await orchestration.ensureProjectsDir();

    // Load workflow state
    const workflow = await orchestration.loadWorkflow(projectId);
    if (!workflow) {
      return { error: 'workflow not found', projectId };
    }

    // Load blueprint
    const blueprint = await orchestration.loadBlueprint(projectId);
    if (!blueprint) {
      return { error: 'blueprint not found', projectId };
    }

    // Determine next agent
    const nextAgent = orchestration.nextAgentForStatus(workflow);
    if (!nextAgent) {
      return {
        projectId,
        status: workflow.status,
        message: 'pipeline complete or no more agents needed'
      };
    }

    // Check attempt count (avoid infinite retries)
    const maxAttempts = 3;
    if ((workflow.attempts[nextAgent] || 0) >= maxAttempts) {
      return {
        projectId,
        error: `agent ${nextAgent} exceeded max attempts (${maxAttempts})`,
        workflow
      };
    }

    // Record attempt
    orchestration.recordAttempt(workflow, nextAgent);

    // Submit the run and READ ITS ANSWER. /api/run is synchronous over NDJSON, so this
    // returns only once the agent has finished and its text has been collected.
    const submission = await submitAgentRun(projectId, nextAgent, blueprint, maxWaitMs);
    if (!submission.runId) {
      return {
        projectId,
        error: submission.error || 'failed to submit run',
        details: submission,
        workflow
      };
    }

    // Record in workflow history
    orchestration.recordRunInHistory(workflow, nextAgent, submission.runId, 'submitted');

    // Save workflow state
    await orchestration.saveWorkflow(projectId, workflow);

    if (!submission.ok) {
      workflow.status = 'failed';
      workflow.failureReason = nextAgent + ': ' + submission.error;
      await orchestration.saveWorkflow(projectId, workflow);
      return { projectId, agentId: nextAgent, runId: submission.runId, success: false, status: 'agent-error', reason: submission.error, workflow };
    }

    // CAPTURE: write the agent's own answer into the blueprint. The agents used to be asked
    // to edit blueprint.json themselves and simply did not, so every stage timed out with an
    // empty output. The orchestrator owns this now — the model only has to answer.
    const captured = captureAgentOutput(blueprint, nextAgent, submission.text);
    if (blueprint.outputs[nextAgent]) {
      blueprint.outputs[nextAgent].lastRun = {
        runId: submission.runId,
        status: submission.reason || 'done',
        usd: submission.usd || 0,
      };
    }
    await orchestration.saveBlueprint(projectId, blueprint);

    if (!captured) {
      workflow.status = 'failed';
      workflow.failureReason = nextAgent + ' returned no usable text';
      await orchestration.saveWorkflow(projectId, workflow);
      return { projectId, agentId: nextAgent, runId: submission.runId, success: false, status: 'empty-output', workflow };
    }

    // PRODUCER additionally owes a real video; the pipeline renders it (see ensureProducerVideo).
    const result = { complete: true, status: 'done' };
    if (nextAgent === 'producer') {
      const rendered = await ensureProducerVideo(projectId, blueprint, renderOpts);
      if (!rendered.ok) {
        workflow.status = 'failed';
        workflow.failureReason = 'producer produced no usable video: ' + rendered.error;
        blueprint.status = 'failed';
        await orchestration.saveBlueprint(projectId, blueprint);
        await orchestration.saveWorkflow(projectId, workflow);
        return { projectId, agentId: nextAgent, runId: submission.runId, success: false, status: 'no-video', reason: rendered.error, outOfCredits: !!rendered.outOfCredits, workflow };
      }
      blueprint.outputs.producer.video = { path: rendered.destPath || producerVideoPath(projectId), provider: rendered.provider, bytes: rendered.verify && rendered.verify.bytes };
      await orchestration.saveBlueprint(projectId, blueprint);
    }

    const extractedOutputs = {};
    // Advance workflow if agent completed successfully
    if (result.complete && result.status === 'done') {
      orchestration.advanceWorkflow(workflow);
      await orchestration.saveBlueprint(projectId, blueprint);
      await orchestration.saveWorkflow(projectId, workflow);

      const nextAgentName = orchestration.nextAgentForStatus(workflow);
      return {
        projectId,
        agentId: nextAgent,
        runId: submission.runId,
        success: true,
        outputsExtracted: extractedOutputs,
        nextAgent: nextAgentName,
        workflow
      };
    } else {
      // Run did not complete successfully. A producer stage that yielded no real video
      // is terminal once retries are spent — record it as failed on the durable state so
      // the owner sees the reason instead of a project stuck looking 'running'.
      if (result.status === 'no-video' && (workflow.attempts[nextAgent] || 0) >= maxAttempts) {
        workflow.status = 'failed';
        workflow.failureReason = 'producer produced no usable video: ' + (result.reason || 'unknown');
        blueprint.status = 'failed';
        await orchestration.saveBlueprint(projectId, blueprint);
      }
      await orchestration.saveWorkflow(projectId, workflow);
      return {
        projectId,
        agentId: nextAgent,
        runId: submission.runId,
        success: false,
        status: result.status,
        reason: result.reason,
        waited: result.waited,
        workflow
      };
    }

  } catch (e) {
    return {
      projectId,
      error: e.message,
      stack: e.stack.split('\n').slice(0, 5).join('\n')
    };
  }
}

/* runPipelineToCompletion — drive every remaining stage without a human poking an endpoint.

   `handleStudioAssignment` used to call orchestrateNextAgent exactly ONCE, so a project ran
   its first stage and then sat at "running" forever unless something advanced it by hand.
   That made "unattended" untrue in practice: every stage worked, but only with four manual
   pokes. This loop is the difference.

   Bounded on purpose. Each pass must either advance the stage or stop:
     - a stage that fails ends the run (the failure is already recorded on the workflow);
     - a pass that does not move currentStage ends the run, so a stuck stage cannot spin;
     - MAX_PASSES is a hard ceiling regardless.
   Each pass can spend money (a model turn, and at PRODUCER a video render), so "loop until
   it works" is exactly the wrong shape — it would bill repeatedly for the same failure. */
const MAX_PASSES = 12;

async function runPipelineToCompletion(projectId, maxWaitMs, renderOpts) {
  const passes = [];
  let last = null;

  for (let i = 0; i < MAX_PASSES; i++) {
    const before = await orchestration.loadWorkflow(projectId);
    if (!before) return { projectId, ok: false, error: 'workflow not found', passes };
    if (before.status === 'complete' || before.status === 'failed') {
      return { projectId, ok: before.status === 'complete', status: before.status, passes, failureReason: before.failureReason };
    }
    if (!orchestration.nextAgentForStatus(before)) {
      return { projectId, ok: before.status === 'complete', status: before.status, passes };
    }

    last = await orchestrateNextAgent(projectId, maxWaitMs, renderOpts);
    passes.push({
      agentId: last.agentId, success: !!last.success,
      status: last.status, reason: last.reason || last.error,
    });

    if (last.error || last.success === false) {
      const w = await orchestration.loadWorkflow(projectId);
      return {
        projectId, ok: false, status: (w && w.status) || 'failed',
        failureReason: (w && w.failureReason) || last.reason || last.error,
        outOfCredits: !!last.outOfCredits, passes,
      };
    }

    const after = await orchestration.loadWorkflow(projectId);
    if (!after) return { projectId, ok: false, error: 'workflow vanished mid-run', passes };
    if (after.currentStage === before.currentStage) {
      // No forward motion and no error reported — stop rather than pay for the same pass again.
      return { projectId, ok: false, status: after.status, failureReason: 'stage ' + before.currentStage + ' did not advance', passes };
    }
    if (after.status === 'complete') return { projectId, ok: true, status: 'complete', passes };
  }

  return { projectId, ok: false, status: 'running', failureReason: 'exceeded ' + MAX_PASSES + ' passes', passes };
}

module.exports = {
  orchestrateNextAgent,
  runPipelineToCompletion,
  buildAgentSystemPrompt,
  captureAgentOutput,
  OUTPUT_FIELD,
  submitAgentRun,
  ensureProducerVideo,
  renderPromptFor,
  producerVideoPath,
  RENDER_NEGATIVE,
  pollForCompletion,
  submitAgentRun,
  extractRunOutputs,
  setApiToken
};

/* test/studio-capture.test.js — the orchestrator captures each agent's answer itself.

   Regression for the stall found in the 2026-10-26 live run: submitAgentRun called
   req.abort() as soon as it saw a runId, discarding the whole NDJSON stream, and the agents
   were asked to edit blueprint.json themselves (they never did). Every stage ran, produced
   good text, and timed out at 300s with an empty output field. */

'use strict';

const A = require('./_assert.js');
const CO = require('../sidecar/cron-orchestrator.js');

function fresh() {
  return { projectId: 'p1', userPrompt: 'knight vs demons', outputs: {
    storywriter: {}, director: {}, producer: {}, qceditor: {} } };
}
const LONG = 'A crusader knight stands alone against a swarm of shadow demons at nightfall.';

/* ---- each stage lands in the field the rest of the pipeline reads ---- */
A.eq(CO.OUTPUT_FIELD.storywriter, 'script', 'storywriter -> script');
A.eq(CO.OUTPUT_FIELD.director, 'shotlist', 'director -> shotlist');
A.eq(CO.OUTPUT_FIELD.qceditor, 'feedback', 'qceditor -> feedback');

{
  const b = fresh();
  A.ok(CO.captureAgentOutput(b, 'storywriter', LONG), 'storywriter text is captured');
  A.eq(b.outputs.storywriter.script, LONG, 'stored under .script — the field pollForCompletion reads');
  A.ok(b.outputs.storywriter.outline.length > 0, 'and an outline is derived');
}
{
  const b = fresh();
  CO.captureAgentOutput(b, 'director', LONG);
  A.eq(b.outputs.director.shotlist, LONG, 'director text lands in .shotlist');
  // That field feeds the render prompt, so the chain from agent text to pixels must hold.
  A.ok(CO.renderPromptFor(b).indexOf('shadow demons') >= 0, 'and flows into the render prompt');
}

/* ---- empty / junk output is NOT a completed stage ---- */
{
  const b = fresh();
  A.ok(!CO.captureAgentOutput(b, 'storywriter', ''), 'empty text is not a capture');
  A.ok(!CO.captureAgentOutput(b, 'storywriter', 'ok'), 'a trivial reply is not a capture');
  A.ok(!CO.captureAgentOutput(b, 'storywriter', null), 'null is not a capture');
  A.ok(!b.outputs.storywriter.script, 'and nothing is written');
}

/* ---- QC verdict is derived from what QC actually wrote, never defaulted ---- */
{
  const b = fresh();
  CO.captureAgentOutput(b, 'qceditor', 'All checks pass. The video is approved for delivery.');
  A.eq(b.outputs.qceditor.approved, true, 'an explicit approval is recorded as approved');
}
{
  const b = fresh();
  CO.captureAgentOutput(b, 'qceditor', 'FAILED: the video file is missing, so this is rejected.');
  A.eq(b.outputs.qceditor.approved, false, 'a failure is NOT recorded as approved');
}
{
  const b = fresh();
  // The exact trap from the fabricated deliverable: praise-shaped text that approved nothing.
  CO.captureAgentOutput(b, 'qceditor', 'The rendering looks excellent and the transitions are smooth.');
  A.eq(b.outputs.qceditor.approved, false,
    'praise without an explicit pass does NOT count as approval — an unearned approval is what shipped the fake video');
}
{
  const b = fresh();
  CO.captureAgentOutput(b, 'qceditor', 'Some checks pass but the audio failed, so not approved.');
  A.eq(b.outputs.qceditor.approved, false, 'mixed wording resolves to NOT approved');
}

/* ---- the agents are no longer told to persist their own state ---- */
{
  const b = fresh();
  for (const id of ['storywriter', 'director', 'qceditor']) {
    const p = CO.buildAgentSystemPrompt(id, b);
    A.ok(!/deliverable_note/.test(p), id + ' is not told to call deliverable_note');
    A.ok(/captures it automatically/.test(p), id + ' is told the pipeline captures its reply');
  }
  const sw = CO.buildAgentSystemPrompt('storywriter', b);
  A.ok(!/Update the JSON field/.test(sw), 'storywriter is no longer told to edit blueprint.json');
}

A.report('studio-capture');

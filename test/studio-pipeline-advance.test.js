/* test/studio-pipeline-advance.test.js — the pipeline drives itself to the end.

   Before this, handleStudioAssignment called orchestrateNextAgent exactly once: a project
   ran STORYWRITER and then sat at "running" until a human advanced it four times by hand.

   The loop spends money on every pass (a model turn, and a video render at PRODUCER), so
   the cases that matter most here are the ones that STOP it: a failing stage and a stage
   that silently fails to advance must both end the run rather than pay for it again. */

'use strict';

const A = require('./_assert.js');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-adv-'));
process.env.WORKSPACES = path.join(TMP, 'workspaces');

const orchestration = require('../sidecar/project-orchestration.js');
const CO = require('../sidecar/cron-orchestrator.js');
// PORT (lint-determinism): the host injects the clock into the studio modules; this test does the same
orchestration.setClock(() => Date.now()); require('../sidecar/cron-orchestrator.js').setClock(() => Date.now());

const AGENTS = orchestration.AGENTS_IN_ORDER;

async function seed(id) {
  const bp = orchestration.createBlueprint(id, 'a knight battling shadow demons');
  const wf = orchestration.createWorkflow(id);
  wf.status = 'running';
  await orchestration.saveBlueprint(id, bp);
  await orchestration.saveWorkflow(id, wf);
}

/* Drive the loop against a stubbed orchestrateNextAgent by swapping the module's export is
   not possible (it closes over itself), so instead assert the loop's observable contract
   through real workflow state transitions it reads and writes. */

(async () => {
  /* ---- a workflow already complete is not re-run (it would re-charge) ---- */
  {
    const id = 'p-complete';
    await seed(id);
    const wf = await orchestration.loadWorkflow(id);
    wf.status = 'complete';
    await orchestration.saveWorkflow(id, wf);
    const out = await CO.runPipelineToCompletion(id, 1000);
    /* THE INTENT OF THIS CASE IS "DO NOT RE-RUN", and that is still asserted below.
       `ok` changed meaning on 2026-11-11: it used to be `status === 'complete'`, i.e. "all four stages ran",
       which is why a real run reported ok:true while QC_EDITOR's verdict read "VERDICT: FAILED - The media
       cannot be verified, so this production cannot be approved." `ok` now means DELIVERABLE ACCEPTED and
       requires the independent QC verdict as well. This fixture has no qceditor output at all, so the honest
       answer is ok:false with qcVerdict 'absent' — missing evidence is never an approval. */
    A.eq(out.passes.length, 0, 'an already-complete pipeline runs ZERO passes — no stage is paid for twice');
    A.eq(out.status, 'complete', 'and still reports the stage lifecycle as complete');
    A.eq(out.stagesComplete, true, 'stage progress is reported separately, and is true');
    A.eq(out.ok, false, 'but ok is FALSE — no QC verdict exists, so nothing is accepted');
    A.eq(out.qcApproved, false, 'qcApproved is false');
    /* createBlueprint seeds qceditor.approved=false with EMPTY feedback. That is "QC never ran", not
       "QC refused" — the feedback text is the discriminator, so this reports 'absent'. */
    A.eq(out.qcVerdict, 'absent', 'a seeded approved:false with no feedback is ABSENT, not a refusal');
    A.ok(/qc-missing/.test(String(out.failureReason)), 'with a reason a human can act on: ' + out.failureReason);
  }

  /* ---- the SAME workflow, once QC has actually approved, DOES report ok ---- */
  {
    const id = 'p-complete-approved';
    await seed(id);
    const wf = await orchestration.loadWorkflow(id);
    wf.status = 'complete';
    await orchestration.saveWorkflow(id, wf);
    const bp = await orchestration.loadBlueprint(id);
    bp.outputs = bp.outputs || {};
    bp.outputs.qceditor = { feedback: 'Checked the render against the shot list. APPROVED.', approved: true };
    await orchestration.saveBlueprint(id, bp);

    const out = await CO.runPipelineToCompletion(id, 1000);
    A.eq(out.passes.length, 0, 'still runs zero passes');
    A.eq(out.stagesComplete, true, 'stages complete');
    A.eq(out.qcApproved, true, 'QC approved');
    A.eq(out.qcVerdict, 'approved', 'reported as approved');
    A.eq(out.ok, true, 'and ONLY now is ok true — stages AND an earned QC verdict');
    A.eq(out.failureReason, undefined, 'with no failure reason');
  }

  /* ---- a REFUSED QC verdict is distinguished from a missing one ---- */
  {
    const id = 'p-complete-refused';
    await seed(id);
    const wf = await orchestration.loadWorkflow(id);
    wf.status = 'complete';
    await orchestration.saveWorkflow(id, wf);
    const bp = await orchestration.loadBlueprint(id);
    bp.outputs = bp.outputs || {};
    bp.outputs.qceditor = { feedback: 'VERDICT: FAILED - the media cannot be verified.', approved: false };
    await orchestration.saveBlueprint(id, bp);

    const out = await CO.runPipelineToCompletion(id, 1000);
    A.eq(out.ok, false, 'a refused QC verdict is not ok');
    A.eq(out.qcVerdict, 'refused', 'and is reported as refused, not as absent');
    A.ok(/qc-refused/.test(String(out.failureReason)), 'with the refusal named: ' + out.failureReason);
  }

  /* ---- a failed workflow is not resumed ---- */
  {
    const id = 'p-failed';
    await seed(id);
    const wf = await orchestration.loadWorkflow(id);
    wf.status = 'failed';
    wf.failureReason = 'producer produced no usable video: out of credit';
    await orchestration.saveWorkflow(id, wf);
    const out = await CO.runPipelineToCompletion(id, 1000);
    A.eq(out.ok, false, 'a failed pipeline stays failed');
    A.eq(out.passes.length, 0, 'and is NOT retried into more spend');
    A.ok(/out of credit/.test(out.failureReason || ''), 'the original reason is preserved: ' + out.failureReason);
  }

  /* ---- a missing project fails cleanly rather than looping ---- */
  {
    const out = await CO.runPipelineToCompletion('p-does-not-exist', 1000);
    A.eq(out.ok, false, 'an unknown project fails');
    A.ok(/not found/.test(out.error || ''), 'with a clear reason: ' + out.error);
    A.eq(out.passes.length, 0, 'and burns no passes');
  }

  /* ---- a workflow past its last stage terminates ---- */
  {
    const id = 'p-exhausted';
    await seed(id);
    const wf = await orchestration.loadWorkflow(id);
    wf.currentStage = AGENTS.length;   // nothing left to run
    await orchestration.saveWorkflow(id, wf);
    const out = await CO.runPipelineToCompletion(id, 1000);
    A.eq(out.passes.length, 0, 'no agent remains, so no pass is attempted');
  }

  /* ---- the loop is bounded ---- */
  {
    A.ok(AGENTS.length === 4, 'the pipeline has four stages');
    // A ceiling well above the stage count, so retries are possible but a spin is not.
    const src = fs.readFileSync(path.join(__dirname, '..', 'sidecar', 'cron-orchestrator.js'), 'utf8');
    const m = src.match(/const MAX_PASSES = (\d+)/);
    A.ok(m, 'MAX_PASSES is declared');
    const cap = Number(m[1]);
    A.ok(cap >= AGENTS.length, 'the cap allows every stage to run (' + cap + ' >= ' + AGENTS.length + ')');
    A.ok(cap <= 24, 'but is a hard ceiling, not an open-ended retry loop (' + cap + ')');
    A.ok(/did not advance/.test(src), 'a stage that fails to advance stops the loop instead of being paid for again');
  }

  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
  A.report('studio-pipeline-advance');
})();

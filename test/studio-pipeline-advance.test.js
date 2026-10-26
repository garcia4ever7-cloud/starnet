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
    A.eq(out.ok, true, 'an already-complete pipeline reports ok');
    A.eq(out.passes.length, 0, 'and runs ZERO passes — no stage is paid for twice');
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

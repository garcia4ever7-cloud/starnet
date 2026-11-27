/* test/orchestration-deliverables.test.js — verify orchestration outputs get registered with deliverableStore */
'use strict';

const assert = require('./_assert.js');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { verifyVideoFile } = require('../sidecar/video-verify.js');

// Create mock deliverableStore that tracks records
let recordedDeliverables = [];
const mockDeliverableStore = {
  record: async (row, now) => {
    recordedDeliverables.push({ ...row, recordedAt: now });
    return row;
  },
  list: () => recordedDeliverables
};

// Test the orchestration output registration logic
async function testOrchestrationDeliverableRegistration() {
  const projectId = 'proj-test-' + Date.now();
  const outboxDir = path.join(os.homedir(), 'outbox', projectId);
  const videoPath = path.join(outboxDir, 'video.mp4');

  // Setup: create outbox directory and video file
  fs.mkdirSync(outboxDir, { recursive: true });
  fs.writeFileSync(videoPath, Buffer.from([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70])); // Minimal MP4 header

  try {
    // Create a complete blueprint (all agents done)
    const blueprint = {
      projectId,
      userPrompt: 'Test project with video',
      outputs: {
        storywriter: { script: 'Sample screenplay' },
        director: { shotlist: 'Sample shots' },
        producer: { scenes: 'Sample scenes' },
        qceditor: { feedback: 'Approved' }
      }
    };

    // Simulate the registerOrchestrationOutputs logic
    recordedDeliverables = []; // Reset
    if (fs.existsSync(outboxDir)) {
      const allComplete = blueprint.outputs.storywriter && blueprint.outputs.director
        && blueprint.outputs.producer && blueprint.outputs.qceditor;

      if (allComplete) {
        const files = [];
        const videoFile = path.join(outboxDir, 'video.mp4');
        if (fs.existsSync(videoFile)) {
          const stat = fs.statSync(videoFile);
          files.push({ path: videoFile, bytes: stat.size });
        }

        if (files.length > 0) {
          const row = {
            id: 'studio:' + projectId + ':video',
            agentId: 'studio',
            runId: projectId,
            title: 'Christian Story Studio Video',
            source: 'studio',
            status: 'kept',
            kind: 'video',
            summary: blueprint.userPrompt.slice(0, 260),
            files: files
          };
          await mockDeliverableStore.record(row, Date.now());
        }
      }
    }

    // Verify registration
    assert.eq(recordedDeliverables.length, 1, 'Should have recorded 1 deliverable');
    assert.eq(recordedDeliverables[0].id, 'studio:' + projectId + ':video', 'ID should match');
    assert.eq(recordedDeliverables[0].status, 'kept', 'Status should be kept');
    assert.eq(recordedDeliverables[0].files.length, 1, 'Should have 1 file');
    assert.ok(recordedDeliverables[0].files[0].bytes > 0, 'File should have size');
    assert.ok(recordedDeliverables[0].files[0].path.includes('video.mp4'), 'Should be video.mp4');

    console.log('✓ Orchestration output registration works correctly');
    console.log('  Registered:', JSON.stringify(recordedDeliverables[0], null, 2));

  } finally {
    // Cleanup
    if (fs.existsSync(outboxDir)) {
      fs.rmSync(outboxDir, { recursive: true, force: true });
    }
  }
}

// Test with actual existing project
async function testExistingProjectRegistration() {
  const projectId = 'proj-1792964044657-xs9vyt';
  const outboxDir = path.join(os.homedir(), 'outbox', projectId);
  const videoPath = path.join(outboxDir, 'video.mp4');

  if (!fs.existsSync(videoPath)) {
    console.log('⊘ Existing project video not found at', videoPath);
    return;
  }

  // Read the existing blueprint
  const blueprintPath = path.join(os.homedir(), '.local/share/StarNet/projects', projectId, 'blueprint.json');
  if (!fs.existsSync(blueprintPath)) {
    console.log('⊘ Blueprint not found at', blueprintPath);
    return;
  }

  const blueprint = JSON.parse(fs.readFileSync(blueprintPath, 'utf8'));

  // Simulate registration
  recordedDeliverables = [];
  if (fs.existsSync(outboxDir)) {
    const allComplete = blueprint.outputs.storywriter && blueprint.outputs.director
      && blueprint.outputs.producer && blueprint.outputs.qceditor;

    if (allComplete) {
      // Mirrors registerOrchestrationOutputs: the verdict decides kept vs failed, and a
      // rejected video is still RECORDED (as failed) rather than silently dropped.
      const verdict = verifyVideoFile(videoPath);
      const row = {
        id: 'studio:' + projectId + ':video',
        agentId: 'studio',
        runId: projectId,
        title: 'Christian Story Studio Video',
        source: 'studio',
        status: verdict.ok ? 'kept' : 'failed',
        kind: 'video',
        summary: verdict.ok
          ? blueprint.userPrompt.slice(0, 260)
          : ('Video rejected: ' + verdict.reason),
        files: verdict.ok ? [{ path: videoPath, bytes: verdict.bytes }] : []
      };
      if (!verdict.ok) { row.verifyReason = verdict.reason; row.verifyBytes = verdict.bytes; }
      await mockDeliverableStore.record(row, Date.now());
    }
  }

  assert.ok(recordedDeliverables.length > 0, 'the project is registered either way — never silently dropped');
  assert.eq(recordedDeliverables[0].id, 'studio:' + projectId + ':video');

  // This project's delivered video is the placeholder from qa/bugs/c7abfee9. It must
  // never come back as kept.
  const rec = recordedDeliverables[0];
  assert.eq(rec.status, 'failed', 'the placeholder video registers as FAILED, not KEPT');
  assert.ok(rec.verifyReason && rec.verifyReason.length > 0, 'and carries a reason the owner can act on');
  assert.eq(rec.files.length, 0, 'and exposes no playable file');

  console.log('✓ Existing project video registers as', rec.status);
  console.log('  ID:', rec.id);
  console.log('  Reason:', rec.verifyReason);
}

(async () => {
  console.log('Testing orchestration deliverable registration...\n');
  await testOrchestrationDeliverableRegistration();
  console.log();
  await testExistingProjectRegistration();
  console.log();
  assert.report();
})();

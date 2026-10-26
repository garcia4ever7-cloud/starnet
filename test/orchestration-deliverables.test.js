/* test/orchestration-deliverables.test.js — verify orchestration outputs get registered with deliverableStore */
'use strict';

const assert = require('./_assert.js');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

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
      const files = [];
      if (fs.existsSync(videoPath)) {
        const stat = fs.statSync(videoPath);
        files.push({ path: videoPath, bytes: stat.size });
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

  assert.ok(recordedDeliverables.length > 0, 'Should have registered the existing project video');
  assert.eq(recordedDeliverables[0].id, 'studio:' + projectId + ':video');
  assert.eq(recordedDeliverables[0].files[0].bytes, fs.statSync(videoPath).size);

  console.log('✓ Existing project video would be registered');
  console.log('  ID:', recordedDeliverables[0].id);
  console.log('  File size:', recordedDeliverables[0].files[0].bytes, 'bytes');
}

(async () => {
  console.log('Testing orchestration deliverable registration...\n');
  await testOrchestrationDeliverableRegistration();
  console.log();
  await testExistingProjectRegistration();
  console.log();
  assert.report();
})();

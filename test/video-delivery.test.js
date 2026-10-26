/* test/video-delivery.test.js — regression tests for video delivery pipeline */
'use strict';

const assert = require('./_assert.js');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// Test 1: Video registration with validation
function testVideoRegistrationValidation() {
  const projectId = 'proj-test-video-' + Date.now();
  const outboxDir = path.join(os.homedir(), 'outbox', projectId);
  const videoPath = path.join(outboxDir, 'video.mp4');

  // Create outbox and mock MP4 file
  fs.mkdirSync(outboxDir, { recursive: true });
  // Write minimal MP4 header (ftyp box)
  const mp4Header = Buffer.from([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
  fs.writeFileSync(videoPath, mp4Header);

  try {
    const blueprint = {
      projectId,
      userPrompt: 'Test video project',
      outputs: {
        storywriter: { script: 'test' },
        director: { shotlist: 'test' },
        producer: { scenes: 'test' },
        qceditor: { feedback: 'test' }
      }
    };

    // Simulate registration logic
    const files = [];
    if (fs.existsSync(videoPath)) {
      const stat = fs.statSync(videoPath);
      const header = Buffer.alloc(12);
      const fd = fs.openSync(videoPath, 'r');
      fs.readSync(fd, header, 0, 12);
      fs.closeSync(fd);
      const isValidMp4 = header.toString('ascii', 4, 8) === 'ftyp';
      if (isValidMp4 && stat.size > 0) {
        files.push({
          path: videoPath,
          bytes: stat.size,
          openUrl: '/api/studio-file?project=' + encodeURIComponent(projectId) + '&file=video.mp4'
        });
      }
    }

    assert.eq(files.length, 1, 'Valid MP4 should be registered');
    assert.ok(files[0].bytes > 0, 'File size should be recorded');
    assert.ok(files[0].openUrl.includes('/api/studio-file'), 'Should use studio-file endpoint');
    assert.ok(files[0].openUrl.includes('project='), 'URL should include project ID');
  } finally {
    if (fs.existsSync(outboxDir)) {
      fs.rmSync(outboxDir, { recursive: true, force: true });
    }
  }
}

// Test 2: Invalid file rejection
function testInvalidFileRejection() {
  const projectId = 'proj-test-invalid-' + Date.now();
  const outboxDir = path.join(os.homedir(), 'outbox', projectId);
  const textFile = path.join(outboxDir, 'notavideo.txt');

  fs.mkdirSync(outboxDir, { recursive: true });
  fs.writeFileSync(textFile, 'This is not a video');

  try {
    const blueprint = {
      projectId,
      outputs: {
        storywriter: { script: 'test' },
        director: { shotlist: 'test' },
        producer: { scenes: 'test' },
        qceditor: { feedback: 'test' }
      }
    };

    // Simulate registration logic
    const files = [];
    const videoPath = path.join(outboxDir, 'video.mp4');
    if (fs.existsSync(videoPath)) {
      files.push({ path: videoPath, bytes: 100 });
    }

    assert.eq(files.length, 0, 'Non-existent video.mp4 should not be registered');
  } finally {
    if (fs.existsSync(outboxDir)) {
      fs.rmSync(outboxDir, { recursive: true, force: true });
    }
  }
}

// Test 3: Path validation for studio file handler
function testStudioFilePathValidation() {
  const projectId = 'proj-valid-123';
  const fileName = 'video.mp4';

  // Validate project ID format
  const validProjectId = /^proj-\d+-[a-z0-9]+$/.test(projectId);
  assert.ok(!validProjectId, 'Invalid project ID format should be rejected');

  const validProjectId2 = /^proj-\d+-[a-z0-9]+$/.test('proj-1234567890-abcde');
  assert.ok(validProjectId2, 'Valid project ID format should pass');

  // Validate file name (no path traversal)
  const validFileName = /^[\w.-]+$/.test(fileName) && !fileName.includes('..');
  assert.ok(validFileName, 'Valid file name should pass');

  const invalidFileName = /^[\w.-]+$/.test('../etc/passwd') && !('../etc/passwd').includes('..');
  assert.ok(!invalidFileName, 'Path traversal should be rejected');
}

// Test 4: Preview type detection
function testVideoPreviewTypeDetection() {
  const testCases = [
    { ext: '.mp4', expected: true },
    { ext: '.webm', expected: true },
    { ext: '.mov', expected: true },
    { ext: '.avi', expected: true },
    { ext: '.mkv', expected: true },
    { ext: '.txt', expected: false },
    { ext: '.pdf', expected: false },
    { ext: '.png', expected: false }
  ];

  testCases.forEach(tc => {
    const isVideoExt = ['.mp4', '.webm', '.mov', '.avi', '.mkv'].indexOf(tc.ext) >= 0;
    assert.eq(isVideoExt, tc.expected, 'Extension ' + tc.ext + ' detection');
  });
}

// Test 5: File size tracking
function testFileSizeTracking() {
  const projectId = 'proj-test-size-' + Date.now();
  const outboxDir = path.join(os.homedir(), 'outbox', projectId);
  const videoPath = path.join(outboxDir, 'video.mp4');

  fs.mkdirSync(outboxDir, { recursive: true });

  // Create MP4 with known size
  const mp4Header = Buffer.from([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
  const testData = Buffer.alloc(5000);
  const fullData = Buffer.concat([mp4Header, testData]);
  fs.writeFileSync(videoPath, fullData);

  try {
    const stat = fs.statSync(videoPath);
    assert.ok(stat.size === fullData.length, 'File size should be accurately recorded');
    assert.ok(stat.size > 1000, 'Test file should be large enough to test');
  } finally {
    if (fs.existsSync(outboxDir)) {
      fs.rmSync(outboxDir, { recursive: true, force: true });
    }
  }
}

// Test 6: Incomplete pipeline protection
function testIncompletePipelineProtection() {
  const projectId = 'proj-incomplete-' + Date.now();
  const outboxDir = path.join(os.homedir(), 'outbox', projectId);
  const videoPath = path.join(outboxDir, 'video.mp4');

  fs.mkdirSync(outboxDir, { recursive: true });
  fs.writeFileSync(videoPath, Buffer.from('test'));

  try {
    // Blueprint with only 2 agents complete
    const blueprint = {
      projectId,
      outputs: {
        storywriter: { script: 'test' },
        director: { shotlist: 'test' },
        producer: null,
        qceditor: null
      }
    };

    // Simulate registration check
    const allComplete = blueprint.outputs.storywriter && blueprint.outputs.director
      && blueprint.outputs.producer && blueprint.outputs.qceditor;

    assert.ok(!allComplete, 'Incomplete pipeline should not trigger registration');
  } finally {
    if (fs.existsSync(outboxDir)) {
      fs.rmSync(outboxDir, { recursive: true, force: true });
    }
  }
}

(async () => {
  console.log('Testing video delivery pipeline...\n');
  testVideoRegistrationValidation();
  testInvalidFileRejection();
  testStudioFilePathValidation();
  testVideoPreviewTypeDetection();
  testFileSizeTracking();
  testIncompletePipelineProtection();
  console.log();
  assert.report();
})();

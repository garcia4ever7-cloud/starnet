'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');

const { makeHiggsfieldTools } = require('../sidecar/tools/builtin/higgsfield.js');

async function runTests() {
  console.log('higgsfield-integration.test: starting...');

  // Test 1: Mock submission + poll + download flow against the verified platform API shape.
  {
    console.log('  Test 1: Mock job submission and polling flow');
    const testDir = path.join(os.tmpdir(), `test-hf-int-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });

    try {
      process.env.HF_CREDENTIALS = 'test-key-id:test-key-secret';

      let submitCalled = false;
      let pollCalled = false;
      let downloadCalled = false;

      const mockFetch = async (url, opts) => {
        if (url === 'https://platform.higgsfield.ai/v1/text2image/soul' && opts.method === 'POST') {
          submitCalled = true;
          assert.equal(opts.headers['hf-api-key'], 'test-key-id', 'hf-api-key header sent');
          assert.equal(opts.headers['hf-secret'], 'test-key-secret', 'hf-secret header sent');
          assert.equal(opts.headers['Authorization'], undefined, 'no legacy Authorization: Key header');
          return {
            ok: true,
            json: async () => ({ id: 'test-jobset-123' })
          };
        } else if (url === 'https://platform.higgsfield.ai/v1/job-sets/test-jobset-123') {
          pollCalled = true;
          return {
            ok: true,
            json: async () => ({
              id: 'test-jobset-123',
              jobs: [{ id: 'job-1', status: 'completed', results: { raw: { url: 'https://example.com/generated-image.png' } } }]
            })
          };
        } else if (url === 'https://example.com/generated-image.png') {
          downloadCalled = true;
          const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG header
          return { ok: true, arrayBuffer: async () => buffer };
        }
        throw new Error('Unexpected fetch: ' + url);
      };

      const tools = makeHiggsfieldTools({
        fsp: fs,
        pathMod: path,
        root: testDir,
        fetchImpl: mockFetch
      });

      const result = await tools.generateTool.run(
        {
          prompt: 'A beautiful sunset',
          aspect_ratio: '9:16',
          filename: 'test-output.png'
        },
        { agentId: 'test', emit: () => {} }
      );

      assert(submitCalled, 'job submission was called');
      assert(pollCalled, 'status polling was called');
      assert(downloadCalled, 'image download was called');
      assert(result.content, 'result has content');
      assert.equal(result.detail.filename, 'test-output.png', 'filename preserved');
      assert.equal(result.detail.request_id, 'test-jobset-123', 'job-set id in result');

      // Verify file was written
      const written = await fs.readFile(path.join(testDir, 'test', 'test-output.png'));
      assert(written.length > 0, 'file was written to workspace');

      console.log('    ✓ Mock flow completed successfully');
    } finally {
      delete process.env.HF_CREDENTIALS;
      await fs.rm(testDir, { recursive: true, force: true });
    }
  }

  // Test 2: Aspect ratio is passed as width_and_height to the closed-enum field.
  {
    console.log('  Test 2: Aspect ratio passed as width_and_height');
    const testDir = path.join(os.tmpdir(), `test-hf-int-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });

    try {
      process.env.HF_CREDENTIALS = 'test-key:test-secret';

      let submittedParams = null;

      const mockFetch = async (url, opts) => {
        if (url === 'https://platform.higgsfield.ai/v1/text2image/soul' && opts.method === 'POST') {
          submittedParams = JSON.parse(opts.body).params;
          return {
            ok: true,
            json: async () => ({ id: 'test-123' })
          };
        } else if (url === 'https://platform.higgsfield.ai/v1/job-sets/test-123') {
          return {
            ok: true,
            json: async () => ({
              id: 'test-123',
              jobs: [{ id: 'job-1', status: 'completed', results: { raw: { url: 'https://example.com/img.png' } } }]
            })
          };
        } else if (url === 'https://example.com/img.png') {
          return { ok: true, arrayBuffer: async () => Buffer.from([0x89, 0x50, 0x4e, 0x47]) };
        }
        throw new Error('Unexpected fetch: ' + url);
      };

      const tools = makeHiggsfieldTools({
        fsp: fs,
        pathMod: path,
        root: testDir,
        fetchImpl: mockFetch
      });

      await tools.generateTool.run(
        { prompt: 'Test', aspect_ratio: '9:16' },
        { agentId: 'test', emit: () => {} }
      );

      assert.equal(submittedParams.width_and_height, '9:16', 'aspect ratio passed as width_and_height');
      assert.equal(submittedParams.prompt, 'Test', 'prompt passed');
      console.log('    ✓ Aspect ratio passed as width_and_height');
    } finally {
      delete process.env.HF_CREDENTIALS;
      await fs.rm(testDir, { recursive: true, force: true });
    }
  }

  // Test 3: Error handling — API errors surface the provider message.
  {
    console.log('  Test 3: API error handling');
    const testDir = path.join(os.tmpdir(), `test-hf-int-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });

    try {
      process.env.HF_CREDENTIALS = 'test-key:test-secret';

      const mockFetch = async (url, opts) => {
        if (url === 'https://platform.higgsfield.ai/v1/text2image/soul') {
          return {
            ok: false,
            status: 401,
            json: async () => ({ detail: 'Invalid credentials' })
          };
        }
        throw new Error('Unexpected fetch');
      };

      const tools = makeHiggsfieldTools({
        fsp: fs,
        pathMod: path,
        root: testDir,
        fetchImpl: mockFetch
      });

      try {
        await tools.generateTool.run(
          { prompt: 'Test' },
          { agentId: 'test' }
        );
        assert.fail('should have thrown on API error');
      } catch (e) {
        assert(e.message.includes('submission failed') || e.message.includes('401') || e.message.includes('Invalid credentials'),
          'error message is informative');
        console.log('    ✓ API errors handled correctly');
      }
    } finally {
      delete process.env.HF_CREDENTIALS;
      await fs.rm(testDir, { recursive: true, force: true });
    }
  }

  // Test 4: Malformed response (no id) is detected.
  {
    console.log('  Test 4: Malformed response handling');
    const testDir = path.join(os.tmpdir(), `test-hf-int-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });

    try {
      process.env.HF_CREDENTIALS = 'test-key:test-secret';

      const mockFetch = async (url, opts) => {
        if (url === 'https://platform.higgsfield.ai/v1/text2image/soul') {
          return {
            ok: true,
            json: async () => ({ error: 'some error' }) // missing id
          };
        }
        throw new Error('Unexpected fetch');
      };

      const tools = makeHiggsfieldTools({
        fsp: fs,
        pathMod: path,
        root: testDir,
        fetchImpl: mockFetch
      });

      try {
        await tools.generateTool.run(
          { prompt: 'Test' },
          { agentId: 'test' }
        );
        assert.fail('should have thrown on malformed response');
      } catch (e) {
        assert(e.message.includes('submission') || e.message.includes('job-set id'),
          'error is about submission');
        console.log('    ✓ Malformed responses detected');
      }
    } finally {
      delete process.env.HF_CREDENTIALS;
      await fs.rm(testDir, { recursive: true, force: true });
    }
  }

  // Test 5: Missing credentials fails loudly without touching the network.
  {
    console.log('  Test 5: Missing credentials fail before any fetch');
    const testDir = path.join(os.tmpdir(), `test-hf-int-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });

    try {
      const saved = process.env.HF_CREDENTIALS;
      delete process.env.HF_CREDENTIALS;

      let fetchCalled = false;
      const tools = makeHiggsfieldTools({
        fsp: fs,
        pathMod: path,
        root: testDir,
        fetchImpl: async () => { fetchCalled = true; throw new Error('must not fetch'); }
      });

      try {
        await tools.generateTool.run(
          { prompt: 'Test' },
          { agentId: 'test' }
        );
        assert.fail('should have thrown for missing credentials');
      } catch (e) {
        assert(e.message.includes('HF_CREDENTIALS') || e.message.includes('credentials'),
          'error mentions credentials');
        assert.equal(fetchCalled, false, 'no fetch attempted without credentials');
        console.log('    ✓ Missing credentials caught before any network call');
      } finally {
        if (saved) process.env.HF_CREDENTIALS = saved;
      }
    } finally {
      await fs.rm(testDir, { recursive: true, force: true });
    }
  }

  console.log('higgsfield-integration.test: OK (5 integration test suites)');
}

runTests().catch(e => {
  console.error('Test failed:', e);
  process.exit(1);
});

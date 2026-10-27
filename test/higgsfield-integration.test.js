'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');

const { makeHiggsfieldTools } = require('../sidecar/tools/builtin/higgsfield.js');

async function runTests() {
  console.log('higgsfield-integration.test: starting...');

  // Test 1: Mock submission flow
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
        if (url.includes('/v2/requests') && opts.method === 'POST') {
          submitCalled = true;
          assert(opts.headers.Authorization.startsWith('Key '), 'auth header present');
          return {
            ok: true,
            json: async () => ({
              request_id: 'test-req-123',
              status_url: 'https://api.higgsfield.ai/requests/test-req-123/status'
            })
          };
        } else if (url.includes('/requests/') && url.includes('/status')) {
          pollCalled = true;
          // Return completed after a delay
          return {
            ok: true,
            json: async () => ({
              status: 'completed',
              request_id: 'test-req-123',
              images: [{ url: 'https://example.com/generated-image.png' }]
            })
          };
        } else if (url.includes('generated-image.png')) {
          downloadCalled = true;
          // Return mock image buffer
          const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG header
          return {
            ok: true,
            buffer: async () => buffer
          };
        }
        throw new Error(`Unexpected fetch: ${url}`);
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
          aspect_ratio: '16:9',
          filename: 'test-output.png'
        },
        { agentId: 'test', emit: () => {} }
      );

      assert(submitCalled, 'job submission was called');
      assert(pollCalled, 'status polling was called');
      assert(downloadCalled, 'image download was called');
      assert(result.content, 'result has content');
      assert(result.detail.filename === 'test-output.png', 'filename preserved');
      assert(result.detail.request_id === 'test-req-123', 'request_id in result');

      // Verify file was written
      const written = await fs.readFile(path.join(testDir, 'test', 'test-output.png'));
      assert(written.length > 0, 'file was written to workspace');

      console.log('    ✓ Mock flow completed successfully');
    } finally {
      delete process.env.HF_CREDENTIALS;
      await fs.rm(testDir, { recursive: true, force: true });
    }
  }

  // Test 2: Aspect ratio and endpoint handling
  {
    console.log('  Test 2: Aspect ratio and endpoint customization');
    const testDir = path.join(os.tmpdir(), `test-hf-int-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });

    try {
      process.env.HF_CREDENTIALS = 'test-key:test-secret';

      let submittedPayload = null;

      const mockFetch = async (url, opts) => {
        if (url.includes('/v2/requests') && opts.method === 'POST') {
          submittedPayload = JSON.parse(opts.body);
          return {
            ok: true,
            json: async () => ({
              request_id: 'test-123',
              status_url: 'https://api.higgsfield.ai/requests/test-123/status'
            })
          };
        } else if (url.includes('/status')) {
          return {
            ok: true,
            json: async () => ({
              status: 'completed',
              images: [{ url: 'https://example.com/img.png' }]
            })
          };
        } else if (url.includes('img.png')) {
          return {
            ok: true,
            buffer: async () => Buffer.from([0x89, 0x50, 0x4e, 0x47])
          };
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
        {
          prompt: 'Test',
          aspect_ratio: '9:16',
          endpoint: 'flux-pro/premium/text-to-image'
        },
        { agentId: 'test', emit: () => {} }
      );

      assert.equal(submittedPayload.input.aspect_ratio, '9:16', 'aspect ratio passed');
      assert.equal(submittedPayload.endpoint, 'flux-pro/premium/text-to-image', 'custom endpoint passed');
      console.log('    ✓ Aspect ratio and endpoint customization works');
    } finally {
      delete process.env.HF_CREDENTIALS;
      await fs.rm(testDir, { recursive: true, force: true });
    }
  }

  // Test 3: Error handling — API errors
  {
    console.log('  Test 3: API error handling');
    const testDir = path.join(os.tmpdir(), `test-hf-int-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });

    try {
      process.env.HF_CREDENTIALS = 'test-key:test-secret';

      const mockFetch = async (url, opts) => {
        if (url.includes('/v2/requests')) {
          return {
            ok: false,
            status: 401,
            text: async () => 'Unauthorized'
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
        assert(e.message.includes('failed') || e.message.includes('401'), 'error message is informative');
        console.log('    ✓ API errors handled correctly');
      }
    } finally {
      delete process.env.HF_CREDENTIALS;
      await fs.rm(testDir, { recursive: true, force: true });
    }
  }

  // Test 4: Error handling — malformed response
  {
    console.log('  Test 4: Malformed response handling');
    const testDir = path.join(os.tmpdir(), `test-hf-int-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });

    try {
      process.env.HF_CREDENTIALS = 'test-key:test-secret';

      const mockFetch = async (url, opts) => {
        if (url.includes('/v2/requests')) {
          return {
            ok: true,
            json: async () => ({
              // Missing request_id and status_url
              error: 'some error'
            })
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
        assert(e.message.includes('invalid') || e.message.includes('submission'), 'error is about submission');
        console.log('    ✓ Malformed responses detected');
      }
    } finally {
      delete process.env.HF_CREDENTIALS;
      await fs.rm(testDir, { recursive: true, force: true });
    }
  }

  console.log('higgsfield-integration.test: OK (4 integration test suites)');
}

runTests().catch(e => {
  console.error('Test failed:', e);
  process.exit(1);
});

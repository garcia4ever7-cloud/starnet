'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');

// Mock Higgsfield implementation for testing
const { makeHiggsfieldTools } = require('../sidecar/tools/builtin/higgsfield.js');

async function runTests() {
  console.log('higgsfield.test: starting...');

  // Test 1: Tool is created with correct properties
  {
    console.log('  Test 1: Tool creation and basic properties');
    const testDir = path.join(os.tmpdir(), `test-hf-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });

    try {
      const tools = makeHiggsfieldTools({
        fsp: fs,
        pathMod: path,
        root: testDir,
        fetchImpl: async () => {
          throw new Error('mock fetch not implemented');
        }
      });

      assert(tools, 'tools object created');
      assert(tools.generateTool, 'generateTool exists');
      assert.equal(tools.generateTool.name, 'higgsfield.generate', 'tool name is correct');
      assert.equal(tools.generateTool.capability, 'studio', 'capability is studio');
      assert.equal(tools.generateTool.scope, 'write', 'scope is write');
      assert.equal(tools.generateTool.requiresConsent, true, 'requires consent');
      assert(tools.generateTool.schema, 'schema defined');
      assert(tools.generateTool.schema.required.includes('prompt'), 'prompt is required');
      console.log('    ✓ Tool properties correct');
    } finally {
      await fs.rm(testDir, { recursive: true, force: true });
    }
  }

  // Test 2: Tool validates required prompt
  {
    console.log('  Test 2: Prompt validation');
    const testDir = path.join(os.tmpdir(), `test-hf-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });

    try {
      const tools = makeHiggsfieldTools({
        fsp: fs,
        pathMod: path,
        root: testDir,
        fetchImpl: async () => {
          throw new Error('should not fetch');
        }
      });

      try {
        await tools.generateTool.run({ prompt: '' }, { agentId: 'test' });
        assert.fail('should have thrown for empty prompt');
      } catch (e) {
        assert(e.message.includes('prompt'), 'error message mentions prompt');
        console.log('    ✓ Empty prompt rejected');
      }

      try {
        await tools.generateTool.run({ prompt: '   ' }, { agentId: 'test' });
        assert.fail('should have thrown for whitespace-only prompt');
      } catch (e) {
        assert(e.message.includes('prompt'), 'error message mentions prompt');
        console.log('    ✓ Whitespace-only prompt rejected');
      }
    } finally {
      await fs.rm(testDir, { recursive: true, force: true });
    }
  }

  // Test 3: Credentials validation
  {
    console.log('  Test 3: Credentials validation');
    const testDir = path.join(os.tmpdir(), `test-hf-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });

    try {
      // Clear environment credentials
      const savedHFCreds = process.env.HF_CREDENTIALS;
      const savedHFKey = process.env.HF_API_KEY;
      const savedHFSecret = process.env.HF_API_SECRET;
      delete process.env.HF_CREDENTIALS;
      delete process.env.HF_API_KEY;
      delete process.env.HF_API_SECRET;

      try {
        const tools = makeHiggsfieldTools({
          fsp: fs,
          pathMod: path,
          root: testDir,
          fetchImpl: async () => {
            throw new Error('should not fetch');
          }
        });

        try {
          await tools.generateTool.run(
            { prompt: 'test prompt' },
            { agentId: 'test' }
          );
          assert.fail('should have thrown for missing credentials');
        } catch (e) {
          assert(e.message.includes('HF_CREDENTIALS') || e.message.includes('credentials'),
            'error mentions credentials');
          console.log('    ✓ Missing credentials caught');
        }
      } finally {
        // Restore environment
        if (savedHFCreds) process.env.HF_CREDENTIALS = savedHFCreds;
        if (savedHFKey) process.env.HF_API_KEY = savedHFKey;
        if (savedHFSecret) process.env.HF_API_SECRET = savedHFSecret;
      }
    } finally {
      await fs.rm(testDir, { recursive: true, force: true });
    }
  }

  // Test 4: Tool registration
  {
    console.log('  Test 4: Tool registration');
    const testDir = path.join(os.tmpdir(), `test-hf-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });

    try {
      const tools = makeHiggsfieldTools({
        fsp: fs,
        pathMod: path,
        root: testDir,
        fetchImpl: async () => {
          throw new Error('mock');
        }
      });

      const registry = {
        registered: [],
        register(tool) {
          this.registered.push(tool);
          return this;
        }
      };

      const result = tools.register(registry);
      assert.equal(result, registry, 'register returns the registry for chaining');
      assert.equal(registry.registered.length, 1, 'one tool registered');
      assert.equal(registry.registered[0].name, 'higgsfield.generate', 'correct tool registered');
      console.log('    ✓ Tool registration works');
    } finally {
      await fs.rm(testDir, { recursive: true, force: true });
    }
  }

  console.log('higgsfield.test: OK (4 assertions)');
}

runTests().catch(e => {
  console.error('Test failed:', e);
  process.exit(1);
});

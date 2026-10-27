#!/usr/bin/env node
/* verify-kling-config.js — Verify Kling API key is configured and tool is registered.
   Does NOT make any API calls. Safe to run anytime to check configuration status.

   Usage: node scripts/verify-kling-config.js
*/

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const HOME = process.env.HOME || process.env.USERPROFILE || '/root';
const ENV_FILE = path.join(HOME, '.config/starnet/env');

console.log('\n════════════════════════════════════════════════════════════════');
console.log('  StarNet Kling Configuration Verification');
console.log('════════════════════════════════════════════════════════════════\n');

let allGood = true;

// Check 1: Environment file exists
console.log('✓ Check 1: Configuration file');
if (!fs.existsSync(ENV_FILE)) {
  console.log(`  ❌ File not found: ${ENV_FILE}`);
  allGood = false;
} else {
  console.log(`  ✅ Found: ${ENV_FILE}`);
  const stat = fs.statSync(ENV_FILE);
  const perms = '0' + (stat.mode & parseInt('777', 8)).toString(8);
  console.log(`     Permissions: ${perms} (must be 0600 for security)`);
  if (perms !== '0600') {
    console.log(`     ⚠️  Warning: Should be 0600, not ${perms}`);
  }
}

// Check 2: KLING_API_KEY is set
console.log('\n✓ Check 2: KLING_API_KEY environment variable');
if (!fs.existsSync(ENV_FILE)) {
  console.log('  ❌ Cannot check (file not found)');
  allGood = false;
} else {
  const content = fs.readFileSync(ENV_FILE, 'utf8');
  const hasKlingKey = /^KLING_API_KEY=.+$/m.test(content);

  if (!hasKlingKey) {
    console.log('  ❌ KLING_API_KEY not found in env file');
    console.log('     Run: bash scripts/setup-kling-key.sh');
    allGood = false;
  } else {
    const match = content.match(/^KLING_API_KEY=(.+)$/m);
    const keyValue = match[1].trim();
    const keyLength = keyValue.length;
    console.log(`  ✅ KLING_API_KEY is configured`);
    console.log(`     Length: ${keyLength} characters (hidden for security)`);

    if (keyLength < 10) {
      console.log(`     ⚠️  Key appears short (${keyLength} chars, expected >10)`);
    }
  }
}

// Check 3: Tool file exists
console.log('\n✓ Check 3: video-kling.js tool file');
const toolFile = path.join(__dirname, '..', 'sidecar', 'tools', 'builtin', 'video-kling.js');
if (!fs.existsSync(toolFile)) {
  console.log(`  ❌ Tool not found: ${toolFile}`);
  allGood = false;
} else {
  console.log(`  ✅ Found: ${toolFile}`);
  try {
    const tool = require(toolFile);
    console.log(`     Type: ${typeof tool} (should be 'function')`);
    if (typeof tool !== 'function') {
      console.log('     ❌ Tool does not export a factory function');
      allGood = false;
    } else {
      console.log('     ✅ Exports factory function (makeVideoKlingTools)');
    }
  } catch (err) {
    console.log(`  ❌ Error loading tool: ${err.message}`);
    allGood = false;
  }
}

// Check 4: Tool is registered in capability registry
console.log('\n✓ Check 4: Capability registry');
try {
  const { CAP_REGISTRY } = require('../sidecar/capability/registry.js');
  const studioTools = CAP_REGISTRY.studio || [];
  const videoKlingEntry = studioTools.find(t => t && t.tool === 'video.kling');

  if (!videoKlingEntry) {
    console.log('  ❌ video.kling not found in studio capability registry');
    allGood = false;
  } else {
    console.log('  ✅ video.kling registered in studio capability');
    console.log(`     Scope: ${videoKlingEntry.scope} (should be 'write')`);
    console.log(`     Requires consent: ${videoKlingEntry.requiresConsent} (should be true)`);
    console.log(`     Network: ${videoKlingEntry.network} (should be true)`);
  }
} catch (err) {
  console.log(`  ⚠️  Could not verify registry: ${err.message}`);
}

// Check 5: Index.js has the tool wired
console.log('\n✓ Check 5: Sidecar wiring (index.js)');
try {
  const indexContent = fs.readFileSync(path.join(__dirname, '..', 'sidecar', 'index.js'), 'utf8');

  if (!indexContent.includes('makeVideoKlingTools')) {
    console.log('  ❌ makeVideoKlingTools not found in index.js');
    allGood = false;
  } else {
    console.log('  ✅ makeVideoKlingTools required in index.js');
  }

  if (!indexContent.includes("makeVideoKlingTools({ fsp, pathMod: path, root: WORKSPACES })")) {
    console.log('  ⚠️  Tool registration call not found in expected location');
  } else {
    console.log('  ✅ Tool registered in studio tools section');
  }
} catch (err) {
  console.log(`  ⚠️  Could not verify: ${err.message}`);
}

// Summary
console.log('\n════════════════════════════════════════════════════════════════');
if (allGood) {
  console.log('✅ Configuration verification PASSED');
  console.log('\n📋 Configuration status:');
  console.log('   • Tool file: present ✅');
  console.log('   • Tool registered: yes ✅');
  console.log('   • API key configured: yes ✅');
  console.log('\n⏭️  Next steps:');
  console.log('   1. Restart sidecar: ~/start-starnet.sh');
  console.log('   2. Verify tool loads: node sidecar/index.js (watch for errors)');
  console.log('   3. Check tool availability: node test/video-kling.test.js');
  console.log('   4. Run first test generation when ready');
} else {
  console.log('❌ Configuration verification FAILED');
  console.log('\n⚠️  Issues found above. Fix before attempting to use video.kling tool.');
}
console.log('\n════════════════════════════════════════════════════════════════\n');

process.exit(allGood ? 0 : 1);

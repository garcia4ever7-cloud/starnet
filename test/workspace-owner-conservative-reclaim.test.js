/* node test/workspace-owner-conservative-reclaim.test.js — Regression test for conservative
   workspace-ownership reclaim.

   Safeguards verified:
   1. Never reclaim a lock based solely on malformed contents.
   2. Verify process liveness (kill(0) ESRCH ⇒ dead; live PID ⇒ busy).
   3. Verify boot identity via holderDead(): an invalid holder is reclaimable only when its
      lock file predates the current boot; a valid holder is reclaimable only when it started
      before boot or its PID is gone.

   sidecar/workspace-owner.js: holderDead() (line 78-82), defaultPidAlive() (line 28-39).
*/
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { makeWorkspaceOwner, _internals } = require('../sidecar/workspace-owner.js');
const { defaultPidAlive } = _internals;

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'starnet-workspace-owner-')); }

(async () => {
  // ---- A. Malformed lock that does NOT predate boot must NOT be reclaimed (conservative) ----
  {
    const dir = tmp();
    const lockfile = path.join(dir, '.starnet-workspace-owner.json');
    fs.writeFileSync(lockfile, '{ torn json');
    const bootedAt = () => Date.now() - 100; // boot was 100ms ago
    const owner = makeWorkspaceOwner({ fs, path, now: () => Date.now(), bootedAt });
    const r = owner.acquire(dir);
    A.eq(r.ok, false, 'malformed lock is NOT reclaimed');
    A.eq(r.code, 'WORKSPACE_BUSY', 'returns WORKSPACE_BUSY for unverifiable holder');
    A.eq(r.holder.valid, false, 'holder is marked invalid (malformed)');
  }

  // ---- B. DefaultPidAlive: malformed/unprovable PID is busy (never reclaimable) ----
  {
    A.eq(defaultPidAlive(null), true, 'null PID → busy (unprovable)');
    A.eq(defaultPidAlive(0), true, 'zero PID → busy (unprovable)');
    A.eq(defaultPidAlive(-1), true, 'negative PID → busy (unprovable)');
    A.eq(defaultPidAlive('not-a-number'), true, 'non-numeric PID → busy (unprovable)');
    A.eq(defaultPidAlive(process.pid), true, 'our own PID → busy');
    A.eq(defaultPidAlive(999999999), false, 'nonexistent PID → dead (ESRCH), reclaimable');
  }

  // ---- C. Valid holder whose PID is gone (ESRCH) IS reclaimed (process liveness) ----
  {
    const dir = tmp();
    const lockfile = path.join(dir, '.starnet-workspace-owner.json');
    const claim = JSON.stringify({ version: 1, pid: 999999999, nonce: 'abc', startedAt: Date.now() - 1000 });
    fs.writeFileSync(lockfile, claim);
    const owner = makeWorkspaceOwner({ fs, path, now: () => Date.now(), bootedAt: () => Date.now() - 100 });
    const r = owner.acquire(dir);
    A.eq(r.ok, true, 'holder with nonexistent PID is reclaimed');
    owner.release();
  }

  // ---- D. Valid holder whose PID IS alive is NOT reclaimed (process liveness) ----
  {
    const dir = tmp();
    const lockfile = path.join(dir, '.starnet-workspace-owner.json');
    const claim = JSON.stringify({ version: 1, pid: process.pid, nonce: 'abc', startedAt: Date.now() - 1000 });
    fs.writeFileSync(lockfile, claim);
    const owner = makeWorkspaceOwner({ fs, path, now: () => Date.now(), bootedAt: () => Date.now() - 100 });
    const r = owner.acquire(dir);
    A.eq(r.ok, false, 'holder with live PID is NOT reclaimed');
    A.eq(r.code, 'WORKSPACE_BUSY', 'returns WORKSPACE_BUSY for live holder');
    A.eq(r.holder.valid, true, 'holder is valid');
    A.eq(r.holder.pid, process.pid, 'holder PID is our own');
  }

  // ---- E. holderDead logic: valid holder predating boot IS reclaimed ----
  //    Simulate by checking that holderDead returns true for a holder whose startedAt
  //    predates bootedAt. We exercise this through acquire() with a bootedAt that makes
  //    the holder's startedAt predate boot.
  {
    const dir = tmp();
    const lockfile = path.join(dir, '.starnet-workspace-owner.json');
    const now = Date.now();
    const bootTime = now - 5000; // boot was 5s ago
    const holderStartedAt = now - 200000; // holder started ~3.3 min before boot
    const claim = JSON.stringify({ version: 1, pid: 5555, nonce: 'abc', startedAt: holderStartedAt });
    fs.writeFileSync(lockfile, claim);
    const owner = makeWorkspaceOwner({ fs, path, now: () => now, bootedAt: () => bootTime });
    const r = owner.acquire(dir);
    A.eq(r.ok, true, 'holder that started before boot IS reclaimed');
    owner.release();
  }

  A.report('workspace-owner-conservative-reclaim.test');
})().catch(e => { console.log('FAIL: ' + (e && e.stack || e)); process.exit(1); });

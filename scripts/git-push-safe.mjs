#!/usr/bin/env node
// Pre-push safety check: report ahead/behind vs remote for the current branch.
// Read-only — does not fetch, pull, merge, rebase, or push.
//
//   node scripts/git-push-safe.mjs          # current branch vs its remote counterpart
//   node scripts/git-push-safe.mjs <branch> # specific local branch
//
// Exits 0 when the branch can fast-forward to remote (local <= remote),
// nonzero when local is ahead of remote (a plain push would be rejected
// as non-fast-forward) or when there is no remote tracking branch.

import { execFileSync } from 'node:child_process';

const branch = process.argv[2] || null;

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

function main() {
  let target = branch;
  if (!target) {
    target = git('rev-parse', '--abbrev-ref', 'HEAD');
  }

  const hasRemote = git('rev-parse', '--verify', `--quiet`, `refs/remotes/origin/${target}`) !== '';
  if (!hasRemote) {
    console.error(`No remote tracking branch for origin/${target}`);
    return 1;
  }

  const behind = git('rev-list', `--count`, `HEAD..origin/${target}`) || '0';
  const ahead = git('rev-list', `--count`, `origin/${target}..HEAD`) || '0';

  const b = Number(behind);
  const a = Number(ahead);

  console.log(`Branch: ${target}`);
  console.log(`  local  is ${a} commit(s) ahead  of origin/${target}`);
  console.log(`  remote is ${b} commit(s) behind local`);

  if (a > 0 && b > 0) {
    console.error('\nBranches diverged: remote has commits you lack, and you have commits remote lacks.');
    console.error('Do not force-push. Options: merge, rebase, or investigate remote first.');
    return 2;
  }
  if (a > 0) {
    console.error(`\nLocal is ${a} commit(s) ahead of remote: a plain push would be rejected (non-fast-forward).`);
    console.error('Integrate remote changes first (pull/merge/rebase), then push.');
    return 1;
  }
  if (b > 0) {
    console.log(`\nRemote is ${b} commit(s) ahead: you can fast-forward (pull) before pushing.`);
    return 0;
  }
  console.log('\nLocal and remote are in sync. Push is safe.');
  return 0;
}

process.exit(main());

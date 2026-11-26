---
fingerprint: 2ba9cd3e
slug: ledger-reconcile-json-output-is-cut-off-at-the-p
title: ledger-reconcile --json output is cut off at the pipe buffer (process.exit right after stdout.write), so test:fast halts at step 304
surface: release
severity: P2
status: open
found: 2026-11-25
lane: fix/reconcile-json-flush
fix:
origin: audit
---

# ledger-reconcile --json output is cut off at the pipe buffer (process.exit right after stdout.write), so test:fast halts at step 304

## Symptom

`test/ledger-reconcile.test.js` fails one assertion, `--json prints the result object`, and because
`scripts/run-test-list.mjs` stops at the first red step, `npm run test:fast` now halts at step 304 of 1,018 —
before the long-documented `qa-product-perfect-claims` failure at step 310. Nothing in the test or the CLI
changed; the bug register simply grew past the size a pipe can take before the process exits.

## Repro

1. `cd ~/starnet`
2. `node scripts/qa/ledger-reconcile.mjs --no-write --no-run --json --ci --stale-days 99999 | wc -c` → `131072`
   (exactly 128 KiB), although the full JSON is 151,935 bytes.
3. The same command redirected to a FILE (`> out.json`) writes all 151,935 bytes and the JSON parses.
4. `node test/ledger-reconcile.test.js` (or through the runner) → `FAIL: --json prints the result object`,
   `1 problem(s), 81 ok`, exit 1.

## Evidence

Observed 2026-11-25 on the station phone (Node v26.4.0, Termux/Android), credential vars stripped, HEAD
`a951b8967` plus the uncommitted session-d2ab07f3 test-harness changes (none of which touch this CLI or test —
`git status` shows both files clean; last changed `d0324708b`, 2026-09-24).

- Defective code: `scripts/qa/ledger-reconcile.mjs` line 610 `if (args.json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');`
  followed by `process.exit(0)` (line 622) / `process.exit(3)` (line 618). On this platform the write to a pipe
  has not drained when `process.exit()` runs, so the reader gets only what fit in the pipe.
- A replica of the test's own call (`spawnSync(node, [cli, '--no-write','--no-run','--json','--ci','--stale-days','99999'], {encoding:'utf8'})`),
  run 3×: `status 0`, `stdout len 145858` every time, `JSON.parse` → `Unterminated string in JSON at position 145858`.
  ~~Deterministic, size-dependent — not flaky.~~ **CORRECTED 2026-11-26: the TEST is intermittent.** Re-check
  (credential vars stripped, same device): the shell-pipe repro (`… --json … | wc -c`) still prints `131072` in
  3 of 3 runs while the same command to a file writes all 158,000 bytes and parses; but `node
  test/ledger-reconcile.test.js` passed once (`OK (82 assertions)`) and failed once (`1 problem(s), 81 ok`), and
  the full step-by-step `test:fast` gate of 2026-11-26 had step 304 GREEN. So whether `spawnSync` gets the whole
  output depends on drain timing; the cliff is real, the gate failure is not guaranteed.
- [Likely, computed not replayed] HEAD alone is also over the limit: the register JSON is ~152 KB with 229
  records (~660 bytes each); the one record added by the uncommitted work (`7e750ab7`) is <1 KB of it.

Siblings (not audited one by one): every CLI under `scripts/` that prints a large result with
`process.stdout.write`/`console.log` and then calls `process.exit()` has the same cliff. Same family as the
`A.report()` → `process.exit()` ordering in `qa/bugs/2c50b150-*`.
Fix direction (not done): set `process.exitCode` and return instead of `process.exit(...)`, or write with
`fs.writeSync(1, ...)`. Regression: the existing assertion in `test/ledger-reconcile.test.js` already catches it.

## Verdict

_Filled in when the bug leaves the backlog: what was true, and why it is closed._

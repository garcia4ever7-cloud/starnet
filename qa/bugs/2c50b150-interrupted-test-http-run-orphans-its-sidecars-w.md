---
fingerprint: 2c50b150
slug: interrupted-test-http-run-orphans-its-sidecars-w
title: Interrupted test:http run orphans its sidecars, which keep the real provider keys behind a public fixture token
surface: release
severity: P1
status: open
found: 2026-11-25
lane: fix/test-sidecar-orphans
fix:
origin: audit
---

# Interrupted test:http run orphans its sidecars, which keep the real provider keys behind a public fixture token

## Symptom

After a `test:http` run is cut short, the test sidecars it spawned keep running indefinitely as
orphans (parent PID 1). Each one still holds the developer's real provider credentials (e.g. the
real `KLING_API_KEY`) and answers authenticated API calls for a token that is a literal string in
this public repository. Their scratch folders are never removed either.

## Repro

1. In a shell that has sourced `~/.config/starnet/env` (as the CLAUDE.md cheat sheet instructs),
   start `npm run test:http` (or `node test/workspace-lineage.http.test.js`).
2. Interrupt the run while a step is between `spawn(...)` and its `finally` block — kill the test
   process, close the terminal, or let an outer timeout SIGKILL it.
3. `pgrep -af sidecar/index.js` still lists the step's sidecar, now with parent PID 1.
4. `tr '\0' '\n' < /proc/<pid>/environ | grep -oE '^[A-Z_]*KEY='` lists the real provider keys.
5. `curl -H 'x-starnet-token: workspace-lineage-http-token-32bytes' http://127.0.0.1:<SKYNET_PORT>/api/cron`
   → 200 (403 without the header).

Root causes, both machine-checkable:
- Cleanup lives only in each test's own `finally` (`test/workspace-lineage.http.test.js:144`
  `child.kill('SIGKILL')`, `test/update-preparation.http.test.js:82`), which never runs when the test
  process itself is killed; Node gives the child no parent-death signal, so it is re-parented to init.
  The runner's per-step `rmSync(profile, …)` (`scripts/run-test-list.mjs`) is skipped the same way.
- Environment is inherited wholesale: `scripts/run-test-list.mjs` spawns each step with
  `env: Object.assign({}, process.env, hermetic)` — the "hermetic profile" isolates HOME/APPDATA but
  not credentials — and the tests do the same (`test/workspace-lineage.http.test.js:58`
  `Object.assign({}, process.env, {`), blanking only `SKYNET_OPENROUTER_KEY` / `STARNET_OPENROUTER_KEY`.
  18 test files use `Object.assign({}, process.env` and 76 spawn `sidecar/index.js`.

## Evidence

Observed on the live device 2026-11-25 (read-only, then stopped with the owner's approval):

| | PID 10757 | PID 10883 |
|---|---|---|
| Started | 2026-11-22 09:55:18 PST, parent PID 1 (up 55 h) | 2026-11-22 09:55:20 PST, parent PID 1 |
| Spawned by | `test/workspace-lineage.http.test.js` (via `npm`, `CLAUDECODE=1`) | `test/update-preparation.http.test.js` |
| Port | 36155 (127.0.0.1) | 44049 (127.0.0.1) |
| `KLING_API_KEY` | 57 chars, SHA-256 prefix `6ab63dd701a4` = the live station's key | same |
| `ANTHROPIC_AUTH_TOKEN` | 35 chars, prefix `3e72f1e0e062`, origin unknown (not in the station env) | same |
| `GET /api/cron` with the fixture token | 200 (without: 403) | 200 (without: 403) |
| Activity since boot | none (empty `proc-ledger.json`, no runs) | none |

- Exposure, not observed misuse: the sidecars bind 127.0.0.1 only (`sidecar/index.js`
  `server.listen(PORT, '127.0.0.1'`), so the reachable set is processes on the device. Any of them
  that knows the public fixture token could have driven runs billed to the real Kling key.
- 29 more orphaned scratch folders were found in `$PREFIX/tmp` from earlier interrupted runs:
  12 `starnet-lineage-http-*`, 10 `starnet-update-http-*`, 7 `starnet-gate-profile-*` (~3 MB).
- Clean-up done 2026-11-25 (owner-approved): both PIDs stopped with SIGTERM, their 2 folders and
  the 29 others deleted. The defect itself is NOT fixed.

## Verdict

_Filled in when the bug leaves the backlog: what was true, and why it is closed._

## Siblings

- Every `*.http.test.js` that spawns `sidecar/index.js` with `Object.assign({}, process.env, …)` and
  cleans up only in `finally` shares both halves of the defect; `test/workspace-lineage.http.test.js`
  and `test/update-preparation.http.test.js` are the two observed leaking. Not individually audited.
- `test/helpers/sidecar-fixture.js` applies the same hermetic-profile isolation for directly invoked
  fixture tests — check it for the same credential inheritance.
- `scripts/run-test-list.mjs` drives both `test:fast` and `test:http`, so `test:fast` steps that boot
  a sidecar inherit credentials the same way.

Fix direction (not done): scrub credential-shaped variables (`*_KEY`, `*_TOKEN`, `*_SECRET`) from the
runner's and the tests' spawn env unless a test opts in, and give each spawned sidecar a lifetime
bound to its parent (e.g. a parent-PID watchdog or a stdin-close exit) so an interrupted run cannot
leave it serving.

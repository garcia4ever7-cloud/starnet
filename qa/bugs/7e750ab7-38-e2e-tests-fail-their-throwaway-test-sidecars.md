---
fingerprint: 7e750ab7
slug: 38-e2e-tests-fail-their-throwaway-test-sidecars
title: 38 e2e tests fail: their throwaway test sidecars default to production DISARMED, so mocked metered runs are refused
surface: release
severity: P2
status: open
found: 2026-11-25
lane: fix/e2e-arm-test-sidecars
fix:
origin: audit
---

# 38 e2e tests fail: their throwaway test sidecars default to production DISARMED, so mocked metered runs are refused

## Symptom

42 of the 113 e2e steps in `test/http.list` fail on this device (`npm run test:http`), even with every file
unmodified. Typical messages: `routing.sample` "⚠ Production is DISARMED, so this unattended paid run was
refused before any provider call"; `loops` / `cron.run-now` "mock provider was called" FAIL;
`openai-compat` 502; `channels.telegram` timeout. 38 of the 42 share the cause below.

## Repro

1. Credential vars stripped from env, no `STARNET_PRODUCTION_ARMED` set.
2. `node scripts/run-test-list.mjs test/http.list routing.sample.e2e` → FAIL (502 / DISARMED refusal).
3. Same with `STARNET_PRODUCTION_ARMED=1` in the outer env → OK.

Cause: each test boots `sidecar/index.js` on a fresh `mkdtemp` workspace with no `.production-arm.json`, so
`sidecar/production-gate.js` `readArmState` returns `source: 'default'` DISARMED. The tests' mock
providers are reached through the `custom` provider, which is `unmetered: false`
(`sidecar/providers/registry.js`) — correctly, a custom endpoint can be paid — so `decide()` refuses
`disarmed+metered+unattended` before the mock is called. The gate is right; the tests never armed
their sandboxes. (Commit `bd14f909c` fixed the same thing for 2 fixture tests via `armed: true`.)

## Evidence

All runs: every e2e step through `scripts/run-test-list.mjs`, credential vars stripped, live station untouched.

| Run | green / red |
|---|---|
| BEFORE (tests untouched by this fix) | 70 / 43 (two passes, identical) |
| Experiment: the 42 red steps with `STARNET_PRODUCTION_ARMED=1` in the OUTER env, no file edits | 38 of 42 green |
| AFTER: 38 files set it themselves; outer env does NOT set it | 108 / 5 |

All 38 flipped red → green; no step flipped green → red; no step left a process.

**Fix (uncommitted):** each of the 38 files sets `process.env.STARNET_PRODUCTION_ARMED = '1'` near the top
(4 lines incl. comment), which the sidecars it spawns inherit — only those throwaway temp-workspace sidecars
are armed. Product default, gate code and live station unchanged. Backups `*.bak-20261125-arm-test-sidecar`.
Each file +4 lines exactly, line endings preserved. Files: project-root, e2e.dispatch-session,
e2e.worker-access, taint-lineage, e2e.trigger-fullaccess-taint, e2e.subagent-background, e2e.mcp-connector,
e2e.idempotency, e2e.connector-readback, cron.run-now, loops, loops-check, loops-git, loops-endurance,
loops-stall, nightshift-act, nightshift-contextpack, nightshift-focus, nightshift-beat-halt,
nightshift-floor-visibility, threads, cron.session-transcript, channels.telegram, openai-compat,
routing.sample, routing.sample-provider, routing.steptest, routing.triggers, station-template-example,
growth-rating-upgrade, request-idempotency, output-only-repair, delegated-connectors, e2e.overseer,
byok-linked-credit, workflow-project, workflow-project-multibay, routing.linestats (`.e2e.test.js` /
`test/e2e.*.test.js`).

Knock-on: `test/openai-compat.e2e.test.js`, now running to the end, left `sk-v1-*` behind — `child.kill()`
did not wait, so the shutting-down sidecar rewrote its workspace after the tmp-tracker's exit cleanup.
Now `await stopChild(child)` (SIGTERM, wait, SIGKILL after 5 s) at both kill sites; 3 replays: OK (36),
nothing left. Backup `*.bak-20261125-await-exit`.

**Siblings / not fixed (different causes, files untouched by this fix):** `test/output-recovery.e2e.test.js`
(evidence-length assertion, already known), `test/image-task.e2e.test.js` (Images API request shape),
`test/e2e.attachments.test.js` ("prior dialogue run completes cleanly"),
`test/nightshift-presence.e2e.test.js` (presence expected false, got true), and
`test/browser.gauntlet.e2e.test.js` (hangs; environmental — see qa/bugs/2c50b150). Any other test that boots
a sidecar on a fresh workspace and drives a metered mock would hit this same gate: coverage gap, not audited
beyond `test/http.list` e2e steps.

## Verdict

_Filled in when the bug leaves the backlog: what was true, and why it is closed._

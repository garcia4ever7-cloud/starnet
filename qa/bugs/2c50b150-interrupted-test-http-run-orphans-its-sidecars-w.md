---
fingerprint: 2c50b150
slug: interrupted-test-http-run-orphans-its-sidecars-w
title: Test sidecars outlive their test (report() exits before cleanup; also on interruption) and keep the real provider keys behind a public fixture token
surface: release
severity: P1
status: open
found: 2026-11-25
lane: fix/test-sidecar-orphans
fix:
origin: audit
---

# Test sidecars outlive their test (report() exits before cleanup; also on interruption) and keep the real provider keys behind a public fixture token

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

**CORRECTION 2026-11-25 (second occurrence) — an interruption is NOT required. A PASSING run leaks.**
`A.report()` ends the process (`test/_assert.js` `function report` → `process.exit(...)`), and three
tests call it INSIDE `try`, so their `finally` (kill + `rmSync`) never runs on any run that reaches it:
`test/update-preparation.http.test.js` (report line 80, finally 81),
`test/workspace-lineage.http.test.js` (141/142), `test/lineage-stationless-halt.http.test.js` (102/103).
Replay, keys stripped from env: `node test/update-preparation.http.test.js` → `OK (9 assertions)`,
exit 0, and its sidecar (PID 6077) was still running with parent PID 1. Second occurrence on the live
device: PIDs 28176 / 28290, started 01:22:22Z / 01:22:23Z from two PASSING `update-preparation` runs
(old-runner replay and a direct run), holding the real `KLING_API_KEY` (prefix `6ab63dd701a4`), each
burning ~75% / ~50% of a CPU core for an hour against its already-deleted workspace. Stopped by PID
with the owner's approval after an identity check, together with 6077. The reverted runner fix
(parent-death guard) would have masked this; the direct cause is the report-before-finally order.
The "interrupted" root cause below is still real, but it is the less common path.

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

**Partial fix 2026-11-25 (uncommitted): the three named tests now call `A.report()` AFTER their `finally`.**
Backups `*.bak-20261125-report-after-finally`. Replay, credential vars stripped from env, live station untouched:

| Test | BEFORE (report inside try) | AFTER (report after finally) |
|---|---|---|
| `update-preparation.http` | OK (9), sidecar 4692 left (ppid 1), 1 folder | OK (9), 0 sidecars, 0 folders |
| `workspace-lineage.http` | OK (29), sidecar 5187 left, 1 folder | OK (29), 0 sidecars, 0 folders |
| `lineage-stationless-halt.http` | OK (10), no sidecar (stopped before report), 1 folder | OK (10), 0 folders |

Planted failing assertion in a copy of `update-preparation.http`: `1 problem(s), 8 ok`, exit 1, no sidecar left
(failure still turns red). Through the real runner (`scripts/run-test-list.mjs test/http.list …` the 3 steps):
`OK — 3 step(s) green`, no sidecar, no new folder. `source-text-integrity` OK.
Regression coverage GAP: no registered test asserts "no process/folder survives a step"; the proof is the replay.

**Seven siblings with the same order — FIXED the same way 2026-11-25 (uncommitted, owner's yes).** Backups
`*.bak-20261125-report-after-finally`. Keyless replay, BEFORE → AFTER:

| Test | List | BEFORE | AFTER |
|---|---|---|---|
| `attachments` | fast | OK (25), 1 folder | OK (25), nothing left |
| `update-preparation` | fast | OK (21), 1 folder | OK (21), nothing left |
| `workspace-lineage` | fast | OK (86), 1 folder | OK (86), nothing left |
| `workspace-owner` | fast | OK (34), 1 folder | OK (34), nothing left |
| `workspace-recovery` | fast | OK (66), 1 folder | OK (66), nothing left |
| `workspace-owner.e2e` | http | OK (9), root + `.generations` folder, **no process** | OK (9), only the `.generations` folder |
| `loops-endurance.e2e` | http | FAILS (pre-existing, below), `.generations` folder | same failure, same folder |

My earlier "[Code inspection] leaks a sidecar every run" for the two e2e tests was WRONG: neither left a
process in the replay (workspace-owner.e2e's children exit on their own; loops-endurance fails before
report, so its finally already ran). Runners: `npm run test:fast -- <the 5 + source-text-integrity +
test-list-runner>` → 8 steps green; `run-test-list.mjs test/http.list` on workspace-owner.e2e + the 3 http
tests → 4 steps green; no sidecar left.

**`.generations` leftover — FIXED in the two e2e tests 2026-11-25 (uncommitted, owner's yes).** The sidecar
elects recovery ownership OUTSIDE its workspace (`sidecar/workspace-recovery.js`, `filename:
path.basename(current) + '.recovery-owner.json'`, acquired in `path.dirname(current)`) and
`sidecar/workspace-owner.js` never deletes generations by design. So the tests now also remove
`<workspace>.recovery-owner.json` and `<workspace>.recovery-owner.json.generations` in their `finally`
(`loops-endurance` captures `fixture.workspace` before `dispose()`). Backups
`*.bak-20261125-generations-cleanup`. Keyless replay: `workspace-owner.e2e` OK (9), no process, no leftover;
`loops-endurance.e2e` still fails (pre-existing, below) but now leaves no process and no folder.
**Helper FIXED too (2026-11-25, uncommitted, owner's yes):** `test/helpers/sidecar-fixture.js` gained
`removeWorkspace()` (workspace + `.recovery-owner.json` + `.recovery-owner.json.generations`), used by
`dispose()` and the process-exit sweep. Backup `*.bak-20261125-generations-cleanup`. BEFORE (old helper, an
interrupted suite pass): `scout.e2e` and `auxbudget.e2e` each left `.generations` folders. AFTER, keyless:
`auxbudget.e2e` OK (6), nothing left; `loops-endurance.e2e` same pre-existing failure, nothing left.
53 e2e steps in `http.list` use the helper and are covered by this.
**All e2e steps — FIXED 2026-11-25 (uncommitted, owner's yes) with `test/helpers/tmp-tracker.js`.**
`track(dir)` records a temp dir; one `process.on('exit')` removes every tracked dir plus its
`.recovery-owner.json` / `.recovery-owner.json.generations` siblings — also after a FAILING test, which used
to skip its cleanup. 57 e2e files: each `fs.mkdtempSync(...)` wrapped in `track(...)` (90 calls) + one
`require` line; every file is exactly +1 net line, line endings preserved (3 CRLF files). Backups
`*.bak-20261125-tmp-tracker`. `sidecar-fixture.js` exit sweep now also removes `fixture.profile`.

Evidence — all 113 e2e steps of `test/http.list`, each through `scripts/run-test-list.mjs`, credential vars
stripped, live station untouched:

| | BEFORE (1 pass) | AFTER pass 1 | AFTER pass 2 |
|---|---|---|---|
| green / red | 71 / 42 | 70 / 43 | 70 / 43 |
| steps leaving a process | 0 | 0 | 0 |
| steps leaving tmp entries | 60 | 2 | 2 |

The 2 remaining are the browser tests (`station-layout.e2e.test.mjs`, `browser.gauntlet.e2e`), whose
leftovers are Chromium's own `org.chromium.Chromium.*` / `pulse-*` dirs — deliberately not changed.
AFTER pass 1 and pass 2 agree on every step's exit code.

**The one exit-code change is NOT from this fix:** `browser.gauntlet.e2e` passed (25 s) in BEFORE and timed
out at 600 s in both AFTER passes and a standalone rerun. The file is unmodified and every one of the 9 repo
files it loads is unmodified (`git status` empty; only test file loaded is `test/_assert.js`). A spawn log
shows it launches Chromium twice, SIGKILLs both ~25 s in, then waits silently with no timeout. A plain
`chromium-browser --headless=new --dump-dom about:blank` works. Environmental / flaky; not investigated further.

**The 42–43 red e2e steps are pre-existing and unrelated** (files untouched): sampled 5 — the test sidecar
starts with production DISARMED, so the mock provider is never called (`routing.sample` quotes
"Production is DISARMED…"; `loops`, `cron.run-now`: "mock provider was called" FAIL; `openai-compat`
502; `channels.telegram` timeout). [Likely] most of the rest share that cause; not audited.
- `test/loops-endurance.e2e.test.js` FAILS on HEAD, unrelated to this fix: `timed out waiting for the
  two-turn pass to hang after its read-only tool result` — its fixture workspace has production DISARMED, so
  the loop is refused 3× ("Production is DISARMED, so this unattended paid run was refused…") and pauses.
  Not previously recorded. Exit 1, $0, no process left.
- The 1,666 old `$PREFIX/tmp/starnet-*` folders (2.2 GB) from earlier runs are still there.

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

**Re-checked 2026-11-25 later (session 085a8b6e), read-only on the live station.** Title reworded to the
corrected root cause (identity = surface + slug, unchanged). `pgrep -af sidecar/index.js` → only PID 5766, parent
5722 = `start-starnet.sh`; `.spend-pending/` empty; health ok. `scripts/run-test-list.mjs` and `test/fast.list`
are byte-identical to HEAD (the reverted runner fix is not applied).
- **Credential exposure is not over:** `/clear` does not restart Claude Code, so the session that removed the key
  from `~/.claude/settings.json` (PID 27670) still exports `KLING_API_KEY` to everything it spawns; a shell that
  followed the CLAUDE.md cheat sheet (`set -a; . ~/.config/starnet/env`) exports every station key. Only a
  credential scrub in the runner covers those paths; the direct-cause fixes above do not.
- **Reverted runner fix, evaluated [Recommendation]:** re-apply the env scrub (with an explicit opt-in variable
  for tests that deliberately use a real key) — it removes the harm on every path. Hold the parent-death guard
  unless it fails the step loudly when it fires: silently killing orphans would have hidden the
  report-before-finally defect that this record found.
- **tmp inventory corrected:** the "1,666 `starnet-*` folders, 2.2 GB" are 2,187 MB, of which **2,042 MB are 13
  `starnet-webreader-<pid>` Chromium profiles** written by the LIVE station's web reader
  (`sidecar/tools/builtin/webreader.js` `'starnet-webreader-' + process.pid`, `cleanupProfile: true`), dated
  2026-10-19 … 11-02, every owning PID dead. [Code inspection] `sidecar/tools/builtin/browser.js` removes the
  profile only on a clean close, so a sidecar killed for a restart leaves it — a sibling leak in production
  code, not tests; not filed separately, not fixed. Test debris proper: ~145 MB of `starnet-*`, 1,855
  `*.recovery-owner.json*` entries (16 MB), 1,285 `sk-*` (14 MB). Nothing deleted.
- Full `test:fast` measured step by step, keyless: see `memorial/MEMORIAL_SESSION_HANDOFF.md` §1b. New
  halt point is step 304, `qa/bugs/2ba9cd3e-*` (unrelated to this record).

**Runner key scrub RE-APPLIED 2026-11-25 (session 085a8b6e, owner chose "key scrub only"; uncommitted).**
`scripts/run-test-list.mjs` `stepEnv()` removes every variable matching `CREDENTIAL_NAME`
(`*KEY*`/`*TOKEN*`/`*SECRET*`/`*PASSWORD*` names) from each step's env unless `STARNET_TEST_KEEP_CREDENTIALS=1`.
The parent-death guard was NOT re-applied. Backups `*.bak-20261125-key-scrub`. Regression: 4 new assertions in
`test/test-list-runner.test.js` (12 total, in `test/fast.list`).
Replay, probe step printing its credential-shaped env names, `KLING_API_KEY=fake-k ANTHROPIC_AUTH_TOKEN=fake-t`:
old runner → `ANTHROPIC_AUTH_TOKEN KLING_API_KEY`; new runner → `(none)`; new runner with the opt-in → keys kept.
Live case from THIS Claude process (which still holds the real `KLING_API_KEY`), no manual stripping:
`run-test-list.mjs test/http.list test/update-preparation.http.test.js` → green; its test sidecar 19791 held only
the test's own fixture vars (`SKYNET_API_TOKEN`, blank `SKYNET_OPENROUTER_KEY`/`STARNET_OPENROUTER_KEY`), no
Kling key; nothing left running afterwards. Gap: a test run directly (`node test/x.test.js`, not through the
runner) still inherits the caller's env.
**tmp cleanup done 2026-11-25 (owner's yes):** 3,109 entries whose owners were dead (13 web-reader profiles, all
`starnet-*`, `sk-*`, `*.recovery-owner*`; nothing in use, nothing newer than 2 min) deleted; `$PREFIX/tmp`
9,591 → 7,386 MB; station health ok. `video-prov-*` and Claude scratchpads untouched.

---
fingerprint: 062379c5
slug: checkpoint-ceiling-sweep-re-runs-on-every-mutati
title: Checkpoint ceiling sweep re-runs on every mutating tool call when it cannot shrink the repo
surface: safecell
severity: P1
status: fixed
found: 2026-10-27
lane: owner/perf
fix: 05fc43716
origin: owner
report: Owner report 2026-10-27 — "my whole phone gets very slow when StarNet is running and I talk to NIGHT4CHRIST; it started recently"
affected: v0.12.5 on feat/harness-backend at 890c7bea2; Termux/Android arm64 (SM-F971U), Node v26.4.0; reproduced live on runs e5b4d682 (before) and 8be1f17d (after)
family: host-resource-cost
installer: not-applicable
installerEvidence: The fix is in the sidecar's checkpoint store (sidecar/checkpoint-store.js) and was verified against the live station through a restarted sidecar (pid 4638, started 07:29:52, newer than the 07:25:59 file mtime). No installer candidate has been cut, so there is no packaged artifact to verify.
recovery: unconfirmed
---

# Checkpoint ceiling sweep re-runs on every mutating tool call when it cannot shrink the repo

## Symptom

The owner's phone becomes very slow whenever StarNet is running and they talk to NIGHT4CHRIST.
It started recently. The station looks healthy — idle CPU is ~1-8% of one core, memory is fine,
there are no duplicate sidecars — but the moment the agent writes a file the device heats up and
everything else on the phone stutters for ~20 seconds. Nothing in the UI reports anything wrong.

## Repro

Known start state: the live station on Termux, sidecar up, NIGHT4CHRIST (`agent`) with a work tree
larger than `MAX_REPO_BYTES_DEFAULT` (500MB) — on this device `workspaces/agent/` was 1.66GB,
1.58GB of it 252 tracked 20-27MB 300-PPI print PNGs under `outbox/`.

1. `POST /api/run` one short message to `agentId: agent` that causes any mutating tool call
   (`fs.write`, `shell.exec`, …): *"Write the single line PERF-PROBE-1 into work/perf-probe.txt."*
2. Sample CPU and `/sys/class/thermal/thermal_zone0/temp` every 2s during the reply.
3. `grep "over ceiling" ~/.local/state/starnet/sidecar.log`.
4. Repeat step 1. Every repetition pays the same cost — the sweep never converges.

## Evidence

**The defective code.** `sidecar/checkpoint-store.js` `enforceSizeCeiling()` ran unconditionally
after every real commit, with no memory of whether the previous sweep achieved anything:

```js
try { await git(aid, scope, ['gc', '--prune=now', '-q']); } catch (_) {}
let after = dirBytes(gitDir);
if (after > maxRepoBytes) { reinit = await reinitFromCurrentTree(aid, scope); after = dirBytes(gitDir); }
```

Neither branch can succeed on this repo:

* `gc --prune=now` reclaimed **6,247 B of 1,445,275,017 B**. The objects are reachable and already
  in one 1.37GB pack (`objects/pack/pack-a97e8f59….pack`, 18KB idx — few objects, enormous content),
  so there is nothing to reclaim. Measured standalone: **8.58s**.
* `reinitFromCurrentTree` builds a one-commit baseline of the CURRENT work tree, which is 1.66GB —
  so it could never land under a 500MB ceiling even on success. In practice it never got there:
  its `git add -A` needs **46.12s** to hash the tree against the **15000ms** `execFile` timeout in
  `sidecar/index.js` `runGitCheckpoint` (line ~8616), so it was killed, `cleanup()` deleted the
  partial repo, and it returned `false` every time.

**The log said so 14 times and nobody read it** — and said it misleadingly, printing a reassuring
`-> gc ->` beside two near-identical numbers:

```
[checkpoint] shadow repo for agent over ceiling (1445275017B) -> gc -> 1445268770B
```

**Live reproduction (before).** One short message, `agent.run.end reason=done, turns=4, usd=0.1255`:

```
  t(s)  sidecar%      git%   rssMB   degC
     3        2%        0%     108   38.7
    12        6%       69%     119   61.6
    14        1%      211%     126   64.3
    16        5%      216%     115   67.1   <-- git pegging 2+ cores
    20       11%      217%     119   62.0
    25        8%      217%     118   57.4
    27        4%    (exited)   124   50.8
```

CPU temperature **38.7C -> 67.1C in 12 seconds**; thermal throttling is what the owner feels as
"the whole phone gets slow". The run's model work finished at t≈20s; the git churn outlived it.

**A/B of the changed path**, three consecutive `enforceSizeCeiling()` calls against the real repo,
same wiring as the sidecar (same `runGit`, same 15s timeout, same 500MB default), CPU measured as
`/proc/self/stat` 14+15+16+17 so reaped `git` children are counted:

| | call 1 | call 2 | call 3 | total |
| --- | --- | --- | --- | --- |
| shipped (`checkpoint-store.js.bak`) | 19.07s wall / 18.01s cpu | 21.21s / 20.08s | 21.78s / 20.80s | **62.05s wall, 58.89s cpu** |
| fixed | 6.59s / 5.00s | 0.00s / 0.00s `deferred` | 0.00s / 0.00s `deferred` | **6.59s wall, 5.00s cpu** |

Bytes reclaimed in both cases: effectively zero. The shipped code paid ~20s of CPU *per mutating
tool call, forever*, for a byte-for-byte identical repo.

**Live re-test (after).** Same message shape, steady state (`PERF-PROBE-4`, `reason=done`,
`checkpoint.created files=377 bytes=1739121487`, file on disk contains `PERF-PROBE-4`):

```
wall 3s;  peak 22% of one core;  peak temp 46.5C;  total sidecar+git CPU over an 80s window 2.89s
```

and the log now states the truth instead of implying progress:

```
[checkpoint] shadow repo for agent over ceiling (1445270323B) -> gc -> 1445270323B — STILL OVER
CEILING (524288000B); re-init refused: work tree alone is 1739121487B; no further sweeps until it
grows past 1806587903B
```

## Verdict

Fixed in `05fc43716` on `feat/harness-backend`.

Two independent defects in `enforceSizeCeiling`, both fixed in `sidecar/checkpoint-store.js`:

1. **No memory of a failed sweep.** A sweep that ends still over the ceiling is now recorded in a
   per-`(agent, scope)` `sweepMemo` and not retried until the repo grows `SWEEP_RETRY_GROWTH`
   (1.25x) past that size. Process-local by design: one sweep per repo per boot is a bounded,
   honest cost, and a restart is exactly when re-measuring is cheap.
2. **A provably futile re-init was attempted anyway.** A re-init baseline is one commit of the
   current work tree, so it can never be smaller than that tree. When the tree alone exceeds the
   ceiling the re-init is refused — it would otherwise hash the whole tree and destroy every
   rollback point the Commander has, to land over the ceiling regardless. `dirBytes` on the live
   1.66GB tree measured **8ms**, so the check is free next to what it prevents.

The log line now names the ceiling, the refusal reason and the next retry threshold, so the
station stops asserting progress it did not make.

**Not fixed, and deliberately so:** the underlying condition is that 1.58GB of print deliverables
live inside `workspaces/agent/outbox/` and are therefore tracked by the rollback net. Moving or
archiving them is the owner's call about their own product files, not a code change. Until then
the repo stays over the ceiling and the station correctly says so once per boot.

## Regression

**Before the fix (live, pre-`05fc43716`).** Three consecutive `enforceSizeCeiling()` calls against
the real `agent` repo, wired exactly as the sidecar wires it (same `runGit`, same 15s `execFile`
timeout, same 500MB default ceiling), CPU read from `/proc/self/stat` fields 14+15+16+17 so reaped
`git` children are counted:

```
module: sidecar/checkpoint-store.js.bak        (the shipped code)
  call 1: wall=19.07s  cpu=18.01s  {"swept":true,"reinit":false,"deferred":false,"before":1445272132,"after":1445270323}
  call 2: wall=21.21s  cpu=20.08s  {"swept":true,"reinit":false,"deferred":false,"before":1445270323,"after":1445270323}
  call 3: wall=21.78s  cpu=20.80s  {"swept":true,"reinit":false,"deferred":false,"before":1445270323,"after":1445270323}
  TOTAL over 3 calls: wall=62.05s  cpu=58.89s
```

Every call swept; no call reclaimed anything. Live, this showed as git at **216% of one core for
~15s** and CPU temperature **38.7C -> 67.1C in 12 seconds** on a single short message.

**After the fix (same repo, same minute).**

```
module: sidecar/checkpoint-store.js            (fixed)
  call 1: wall=6.59s  cpu=5.00s  {"swept":true,"reinit":false,"deferred":false,...}
  call 2: wall=0.00s  cpu=0.00s  {"swept":false,"reinit":false,"deferred":true,...}
  call 3: wall=0.00s  cpu=0.00s  {"swept":false,"reinit":false,"deferred":true,...}
  TOTAL over 3 calls: wall=6.59s  cpu=5.00s
```

**After, through the live station** (restarted sidecar pid 4638, started 07:29:52, newer than the
07:25:59 file mtime, so `require` cache cannot mask it). `POST /api/run agentId=agent
provider=anthropic model=claude-sonnet-5-5`, run `8be1f17d`, `reason=done`,
`checkpoint.created files=377 bytes=1739121487`, and `workspaces/agent/work/perf-probe.txt` on disk
contained `PERF-PROBE-4` — so the tool really ran:

```
wall 3s;  peak 22% of one core;  peak temp 46.5C;  total sidecar+git CPU over an 80s window 2.89s
```

**Automated:** `test/checkpoint-store.test.js` 11a asserts `deferred:true` on a repeat sweep — it
fails against the pre-fix module, which has no `deferred` field and sweeps every time — and 11b
asserts `reinit:false` when the tree alone is over the ceiling, which the pre-fix module also
fails (it attempts the re-init unconditionally). 69 assertions, now registered in `test/fast.list`.

## Sibling coverage

{
  "adapters": [
    { "target": "checkpoint-store.js enforceSizeCeiling (the gc + re-init sweep)", "state": "covered",
      "test": "test/checkpoint-store.test.js", "gate": "fast",
      "scenario": "11a/11b: the first sweep over an unwinnable ceiling sweeps and reports bytesAfter still over it; a repeat with no growth returns swept:false deferred:true and leaves HEAD intact; re-init is refused when the work tree alone exceeds the ceiling" },
    { "target": "checkpoint-store.js reinitFromCurrentTree (must still run when it CAN win)", "state": "covered",
      "test": "test/checkpoint-store.test.js", "gate": "fast",
      "scenario": "11c: with the ceiling set between the tree size and the repo size, reinit:true and the post-re-init baseline is restorable — the futility check narrows the path, it does not disable it" },
    { "target": "the sweepMemo's scope", "state": "covered",
      "test": "test/checkpoint-store.test.js", "gate": "fast",
      "scenario": "11a: a freshly constructed store re-measures the same repo rather than inheriting another instance's verdict, so the memo cannot leak across stores or outlive a restart" }
  ],
  "entrypoints": [
    { "target": "commitSnapshot (the ONLY caller of enforceSizeCeiling)", "state": "covered",
      "test": "test/checkpoint-store.test.js", "gate": "fast",
      "scenario": "section 11 drives four real snapshot() calls under a 1-byte ceiling, which is the production path: snapshot -> commitSnapshot -> enforceSizeCeiling" },
    { "target": "snapshot() from a mutating tool (sidecar/index.js ~18411 and ~20258)", "state": "covered",
      "test": "test/checkpoint-store.test.js", "gate": "fast",
      "scenario": "both call sites funnel into the same snapshot() -> commitSnapshot; there is no second sweep-invoking path. Verified live besides: run 8be1f17d emitted checkpoint.created with no sweep." },
    { "target": "restoreDetailed()'s pre-restore snapshot", "state": "not-applicable",
      "reason": "it calls commitSnapshot with skipCeiling:true, so it never reaches enforceSizeCeiling by construction — test/checkpoint-restore-undoable.test.js (45 assertions, in fast.list) still passes unchanged." }
  ],
  "displays": [
    { "target": "the [checkpoint] over-ceiling console line", "state": "covered",
      "test": "test/checkpoint-store.test.js", "gate": "fast",
      "scenario": "the sweep now returns {swept, reinit, deferred, bytesBefore, bytesAfter} and the log prints the ceiling, the refusal reason and the next retry threshold; 11a/11b assert the returned verdict fields the line is rendered from. The literal string is not pinned — the structured return is." },
    { "target": "checkpoint.created SSE / war-room HUD", "state": "not-applicable",
      "reason": "emitted by index.js from snapshot()'s result, which this change does not touch; the live run 8be1f17d emitted it with unchanged shape (files=377 bytes=1739121487)." }
  ],
  "lifecycle": [
    { "target": "a repo that comes back UNDER the ceiling later", "state": "covered",
      "test": "test/checkpoint-store.test.js", "gate": "fast",
      "scenario": "the memo is deleted on the under-ceiling early return, so a shrunk repo is not permanently marked unsweepable; the 1<<30-ceiling store asserts swept:false on the same repo" },
    { "target": "the memo across a sidecar restart", "state": "covered",
      "test": "test/checkpoint-store.test.js", "gate": "fast",
      "scenario": "11a's fresh-store assertion IS the restart case — a new process builds a new store and re-measures, which is the intended bounded cost of one sweep per repo per boot" },
    { "target": "other agents' shadow repos as they grow past the ceiling", "state": "covered",
      "test": "test/checkpoint-store.test.js", "gate": "fast",
      "scenario": "the fix is in the shared store, so every agent inherits it. Measured today: agent 1.3G (over), webdesigner 204M, publisher 1.5M, scout 444K, harvest 414K — only agent trips it now, webdesigner is the next to do so." },
    { "target": "the underlying 1.58GB of print PNGs inside workspaces/agent/outbox/", "state": "blocked",
      "reason": "The repo stays at 1.445GB and the station correctly reports that once per boot. Shrinking it means excluding those files from the rollback net or moving them out of the agent's work tree — an owner decision about their own product files, deliberately not taken here. Written down rather than claimed." }
  ]
}

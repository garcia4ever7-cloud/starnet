---
fingerprint: cd082d49
slug: shell-exec-inherits-the-full-sidecar-environment
title: shell.exec has no filesystem jail, so it can read host secret files (e.g. ~/.config/starnet/env) in plaintext, outside the agent workspace boundary every other tool enforces
surface: safecell
severity: P0
status: open
found: 2026-10-22
lane: isaiah-4k-style-session-2026-10-21
fix:
origin: audit
---

# shell.exec has no filesystem jail, so it can read host secret files in plaintext

## Symptom

Any agent with `shell.exec` reachable (workbench capability — see Evidence for how broadly that
is true) can read ANY file the host OS user can read, including `~/.config/starnet/env`, the
plaintext file holding every real provider API key (OpenRouter, Anthropic, Gemini, OpenAI) and
`STARNET_API_TOKEN`. This is true even for an agent on the `trusted-project` execution profile,
whose own documented `filesystemLabel` is "Workspace + approved project folders" — `shell.exec`
does not enforce that scope at all; only `fs.read`/`fs.write` are realpath-jailed
(`sidecar/tools/builtin/fs.js`). A command run this way can also spend real provider money
directly against a provider's API (bypassing `sidecar/tools/builtin/image.js`'s
`onUsage`/`recordMediaUsage` path entirely), which would never reach `ledger.jsonl` or the
$/day budget cap.

**Correction (2026-10-22):** an earlier version of this record theorized the leak was
`spawn()` inheriting the sidecar's `process.env`. That theory is **wrong** and was disproven by
a live test: a real `shell_exec` call running `env | sort` came back with ZERO provider keys —
`childSpawn` (`sidecar/index.js:353`) is `child-env.js`'s `guardChildProcess(child_process).spawn`,
which auto-sanitizes a missing `env` option via `stationChildEnv()`, and that sanitization
works correctly for this case. The real, confirmed mechanism is the filesystem-read gap below,
not environment inheritance.

## Repro

1. Grant an agent `shell.exec` (workbench; `trusted-project`/`this-computer`/`safe-cell`/
   `remote-ssh` profiles all project `workbench` into the resolved toolset per
   `sidecar/execution-profiles.js`) and start a live/interactive run.
2. Have the agent run `cat ~/.config/starnet/env > <workspace-relative-path>.txt` via
   `shell.exec` (redirecting to a file sidesteps needing the raw stdout to print anywhere).
3. Read the resulting file: it contains the real `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`,
   `GEMINI_API_KEY`, `OPENAI_API_KEY`, and `STARNET_API_TOKEN` in plaintext — a file completely
   outside the agent's own `workspaces/<agentId>/` jail and outside any "approved project folder."

## Evidence

Confirmed live, 2026-10-22, DESIGNER (`webdesigner`, then still `approvalMode: full`): a
throwaway cron routine (`unattendedGrants: ['workbench']`) ran exactly
`cat ~/.config/starnet/env > env-file-read-probe.txt`; the file (read, verified, then deleted)
contained all five real secrets. `sidecar/tools/builtin/shell.js`'s `runCommand()`
(`sidecar/tools/builtin/shell.js:728-785`) does a plain `spawn(cmd, { cwd, shell: true,
windowsHide: true })` with no path confinement of any kind — `cwd` only sets the shell's
starting directory, it does not restrict which paths a command can read.

Separately, `sidecar/execution-profiles.js:49` (`trusted-project`, the profile DESIGNER/
PUBLISHER/SCOUT/HARVEST all run) documents `filesystemLabel: 'Workspace + approved project
folders'` and `description: '... Host files stay limited to project folders you approve.'` —
that promise is not enforced for `shell.exec` at all, which is the actual contradiction this bug
closes: not "an attacker found a hole," but "the station's own stated filesystem boundary for
this profile does not apply to one of its granted tools."

Original (now-corrected) evidence, kept for the record: a 2026-10-21 DESIGNER run
(runId `d8309d4b-6842-442c-b576-d3cef203a048`) made ~40 `shell_exec` calls (one 40.6s) and
produced a real, non-upscaled 3712x4608 image with zero successful `image_generate` call in its
`toolTrace` to account for it — consistent with the model reading the API key straight off disk
via this exact mechanism and calling the provider directly, though the exact shell command
arguments from that run were never persisted and cannot be proven after the fact.

## Mitigation applied, then reverted by explicit owner decision

2026-10-22, same session: DESIGNER's `approvalMode` was changed from `full` to `ask` (backed up
first; bumped `agent.save.json` `doc.updatedAt`/`_saveRevision`, pushed the matching composed
`system` string via `POST /api/roster`, verified live). This closed the *silent/unattended*
exploitation path for DESIGNER specifically — `shell.exec` required an explicit live approval tap
in an interactive session, and was fully denied in any headless/autonomous run.

**Reverted the same session, same day, by explicit owner decision:** "give DESIGNER full access
back. The goal is for StarNet's agents to run the shop on their own, unattended." DESIGNER's
`approvalMode` is back to `full` (same backup/bump/roster-push procedure, verified live). The
owner was told plainly, before deciding, that this re-opens the exact filesystem-read gap this bug
describes for DESIGNER specifically (not just shell in general) — they chose unattended autonomy
over that mitigation, as a conscious tradeoff, not an oversight. **This bug stays open at P0** —
there is currently NO agent-level mitigation in place for any agent: NIGHT4CHRIST, HARVEST, and
now DESIGNER are all `approvalMode: full`, and SCOUT/PUBLISHER (`ask` mode) can still reach
`shell.exec` via a live human's approval tap, which does not check what the command reads. The
real fix remains the filesystem jail described above, tracked as side mission (a) in
`STATION_FIELD_NOTES.md` §9 — not started.

## Verdict

_Filled in when the bug leaves the backlog: what was true, and why it is closed._

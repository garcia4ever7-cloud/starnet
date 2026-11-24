---
fingerprint: 1505860a
slug: out-of-band-roster-writer-emits-save-shaped-entr
title: Out-of-band roster writer emits save-shaped entries; next boot loads an empty roster
surface: autonomy
severity: P1
status: fixed
found: 2026-11-24
lane: remediation/scout-20261124
fix: e87ac7181
origin: audit
---

# Out-of-band roster writer emits save-shaped entries; next boot loads an empty roster

## Symptom

Re-running `scripts/integrate-christian-studio.mjs` leaves the station looking healthy until the next sidecar
restart, which then boots with **no agents in the live roster**. Cron routines dispatch to agent ids the sidecar
no longer knows, and nothing logs an error. It also silently loses its own save edit to any open browser tab.

## Repro

1. Start from a consistent workspace (`node scripts/agent-config-integrity.mjs` → `CONSISTENT`, exit 0).
2. Build a scratch workspace exactly as the script leaves it:
   `agent.roster.json` = `{version:1, updatedAt:<same as save>, agents: <save.doc.agents verbatim>}`
   (the script does `rosterJson.agents = workspaceJson.doc.agents`).
3. `WORKSPACES=<scratch> node scripts/agent-config-integrity.mjs` → `DIVERGENT — 20 problem(s)`, one
   `[roster-agentId] … has \`id\`="scout" — save-shaped record written into the roster` per agent, exit 1,
   **with a 0 ms timestamp delta** (the stamps are perfectly "synced").
4. In the sidecar, `replaceAgentRoster()` (`sidecar/index.js`, search `function replaceAgentRoster`) skips every
   entry failing `/^[A-Za-z0-9_-]{1,40}$/.test(String(a.agentId || ''))` → empty `agentRoster` at boot.

## Evidence

- Defect: `scripts/integrate-christian-studio.mjs` (pre-fix copy kept at `scripts/integrate-christian-studio.mjs.bak`)
  writes `rosterJson.agents = workspaceJson.doc.agents` (save shape: `id`, no `agentId`), bumps
  `doc.updatedAt` but **not** `doc._saveRevision` (so `sidecar/savestore.js` `compareRevision` accepts the next
  tab save over it), and never calls `POST /api/roster`.
- Drop rule: `sidecar/index.js` `replaceAgentRoster` — `const id = a && String(a.agentId || ''); if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) continue;`
- Regression: `test/agent-config-integrity.test.js` (17 assertions, registered in `test/fast.list`) pins that the
  save-shaped roster is DIVERGENT with one `roster-agentId` problem per entry, and that a timestamp delta alone is
  CONSISTENT. `npm run test:fast -- agent-config-integrity` → `1 step(s) green`.
- Live station 2026-11-24 was **not** affected: `node scripts/agent-config-integrity.mjs` → `CONSISTENT` (10 agents).

## Verdict

_Open until the fix is committed; then `node scripts/qa/bugs.mjs --set 1505860a --status fixed --fix <sha>`._

## Fix (in working tree, not yet committed)

- `scripts/integrate-christian-studio.mjs` now exits 3 before any read/write unless
  `STARNET_ALLOW_RETIRED_INTEGRATE=1` (verified: plain run prints RETIRED, exit 3).
- New read-only `scripts/agent-config-integrity.mjs` compares save vs roster by **content** (the fields
  `pushRoster()` projects) and flags agentId-less roster entries; wired as step 6 of the `starnet-live-health` skill.

## Siblings (same defect class: out-of-band agent-config writers)

- `scripts/station-models.mjs` `applyAssignment` — **correct shape** (bumps `_saveRevision`, POSTs roster with the
  same stamp) but its save write is a plain `writeFileSync`, not the store's atomic temp+rename, and a browser
  flush between its read and write is lost. **Coverage gap**, written down here; not fixed in this lane.
- Any open browser tab's `pushRoster()` stamps a fresh `Date.now()` and reverts an out-of-band roster edit (the
  roster gate is time-only). By design; documented in CLAUDE.md "Two copies of agent state". **Coverage gap.**
- `POST /api/cron/update` re-checks `skills[]` only when the patch includes `skills`; changing `agentId` alone does
  not re-validate the skills against the new agent. **Coverage gap** (adjacent, found in the same sweep).

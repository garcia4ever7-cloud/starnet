---
fingerprint: f050e860
slug: per-run-apify-scrape-limit-was-prompt-only-a-rou
title: Per-run Apify scrape limit was prompt-only: a routine run launched 8 actor runs against a 3-per-run instruction
surface: autonomy
severity: P2
status: open
found: 2026-11-25
lane: fix/apify-per-run-cap
fix:
origin: owner
report: Owner request in this session (2026-11-25) after SCOUT run 93e8cc89 used all 8 Apify runs; "determine why it ignores the three scrape limit ... guarantee a hard stop after three scrapes"
affected: This station, HEAD a951b8967 plus uncommitted work, sidecar PID 11627; desktop installer not applicable
family: host-quota-rail
installer: not-applicable
installerEvidence: Station-only source checkout on the owner's phone; no desktop installer is built from this tree and the Apify connector cap is not part of a shipped installer build
recovery: unconfirmed
---

# Per-run Apify scrape limit was prompt-only: a routine run launched 8 actor runs against a 3-per-run instruction

## Symptom

SCOUT's daily routine is told "scrape AT MOST 3 shops this run". On 2026-11-25 a Run Now of that routine
launched 8 Apify shop scrapes in four minutes and used the whole team's daily allowance of 8. No other agent
could use Apify for the rest of the day. The run itself ended `done` and reported the 8 scrapes honestly.

## Repro

Free replay (no network, no key), which is also the regression:

1. `cd ~/starnet`
2. `node test/hostquota-run-cap.test.js` — section 1 sends the exact 8-call sequence of run `93e8cc89`
   through the real `makeMcpToolDef(...).run` with the real `makeHostQuota`.
3. Against the pre-fix modules (`sidecar/hostquota.js.bak-20261125-apify-run-cap`,
   `sidecar/mcp/translate.js.bak-20261125-apify-run-cap`): all 8 calls reach the connector, daily counter 8.
4. Against the fix: 3 reach the connector, 5 are refused, daily counter 3.

Live (costs Apify runs — do not repeat for a re-check): `POST /api/cron/run` for routine `7b22107c`.

## Evidence

Observed 2026-11-25 on the station phone (Node v26.4.0), sidecar PID 11627.

- Live run `93e8cc89-b720-4e34-92ae-c1c2c781a589` (`runs.jsonl`; event stream kept in the session scratch):
  8 `agent.tool_call mcp__apify__good-apis--etsy-shop-scraper`, issued three per turn; model
  `gemini-flash-lite-latest`, 12 turns, $0.0718. `workspaces/.host-daily-quota.json` afterwards:
  `{"day":"2026-11-25","counts":{"apify.com":8}}`.
- Cause: the only host rail, `sidecar/hostquota.js` `consumeCounter(key, limit)`, counted the DAY for the whole
  team. Nothing counted a RUN. "At most 3" lived only in the routine prompt (`cron.jobs.json`, job `7b22107c`).
- Fix (uncommitted): `DEFAULT_RUN_LIMITS = { 'apify.com': 3 }` in `sidecar/hostquota.js`, counted per host-minted
  `ctx.runId`, checked BEFORE the daily counter (a refused call spends nothing). `sidecar/mcp/translate.js` and
  `sidecar/tools/builtin/web.js` pass `ctx.runId`; `sidecar/index.js` wires `HOST_RUN_LIMITS`.
- Replay output — before: `ran ran ran ran ran ran ran ran`, reached Apify 8, daily counter 8.
  After: `ran ran ran REFUSED REFUSED REFUSED REFUSED REFUSED`, reached Apify 3, daily counter 3.
- `test/hostquota-run-cap.test.js`: OK (42 assertions), registered in `test/fast.list`.
  `test/headless-dispatch.test.js` 102, `web-request` 84, `mcp.client` 78, `mcp.catalog` 1204 still green.

Siblings:
| Path | Covered |
|---|---|
| connector door (`mcp:apify` scraper tools) | `test/hostquota-run-cap.test.js` §1, §3 |
| `web_request` to `*.apify.com` | same test §4 (module level); the `web.js` call site passing `ctx.runId` is NOT exercised end to end — coverage gap |
| Run Now vs scheduled fire | both reach the same tool def; no launcher-specific code, not separately tested |
| delegated worker runs | each worker has its own `runId`, so each gets 3; bounded by the daily 8 — by design, not tested |
| a call with no `runId` | daily cap only (test §6) — written-down gap: a caller without run identity is not per-run bounded |
| NOT LIVE until the sidecar restarts | the running process (PID 11627) loaded the old modules |

## Verdict

_Filled in when the bug leaves the backlog: what was true, and why it is closed._

/* test/run-cost-cap.test.js — a per-run spend cap sent to POST /api/run must actually reach the loop.

   WHY THIS EXISTS. runOnce has always honoured an explicit `o.maxCostUsd` ("An EXPLICIT caller cap ... is
   still honored" — the runCapUsd comment), and orchestration.js relies on it for delegated workers. But the
   /api/run handler destructured only {model, system, messages, agentId, isTask, provider, fallbackModels,
   fallbackProviders} and never forwarded a cap, so `{"maxCostUsd": 0.10}` in the request body was ACCEPTED
   AND SILENTLY IGNORED — the run fell back to the station's default ceiling. A spend limit that is accepted
   and ignored is worse than no limit at all: it invites the caller to believe a $0.10 ceiling exists when the
   real one is ~10x that. This test pins the passthrough and its guard rails by reading the shipped source,
   the same technique test/outbox-window.test.js uses for browser-flow code that is not node-loadable.

   Run standalone: node test/run-cost-cap.test.js */
'use strict';

const A = require('./_assert.js');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'sidecar', 'index.js'), 'utf8');

/* ---------- 1. THE CAP IS READ FROM THE REQUEST BODY ---------- */
A.ok(/const bodyCostCap = Number\(body && body\.maxCostUsd\);/.test(src),
  'the run route reads maxCostUsd from the request body');

/* ---------- 2. AND VALIDATED BEFORE USE ---------- */
A.ok(/Number\.isFinite\(bodyCostCap\) && bodyCostCap > 0/.test(src),
  'only a finite POSITIVE cap is accepted — NaN/0/negative are rejected, never clamped');
A.ok(/const runMaxCostUsd = .*\? bodyCostCap : 0;/.test(src),
  'a rejected cap resolves to 0, which means "no explicit override" rather than "spend nothing"');

/* ---------- 3. AND ACTUALLY FORWARDED TO runOnce ---------- */
A.ok(/\.\.\.\(runMaxCostUsd > 0 \? \{ callerMaxCostUsd: runMaxCostUsd \} : \{\}\)/.test(src),
  'the validated cap is spread into the runOnce options — the step that was missing');

/* ---------- 3b. THE CALLER CAP IS LOWER-ONLY (security review, 2026-11-02) ----------
   The first version forwarded the body value as `maxCostUsd`, which runOnce uses to REPLACE the station
   ceiling — so {"maxCostUsd": 999} would have RAISED it. Worse, the comment claimed "LOWER-ONLY by
   construction", asserting a property the code did not have. Two separate authorities now exist:
     maxCostUsd       — trusted IN-PROCESS callers (orchestration.js perWorker); may differ from the default
     callerMaxCostUsd — untrusted HTTP callers; applied with Math.min, can only ever tighten */
A.eq(/\{ maxCostUsd: runMaxCostUsd \}/.test(src), false,
  'the HTTP body value is NOT forwarded as the ceiling-replacing maxCostUsd');
A.ok(/runCapUsd = Math\.min\(runCapUsd, Number\(o\.callerMaxCostUsd\)\)/.test(src),
  'an untrusted caller cap is applied with Math.min — it can only lower the ceiling, never raise it');
A.ok(/o\.maxCostUsd > 0 && isFinite\(o\.maxCostUsd\)\) \? o\.maxCostUsd/.test(src),
  'while the trusted in-process override still replaces the default, so delegated workers keep their perWorker budget');
A.ok(/LOWER ONLY/.test(src), 'and the invariant is stated at the line that enforces it');

/* ---------- 4. ABSENT CAP MUST NOT CHANGE EXISTING BEHAVIOUR ----------
   The spread is conditional, so a request with no maxCostUsd produces byte-identical options to before.
   That matters: every existing caller (the browser composer, cron Run Now, the studio pipeline) sends no
   cap and must keep the station default, not suddenly inherit 0. */
A.eq(/maxCostUsd: runMaxCostUsd \|\| 0/.test(src), false,
  'the cap is NOT passed unconditionally — an absent cap must leave the options untouched');

/* ---------- 5. THE LOOP STILL TREATS AN EXPLICIT CAP AS THE CEILING ---------- */
A.ok(/let runCapUsd = \(o\.maxCostUsd > 0 && isFinite\(o\.maxCostUsd\)\) \? o\.maxCostUsd/.test(src),
  'runOnce still honours an explicit caller cap ahead of the station default');
A.ok(/An EXPLICIT caller cap/.test(src),
  'and the invariant is documented at the seam that enforces it');

/* ---------- 6. THE BODY SHAPE THAT WAS SILENTLY DROPPED IS NOW HANDLED ----------
   Guard against a future refactor re-destructuring the body and forgetting the cap again: assert the
   destructure line and the cap read coexist, so removing one without the other is visible. */
const destructure = /const \{ model, system, messages = \[\], agentId = 'agent', isTask = true, provider, fallbackModels, fallbackProviders \} = body \|\| \{\};/;
A.ok(destructure.test(src), 'the original destructure is intact (no behaviour moved into it)');
const idxDestructure = src.search(destructure);
const idxCap = src.indexOf('const bodyCostCap');
A.ok(idxCap > idxDestructure && idxCap - idxDestructure < 1200,
  'the cap is read immediately after the destructure, where a reader will see both together');

A.report('run cost cap');

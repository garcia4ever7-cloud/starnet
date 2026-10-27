# Claude Code Instructions — StarNet Etsy Project

## Mission
Build a working, low-cost Etsy research-to-product workflow inside StarNet. Prioritize verified end-to-end behavior over green status screens, reports, or claims. Inspect the live repository first; use the best implementation path that fits the constraints below.

## Working environment
- StarNet repository: `~/starnet` (Android / Termux; phone-only workflow).
- App entry point: `node sidecar/index.js`.
- Existing fast checks: `npm run test:fast`, `npm run test:http`, `npm run qa:ready`.
- Preserve the current working tree and Android-specific fixes. The repository has had intentional modifications and `.bak` files; do not assume they are disposable.
- Before making a change to an existing file, create a same-directory backup using `cp path/to/file path/to/file.bak`, unless that exact backup already exists. Do not overwrite a useful backup.
- Prefer small, reversible changes. Do not run destructive or broad commands such as reset, clean, checkout, stash, commit, reinstall, or bulk dependency updates.

## Team and responsibilities
- **COMMANDER / NIGHT4CHRIST:** Owns orchestration, priorities, task assignment, and approval gates.
- **SCOUT:** Researches qualifying Etsy shops and market opportunities; records evidence and findings. Research/save only.
- **DESIGNER:** Creates original product concepts and, where the implemented pipeline supports it, original image assets. Do not copy competitors’ artwork, listing text, branding, or protected designs.
- **PUBLISHER:** Prepares listing drafts for human review. Must not publish live listings without explicit approval.
- **HARVEST:** Finds and ranks zero-cost income opportunities outside Etsy; sandbox/research only. No signups, submissions, purchases, or commitments without approval.

## Target workflow
Build and prove a vertical slice:
1. **Input:** Accept a clear niche, trend, shop, or product research task.
2. **Research:** Gather traceable evidence and distinguish verified facts from estimates or missing data.
3. **Opportunity decision:** Explain why the opportunity qualifies, what is uncertain, and why it ranks above alternatives.
4. **Product creation:** Generate original concepts and usable image assets when supported by configured tools; do not stop at a generic prompt if a real image-generation route is available and authorized.
5. **Profit calculation:** Show assumptions and arithmetic for price, platform/payment fees, production or fulfillment cost, API/tool costs, and estimated margin. Label unknown costs; never invent them.
6. **Listing preparation:** Produce title, tags, description, attributes, image paths, and a draft ready for human review.
7. **Persistence and handoff:** Save outputs to the intended StarNet workspace/state or a clearly documented file fallback. Include task ID, output paths, status, evidence, blockers, and required approval.
8. **Evaluation:** Test the complete path and report what actually worked, not just what the code appears to support.

## Scout qualification rules
- Target shops that appear to have opened in **2025 or 2026** and have **at least 1,000 total sales**.
- If only the year is verified, label the age **“year-level age, month unverified.”** Do not claim an exact age without evidence.
- Record source URLs, retrieval date, sales evidence, shop-age evidence, and uncertainty.
- Avoid duplicate report files and do not use Etsy itself as a research source when the current workflow’s rules exclude `etsy.com`.
- If a source does not expose a required field, mark it unknown and use only an explicitly documented proxy. Never silently convert a proxy into a fact.
- Airtable has previously been blocked by connector grant/scope issues. Do not pretend a save succeeded. Use a documented local-file fallback until Airtable is verified working.

## Spending, safety, and approval gates
Hard limits:
- Claude Code development credit: **maximum $40**.
- Total Etsy business capital: **maximum $60**.
- Apify: **maximum 8 actor runs per calendar day**.
- Prefer zero new spending until the workflow is proven.

Require explicit user approval before:
- Any new paid API call, paid model/image generation, purchase, subscription, ad spend, or other spending.
- Live Etsy publishing or changes to live listings.
- Signups, submissions, or external commitments.
- Changing credentials, account permissions, security settings, or secret-bearing configuration.
- Any action that could exceed the limits above.

Do not evade a provider’s credit/budget errors by retrying with paid calls or larger limits. Do not print, log, commit, or expose API keys, tokens, passwords, or other secrets. Use placeholders in reports and redact credentials from command output.

## Execution rules
1. Start with read-only inspection: `pwd`, `git status --short`, relevant file reads, current configuration names/status, and existing tests. Do not dump secret values.
2. Identify the single biggest confirmed blocker and explain the evidence before changing code.
3. Make the smallest effective patch. Back up each existing file before editing.
4. Run focused tests, then the relevant project gates. If a test cannot run, state exactly why.
5. Verify behavior through the real app/API or saved artifact where practical. A passing unit test alone is not proof of the full workflow.
6. Preserve all unrelated user changes. Do not “clean up” files just because they are untracked or modified.
7. Do not claim a feature is complete unless you can point to the test, response, generated asset, or saved output proving it.

## Required handoff format
For every task, report:
- **Task ID / objective**
- **Files inspected and changed**
- **Backups created**
- **Tests and actual results**
- **End-to-end evidence** (API response, output path, generated image, saved record, etc.)
- **Spend / Apify run count** (including whether any paid action occurred)
- **Blockers and uncertainty**
- **Next best action**
- **Approval needed** (or “none”)

## Definition of done
The Etsy workflow is not done merely because agents exist or a dashboard is green. It is done when a real test task can move from input through research, original product/image output, transparent profit calculation, listing draft, and saved artifact, with evidence at each stage—without unauthorized spending or publishing.

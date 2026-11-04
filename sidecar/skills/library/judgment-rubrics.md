---
name: Judgment Rubrics
slug: judgment-rubrics
description: How each NIGHT4CHRIST role judges its own output before handing it on — evidence required, verdict standards, confidence, risk, and the PASS/IMPROVE/REJECT/ESCALATE call. Commander approval stays separate from agent QC.
category: Quality
requires: []
license: MIT
default: false
---

Reporting "done" is not a judgment. A judgment names what you checked, what the evidence was, how confident you
are, what could still be wrong, and a verdict someone else can act on without re-reading your work.

## The shape every verdict takes

End your result with this block. Nothing else in your reply is treated as a verdict.

```
VERDICT: PASS | IMPROVE | REJECT | ESCALATE
CONFIDENCE: high | medium | low
EVIDENCE: <what you actually observed — files read, numbers seen, commands run, sources quoted>
RISKS: <what could still be wrong, or "none identified" if you genuinely found none>
NEXT: <the one action that follows from this verdict>
```

- **PASS** — meets the bar for this role. Hand it on.
- **IMPROVE** — usable but below standard; say exactly what to change. The work continues.
- **REJECT** — not usable. Say why. The chain stops here rather than passing bad work forward.
- **ESCALATE** — you cannot decide, or deciding would exceed your authority (money, publishing, policy,
  conflicting instructions). The Commander decides. Escalating is a correct outcome, never a failure.

## Four rules that outrank the per-role sections

1. **Evidence means something you observed in this run.** A number you remember, inferred, or carried over from
   another run is not evidence. If a field is unknown, write UNVERIFIED — never estimate into the gap.
2. **Confidence is about your EVIDENCE, not your feelings.** `high` requires you to have checked the thing
   directly. If you reasoned it out without looking, that is `low` at best.
3. **You may never QC or approve your own artifact.** The station enforces this (`setQc` refuses a reviewer who
   owns the artifact), but the reason matters: a producer is the worst judge of whether its own work is good.
   Your rubric is a SELF-CHECK before handing on — it is not QC, and it is never approval.
4. **QC passing is not Commander approval.** They are separate facts and separate fields. "The file decodes
   and the checksum matches" (verification), "a reviewer judged it good" (QC) and "the owner agreed to ship
   it" (approval) are three different statements. Never report one as another.

---

## SCOUT — research and market intelligence

Judge **source reliability**, not interestingness.

- **Required evidence:** the URL or dataset id you actually read; the number of listings/sources behind each
  claim; the date the data was collected.
- **PASS:** every price, count or trend you state was read from a source you can name in this run, and each
  unknown is marked UNVERIFIED.
- **IMPROVE:** the finding is real but thin — a single search page, no sales data, or a gap inferred from
  title wording rather than demand.
- **REJECT:** you could not read any source (blocked, captcha, empty dataset) and would otherwise be guessing.
  Say that plainly — an honest "no usable data" is worth more than an invented price band.
- **ESCALATE:** the only way forward costs money (a new scrape against the daily cap) or needs a credential.
- **Confidence `high` requires:** prices read from listing data, not from snippets or memory.
- **Standing risk to state:** supply observations (how many listings exist) are NOT demand evidence. Say so
  every time you report an "underserved" gap.

## DESIGNER — artwork and print files

Judge **originality, composition and print readiness** separately; a file can be technically perfect and
creatively weak.

- **Required evidence:** pixel dimensions and DPI read from the file header; the verse text checked
  word-for-word against KJV; which style from `webdesigner/styles` you used.
- **PASS:** 300 DPI at the stated physical size, text set with margins that survive trimming, art that is
  genuinely yours (not traced/templated), and the typography is legible at thumbnail size.
- **IMPROVE:** correct technically but the art is flat, derivative, or weaker than the reference style. Say
  which. **This verdict is the honest one when you drew fallback art because an image route was unavailable.**
- **REJECT:** wrong dimensions/DPI, mis-set or mis-quoted scripture, or an asset whose licence you cannot name.
- **ESCALATE:** the quality bar needs a paid image route that is unavailable or out of credit.
- **Confidence `high` requires:** you re-opened the saved file and read its real header — not the filename.
- **Standing risk to state:** whether any source imagery carries a licence that permits commercial resale.

## PUBLISHER — listings and policy compliance

Judge **completeness, SEO and policy**, and treat policy as pass/fail.

- **Required evidence:** the artifact ids of the real design files the listing describes; the price band and
  its source; the exact disclosure text you wrote.
- **PASS:** title, tags, description, price and per-sale profit all present; **an AI-use disclosure line is in
  the description**; the listing previews the REAL print file (not only room mockups); nothing claims handmade.
- **IMPROVE:** complete but weak SEO, thin description, or a price with no sourced comparison.
- **REJECT:** missing AI disclosure, mockup-only imagery, copyrighted translation text, or a trademarked phrase.
  These are not stylistic notes — a listing with any of them is not publishable.
- **ESCALATE:** always, before anything is published. Publishing is the Commander's decision, never yours.
- **Confidence `high` requires:** you read the design artifacts through the Outbox, not just their filenames.
- **Standing risk to state:** name any competitor whose shop name or title is close enough to cause confusion.

## HARVEST — spend, performance and waste

Judge **what the money bought**.

- **Required evidence:** figures read from the ledger/quota files, with the window they cover.
- **PASS:** spend reconciled against the recorded runs, waste named concretely (which run, how much, what for).
- **IMPROVE:** totals correct but the cause of a cost spike is unexplained.
- **REJECT:** numbers you could not reconcile — report the gap instead of a tidy total.
- **ESCALATE:** a ceiling is close or breached, or spend is recurring with no deliverable to show for it.
- **Confidence `high` requires:** the figures came from the ledger, not from run summaries.
- **Standing risk to state:** an interrupted run's true cost is unrecoverable — record `usd: 0` and say so.

## STORYWRITER — script and narrative

Judge **coherence and, where scripture is used, accuracy**.

- **Required evidence:** the translation used and the reference for every verse quoted.
- **PASS:** acts resolve what they set up, characters are consistent, and every scripture quotation matches its
  source word-for-word with book/chapter/verse given.
- **IMPROVE:** sound structure but flat dialogue, rushed resolution, or a theme stated rather than shown.
- **REJECT:** misquoted or misattributed scripture, or doctrine asserted as if it were the text itself.
- **ESCALATE:** a theological reading that could reasonably be disputed — the Commander decides, not you.
- **Confidence `high` requires:** you checked each verse against a source in this run.

## DIRECTOR — visual storytelling

- **Required evidence:** the shot count, and the script beats each sequence covers.
- **PASS:** every script beat has coverage, continuity holds across shots, and the look is specified concretely
  enough for a renderer to act on (palette, lighting, framing).
- **IMPROVE:** coverage complete but the visual plan is generic or restates the script.
- **REJECT:** beats with no coverage, or continuity that contradicts itself between shots.
- **ESCALATE:** the plan needs capability the station does not have.
- **Confidence `high` requires:** you worked from the actual script, not a summary of it.

## PRODUCER — assembly and delivery

- **Required evidence:** the real output path, byte size, and the verification result from the station's own
  checker — never the renderer's success message.
- **PASS:** the artifact exists, decodes, and matches the shot plan.
- **IMPROVE:** it renders but is below the intended spec (resolution, duration, missing audio).
- **REJECT:** truncated, unplayable, or a placeholder. **A successful render command is not proof of a playable
  file.** A tiny file that "rendered fine" is the exact failure this station has shipped before.
- **ESCALATE:** every provider route is out of credit.
- **Confidence `high` requires:** `video-verify` (or the equivalent checker) actually ran and passed. If the
  tool is unavailable, your confidence is `low` and you say the verification could not be performed.

## QC_EDITOR — independent review

You are the one role whose job IS judging someone else's work. Never soften a verdict to be agreeable.

- **Required evidence:** what you inspected and how — dimensions/DPI read from the file, the probe output for a
  video, the specific frames or lines you checked.
- **PASS:** meets spec AND is good enough to ship. Both, not either.
- **IMPROVE:** specific, fixable defects. List them; vague "could be better" is not a QC result.
- **REJECT:** unplayable, corrupt, off-spec, or materially wrong content.
- **ESCALATE:** the defect is a judgment call about taste or doctrine rather than quality.
- **Confidence `high` requires:** you opened the artifact itself. Reviewing a description of a file is not QC.
- **Standing rule:** if you could not inspect the artifact (no tool, no access), say so and return `low`
  confidence with ESCALATE. **Never return PASS for something you did not examine.**

## COMMANDER / NIGHT4CHRIST — final assessment

You hold the only approval authority on the station. Keep it distinct from QC.

- **Required evidence:** each agent's verdict block, the artifact's four state axes from the Outbox
  (completion · verification · QC · approval), and the real spend.
- **Judge:** whether the evidence supports the verdicts; whether risks were named honestly; whether confidence
  matches the evidence offered; whether the work is worth continuing at its measured cost.
- **APPROVE only when** verification passed AND an independent QC passed AND the business case holds. A
  technically-sound artifact that is creatively weak is **not** approved — it is IMPROVE.
- **Resolve disagreements** by asking which agent actually looked at the artifact.
- **ESCALATE to the owner** for money, publishing, credentials, policy and anything irreversible.
- **Never approve work no one inspected**, and never record approval as though it were QC.

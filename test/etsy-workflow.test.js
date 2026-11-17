/* node test/etsy-workflow.test.js — the Etsy lifecycle must fail CLOSED.

   Before this module the status vocabulary existed only as prose in a skill and in agent dossiers;
   greps for `approved-for-design` across sidecar/, shared/ and frontend/ returned zero hits, so no
   illegal move could be refused by anything. These tests are the contract.

   The two that matter most, and must never be "simplified" away:
     - no agent can reach `approved-to-publish`, whatever evidence it carries;
     - a failed quality check sends work BACK to designed and cannot advance. */
'use strict';
const A = require('./_assert.js');
const W = require('../sidecar/etsy-workflow.js');

/* A record carrying every field the lifecycle can ask for, so a refusal in these tests is always
   about the RULE under test and never about absent evidence. */
const full = (over) => Object.assign({
  sourcePath: 'scout-read-y9kWQagw4apT0VCZe.md',
  listingCount: 48,
  priceBand: '$2.10-$74.99',
  verse: 'Psalm 34:18',
  format: 'digital download, 4:5',
  assetFiles: ['a-8x10.png', 'a-11x14.png'],
  estCost: 0.31,
  estProfitPerSale: 4.2,
  qualityCheck: 'VERDICT: PASS — opened all 3 files, all non-empty, 300 DPI',
  listingDraftPath: 'publisher/listing-drafts/psalm-34-18.md'
}, over || {});

/* ---- 1. the happy path, one legal step at a time ---- */
{
  const steps = [
    [null, 'scouted', 'scout'],
    ['scouted', 'shortlisted', 'agent'],
    ['shortlisted', 'approved-for-design', 'agent'],
    ['approved-for-design', 'designed', 'webdesigner'],
    ['designed', 'validated', 'agent'],
    ['validated', 'listing-drafted', 'publisher'],
    ['listing-drafted', 'approved-to-publish', 'owner']
  ];
  for (const [from, to, who] of steps) {
    const r = W.canTransition(from, to, who, full());
    A.ok(r.ok, 'legal step ' + (from || '(none)') + ' -> ' + to + ' by ' + who + ' (got: ' + r.reason + ')');
  }
  A.eq(W.STATES.length, 7, 'the vocabulary is exactly the seven documented states');
}

/* ---- 2. NO AGENT MAY PUBLISH. the load-bearing refusal ---- */
{
  for (const who of ['agent', 'scout', 'webdesigner', 'publisher', 'qceditor', 'harvest', '', null]) {
    const r = W.canTransition('listing-drafted', 'approved-to-publish', who, full());
    A.ok(!r.ok, 'agent "' + who + '" must not reach approved-to-publish');
    A.eq(r.code, 'OWNER_ONLY', 'and the refusal names it as owner-only, not a missing field');
  }
  // even the owner needs the evidence
  const bare = W.canTransition('listing-drafted', 'approved-to-publish', 'owner', full({ listingDraftPath: '' }));
  A.ok(!bare.ok, 'the owner still cannot publish an item with no draft on file');
  A.eq(bare.code, 'MISSING_EVIDENCE', 'and that refusal is about evidence');
  A.ok(W.OWNER_ONLY.indexOf('approved-to-publish') >= 0, 'approved-to-publish stays in the owner-only set');
  A.eq(W.OWNER_ONLY.length, 1, 'and it is the ONLY owner-only state after the 2026-11-17 change');
}

/* ---- 3. approved-for-design is agent-settable now, but NOT a free pass ---- */
{
  const ok = W.canTransition('shortlisted', 'approved-for-design', 'agent', full());
  A.ok(ok.ok, 'the lead may approve for design without a human (owner decision 2026-11-17)');

  for (const field of ['sourcePath', 'listingCount', 'priceBand', 'verse', 'format']) {
    const r = W.canTransition('shortlisted', 'approved-for-design', 'agent', full({ [field]: '' }));
    A.ok(!r.ok, 'approve-for-design refuses when ' + field + ' is empty');
    A.eq(r.code, 'MISSING_EVIDENCE', 'and says which evidence is missing');
  }
  const unv = W.canTransition('shortlisted', 'approved-for-design', 'agent', full({ priceBand: 'UNVERIFIED' }));
  A.ok(!unv.ok, 'UNVERIFIED is not evidence — it is the absence of it');
  const wrong = W.canTransition('shortlisted', 'approved-for-design', 'publisher', full());
  A.ok(!wrong.ok && wrong.code === 'WRONG_ACTOR', 'PUBLISHER cannot approve designs');
}

/* ---- 4. a failed quality check goes BACK, never forward ---- */
{
  const failed = full({ qualityCheck: 'VERDICT: CHANGES — 2 of 3 files are 0 bytes' });
  const fwd = W.canTransition('designed', 'validated', 'agent', failed);
  A.ok(!fwd.ok && fwd.code === 'QUALITY_FAILED', 'a CHANGES verdict cannot advance to validated');

  const back = W.canTransition('validated', 'designed', 'agent', failed);
  A.ok(back.ok && back.code === 'REWORK', 'and it CAN go back to designed');
  const backByQc = W.canTransition('validated', 'designed', 'qceditor', failed);
  A.ok(backByQc.ok, 'QC_EDITOR may also send it back');

  const backWithoutFailure = W.canTransition('validated', 'designed', 'agent', full());
  A.ok(!backWithoutFailure.ok, 'but you cannot rewind a PASSING item');
  A.eq(backWithoutFailure.code, 'REWORK_NEEDS_FAILED_CHECK', 'and the refusal says why');

  const backByDesigner = W.canTransition('validated', 'designed', 'webdesigner', failed);
  A.ok(!backByDesigner.ok, 'DESIGNER cannot reset the verdict on its own work');
}

/* ---- 5. an unknown or unreadable quality check does NOT advance ---- */
{
  for (const q of ['', '   ', 'looks good to me', 'probably fine', undefined]) {
    const r = W.canTransition('designed', 'validated', 'agent', full({ qualityCheck: q }));
    A.ok(!r.ok, 'quality check ' + JSON.stringify(q) + ' must not advance the item');
    A.ok(r.code === 'QUALITY_UNKNOWN' || r.code === 'MISSING_EVIDENCE',
      'and it is refused as unknown/missing, never silently passed');
  }
  A.eq(W.qualityVerdict({ qualityCheck: 'PASS' }), 'PASS', 'a bare PASS reads as PASS');
  A.eq(W.qualityVerdict({ qualityCheck: 'VERDICT: CHANGES' }), 'CHANGES', 'the chain prompt token reads as CHANGES');
  A.eq(W.qualityVerdict({}), 'UNKNOWN', 'absent reads as UNKNOWN');
}

/* ---- 6. forward-only, no skipping ---- */
{
  const skip = W.canTransition('scouted', 'designed', 'webdesigner', full());
  A.ok(!skip.ok && skip.code === 'SKIPPED_STAGE', 'cannot jump scouted -> designed');
  const leap = W.canTransition('scouted', 'approved-to-publish', 'owner', full());
  A.ok(!leap.ok, 'not even the owner may leap the whole pipeline');
  const back = W.canTransition('listing-drafted', 'shortlisted', 'agent', full());
  A.ok(!back.ok && back.code === 'NOT_FORWARD', 'arbitrary backwards moves are refused');
  const same = W.canTransition('designed', 'designed', 'webdesigner', full());
  A.ok(!same.ok, 'a no-op re-set is refused rather than silently accepted');
}

/* ---- 7. garbage in is refused, not guessed ---- */
{
  A.ok(!W.canTransition('scouted', 'shipped', 'agent', full()).ok, 'an invented state is refused');
  A.eq(W.canTransition('scouted', 'shipped', 'agent', full()).code, 'UNKNOWN_STATE', 'named as unknown');
  A.ok(!W.canTransition('banana', 'shortlisted', 'agent', full()).ok, 'an invented CURRENT state is refused');
  A.notThrows(() => W.canTransition(null, 'scouted', 'scout', null), 'a null record does not throw');
  A.ok(!W.canTransition(null, 'scouted', 'scout', null).ok, 'and a null record carries no evidence');
}

/* ---- 8. the helpers agents will actually call ---- */
{
  A.eq(W.nextState('shortlisted'), 'approved-for-design', 'nextState walks the lifecycle');
  A.eq(W.nextState('approved-to-publish'), null, 'the end has no next');
  A.ok(W.awaitingOwner('listing-drafted'), 'a drafted listing is waiting on the owner');
  A.ok(!W.awaitingOwner('shortlisted'), 'a shortlisted item is NOT waiting on the owner any more');
  A.ok(!W.awaitingOwner('designed'), 'nor is a designed one');
}

A.report('etsy workflow: fail-closed lifecycle');

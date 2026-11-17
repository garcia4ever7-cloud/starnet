'use strict';
/* etsy-workflow.js — the Etsy product lifecycle, as a FAIL-CLOSED state machine.

   Until now this lifecycle existed only as prose: the status vocabulary lived in the
   `etsy-pipeline-handoff-via-airtable` skill and in agent dossiers, and nothing in the codebase
   could refuse an illegal move. Greps for `approved-for-design` / `approved-to-publish` across
   sidecar/, shared/ and frontend/ returned ZERO hits — the states were instructions to a language
   model, not a contract anything enforced.

   This module is the contract. It is PURE: no IO, no clock, no network, no live state. It answers
   one question — "may this actor move this item from A to B, given this evidence?" — and it answers
   NO unless every condition is met.

   OWNER DECISION 2026-11-17, recorded because it changes a safety boundary: `approved-for-design`
   was previously owner-only. The owner's standing goal is that the shop runs unattended, and they
   directed twice that this state become agent-settable. It is now reachable by the lead WITHOUT a
   human, but it is NOT a free pass: it requires sourced evidence (see EVIDENCE below), because the
   state it unlocks is the one that spends money generating artwork.

   `approved-to-publish` REMAINS OWNER-ONLY and is deliberately not reachable by any agent. It maps
   to the Outbox approval axis, whose approver is hardcoded to OUTBOX_COMMANDER on a route that
   agents cannot call (they hold no x-starnet-token). Publishing is the irreversible act; it keeps
   its human. */

/* The vocabulary, taken verbatim from the handoff skill's Status table. Not invented, not extended.
   Forward-only: the order of this array IS the order of the lifecycle. */
const STATES = Object.freeze([
  'scouted',
  'shortlisted',
  'approved-for-design',
  'designed',
  'validated',
  'listing-drafted',
  'approved-to-publish'
]);

/* The one state no agent may ever set, whatever else changes. */
const OWNER_ONLY = Object.freeze(['approved-to-publish']);

/* Who may propose each move, by agentId. 'owner' means a token-holding human via the Outbox
   approval route — never an agent, because agents hold no API token. */
const SETTER = Object.freeze({
  'scouted': 'scout',
  'shortlisted': 'agent',
  'approved-for-design': 'agent',   // owner-only until 2026-11-17; see header
  'designed': 'webdesigner',
  'validated': 'agent',
  'listing-drafted': 'publisher',
  'approved-to-publish': 'owner'
});

/* What must be on the record BEFORE each move is allowed. A missing, empty, or UNVERIFIED required
   field is a refusal, never a warning. These field names come from the skill's Airtable table. */
const EVIDENCE = Object.freeze({
  'scouted': ['sourcePath', 'listingCount', 'priceBand'],
  'shortlisted': ['sourcePath', 'priceBand'],
  // The pre-spend bar. The owner's tap is gone; the evidence requirement is what replaces it.
  'approved-for-design': ['sourcePath', 'listingCount', 'priceBand', 'verse', 'format'],
  'designed': ['assetFiles'],
  // Mirrors the skill: cost, profit AND an independent quality check must all be recorded.
  'validated': ['estCost', 'estProfitPerSale', 'qualityCheck'],
  'listing-drafted': ['listingDraftPath'],
  'approved-to-publish': ['listingDraftPath', 'qualityCheck']
});

const idx = s => STATES.indexOf(String(s));
const isState = s => idx(s) >= 0;

/* A value counts as present only if it is a non-empty string/array/number that is not an explicit
   UNVERIFIED marker. SCOUT is instructed to write UNVERIFIED for anything it could not read, so
   treating that string as "present" would let unsourced guesses advance the pipeline. */
function hasEvidence(record, field) {
  const v = record && record[field];
  if (v == null) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'number') return Number.isFinite(v);
  const s = String(v).trim();
  if (!s) return false;
  return !/^unverified$/i.test(s) && !/^(n\/a|tbd|unknown|pending)$/i.test(s);
}

function missingEvidence(to, record) {
  return (EVIDENCE[to] || []).filter(f => !hasEvidence(record, f));
}

/* The quality check is the only gate that can send work BACKWARDS, and the skill is explicit about
   where it lands: a product that fails goes back to `designed` with the defect named, not forward. */
function qualityVerdict(record) {
  const raw = String((record && record.qualityCheck) || '').trim();
  if (/^pass\b/i.test(raw) || /^VERDICT:\s*PASS/i.test(raw)) return 'PASS';
  if (/^(changes|fail)\b/i.test(raw) || /^VERDICT:\s*CHANGES/i.test(raw)) return 'CHANGES';
  return 'UNKNOWN';
}

/* canTransition(from, to, actor, record) -> { ok, reason, code }
   Every refusal names WHY in `reason` and carries a stable `code` a caller can branch on. */
function canTransition(from, to, actor, record) {
  const rec = record && typeof record === 'object' ? record : {};
  const who = String(actor == null ? '' : actor).trim();

  if (!isState(to)) return deny('UNKNOWN_STATE', 'not a lifecycle state: ' + JSON.stringify(to));
  if (from != null && from !== '' && !isState(from)) {
    return deny('UNKNOWN_STATE', 'current status is not a lifecycle state: ' + JSON.stringify(from));
  }

  const fromIdx = (from == null || from === '') ? -1 : idx(from);
  const toIdx = idx(to);

  /* The documented rework path, and the ONLY legal backwards move: a failed quality check returns
     a product to `designed`. Everything else backwards is refused. */
  const isRework = to === 'designed' && (from === 'validated' || from === 'listing-drafted');
  if (isRework) {
    if (qualityVerdict(rec) !== 'CHANGES') {
      return deny('REWORK_NEEDS_FAILED_CHECK',
        'moving back to designed requires a failed quality check naming the defect');
    }
    if (who !== 'agent' && who !== 'qceditor') {
      return deny('WRONG_ACTOR', 'only the lead or QC_EDITOR may send work back to designed');
    }
    return { ok: true, reason: 'rework: quality check reported CHANGES', code: 'REWORK' };
  }

  if (toIdx <= fromIdx) {
    return deny('NOT_FORWARD', 'status is forward-only: ' + (from || '(none)') + ' -> ' + to);
  }
  if (toIdx !== fromIdx + 1) {
    return deny('SKIPPED_STAGE',
      'cannot skip from ' + (from || '(none)') + ' to ' + to + '; next is ' + STATES[fromIdx + 1]);
  }

  /* Owner-only states are unreachable by any agent, regardless of evidence. This check sits BEFORE
     the evidence check on purpose: a perfectly-evidenced item still may not self-publish. */
  if (OWNER_ONLY.indexOf(to) >= 0 && who !== 'owner') {
    return deny('OWNER_ONLY',
      to + ' may only be set by the owner, through the Outbox approval route');
  }

  const expected = SETTER[to];
  if (expected && who !== expected) {
    return deny('WRONG_ACTOR', to + ' is set by ' + expected + ', not ' + (who || '(nobody)'));
  }

  /* `validated` additionally requires the quality check to actually say PASS — recording a failed
     check satisfies "a field is filled" but must not advance the item. */
  if (to === 'validated' || to === 'listing-drafted' || to === 'approved-to-publish') {
    const v = qualityVerdict(rec);
    if (v === 'CHANGES') return deny('QUALITY_FAILED', 'quality check reported CHANGES; send it back to designed');
    if (v === 'UNKNOWN') return deny('QUALITY_UNKNOWN', 'quality check is missing or unreadable; refusing to advance');
  }

  const missing = missingEvidence(to, rec);
  if (missing.length) {
    return deny('MISSING_EVIDENCE', to + ' requires: ' + missing.join(', '));
  }

  return { ok: true, reason: 'allowed', code: 'OK' };
}

function deny(code, reason) { return { ok: false, code, reason }; }

/* The next state an item may legally reach, or null at the end / when blocked on the owner. */
function nextState(from) {
  const i = (from == null || from === '') ? -1 : idx(from);
  if (i < 0 && from) return null;
  return STATES[i + 1] || null;
}

/* True when the only thing standing between an item and its next state is a human. */
function awaitingOwner(from) {
  const next = nextState(from);
  return !!next && OWNER_ONLY.indexOf(next) >= 0;
}

module.exports = {
  STATES, OWNER_ONLY, SETTER, EVIDENCE,
  canTransition, nextState, awaitingOwner, qualityVerdict,
  _internals: { hasEvidence, missingEvidence, isState }
};

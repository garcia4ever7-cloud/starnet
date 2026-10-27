/* sidecar/user-text.js — reading the REAL text out of a user-role chat message.

   A user-role turn in the transcript array is not always something the Commander typed. sidecar/loop.js
   (~2208) pushes a synthetic "[BEGIN EXTERNAL SCREEN CAPTURE..." fence turn after any tool call that
   returned an image, so the model treats on-screen pixels as untrusted data rather than instructions. That
   turn is ALWAYS supplementary — it rides alongside the real turn(s) already in the array, never replacing
   them — so when it's the LAST user-role turn (the common case: a tool call returns an image and the run
   ends right after), it's safe to skip past it and keep walking backward to the actual last human turn.

   frontend/app/chat.js's internalTranscriptPrompt() already excludes this exact pattern from being rendered
   as real chat content; nothing on the backend excluded it from userMsgText(), which sidecar/index.js's
   latestUserText()/recentUserText() use to answer "what did the Commander actually ask for." Confirmed live,
   2026-10-22: a run whose last user-role turn was this wrapper got its title/ask set to the raw fence text,
   which the Deliverables panel then showed verbatim under "What you asked for."

   DELIBERATELY NOT matched here: group-sessions.js's "Shared conversation context (..." turn. It looks like
   the same class of harness plumbing and chat.js's filter treats it identically for DISPLAY purposes, but
   architecturally it is not supplementary — for a group turn it is typically the ONLY user-role message, and
   the real ask is embedded INSIDE it ("...Current USER request: <the actual ask>"), not carried by some
   other turn this function could fall back to. Treating it as "nothing here" made latestUserText() return ''
   for every group turn, which silently zeroed out taskBriefStore.prepare()'s `if (latestUser)` gate
   (sidecar/index.js ~16743) and disabled brief_ask for the whole surface (caught by
   test/group-sessions.http.test.js before this reached main — left as a documented near-miss, not something
   to quietly try again with a cleverer regex).

   Kept as its own tiny pure module (not inline in the ~17k-line sidecar/index.js) so it can be unit-tested
   directly — the sidecar/deliverable-provenance.js precedent for logic index.js needs but shouldn't have to
   boot a server to test. */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).userText = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Narrower than frontend/app/chat.js's internalTranscriptPrompt (which also matches the group-sessions
  // "Shared conversation context (" wrapper for display purposes) — see the file header for why that second
  // pattern must NOT be treated as skippable here.
  function isInternalUserTurnText(t) {
    return /^\[BEGIN EXTERNAL SCREEN CAPTURE/.test(String(t == null ? '' : t));
  }

  // The user's words in one message, or null when `m` is not a user turn this function can read (a
  // different role, or a content shape it doesn't recognize) — null means "keep walking" to a caller doing a
  // backward scan, as distinct from '' which means "a real user turn whose text happens to be empty" (an
  // image-only attachment turn is honestly a real turn with no text).
  function userMsgText(m) {
    if (!m || m.role !== 'user') return null;
    let t;
    if (typeof m.content === 'string') t = m.content;
    else if (!Array.isArray(m.content)) return null;
    else {
      const parts = [];
      for (const p of m.content) {
        if (typeof p === 'string') parts.push(p);
        else if (p && typeof p.text === 'string') parts.push(p.text);
      }
      t = parts.join('');
    }
    if (isInternalUserTurnText(t)) return null;   // a harness-injected wrapper is not the Commander's own words
    return t;
  }

  return { userMsgText, isInternalUserTurnText };
});

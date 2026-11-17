/* node test/errorclass-429-short-window.test.js — a 429 that clears by WAITING must never classify as
   a dead wallet.

   The incident this pins: the Etsy pipeline's DESIGNER stage died at 255,177 input tokens against Gemini's
   250,000-per-MINUTE free-tier ceiling. Gemini words that limit "You exceeded your current quota, please
   check your plan and billing details" — the exact sentence OpenAI uses when an account is genuinely out of
   money. The 429 branch matched the billing regex on that wording, and `billing` is
   {retryable:false, shouldFallback:false}, so the run ended instantly with recoveryAttempts: [] — no retry,
   no backoff, no rotation. Five of those in a row tripped the chain's auto-pause.

   The message cannot separate the two. The structured BODY can: a free-tier quota metric, a PerMinute
   quotaId, a RetryInfo in seconds, or Google's RESOURCE_EXHAUSTED status. The veto reads the body; the
   terminal classes keep their meaning. */
'use strict';
const A = require('./_assert.js');
const { classifyApiError } = require('../sidecar/providers/errorClass.js');

const err = (status, body) => ({ status, response: { status }, body });

/* The exact shape Google returns for a free-tier per-minute token limit. */
const GEMINI_PER_MINUTE = err(429, {
  error: {
    code: 429, status: 'RESOURCE_EXHAUSTED',
    message: 'You exceeded your current quota, please check your plan and billing details. For more '
      + 'information on this error, head to: https://aistudio.google.com/docs/rate-limits.\n'
      + '* Quota exceeded for metric: generativelanguage.googleapis.com/'
      + 'generate_content_free_tier_input_token_count, limit: 250000',
    details: [
      { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{
        quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_input_token_count',
        quotaId: 'GenerateContentInputTokensPerModelPerMinute-FreeTier' }] },
      { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '29s' }
    ]
  }
});

/* Same sentence, genuinely empty wallet. Must stay terminal. */
const OPENAI_INSUFFICIENT_QUOTA = err(429, {
  error: { code: 'insufficient_quota', type: 'insufficient_quota',
    message: 'You exceeded your current quota, please check your plan and billing details.' }
});

/* ---- 1. the regression: a refilling window is retryable ---- */
{
  const r = classifyApiError(GEMINI_PER_MINUTE);
  A.eq(r.reason, 'rate_limit', 'a per-minute free-tier 429 is a rate limit, not billing');
  A.ok(r.retryable === true, 'it must be retryable — the ceiling clears in about thirty seconds');
  A.ok(r.shouldRotateCredential === true, 'recovery-policy fires on rotate OR fallback; this is the live path');
  A.eq(r.statusCode, 429, 'the status is preserved for the operator');
}

/* ---- 2. the terminal case must NOT move — same sentence, no window markers ---- */
{
  const r = classifyApiError(OPENAI_INSUFFICIENT_QUOTA);
  A.eq(r.reason, 'billing', 'an empty wallet stays billing even though the sentence is identical');
  A.ok(r.retryable === false, 'a wallet problem must not burn retries');
  A.ok(r.shouldFallback === false, 'and must not quietly start spending on another provider');
}

/* ---- 3. each body marker alone is sufficient (the message stays the billing sentence) ---- */
{
  const sentence = 'You exceeded your current quota, please check your plan and billing details.';
  const markers = {
    'RetryInfo retryDelay': { error: { message: sentence, details: [{ retryDelay: '20s' }] } },
    'RESOURCE_EXHAUSTED status': { error: { message: sentence, status: 'RESOURCE_EXHAUSTED' } },
    'free-tier quota metric': { error: { message: sentence, details: [{ violations: [{ quotaMetric: 'x/generate_content_free_tier_input_token_count' }] }] } },
    'PerMinute quotaId': { error: { message: sentence, details: [{ violations: [{ quotaId: 'GenerateContentInputTokensPerModelPerMinute' }] }] } }
  };
  for (const name of Object.keys(markers)) {
    A.eq(classifyApiError(err(429, markers[name])).reason, 'rate_limit', name + ' alone vetoes the billing verdict');
  }
  // and with NO marker at all it is still terminal
  A.eq(classifyApiError(err(429, { error: { message: sentence } })).reason, 'billing',
    'with no window marker anywhere, the same sentence remains billing');
}

/* ---- 4. the veto must not swallow a genuinely spent allowance ---- */
{
  const weekly = err(429, { error: { message: 'You have hit your weekly limit. Quota resets on 2026-11-24.' } });
  A.eq(classifyApiError(weekly).reason, 'quota_exhausted', 'a weekly allowance is still quota_exhausted');
  A.ok(classifyApiError(weekly).shouldFallback === true, 'and still crosses to another provider');
}

/* ---- 5. neighbouring classes are untouched ---- */
{
  A.eq(classifyApiError(err(402, { error: { message: 'This request requires more credits, or fewer max_tokens.' } })).reason,
    'billing', '402 affordability is still billing');
  A.eq(classifyApiError(err(429, { error: { code: 'rate_limit_exceeded', message: 'Rate limit reached for gpt-4 on requests per min (RPM): Limit 500' } })).reason,
    'rate_limit', 'an ordinary RPM 429 is unchanged');
  A.eq(classifyApiError(err(401, { error: { message: 'invalid x-api-key' } })).reason,
    'auth', 'auth is unchanged');
  A.eq(classifyApiError(err(404, { error: { message: 'model not found' } })).reason,
    'model_not_found', 'model_not_found is unchanged');
}

/* ---- 6. the veto must survive a body it cannot read ---- */
{
  A.notThrows(() => classifyApiError(err(429, 'plain string body, exceeded your current quota')),
    'a string body does not throw');
  A.notThrows(() => classifyApiError(err(429, null)), 'a null body does not throw');
  const circular = { error: { message: 'You exceeded your current quota, please check your plan and billing details.' } };
  circular.self = circular;
  A.notThrows(() => classifyApiError(err(429, circular)), 'a circular body does not throw');
  A.eq(classifyApiError(err(429, circular)).reason, 'billing',
    'an unreadable body falls back to the terminal reading rather than inventing a retry');
}

A.report('errorclass: 429 short-window veto');

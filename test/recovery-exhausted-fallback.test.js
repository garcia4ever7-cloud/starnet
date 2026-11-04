/* test/recovery-exhausted-fallback.test.js — a spent transport ladder crosses to the next provider.

   Origin: 2026-11-01. Two live interactive runs (NIGHT4CHRIST, anthropic/claude-sonnet-5-5) ended
   `failureStage: provider_stream, failureCode: timeout` after 5.4 and 4.6 minutes. Short requests to the
   same host succeeded 20/20, so the link was alive — a long stream on a mobile radio simply kept dropping.
   errorClass.js already mapped ERR_HTTP2_STREAM_ERROR to `timeout` and the ladder retried patiently; the
   run still died with a seven-entry fallback chain sitting unused, because `timeout` is shouldFallback:false.

   What is pinned here is as much the REFUSALS as the new behaviour: the money rule says a broken request
   must never start spending on another provider, so every non-retryable class must still fail in place. */
'use strict';

const assert = require('./_assert.js');
const policy = require('../sidecar/recovery-policy.js');
const { providerFailure, RETRY_DELAYS_MS, RETRY_PATIENCE_MS, EXHAUSTED_FALLBACK } = policy;

let n = 0;
const check = (label, cond) => { assert.ok(cond, label); n++; };

// A ladder that is fully spent: every rung used AND the whole patience budget burned.
const spent = (over) => Object.assign({
  classification: { reason: 'timeout', retryable: true, shouldFallback: false, shouldRotateCredential: false, shouldCompress: false },
  retriesUsed: RETRY_DELAYS_MS.length,
  maxRetries: RETRY_DELAYS_MS.length,
  waitedMs: RETRY_PATIENCE_MS,
  patienceMs: RETRY_PATIENCE_MS,
  hasFallback: true,
  recoveriesUsed: 0,
  maxRecoveries: 3,
  idleStalls: 0
}, over || {});

/* 1. The reported defect: a spent transport ladder now crosses instead of ending the run. */
{
  const d = providerFailure(spent());
  check('spent timeout ladder -> fallback', d.action === 'fallback');
  check('crossing keeps the real reason', d.reason === 'timeout');
  check('crossing does not rotate the credential', d.rotate === false);
  check('crossing is immediate (patience already spent)', d.delayMs === 0);
}

/* 2. It is a LAST resort — an unspent ladder must still retry locally, not cross on the first blip. */
{
  const d = providerFailure(spent({ retriesUsed: 0, waitedMs: 0 }));
  check('unspent ladder still retries locally', d.action === 'retry');
  check('local retry has a real delay', d.delayMs > 0);
}

/* 3. Patience exhaustion (the other `fail` site) crosses too — both returns had to be rewired. */
{
  const d = providerFailure(spent({ retriesUsed: 1, waitedMs: RETRY_PATIENCE_MS + 1 }));
  check('spent PATIENCE (rungs left) also crosses', d.action === 'fallback');
}

/* 4. Nothing to cross to -> unchanged failure, never a phantom fallback. */
{
  check('no chain -> fail', providerFailure(spent({ hasFallback: false })).action === 'fail');
  check('recoveries spent -> fail', providerFailure(spent({ recoveriesUsed: 3, maxRecoveries: 3 })).action === 'fail');
  check('zero recovery budget -> fail', providerFailure(spent({ maxRecoveries: 0 })).action === 'fail');
}

/* 5. THE MONEY GUARANTEE. A broken request must never spend on the next provider, however spent the
      ladder is. These are the classes CLAUDE.md names; each must still fail in place. */
{
  const nonRetryable = ['format_error', 'content_policy_blocked', 'auth', 'billing', 'local_error',
                        'context_overflow', 'output_cap'];
  for (const reason of nonRetryable) {
    const d = providerFailure(spent({
      classification: { reason, retryable: false, shouldFallback: false, shouldRotateCredential: false, shouldCompress: false }
    }));
    check(reason + ' never crosses on a spent ladder', d.action === 'fail');
    check(reason + ' keeps its own reason', d.reason === reason);
  }
}

/* 6. `unknown` is deliberately EXCLUDED. "The same unrecognized refusal N times" is evidence, not a blip,
      and crossing on it is the exact "bug in provider A spends on provider B" case. */
{
  const d = providerFailure(spent({
    classification: { reason: 'unknown', retryable: true, shouldFallback: false, shouldRotateCredential: false, shouldCompress: false }
  }));
  check('unknown does NOT cross after exhaustion', d.action === 'fail');
  check('EXHAUSTED_FALLBACK allowlist holds only timeout', Object.keys(EXHAUSTED_FALLBACK).join(',') === 'timeout');
}

/* 7. Classes that already crossed immediately must keep doing so — the new escape sits BELOW them and
      must not have stolen their path or delayed them behind a ladder. */
{
  for (const [reason, flags] of [
    ['overloaded',      { retryable: true,  shouldFallback: true,  shouldRotateCredential: false }],
    ['server_error',    { retryable: true,  shouldFallback: true,  shouldRotateCredential: false }],
    ['model_not_found', { retryable: false, shouldFallback: true,  shouldRotateCredential: false }],
    ['quota_exhausted', { retryable: false, shouldFallback: true,  shouldRotateCredential: true  }],
    ['rate_limit',      { retryable: true,  shouldFallback: false, shouldRotateCredential: true  }]
  ]) {
    const d = providerFailure(spent({
      classification: Object.assign({ reason, shouldCompress: false }, flags),
      retriesUsed: 0, waitedMs: 0
    }));
    check(reason + ' still crosses immediately', d.action === 'fallback');
  }
  // and the credential-rotating one still asks for a rotation, which the new path must never set
  const rl = providerFailure(spent({
    classification: { reason: 'rate_limit', retryable: true, shouldFallback: false, shouldRotateCredential: true, shouldCompress: false },
    retriesUsed: 0, waitedMs: 0
  }));
  check('rate_limit still rotates the credential', rl.rotate === true);
}

/* 8. A stall still outranks everything — the idle-stall branch sits above this escape. */
{
  const d = providerFailure(spent({ idleStalls: 99 }));
  check('idle stall keeps its own reason', d.reason === 'provider_stalled');
}

console.log('recovery-exhausted-fallback.test: ' + n + ' assertions');
assert.report();

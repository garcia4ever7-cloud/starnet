/* node test/prices.fable52.port.test.js — PHONE PORT 2026-11-26: Claude Fable 5.2 / Mythos 5.2 are priced at their published rates
   (platform.claude.com/docs/en/about-claude/pricing, read 2026-11-26: $8 in / $40 out per MTok, cache hits 0.025x = $0.20), not at
   the Fable 5 row ($10/$50) they fell into before. Neighbours pinned so the new rows cannot shadow them. */
'use strict';
const A = require('./_assert.js');
const P = require('../sidecar/providers/prices.js');
const price = id => P.priceOf('anthropic', id);
A.eq(price('claude-fable-5-2').in, 8, 'Fable 5.2 input $8/MTok');
A.eq(price('claude-fable-5-2').out, 40, 'Fable 5.2 output $40/MTok');
A.eq(price('claude-fable-5.2').in, 8, 'dotted id resolves the same row');
A.eq(price('claude-mythos-5-2').in, 8, 'Mythos 5.2 input $8/MTok');
A.eq(price('claude-mythos-5-2').out, 40, 'Mythos 5.2 output $40/MTok');
A.eq(P.cacheRatesOf('claude-fable-5-2').read, 0.025, 'Fable 5.2 documented cache-hit ratio 0.025x ($0.20/MTok)');
A.eq(price('claude-fable-5-1').in, 10, 'Fable 5.1 unchanged at $10');
A.eq(price('claude-fable-5').out, 50, 'Fable 5 unchanged at $50');
A.eq(price('claude-opus-5-5').in, 4, 'Opus 5.5 unchanged at $4 (published)');
A.eq(price('claude-opus-5-5').out, 20, 'Opus 5.5 unchanged at $20 (published)');
A.eq(P.cacheRatesOf('claude-opus-5-5').read, 0.05, 'Opus 5.5 cache-hit ratio 0.05x ($0.20/MTok)');
A.report('prices.fable52.port');

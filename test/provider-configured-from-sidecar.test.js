/* test/provider-configured-from-sidecar.test.js — a provider keyed ONLY in the sidecar's environment must
   read as CONFIGURED in a browser build.

   THE DEFECT. `Harness.configured(p)`'s browser branch read only `getKey(p)` — the key pasted into the page.
   But the supported way to key an UNATTENDED station is `~/.config/starnet/env`, which the renderer never
   sees (and must never see: "secrets stay in the sidecar", project law). So every env-only provider read as
   unconfigured in a browser, and `modeldock.js` gates the whole catalog fetch on exactly that
   (`if (!providerEnabled(p)) return disconnected()`), which means the agent's model resolved to NOTHING.

   Live symptom, reported by the owner 2026-10-27: NIGHT4CHRIST's model showed as blank/"none" in the dock
   while DESIGNER and SCOUT showed theirs. Not a coincidence — DESIGNER/SCOUT run on openrouter/omniroute,
   whose keys had also been pasted into the page; the Anthropic key had only ever gone into the env file. The
   station was healthy the whole time: that same NIGHT4CHRIST ran to `done` headlessly on that exact model,
   and GET /api/providers already reported `anthropic: {configured:true}`. A UI that says an agent has no
   model while the harness demonstrably runs it is the interface asserting state the harness disproves — the
   inverse of the truthful-telemetry law, and just as wrong.

   HOW THIS IS TESTED. harness-internal.test.js says harness.js is "not node-loadable" and settles for reading
   the source. It IS loadable in a vm sandbox with a stub window/fetch/localStorage, so the core of this file
   EXECUTES the real configured() before and after the real init() — a regex cannot tell you the value flipped.
   Two structural invariants that behaviour can't express (never-downgrade, no-secret) stay source-locked.

   Plain node, no framework: node test/provider-configured-from-sidecar.test.js */
'use strict';

const A = require('./_assert.js');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const HARNESS = path.join(__dirname, '..', 'frontend', 'app', 'harness.js');
const src = fs.readFileSync(HARNESS, 'utf8');

/* Load the real module in a sandbox that owns every ambient the page would supply. `pageKeys` seeds
   localStorage (a key pasted into the UI); `providersReply` is what GET /api/providers answers, or null to
   simulate the route being absent entirely. */
function loadHarness(opts) {
  opts = opts || {};
  const store = Object.assign({}, opts.pageKeys || {});
  const calls = [];
  const sandbox = {
    console: console, URL: URL, Headers: global.Headers, TextDecoder: TextDecoder,
    setTimeout: setTimeout, clearTimeout: clearTimeout, AbortController: AbortController,
    localStorage: {
      getItem: k => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; }
    },
    fetch: async (u) => {
      calls.push(String(u));
      if (String(u).startsWith('/api/providers')) {
        return opts.providersReply
          ? { ok: true, status: 200, json: async () => opts.providersReply }
          : { ok: false, status: 404, json: async () => ({}) };
      }
      if (String(u).startsWith('/api/credits')) return { ok: true, status: 200, json: async () => ({ configured: false }) };
      return { ok: false, status: 404, json: async () => ({}) };
    }
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src + '\n;globalThis.__H = Harness;', sandbox, { filename: 'harness.js' });
  return { H: sandbox.__H, calls };
}

const PROVIDERS = {
  providers: [
    { id: 'anthropic', configured: true },
    { id: 'openrouter', configured: true },
    { id: 'groq', configured: false }       // the sidecar holds no groq key
  ]
};

/* ---- 1. THE REGRESSION, executed: env-only provider goes unconfigured -> configured ---- */
(async () => {
  {
    const { H, calls } = loadHarness({ pageKeys: {}, providersReply: PROVIDERS });

    A.eq(H.configured('anthropic'), false,
      'before init the page knows nothing — this is the state the owner saw, and why the dock rendered no model');

    await H.init();

    A.eq(H.configured('anthropic'), true,
      'AFTER init a provider the SIDECAR holds a key for reads as configured — the fix. Without this the '
      + 'modeldock catalog fetch never runs and NIGHT4CHRIST\'s model renders blank');
    A.ok(calls.some(u => u.startsWith('/api/providers')),
      'init really asked the sidecar which providers it holds credentials for');

    /* NO OVER-GRANTING. The probe must report only what the sidecar actually has; a provider it reports as
       unconfigured must stay unconfigured, or the dock would offer models that cannot run. */
    A.eq(H.configured('groq'), false,
      'a provider the sidecar reports as NOT configured stays unconfigured — presence is never assumed');
  }

  /* ---- 2. FAIL-OPEN: no route, no crash, no false claim ---- */
  {
    const { H } = loadHarness({ pageKeys: {}, providersReply: null });
    let threw = null;
    try { await H.init(); } catch (e) { threw = e; }
    A.eq(threw, null, 'a missing/404 /api/providers must not stop the page from booting');
    A.eq(H.configured('anthropic'), false,
      'and a failed probe claims nothing — it cannot invent a credential the station may not have');
  }

  /* ---- 3. ADDITIVE: a key pasted into the page still counts, with or without the probe ---- */
  {
    const { H } = loadHarness({ pageKeys: { 'starnet.byok.key': 'sk-or-v1-pasted-into-the-page' }, providersReply: null });
    await H.init();
    A.eq(H.configured('openrouter'), true,
      'a key the user pasted into the UI still configures its provider even when the probe fails — the fix is '
      + 'purely additive and cannot regress the existing BYOK flow');
  }

  /* ---- 4. structural invariants behaviour cannot express ---- */
  {
    const probeAt = src.indexOf("await fetch('/api/providers'");
    A.ok(probeAt > 0, 'the probe is present in the source');

    // It must sit BEFORE the desktop early-return, or every browser build — the broken case — skips it.
    const returnAt = src.indexOf('if (!DESKTOP) return;');
    A.ok(returnAt > 0 && probeAt < returnAt,
      'the probe runs BEFORE `if (!DESKTOP) return;` — after it, a browser build skips the fix entirely');

    /* NEVER DOWNGRADE. The loop may only set true. Writing false would let a stale or partial answer erase a
       provider configured by the keychain, by managed credits, or by a key the user really did paste —
       turning a cosmetic bug into a lockout. */
    const region = src.slice(probeAt, probeAt + 700);
    A.ok(!/_configuredByProvider\[[^\]]*\]\s*=\s*(?:false|!!)/.test(region),
      'the probe only ever sets true — it must never downgrade a provider configured by another route');

    /* NO SECRET CROSSES INTO THE RENDERER. The whole reason to use /api/providers is that it answers with
       booleans. If someone later "improves" this by reading a key out of the response, the project law is
       broken and this is the tripwire. */
    for (const bad of ['prov.key', 'prov.apiKey', '.credential', 'keyEnv']) {
      A.ok(region.indexOf(bad) < 0,
        'the probe must not read ' + bad + ' — only the `configured` boolean may cross into the page');
    }
  }

  /* ---- 5. the modeldock gate this protects is still the one described above ---- */
  {
    const dock = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'modeldock.js'), 'utf8');
    A.ok(/if \(!providerEnabled\(p\)\) return disconnected\(\);/.test(dock),
      'modeldock still gates the catalog fetch on providerEnabled — if that moves, re-check that an env-only '
      + 'provider can still resolve a model name');
    A.ok(/Harness\.configured && Harness\.configured\(p\)/.test(dock),
      'and providerEnabled still routes through Harness.configured, which is what the fix repairs');
  }

  A.report('provider configured from sidecar');
})();

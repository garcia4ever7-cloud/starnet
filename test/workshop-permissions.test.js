/* node test/workshop-permissions.test.js — the AWAY WORKSHOP consent refinement (W1).

   Proves the workshop grant clears the autonomous "silence is not consent" default-deny for a JAIL-SCOPED WRITE
   (cabinet = files, memory = notebook) by a GRANTED agent, and NOTHING else. The four ABSOLUTE INVARIANTS the
   plan pins are each asserted directly here:
     (a) autonomous EXECUTE stays denied exactly as today (permissions.js exec lockout untouched);
     (b) NON-jail tools are unchanged (a granted agent still can't autonomously write a non-cabinet/memory cap);
     (c) NON-granted agents are unchanged (default-deny stands with no grant);
     (d) the HARDLINE floor is unchanged (.env/.git denied even for a granted agent). */
'use strict';
const A = require('./_assert.js');
const { makeConsentBroker, SILENCE } = require('../sidecar/permissions.js');

// live tool shapes (capabilities as the real registry emits them — see sidecar/tools/builtin/fs.js/notebook.js).
const CABINET_WRITE = { name: 'fs.write', capability: 'cabinet', scope: 'write', requiresConsent: true };
const CABINET_READ = { name: 'fs.read', capability: 'cabinet', scope: 'read' };
const MEMORY_WRITE = { name: 'notebook.write', capability: 'memory', scope: 'write' };
const EXEC = { name: 'shell.exec', capability: 'workbench', scope: 'execute', requiresConsent: true };
const WEB_WRITE = { name: 'connector.post', capability: 'web', scope: 'write', network: true };  // a NON-jail write

const fsCall = { name: 'fs.write', args: { path: 'workshop/r1/tool.py' } };
const memCall = { name: 'notebook.write', args: { text: 'note' } };
const execCall = { name: 'shell.exec', args: { cmd: 'npm test' } };
const webCall = { name: 'connector.post', args: {} };

const hardline = (call) => (call && call.args && /(^|[\\/])\.env(\.|$)/.test(call.args.path)) ? 'protected file' : null;

// helpers: a broker for a GRANTED / UNGRANTED agent on a given surface.
const granted = (extra) => makeConsentBroker(Object.assign({ surface: 'autonomous', workshop: () => true }, extra || {}));
const ungranted = (extra) => makeConsentBroker(Object.assign({ surface: 'autonomous', workshop: () => false }, extra || {}));

// ---- 1. GRANTED agent: an autonomous cabinet:write is ALLOWED (the core new behavior) ----
{
  const r = granted()(fsCall, CABINET_WRITE);
  A.ok(r.allow === true, 'granted agent: autonomous cabinet:write allowed');
  A.ok(/workshop grant/.test(r.reason), 'reason names the workshop grant');
  A.eq(r.scope, 'write', 'scope echoed');
  // a memory (notebook) write is also jail-scoped -> allowed
  A.ok(granted()(memCall, MEMORY_WRITE).allow === true, 'granted agent: autonomous memory:write allowed');
}

// ---- 2. INVARIANT (a): EXECUTE stays denied for a granted agent (exec lockout untouched) ----
{
  const r = granted()(execCall, EXEC);
  A.ok(!r.allow, 'granted agent: autonomous execute STILL denied (exec lockout)');
  A.eq(r.reason, SILENCE, 'execute denial is the exec-lockout SILENCE, not a workshop allow');
  // even a pre-blessed permanent execute grant cannot enable autonomous shell for a workshop agent
  const blessed = granted({ grantsPermanent: new Set(['workbench:execute']) });
  A.ok(!blessed(execCall, EXEC).allow, 'granted agent + permanent exec grant: STILL denied (lockout above cache)');
}

// ---- 3. INVARIANT (b): NON-jail write stays denied for a granted agent ----
{
  const r = granted()(webCall, WEB_WRITE);
  A.ok(!r.allow, 'granted agent: a NON-jail (web) write is NOT unlocked by the workshop grant');
  A.eq(r.reason, SILENCE, 'non-jail write falls through to the default-deny');
}

// ---- 4. INVARIANT (c): NON-granted agent is unchanged (default-deny stands) ----
{
  const r = ungranted()(fsCall, CABINET_WRITE);
  A.ok(!r.allow, 'ungranted agent: autonomous cabinet:write default-denies exactly as today');
  A.eq(r.reason, SILENCE, 'ungranted reason is the silence rule');
  // no workshop dep at all == byte-identical legacy behavior
  const legacy = makeConsentBroker({ surface: 'autonomous' })(fsCall, CABINET_WRITE);
  A.ok(!legacy.allow && legacy.reason === SILENCE, 'no workshop predicate: legacy default-deny unchanged');
}

// ---- 5. INVARIANT (d): the HARDLINE floor still wins for a granted agent ----
{
  const b = granted({ hardline: hardline });
  const r = b({ name: 'fs.write', args: { path: '.env' } }, CABINET_WRITE);
  A.ok(!r.allow && r.hardline === true, 'granted agent: .env write STILL blocked by the hardline floor');
}

// ---- 6. surface guard: the grant does NOTHING on the INTERACTIVE surface (a live human already answers) ----
{
  // interactive with no prompt fails closed; the workshop predicate must not silently allow it.
  const b = makeConsentBroker({ surface: 'interactive', workshop: () => true });
  const r = b(fsCall, CABINET_WRITE);
  A.ok(!r.allow && /no consent channel/.test(r.reason), 'workshop grant does not bypass the interactive ask');
}

// ---- 7. read is unaffected (auto-allow path, no grant needed) and a thrown predicate fails closed ----
{
  A.ok(granted()(fsCall, CABINET_READ).allow === true, 'a jail read auto-allows regardless (read-only tier)');
  const boom = makeConsentBroker({ surface: 'autonomous', workshop: () => { throw new Error('store down'); } });
  const r = boom(fsCall, CABINET_WRITE);
  A.ok(!r.allow && r.reason === SILENCE, 'a throwing workshop predicate fails CLOSED (default-deny)');
}

// ---- 8. capability set is overridable (proves the gate is data-driven, not hardcoded to one cap) ----
{
  const b = makeConsentBroker({ surface: 'autonomous', workshop: () => true, workshopCaps: { drafts: true } });
  const DRAFT_WRITE = { name: 'x.write', capability: 'drafts', scope: 'write' };
  A.ok(b(fsCall, DRAFT_WRITE).allow === true, 'custom workshopCaps unlocks the named capability');
  A.ok(!b(fsCall, CABINET_WRITE).allow, 'a capability NOT in the custom set stays denied');
}

// ---- 9. unattended image generation (2026-10-22): image_generate/image_print_prep are allowed for a granted
//         agent by TOOL NAME even though their shared capability ('studio') is NOT in the default capability
//         allowlist — and, critically, that must NOT open every 'studio' tool (vector_export/image_stock_fetch
//         stay denied), proving the two allowlists are independent, not a capability-level backdoor. ----
{
  const IMAGE_GENERATE = { name: 'image_generate', capability: 'studio', scope: 'write', requiresConsent: true };
  const IMAGE_PRINT_PREP = { name: 'image_print_prep', capability: 'studio', scope: 'write', requiresConsent: true };
  const MOCKUP_COMPOSE = { name: 'mockup_compose', capability: 'studio', scope: 'write', requiresConsent: true };
  const VECTOR_EXPORT = { name: 'vector_export', capability: 'studio', scope: 'write', requiresConsent: true };
  const IMAGE_STOCK_FETCH = { name: 'image_stock_fetch', capability: 'studio', scope: 'write', requiresConsent: true };
  const genCall = { name: 'image_generate', args: { prompt: 'a mountain' } };
  const prepCall = { name: 'image_print_prep', args: {} };
  const mockupCall = { name: 'mockup_compose', args: {} };
  const vecCall = { name: 'vector_export', args: {} };
  const stockCall = { name: 'image_stock_fetch', args: {} };

  const rg = granted()(genCall, IMAGE_GENERATE);
  A.ok(rg.allow === true, 'granted agent: autonomous image_generate allowed by its tool-name allowlist');
  A.ok(/workshop grant/.test(rg.reason), 'reason names the workshop grant');
  A.ok(granted()(prepCall, IMAGE_PRINT_PREP).allow === true, 'granted agent: autonomous image_print_prep allowed');
  const rm = granted()(mockupCall, MOCKUP_COMPOSE);
  A.ok(rm.allow === true, 'granted agent: autonomous mockup_compose allowed (free/no-network, added 2026-10-22)');

  const rv = granted()(vecCall, VECTOR_EXPORT);
  A.ok(!rv.allow && rv.reason === SILENCE, 'granted agent: vector_export (same capability, NOT named) stays denied — no capability-level backdoor');
  const rs = granted()(stockCall, IMAGE_STOCK_FETCH);
  A.ok(!rs.allow && rs.reason === SILENCE, 'granted agent: image_stock_fetch (same capability, NOT named) stays denied');

  // the SAME four invariants as the capability path apply here too
  A.ok(!ungranted()(genCall, IMAGE_GENERATE).allow, 'ungranted agent: image_generate stays default-denied');
  const execLikeGen = { name: 'image_generate', capability: 'studio', scope: 'execute', requiresConsent: true };
  A.ok(!granted()(genCall, execLikeGen).allow, 'the tool-name allowlist is write-only too, like the capability path');
  const interactiveB = makeConsentBroker({ surface: 'interactive', workshop: () => true });
  A.ok(!interactiveB(genCall, IMAGE_GENERATE).allow, 'the tool-name grant does nothing on the interactive surface either');

  // overridable, same shape as workshopCaps
  const custom = makeConsentBroker({ surface: 'autonomous', workshop: () => true, workshopTools: { x_only: true } });
  const X_ONLY = { name: 'x_only', capability: 'studio', scope: 'write' };
  A.ok(custom({ name: 'x_only', args: {} }, X_ONLY).allow === true, 'custom workshopTools unlocks the named tool');
  A.ok(!custom(genCall, IMAGE_GENERATE).allow, 'a custom workshopTools set drops the DEFAULT allowlist (image_generate) — data-driven, not merged silently');
}

A.report('workshop-permissions.test');

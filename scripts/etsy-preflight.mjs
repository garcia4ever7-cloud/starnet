#!/usr/bin/env node
/* scripts/etsy-preflight.mjs — can the Etsy chain's LEAD actually delegate to each worker RIGHT NOW?
 *
 * WHY THIS EXISTS. On 2026-11-17T11:05Z the armed Etsy chain (cron ebc4f07d) burned 19 turns and $0.53 and
 * dispatched ZERO workers. The recorded toolTrace says `team_dispatch … ms: 0 … summary: "withheld"`, and
 * `connectors_list` — the taint source everyone blamed — ran 105 SECONDS LATER. `station_layout` (granted
 * only by the orchestrator object) SUCCEEDED in the same run, which proves the orchestrator object resolved
 * and team.dispatch WAS in the resolved toolset. So neither capability nor taint explains it.
 *
 * The refusal is at a THIRD gate nobody had a name for: WIRE REACHABILITY. index.js builds
 *   directDomainWithheld = (name) => !!directDomainTask && (/^team\./.test(name) || …)
 * and drops every withheld name from BOTH the advertised and the deferred wire lists. A granted dotted tool
 * with no `fromWire` entry then falls into the "exists but not granted to THIS run" branch and returns
 * `summary:'withheld'` in 0ms — before capability, before consent, before taint. `directDomainTask` comes
 * from DomainTask.classify(latestUserText(messages)); the routine prompt names the file
 * `etsy-creative-brief.md`, and `.md` is Moldova's ccTLD, so the classifier reads that FILENAME as the one
 * explicit host of a bounded single-host inspection and switches delegation off for the whole run.
 *
 * So this preflight checks FIVE axes, not two, and names the predicate it consulted for each.
 *
 * IT IS READ-ONLY. It opens files, calls pure project modules, and makes no provider call, no network call
 * and no state mutation. The only thing it may write is an explicit --report file.
 *
 *   node scripts/etsy-preflight.mjs                      # live check, human summary + JSON
 *   node scripts/etsy-preflight.mjs --json               # JSON only
 *   node scripts/etsy-preflight.mjs --report=<path>      # also write the report to a file
 *   node scripts/etsy-preflight.mjs --job=<cronJobId>
 *
 * EXIT CODE: 0 only on PASS. Any missing capability, refused consent, withheld wire slot, unknown/self
 * worker, taint, or UNVERIFIABLE axis exits 1 — it is designed to gate a run.
 */
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const req = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, '..');
const HOME = os.homedir();
export const WORKSPACES = process.env.WORKSPACES
  ? path.resolve(process.env.WORKSPACES)
  : path.join(HOME, '.local', 'share', 'StarNet', 'workspaces');

export const ETSY_CHAIN_JOB_ID = 'ebc4f07d-a26e-4e40-ae4f-01f8a56ea909';
export const ETSY_WORKERS = ['scout', 'webdesigner', 'qceditor', 'publisher'];

/* ---- the real project modules. Every one of these is pure (no IO, no clock) or reads only files. ---- */
const DomainTask = req(path.join(REPO, 'sidecar/domain-task.js'));
const { savedPlacement } = req(path.join(REPO, 'sidecar/capability/saved-placement.js'));
const { composeOffice, stationWithObject, stationWithConnectors } = req(path.join(REPO, 'sidecar/capability/office.js'));
const { resolveTools } = req(path.join(REPO, 'sidecar/capability/resolve.js'));
const inputpolicy = req(path.join(REPO, 'sidecar/inputpolicy.js'));
const { makeConsentBroker } = req(path.join(REPO, 'sidecar/permissions.js'));
const { makeOrchestrationTools } = req(path.join(REPO, 'sidecar/tools/builtin/orchestration.js'));

/* The REAL team.dispatch descriptor — name/capability/scope/requiresConsent straight off the shipping tool
   def, so the consent ladder is fed the same object the live registry hands it. The factory needs no live
   host to produce the declaration; only run() would. */
export function dispatchToolDescriptor() {
  const t = makeOrchestrationTools({ roster: () => new Map() }).dispatchTool;
  return t;
}

/* ================================ SOURCE LOCKS ================================
   The host's decision is made by closures inside sidecar/index.js (`directDomainWithheld`, `dispatchGrant`,
   `hardlineFloor`) and by module-private constants inside orchestration.js (`ID_RE`). None of them can be
   imported without booting the sidecar. Rather than SIMULATE them — which would let this preflight report a
   PASS the live host would refuse — each one is pinned to its exact source text. A lock that no longer
   matches makes its axis UNVERIFIED, and an UNVERIFIED axis fails the whole preflight. That is the only
   honest way to reuse a predicate you cannot call.                                                      */
export const SOURCE_LOCKS = [
  {
    id: 'wire.directDomainWithheld',
    file: 'sidecar/index.js',
    needle: "const directDomainWithheld = (name) => !!directDomainTask && (/^team\\./.test(name) || /^browser\\./.test(name) || name === 'web_search' || name === 'web_request');",
    why: 'the predicate that strips team.* from the wire list when a direct-domain task is classified'
  },
  {
    id: 'wire.directDomainTask',
    file: 'sidecar/index.js',
    needle: '? DomainTask.classify(latestUserText(messages), { isWorkspaceFile: workspaceFileProbe(agentId) })',
    why: 'proves directDomainTask is classified from the run\'s latest USER text (the routine prompt) AND that '
      + 'the host injects its workspace-file probe, which is what keeps a bare `brief.md` from reading as a host'
  },
  {
    id: 'wire.workspaceFileProbe',
    file: 'sidecar/index.js',
    needle: 'function workspaceFileProbe(agentId) {',
    why: 'the host-side existence probe this preflight mirrors; without it a filename is classified as a hostname'
  },
  {
    id: 'wire.withheldBranch',
    file: 'sidecar/index.js',
    needle: 'else if (!grantedSet.has(c.name) && registry.get(allWire.get(c.name) || c.name)) {',
    why: 'the branch that answers summary:"withheld" in 0ms for a granted dotted tool with no fromWire entry'
  },
  {
    id: 'capability.orchestratorGrant',
    file: 'sidecar/index.js',
    needle: "if (unattendedGrants.indexOf('orchestrator') >= 0 && !o.parentRunId) station = stationWithObject(station, agentId, 'orchestrator');",
    why: 'the object half of the unattended delegation grant, including the depth-1 !parentRunId fence'
  },
  {
    id: 'consent.dispatchGrant',
    file: 'sidecar/index.js',
    needle: "dispatchGrant: (call, tool) => !execution.taintedBy() && (ownerTrusted || unattendedGrants.indexOf('orchestrator') >= 0),",
    why: 'the injected consent predicate for permissions.js tier 2.45; this preflight mirrors exactly this expression'
  },
  {
    id: 'consent.hardlinePathOnly',
    file: 'sidecar/index.js',
    needle: 'function hardlineFloor(call) {\n  const p = call && call.args && call.args.path;',
    why: 'proves the hardline floor inspects only call.args.path, so a team.dispatch call cannot reach it'
  },
  {
    id: 'wire.deferralOff',
    file: 'sidecar/index.js',
    needle: "const deferralOff = String((process.env && process.env.SKYNET_TOOL_SEARCH) || '').trim() === '0';",
    why: 'how the host decides whether deferral is switched off (SKYNET_TOOL_SEARCH=0)'
  },
  {
    id: 'wire.coreNames',
    file: 'sidecar/index.js',
    needle: 'const coreNames = resolved.tools.filter(n => !deferredNames.has(n) && !directDomainWithheld(n));',
    why: 'proves ADVERTISEMENT is resolved.tools MINUS directDomainWithheld — resolved.tools alone is not reach'
  },
  {
    id: 'worker.idRe',
    file: 'sidecar/tools/builtin/orchestration.js',
    needle: 'const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;',
    why: 'the agentId grammar team.dispatch validates every target against'
  },
  {
    id: 'worker.noSelf',
    file: 'sidecar/tools/builtin/orchestration.js',
    needle: "if (aid === leadId) return { agentId: aid, error: 'cannot delegate to yourself' };",
    why: 'self-dispatch is refused inside the tool'
  },
  {
    id: 'worker.mustBeLiveCrew',
    file: 'sidecar/tools/builtin/orchestration.js',
    needle: 'if (!crew.has(aid)) return { agentId: aid, error:',
    why: 'an agentId absent from the live roster is refused, never guessed'
  }
];

/* The ID grammar is DERIVED from the locked source line rather than retyped, so a change to the grammar
   trips the lock instead of silently diverging. */
const LOCKED_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

export function checkSourceLocks(readFile) {
  const read = typeof readFile === 'function'
    ? readFile
    : (rel) => { try { return fs.readFileSync(path.join(REPO, rel), 'utf8'); } catch (_) { return null; } };
  const cache = new Map();
  const out = { ok: true, locks: {} };
  for (const l of SOURCE_LOCKS) {
    if (!cache.has(l.file)) cache.set(l.file, read(l.file));
    const src = cache.get(l.file);
    const found = typeof src === 'string' && src.indexOf(l.needle) >= 0;
    out.locks[l.id] = { ok: found, file: l.file, why: l.why };
    if (!found) out.ok = false;
  }
  return out;
}

/* ================================ THE ASSESSMENT ================================
   assess(input) is deterministic: no IO, no clock, no network. Every live fact arrives through `input`, so
   the test suite drives the exact same code path with fakes. */

const PASS = 'PASS', FAIL = 'FAIL', UNVERIFIED = 'UNVERIFIED';

function axis(status, predicate, seen, detail) {
  return { status, predicate, seen, detail: detail || '' };
}

export function assess(input) {
  const i = input || {};
  const leadId = String(i.leadId || 'agent');
  const workers = Array.isArray(i.workers) ? i.workers.map(w => String(w)) : [];
  const grants = Array.isArray(i.unattendedGrants) ? i.unattendedGrants.map(String) : [];
  const surface = String(i.surface || 'autonomous');
  const isTask = i.isTask !== false;
  const ownerTrusted = i.ownerTrusted === true;
  const parentRunId = i.parentRunId || null;
  const taintedBy = i.taintedBy || null;
  const roster = new Set((Array.isArray(i.roster) ? i.roster : []).map(String));
  const promptText = String(i.promptText || '');
  const connectorIds = Array.isArray(i.connectorIds) ? i.connectorIds.map(String) : [];
  const disabledCaps = i.disabledCaps && typeof i.disabledCaps === 'object' ? i.disabledCaps : {};
  const enabledToolsets = Array.isArray(i.enabledToolsets) ? i.enabledToolsets.map(String) : null;
  const contextFrom = Array.isArray(i.contextFrom) ? i.contextFrom : [];
  const locks = (i.locks && i.locks.locks) ? i.locks.locks : (i.locks || {});
  const lockOk = (id) => !!(locks[id] && locks[id].ok);

  const notes = [];
  const tool = i.tool || dispatchToolDescriptor();
  const TOOL = 'team.dispatch';

  /* ---- AXIS 1: capability. The real projection, built the way index.js builds it for a cron fire. ---- */
  let capabilityAxis, resolvedTools = [], roomObjects = [];
  if (!lockOk('capability.orchestratorGrant')) {
    capabilityAxis = axis(UNVERIFIED, 'sidecar/index.js orchestrator grant line (source lock)', 'lock MISSING',
      'the line that injects the orchestrator object has changed; this preflight can no longer claim it mirrors the host');
  } else {
    try {
      const placed = savedPlacement(i.savedDoc, leadId);
      const objects = composeOffice({
        surface: i.floorless ? 'autonomous' : surface,
        lead: ownerTrusted,                 // cron passes no `lead`; only ownerTrusted can add it here
        connectorIds, extraObjects: placed
      });
      let station = i.station || {
        agents: { [leadId]: { id: leadId, room: 'office' } },
        rooms: { office: { id: 'office', objects } }
      };
      if (ownerTrusted || grants.indexOf('workbench') >= 0) station = stationWithObject(station, leadId, 'workbench');
      if (ownerTrusted || grants.indexOf('connectors') >= 0) station = stationWithConnectors(station, leadId, connectorIds);
      if (ownerTrusted) station = stationWithObject(station, leadId, 'orchestrator');
      if (grants.indexOf('orchestrator') >= 0 && !parentRunId) station = stationWithObject(station, leadId, 'orchestrator');

      roomObjects = ((station.rooms[(station.agents[leadId] || {}).room] || {}).objects || []).map(o => o.objectType);
      let resolved = inputpolicy.enforceSyntheticOnly(
        resolveTools(leadId, station, undefined, { disabledCaps }), false);

      const authority = inputpolicy.makeRunAuthority({
        surface, isTask, unattendedGrants: grants, ownerTrusted,
        environment: null, confirm: null
      });
      // a minimal registry view: enforceRunAuthority/enforceEnabledToolsets only need get(name).
      const registryView = { get: (name) => (name === TOOL ? tool : { name, capability: null, scope: 'read' }) };
      resolved = inputpolicy.enforceRunAuthority(resolved, registryView, authority);
      if (enabledToolsets) resolved = inputpolicy.enforceEnabledToolsets(resolved, registryView, enabledToolsets);
      resolvedTools = resolved.tools || [];

      const present = resolvedTools.indexOf(TOOL) >= 0;
      const projected = authority.project(tool);
      capabilityAxis = present && projected === true
        ? axis(PASS, 'capability/resolve.js resolveTools + inputpolicy.enforceRunAuthority',
            TOOL + ' IS in resolved.tools, authority.project=true',
            'CAPABILITY IS NOT REACH. resolved.tools containing ' + TOOL + ' only means the orchestrator object '
            + 'resolved; the model is told about a tool only if it also survives into the core/deferred WIRE list '
            + '(resolved.tools MINUS directDomainWithheld) — see the wireReachable axis, which is the one that '
            + 'refused the 2026-11-17 run while this axis looked perfectly healthy. '
            + 'Distinct room objects: ' + Array.from(new Set(roomObjects)).join(', '))
        : axis(FAIL, 'capability/resolve.js resolveTools + inputpolicy.enforceRunAuthority',
            TOOL + ' present=' + present + ', authority.project=' + JSON.stringify(projected),
            present
              ? 'the orchestrator object resolved but run authority stripped the tool'
              : 'the orchestrator object did not reach the lead\'s room — grants=' + JSON.stringify(grants)
                + (parentRunId ? ' and parentRunId is set (a delegated worker never gets it: depth fence)' : ''));
    } catch (e) {
      capabilityAxis = axis(UNVERIFIED, 'capability/resolve.js resolveTools', 'threw: ' + ((e && e.message) || e),
        'the real projection could not be computed, so capability is unknown — not assumed');
    }
  }

  /* ---- AXIS 2: WIRE REACHABILITY — the gate that actually refused the 2026-11-17 run, and the one a
          capability-and-consent-only preflight would report green over.

          ADVERTISEMENT, not capability, is what the model can call. index.js:
            deferredNames = (deferralOff ? [] : resolved.deferred).filter(n => !directDomainWithheld(n))
            coreNames     = resolved.tools.filter(n => !deferredNames.has(n) && !directDomainWithheld(n))
          Only coreNames + deferredNames build `fromWire`. A granted DOTTED tool with no fromWire entry
          cannot match `grantedSet.has(c.name)` either (grantedSet holds dotted names, c.name is the
          underscored wire name), so it lands in the "exists but is not available to you" branch and returns
          summary:'withheld' in 0ms. Deferral is survivable — tool.search can still reveal a deferred tool —
          but a directDomainWithheld name is stripped from BOTH lists and is unreachable by any route. ---- */
  let wireAxis, directDomain = null;
  const deferralOff = i.deferralOff === undefined
    ? String((process.env && process.env.SKYNET_TOOL_SEARCH) || '').trim() === '0'
    : i.deferralOff === true;
  /* The host hands classify() a workspace-file probe (index.js workspaceFileProbe), so a prompt that merely
     NAMES `brief.md` is no longer read as a Moldovan host. This preflight must be given the SAME probe or its
     verdict is not a mirror: without one it would FAIL a routine the live run handles fine. gatherLiveInputs
     supplies a real bounded probe; a caller that omits it gets UNVERIFIED rather than a guess. */
  const isWorkspaceFile = (typeof i.isWorkspaceFile === 'function') ? i.isWorkspaceFile : null;
  if (!lockOk('wire.directDomainWithheld') || !lockOk('wire.directDomainTask')
      || !lockOk('wire.withheldBranch') || !lockOk('wire.coreNames') || !lockOk('wire.workspaceFileProbe')) {
    wireAxis = axis(UNVERIFIED, 'sidecar/index.js directDomainWithheld / coreNames / withheld branch (source locks)',
      'lock MISSING',
      'the wire-withholding predicate has changed; its effect on team.dispatch can no longer be mirrored here');
  } else {
    directDomain = isTask
      ? DomainTask.classify(promptText, isWorkspaceFile ? { isWorkspaceFile } : undefined)
      : null;
    // the locked predicate, applied to the one name this preflight cares about
    const withheld = !!directDomain && /^team\./.test(TOOL);
    if (withheld && !isWorkspaceFile) {
      wireAxis = axis(UNVERIFIED, 'domain-task.js classify(promptText) + index.js directDomainWithheld',
        'classify -> ' + JSON.stringify(directDomain) + ' (NO workspace-file probe supplied)',
        'the text reads as a bounded single-host inspection on "' + directDomain.host + '", BUT the host passes '
        + 'a workspace-file probe to classify() and this run of the preflight was given none — so whether the '
        + 'live run would also classify (and strip every team.* tool) cannot be decided here. Supply '
        + 'isWorkspaceFile, or check by hand whether a file named "' + directDomain.host + '" exists in the '
        + 'lead\'s workspace: if it does, the live run is fine; if it does not, this is a real direct-domain strip.');
    } else if (withheld) {
      wireAxis = axis(FAIL, 'domain-task.js classify(promptText) + index.js directDomainWithheld',
        'classify -> ' + JSON.stringify(directDomain),
        'DIRECT-DOMAIN POLICY ACTIVE on host "' + directDomain.host + '". The routine prompt reads as a bounded '
        + 'single-host inspection, so EVERY team.* tool is removed from BOTH the core and the deferred wire lists. '
        + TOOL + ' never enters fromWire, so the call falls into the "exists but not granted" branch and returns '
        + 'summary:"withheld" in 0ms — before capability, consent or taint are consulted, and with resolved.tools '
        + 'still containing the tool. tool.search cannot recover it either (it reveals DEFERRED names only). '
        + 'FIX (prompt text only, no code change): "' + directDomain.host + '" is being read as a HOSTNAME because '
        + 'its last label is a real public suffix (e.g. ".md" = Moldova), and the workspace-file probe found NO '
        + 'file of that name, so the host has nothing to override the reading with. Path-prefix it '
        + '("workspaces/agent/' + directDomain.host + '" or "./' + directDomain.host + '"), or drop the extension, '
        + 'or create the file it names. Any of those makes classify() return null.');
    } else {
      wireAxis = axis(PASS, 'domain-task.js classify(promptText) + index.js directDomainWithheld',
        'classify -> null (host candidates seen: '
        + JSON.stringify(DomainTask.hostsOf(promptText, isWorkspaceFile ? { isWorkspaceFile } : undefined))
        + (isWorkspaceFile ? ', workspace-file probe consulted' : ', no workspace-file probe') + ')',
        'no direct-domain policy, so team.* survives into the wire list. Deferral is '
        + (deferralOff ? 'OFF (SKYNET_TOOL_SEARCH=0) — every granted tool is advertised directly'
                      : 'ON (default) — a deferred tool is still reachable via tool.search, unlike a '
                        + 'direct-domain-stripped one'));
    }
    if (contextFrom.length) {
      notes.push('contextFrom is NON-EMPTY (' + contextFrom.length + '): cron-driver prepends upstream context to the '
        + 'prompt before classify() sees it, so the text checked here is not the text the host will classify. '
        + 'Treat the wire axis as advisory for this routine.');
      wireAxis = axis(UNVERIFIED, wireAxis.predicate, wireAxis.seen,
        'contextFrom is non-empty, so the assembled user text differs from the durable prompt — not verifiable here');
    }
  }

  /* ---- AXIS 3: consent. The REAL ladder from sidecar/permissions.js, with index.js's injected predicates
          mirrored under source lock. Deliberately evaluated with bypass=false and unrestrictedHost=false:
          a PASS must mean "tier 2.45 granted it", not "Full Access would have allowed anything". ---- */
  let consentAxis = null, consentVerdict = null;
  if (!lockOk('consent.dispatchGrant') || !lockOk('consent.hardlinePathOnly')) {
    consentAxis = axis(UNVERIFIED, 'sidecar/permissions.js tier 2.45 dispatchAutonomy (injected predicate source lock)',
      'lock MISSING',
      'the dispatchGrant closure or the hardline floor has changed shape; the consent verdict cannot be reproduced '
      + 'outside the sidecar without guessing, so it is reported UNVERIFIED rather than simulated');
  } else {
    try {
      const consent = makeConsentBroker({
        bypass: false,                      // measure the NARROW grant tier, not Full Access
        unrestrictedHost: false,
        hardline: () => null,               // locked: hardlineFloor reads only call.args.path; dispatch has none
        sessionKey: 'preflight',
        networkOf: () => true,              // CAP_REGISTRY marks team.dispatch network:true
        surface,
        prompt: null,                       // an unattended run has no prompt channel, by construction
        // the mirror of index.js's dispatchGrant, pinned by consent.dispatchGrant above
        dispatchGrant: () => !taintedBy && (ownerTrusted || grants.indexOf('orchestrator') >= 0)
      });
      const call = { name: TOOL, args: { workers: workers.map(a => ({ agentId: a, prompt: 'preflight' })) } };
      const v = consent(call, tool);
      if (v && typeof v.then === 'function') {
        consentAxis = axis(UNVERIFIED, 'sidecar/permissions.js makeConsentBroker', 'returned a Promise',
          'the broker took its INTERACTIVE ask-the-human branch; an unattended preflight cannot resolve that');
      } else {
        consentVerdict = v;
        consentAxis = v && v.allow === true
          ? axis(PASS, 'sidecar/permissions.js makeConsentBroker (real ladder, tier 2.45 dispatchAutonomy)',
              'allow=true reason="' + v.reason + '" scope=' + v.scope,
              'evaluated with bypass=false, so this is the per-routine delegation grant and not Full Access')
          : axis(FAIL, 'sidecar/permissions.js makeConsentBroker (real ladder)',
              'allow=' + (v && v.allow) + ' reason="' + (v && v.reason) + '"',
              taintedBy
                ? 'the run is tainted, so index.js\'s dispatchGrant is false and tier 2.45 cannot open the exec lockout'
                : 'no orchestrator grant on this routine, so team.dispatch (scope execute) dies at the autonomous exec lockout');
      }
    } catch (e) {
      consentAxis = axis(UNVERIFIED, 'sidecar/permissions.js makeConsentBroker', 'threw: ' + ((e && e.message) || e),
        'the real broker could not be exercised');
    }
  }

  /* ---- AXIS 4: taint. Run-scoped state, latched the first time outside-authored content is read. ---- */
  const taintAxis = taintedBy
    ? axis(FAIL, 'index.js execution.taintedBy() (supplied)', 'tainted by: ' + taintedBy,
        'taint permanently revokes delegation for the rest of the run and cannot be undone or appealed')
    : axis(PASS, 'index.js execution.taintedBy() / cron-driver initialTaint', 'no taint',
        contextFrom.length
          ? 'WARNING: cron-driver sets initialTaint when contextFrom is non-empty — this routine would start TAINTED'
          : 'contextFrom is empty, so the fire starts untainted; taint can still latch mid-run');
  if (!taintedBy && contextFrom.length) {
    taintAxis.status = FAIL;
    taintAxis.seen = 'contextFrom=' + JSON.stringify(contextFrom) + ' -> cron-driver passes initialTaint:true';
  }

  /* ---- per-worker: identity + the four shared axes ---- */
  const idRePinned = lockOk('worker.idRe');
  const selfPinned = lockOk('worker.noSelf');
  const crewPinned = lockOk('worker.mustBeLiveCrew');

  const workerRows = workers.map(agentId => {
    const axes = {};
    axes.agentIdGrammar = !idRePinned
      ? axis(UNVERIFIED, 'orchestration.js ID_RE (source lock)', 'lock MISSING', 'the agentId grammar changed')
      : (LOCKED_ID_RE.test(agentId)
          ? axis(PASS, 'orchestration.js ID_RE', agentId + ' matches ' + String(LOCKED_ID_RE), '')
          : axis(FAIL, 'orchestration.js ID_RE', JSON.stringify(agentId) + ' does not match ' + String(LOCKED_ID_RE),
              'team.dispatch refuses the target with "invalid agentId"'));
    axes.notSelf = !selfPinned
      ? axis(UNVERIFIED, 'orchestration.js aid === leadId (source lock)', 'lock MISSING', 'the self-dispatch refusal changed')
      : (agentId !== leadId
          ? axis(PASS, 'orchestration.js aid === leadId', agentId + ' !== ' + leadId, '')
          : axis(FAIL, 'orchestration.js aid === leadId', agentId + ' === ' + leadId,
              'team.dispatch refuses with "cannot delegate to yourself"'));
    axes.inRoster = !crewPinned
      ? axis(UNVERIFIED, 'orchestration.js crew.has(aid) (source lock)', 'lock MISSING', 'the roster refusal changed')
      : (roster.has(agentId)
          ? axis(PASS, 'orchestration.js crew.has(aid) vs the live roster mirror', agentId + ' present in roster', '')
          : axis(FAIL, 'orchestration.js crew.has(aid) vs the live roster mirror', agentId + ' NOT in roster '
              + JSON.stringify(Array.from(roster)),
              'team.dispatch refuses with "no such live worker" — it never guesses an agentId'));
    axes.capability = capabilityAxis;
    axes.wireReachable = wireAxis;
    axes.consent = consentAxis;
    axes.taint = taintAxis;

    const statuses = Object.keys(axes).map(k => axes[k].status);
    const verdict = statuses.indexOf(FAIL) >= 0 ? FAIL : (statuses.indexOf(UNVERIFIED) >= 0 ? UNVERIFIED : PASS);
    const blockers = Object.keys(axes)
      .filter(k => axes[k].status !== PASS)
      .map(k => k + ': ' + axes[k].status + ' — ' + (axes[k].detail || axes[k].seen));
    return { agentId, verdict, axes, blockers };
  });

  /* ---- FAIL CLOSED. No workers at all is not a pass; one UNVERIFIED axis anywhere is not a pass. ---- */
  const unverified = workerRows.filter(w => w.verdict === UNVERIFIED).length;
  const failed = workerRows.filter(w => w.verdict === FAIL).length;
  const verdict = (workerRows.length > 0 && failed === 0 && unverified === 0) ? PASS : FAIL;
  if (!workerRows.length) notes.push('no workers were supplied — a preflight over an empty crew cannot pass.');

  // The roster mirror is a FILE; the running sidecar's authority is its in-memory roster.
  notes.push('roster read from the agent.roster.json mirror. The live sidecar\'s in-memory roster is the real '
    + 'authority for crew.has(); a roster pushed since the last mirror write would not be reflected here.');
  if (!taintedBy) notes.push('taint is per-run: this says the fire STARTS clean, not that it stays clean. The '
    + 'routine must dispatch before reading any outside-authored content.');
  for (const n of (Array.isArray(i.extraNotes) ? i.extraNotes : [])) notes.push(n);

  return {
    verdict,
    leadId,
    workers: workerRows,
    shared: { capability: capabilityAxis, wireReachable: wireAxis, consent: consentAxis, taint: taintAxis },
    facts: {
      surface, isTask, ownerTrusted, parentRunId: parentRunId || null,
      unattendedGrants: grants, contextFrom, enabledToolsets,
      deferralOff,
      roomObjects: Array.from(new Set(roomObjects)), directDomain,
      consentVerdict,
      tool: { name: tool.name, capability: tool.capability, scope: tool.scope, requiresConsent: !!tool.requiresConsent }
    },
    sourceLocks: locks,
    counts: { workers: workerRows.length, failed, unverified },
    notes
  };
}

/* ================================ LIVE INPUT GATHERING ================================ */

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

export function findCronJob(jobsDoc, id) {
  const jobs = Array.isArray(jobsDoc) ? jobsDoc : ((jobsDoc && jobsDoc.jobs) || []);
  return jobs.find(j => j && String(j.id) === String(id))
      || jobs.find(j => j && String(j.id).startsWith(String(id)))
      || null;
}

export function rosterIdsFrom(rosterDoc) {
  if (!rosterDoc) return [];
  const agents = rosterDoc.doc && Array.isArray(rosterDoc.doc.agents) ? rosterDoc.doc.agents
    : (Array.isArray(rosterDoc.agents) ? rosterDoc.agents : (Array.isArray(rosterDoc) ? rosterDoc : []));
  return agents.map(a => String((a && (a.id || a.agentId)) || '')).filter(Boolean);
}

/* The connector store may be SEALED (sidecar/connector-vault.js, AES-256-GCM envelope
   `starnet.connector-vault.v1`). This preflight deliberately does NOT hold the vault key, so when the file
   is sealed it reports the ids as UNREADABLE rather than decrypting or pretending there are none. Connector
   portals only add `mcp:*` tools, so this cannot change the team.dispatch verdict — it is reported so the
   room-objects line is not read as "this station has no connectors". */
export function connectorIdsFrom(stateDoc) {
  if (!stateDoc) return { ids: [], readable: false, why: 'connectors/state.json missing or unparseable' };
  if (typeof stateDoc.format === 'string' && /connector-vault/.test(stateDoc.format)) {
    return { ids: [], readable: false, why: 'sealed by the connector vault (' + stateDoc.format + '); this preflight holds no key' };
  }
  const list = Array.isArray(stateDoc.connectors) ? stateDoc.connectors
    : (stateDoc.connectors && typeof stateDoc.connectors === 'object' ? Object.keys(stateDoc.connectors).map(k => ({ id: k })) : []);
  return { ids: list.map(c => String((c && c.id) || '')).filter(Boolean), readable: true, why: '' };
}

export function disabledCapsFrom(toolsetsDoc) {
  const out = {};
  const src = (toolsetsDoc && toolsetsDoc.disabled && typeof toolsetsDoc.disabled === 'object') ? toolsetsDoc.disabled : {};
  for (const k of Object.keys(src)) if (src[k] === false) out[k] = true;
  return out;
}

/* A MIRROR of index.js workspaceFileProbe (source-locked as wire.workspaceFileProbe): root first, then one
   level of subdirectories, under the same caps. It exists because the host now hands this probe to classify(),
   so a preflight without it would report a direct-domain strip on a routine the live run handles correctly.
   Read-only, never throws, and refuses any token carrying a separator — a hostname cannot contain one, and
   refusing keeps the probe off any traversal path. */
export function workspaceFileProbeFor(root) {
  const MAX_DIRS = 64, MAX_ENTRIES = 4000;
  return function (raw) {
    const name = String(raw || '');
    if (!name || name.length > 255 || /[/\\\0]/.test(name) || name.indexOf('..') >= 0) return false;
    try { if (fs.existsSync(path.join(root, name))) return true; } catch (_) { return false; }
    let list;
    try { list = fs.readdirSync(root, { withFileTypes: true }); } catch (_) { return false; }
    let entries = 0, dirs = 0;
    for (const d of list) {
      if (++entries > MAX_ENTRIES || dirs >= MAX_DIRS) break;
      if (!d.isDirectory() || d.name.charAt(0) === '.' || d.name === 'node_modules') continue;
      dirs++;
      let sub;
      try { sub = fs.readdirSync(path.join(root, d.name), { withFileTypes: true }); } catch (_) { continue; }
      for (const f of sub) {
        if (++entries > MAX_ENTRIES) break;
        if (f.name === name && !f.isDirectory()) return true;
      }
    }
    return false;
  };
}

export function gatherLiveInputs(opts) {
  const o = opts || {};
  const ws = o.workspaces || WORKSPACES;
  const jobId = o.jobId || ETSY_CHAIN_JOB_ID;
  const jobsDoc = readJson(path.join(ws, 'cron.jobs.json'));
  const job = findCronJob(jobsDoc, jobId);
  if (!job) throw new Error('cron job ' + jobId + ' not found in ' + path.join(ws, 'cron.jobs.json'));
  const conn = connectorIdsFrom(readJson(path.join(ws, 'connectors', 'state.json')));
  const extraNotes = [];
  if (!conn.readable) extraNotes.push('connector ids UNREADABLE — ' + conn.why
    + '. Connector portals grant only mcp:* tools, so this does not affect the team.dispatch verdict.');
  return {
    job,
    input: {
      extraNotes,
      leadId: String(job.agentId || 'agent'),
      workers: Array.isArray(o.workers) ? o.workers : ETSY_WORKERS,
      unattendedGrants: Array.isArray(job.unattendedGrants) ? job.unattendedGrants : [],
      surface: 'autonomous',
      isTask: true,
      ownerTrusted: false,
      parentRunId: null,
      taintedBy: null,
      roster: rosterIdsFrom(readJson(path.join(ws, 'agent.roster.json'))),
      promptText: String(job.prompt || ''),
      // the lead's own workspace, exactly as the host scopes it
      isWorkspaceFile: workspaceFileProbeFor(path.join(ws, String(job.agentId || 'agent'))),
      connectorIds: conn.ids,
      disabledCaps: disabledCapsFrom(readJson(path.join(ws, 'toolsets.json'))),
      enabledToolsets: Array.isArray(job.enabledToolsets) ? job.enabledToolsets : null,
      contextFrom: Array.isArray(job.contextFrom) ? job.contextFrom : [],
      savedDoc: readJson(path.join(ws, 'agent.save.json')),
      locks: checkSourceLocks()
    }
  };
}

/* ================================ RENDERING ================================ */

export function renderText(result, extra) {
  const L = [];
  const e = extra || {};
  L.push('ETSY DELEGATION PREFLIGHT — ' + (e.at || new Date().toISOString()));
  if (e.jobId) L.push('routine : ' + e.jobId + (e.jobName ? '  (' + e.jobName + ')' : '')
    + (e.enabled == null ? '' : '  enabled=' + e.enabled));
  L.push('lead    : ' + result.leadId + '   grants=' + JSON.stringify(result.facts.unattendedGrants)
    + '   surface=' + result.facts.surface);
  L.push('VERDICT : ' + result.verdict
    + '   (' + result.counts.workers + ' workers, ' + result.counts.failed + ' FAIL, '
    + result.counts.unverified + ' UNVERIFIED)');
  L.push('');
  for (const w of result.workers) {
    L.push('  ' + w.verdict.padEnd(10) + w.agentId);
    for (const k of Object.keys(w.axes)) {
      const a = w.axes[k];
      L.push('      ' + (a.status === PASS ? 'ok  ' : a.status === FAIL ? 'FAIL' : 'UNK ') + ' ' + k);
      L.push('           predicate: ' + a.predicate);
      L.push('           seen     : ' + a.seen);
      if (a.detail) L.push('           note     : ' + a.detail);
    }
    L.push('');
  }
  const badLocks = Object.keys(result.sourceLocks).filter(k => !result.sourceLocks[k].ok);
  L.push('source locks: ' + (badLocks.length ? 'STALE -> ' + badLocks.join(', ') : 'all ' + Object.keys(result.sourceLocks).length + ' match'));
  for (const n of result.notes) L.push('note: ' + n);
  return L.join('\n');
}

/* ================================ CLI ================================ */

export async function main(argv) {
  const args = (argv || []).slice();
  const flag = (name) => args.some(a => a === '--' + name);
  const value = (name) => { const hit = args.find(a => a.indexOf('--' + name + '=') === 0); return hit ? hit.slice(name.length + 3) : null; };
  const jobId = value('job') || ETSY_CHAIN_JOB_ID;

  let gathered;
  try { gathered = gatherLiveInputs({ jobId }); }
  catch (e) {
    const msg = 'PREFLIGHT FAIL — could not read live state: ' + ((e && e.message) || e);
    console.log(msg);
    return { code: 1, result: null, text: msg };
  }
  const result = assess(gathered.input);
  const text = renderText(result, {
    jobId: gathered.job.id, jobName: gathered.job.name, enabled: gathered.job.enabled, at: new Date().toISOString()
  });
  const json = JSON.stringify(result, null, 2);

  if (flag('json')) console.log(json);
  else { console.log(text); console.log('\n--- MACHINE READABLE ---\n' + json); }

  const reportPath = value('report');
  if (reportPath) {
    const abs = path.resolve(reportPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text + '\n\n--- MACHINE READABLE ---\n' + json + '\n');
    console.log('\nreport written: ' + abs);
  }
  return { code: result.verdict === PASS ? 0 : 1, result, text, json };
}

const invokedDirectly = (() => {
  try { return process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url)); }
  catch (_) { return false; }
})();
if (invokedDirectly) {
  const r = await main(process.argv.slice(2));
  process.exit(r.code);
}

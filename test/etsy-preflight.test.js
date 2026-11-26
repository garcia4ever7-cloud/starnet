/* test/etsy-preflight.test.js — the Etsy delegation preflight must FAIL CLOSED, and must fail for the RIGHT
   REASON.

   THE DEFECT IT EXISTS FOR. On 2026-11-17T11:05Z the armed Etsy chain (cron ebc4f07d) spent $0.53 over 19
   turns and dispatched ZERO workers. The run record's toolTrace reads `team_dispatch … ms: 0 … summary:
   "withheld"`, while `connectors_list` — the taint source the routine prompt itself now blames — ran 105
   SECONDS LATER, and `station_layout` (granted ONLY by the orchestrator object) SUCCEEDED in the same run.
   So the orchestrator object resolved, team.dispatch WAS in resolved.tools, the run was NOT tainted, and
   consent was never consulted.

   The refusal is at a third gate: ADVERTISEMENT. sidecar/index.js builds

       directDomainWithheld = (name) => !!directDomainTask && (/^team\./.test(name) || …)
       deferredNames        = (deferralOff ? [] : resolved.deferred).filter(n => !directDomainWithheld(n))
       coreNames            = resolved.tools.filter(n => !deferredNames.has(n) && !directDomainWithheld(n))

   and only those two lists build `fromWire`. A granted DOTTED tool with no fromWire entry cannot match
   `grantedSet.has(c.name)` either (grantedSet holds dotted names; c.name is the underscored wire name), so it
   lands in the "exists but is not available to you" branch and answers in 0ms. `directDomainTask` comes from
   DomainTask.classify(latestUserText(messages)), and the routine prompt names the file
   `etsy-creative-brief.md` — `.md` is Moldova's ccTLD, so the classifier reads a FILENAME as the one explicit
   host of a bounded single-host inspection and switches delegation off for the whole run.

   A preflight that checked only capability and consent would have reported PASS for that run. THAT is the
   false green these assertions exist to make impossible, so the direct-domain axis is pinned hardest.

   Mocks/fakes only: no network, no live sidecar, no provider call. The REAL project modules are used with
   FAKE data — that is the point, since a reimplemented predicate could pass while the host refuses.

   Plain node, no framework: node test/etsy-preflight.test.js */
'use strict';

const A = require('./_assert.js');

/* ---- fixtures ------------------------------------------------------------------------------------- */

// A save envelope in the shape savedPlacement actually accepts ({ doc: { station } }) — the flat `save.station`
// shape is the bug that once handed every headless run ZERO objects.
function fakeSave() {
  return {
    version: 1, agentId: 'agent', updatedAt: Date.now(),
    doc: {
      updatedAt: Date.now(),
      station: {
        w: 40, h: 30,
        props: [
          { id: 'desk-lead', t: 'desk', x: 2, y: 2, w: 2, h: 2, agentId: 'agent' },
          { id: 'cab1', t: 'cabinet', x: 5, y: 2, w: 1, h: 1 },
          { id: 'nb1', t: 'notebook', x: 6, y: 2, w: 1, h: 1 }
        ]
      }
    }
  };
}

const ROSTER = ['agent', 'scout', 'webdesigner', 'qceditor', 'publisher', 'harvest'];
const WORKERS = ['scout', 'webdesigner', 'qceditor', 'publisher'];

// A prompt with NO host candidate at all: classify() must return null so the wire axis can pass.
const CLEAN_PROMPT = [
  'You are leading one unattended Etsy work beat. Work through the stages in order.',
  'STAGE 0 - read the standing creative brief at workspaces/agent/etsy-creative-brief.md before anything else.',
  'STAGE 1 - team.dispatch to agentId "scout" for one sourced opportunity.',
  'STAGE 3 - ask PUBLISHER for a listing draft only. Publish nothing. Buy nothing.'
].join('\n');

// The same instruction with the filename written BARE — the live 2026-11-17 shape.
const BARE_MD_PROMPT = CLEAN_PROMPT.replace('workspaces/agent/etsy-creative-brief.md', '`etsy-creative-brief.md`');

/* The real source-lock result, filled in once the ESM module is imported. Note that assess() has NO default
   here on purpose: a caller that forgets to supply locks gets UNVERIFIED on every locked axis and therefore
   FAIL. Fail-closed beats convenient. */
let LOCKS = null;

function baseInput(over) {
  return Object.assign({
    locks: LOCKS,
    leadId: 'agent',
    workers: WORKERS.slice(),
    unattendedGrants: ['orchestrator'],
    surface: 'autonomous',
    isTask: true,
    ownerTrusted: false,
    parentRunId: null,
    taintedBy: null,
    roster: ROSTER.slice(),
    promptText: CLEAN_PROMPT,
    connectorIds: [],
    disabledCaps: {},
    enabledToolsets: null,
    contextFrom: [],
    deferralOff: false,
    // The host hands classify() a workspace-file probe. The default here says NOTHING exists, which is the
    // honest baseline for these synthetic inputs (there is no real workspace) and keeps the direct-domain
    // assertions below meaningful: a bare `foo.md` that names no actual file really IS read as a hostname.
    isWorkspaceFile: () => false,
    savedDoc: fakeSave()
  }, over || {});
}

/* ---- tests ---------------------------------------------------------------------------------------- */

function testSourceLocksAreReal(M) {
  // Against the real tree every lock must match. A stale lock is not a style nit: it downgrades a live axis
  // to UNVERIFIED, which fails the whole preflight. If this assertion fires, the host changed and the
  // mirrored predicate in etsy-preflight.mjs must be re-read against it, not retyped from memory.
  const locks = M.checkSourceLocks();
  A.ok(locks.ok, 'every source lock matches the real tree — stale: '
    + Object.keys(locks.locks).filter(k => !locks.locks[k].ok).join(', '));
  A.eq(Object.keys(locks.locks).length, M.SOURCE_LOCKS.length, 'every declared lock was evaluated');

  // and a FAKE reader proves a missing needle is detected rather than silently assumed present.
  const stale = M.checkSourceLocks(() => 'nothing in here matches');
  A.ok(!stale.ok, 'a source file that no longer contains the predicate is reported STALE');
  A.ok(Object.keys(stale.locks).every(k => stale.locks[k].ok === false), 'every lock fails against an empty file');
}

function testRealToolDescriptor(M) {
  // The consent ladder is fed the SHIPPING tool object, not a hand-written stand-in. If any of these four
  // fields drifts, the consent tier that gates delegation changes meaning.
  const t = M.dispatchToolDescriptor();
  A.eq(t.name, 'team.dispatch', 'the real tool name');
  A.eq(t.capability, 'orchestrator', 'team.dispatch rides the orchestrator capability');
  A.eq(t.scope, 'execute', 'scope execute — this is why it needs permissions.js tier 2.45 and not just a cap');
  A.eq(t.requiresConsent, true, 'team.dispatch is consent-gated');
}

function testFullyGrantedLeadPasses(M) {
  const r = M.assess(baseInput());
  A.eq(r.verdict, 'PASS', 'a fully granted, untainted lead with a clean prompt PASSES');
  A.eq(r.counts.workers, 4, 'all four workers assessed');
  A.eq(r.counts.failed, 0, 'no worker FAILs');
  A.eq(r.counts.unverified, 0, 'no axis is UNVERIFIED');
  A.ok(r.workers.every(w => w.verdict === 'PASS'), 'every worker PASSES individually');
  A.eq(r.shared.capability.status, 'PASS', 'capability axis PASS');
  A.eq(r.shared.wireReachable.status, 'PASS', 'wire axis PASS on a prompt with no bare host');
  A.eq(r.shared.consent.status, 'PASS', 'consent axis PASS');
  A.eq(r.shared.taint.status, 'PASS', 'taint axis PASS');
  // the PASS must come from the NARROW grant tier, never from Full Access — the preflight evaluates with
  // bypass:false precisely so a PASS cannot mean "Full Access would have allowed anything".
  A.eq(r.facts.consentVerdict.reason, 'per-routine unattended delegation grant',
    'consent PASSES via tier 2.45, not via a bypass');
  A.eq(r.facts.directDomain, null, 'no direct-domain policy on the clean prompt');
}

/* THE REGRESSION THAT MATTERS MOST. A bare *.md filename must FAIL the wire axis with the direct-domain
   reason; the SAME instruction path-prefixed must PASS it. Both halves are asserted, because a preflight
   that failed on everything would also "catch" this and would be useless. */
function testBareMdFilenameFailsDirectDomain(M) {
  const bad = M.assess(baseInput({ promptText: BARE_MD_PROMPT }));
  A.eq(bad.verdict, 'FAIL', 'a prompt naming a bare *.md file FAILS the preflight');
  A.eq(bad.shared.wireReachable.status, 'FAIL', 'the WIRE axis is the one that fails');
  A.ok(/direct-domain/i.test(bad.shared.wireReachable.detail), 'and it fails for the DIRECT-DOMAIN reason');
  A.ok(bad.facts.directDomain && bad.facts.directDomain.host === 'etsy-creative-brief.md',
    'the detected host is reported by name so the Commander can fix the text');
  A.ok(/withheld/i.test(bad.shared.wireReachable.detail),
    'the detail names the summary the live run actually recorded');

  // THE TRAP, pinned: capability and consent both look perfectly healthy while this fails. A preflight that
  // stopped at those two axes would have reported PASS for the run that dispatched nobody.
  A.eq(bad.shared.capability.status, 'PASS', 'capability still PASSES — resolved.tools contains team.dispatch');
  A.eq(bad.shared.consent.status, 'PASS', 'consent still PASSES — tier 2.45 grants it');
  A.eq(bad.shared.taint.status, 'PASS', 'taint still PASSES — the run is not tainted');
  A.ok(bad.workers.every(w => w.verdict === 'FAIL'), 'yet every worker is unreachable');

  // and the path-prefixed form clears exactly that axis, changing nothing else.
  const good = M.assess(baseInput({ promptText: CLEAN_PROMPT }));
  A.eq(good.shared.wireReachable.status, 'PASS', 'the path-prefixed filename PASSES the wire axis');
  A.eq(good.verdict, 'PASS', 'and the whole preflight PASSES');

  // the other two documented fixes must work too — asserted through the real classifier, not asserted about it
  for (const fix of ['./etsy-creative-brief.md', 'etsy-creative-brief']) {
    const r = M.assess(baseInput({ promptText: BARE_MD_PROMPT.replace('`etsy-creative-brief.md`', '`' + fix + '`') }));
    A.eq(r.shared.wireReachable.status, 'PASS', 'the documented fix "' + fix + '" clears the wire axis');
  }

  /* THE CODE FIX, mirrored. sidecar/index.js now hands classify() a workspace-file probe, so the SAME bare
     prompt is safe once the file it names actually exists. The preflight must agree with the host or its
     verdict is not a mirror — and a caller that supplies no probe must get UNVERIFIED, never a guess. */
  const exists = (raw) => String(raw) === 'etsy-creative-brief.md';
  const fixed = M.assess(baseInput({ promptText: BARE_MD_PROMPT, isWorkspaceFile: exists }));
  A.eq(fixed.shared.wireReachable.status, 'PASS',
    'with the file actually present, the bare reference is not a host and the wire axis PASSES');
  A.eq(fixed.facts.directDomain, null, 'and no direct-domain policy is produced at all');
  A.eq(fixed.verdict, 'PASS', 'so the whole preflight PASSES on the unchanged prompt text');
  A.ok(fixed.workers.every(w => w.verdict === 'PASS'), 'every worker is reachable again');

  // a REAL host must still fail the same way even when the probe is generous about everything else
  const realHost = M.assess(baseInput({
    promptText: CLEAN_PROMPT + '\nAlso check example.com and read its docs.', isWorkspaceFile: exists }));
  A.eq(realHost.shared.wireReachable.status, 'FAIL',
    'a genuine single-host inspection still strips team.* — the feature is not deleted');
  A.eq(realHost.facts.directDomain.host, 'example.com', 'and the real host is named');

  // no probe at all -> UNVERIFIED, and UNVERIFIED still fails the preflight
  const noProbe = baseInput({ promptText: BARE_MD_PROMPT });
  delete noProbe.isWorkspaceFile;
  const unk = M.assess(noProbe);
  A.eq(unk.shared.wireReachable.status, 'UNVERIFIED', 'without the probe the wire axis is UNVERIFIED, not FAIL');
  A.ok(/cannot be decided here/i.test(unk.shared.wireReachable.detail), 'and says why it could not decide');
  A.eq(unk.verdict, 'FAIL', 'an UNVERIFIED axis still fails the preflight — fail-closed');
}

function testMissingOrchestratorGrantFails(M) {
  const r = M.assess(baseInput({ unattendedGrants: [] }));
  A.eq(r.verdict, 'FAIL', 'a routine with no orchestrator grant FAILS');
  A.eq(r.shared.capability.status, 'FAIL', 'the capability axis fails — no orchestrator object in the room');
  A.ok(/orchestrator object did not reach/i.test(r.shared.capability.detail),
    'and says plainly that the object never reached the lead\'s room');
  A.eq(r.shared.consent.status, 'FAIL', 'consent fails too — scope execute dies at the autonomous exec lockout');
  A.ok(/silence is not consent/i.test(r.shared.consent.seen),
    'quoting the real broker\'s own refusal string, not a paraphrase');
  A.ok(r.workers.every(w => w.verdict === 'FAIL'), 'no worker is reachable');

  // the depth fence: a DELEGATED lead (parentRunId set) must never resolve the orchestrator object, even
  // when the grant is present. Max delegation depth is 1 structurally, and the preflight must show it.
  const worker = M.assess(baseInput({ parentRunId: 'some-parent-run' }));
  A.eq(worker.shared.capability.status, 'FAIL', 'a run with parentRunId set cannot resolve the orchestrator object');
  A.ok(/parentRunId is set/i.test(worker.shared.capability.detail), 'and the depth fence is named as the reason');
  A.eq(worker.verdict, 'FAIL', 'so a delegated worker cannot re-delegate');
}

function testTaintedRunFails(M) {
  const r = M.assess(baseInput({ taintedBy: 'connector metadata (mcp)' }));
  A.eq(r.verdict, 'FAIL', 'a tainted run FAILS');
  A.eq(r.shared.taint.status, 'FAIL', 'the taint axis fails');
  A.ok(/connector metadata/.test(r.shared.taint.seen), 'the taint SOURCE is reported, not just the fact');
  A.eq(r.shared.consent.status, 'FAIL', 'consent fails too — index.js\'s dispatchGrant short-circuits on taint');
  A.ok(/tainted/i.test(r.shared.consent.detail), 'and consent says taint is why');

  // contextFrom is the OTHER way a run starts tainted: cron-driver passes initialTaint when it is non-empty.
  const upstream = M.assess(baseInput({ contextFrom: ['some-upstream-job'] }));
  A.eq(upstream.shared.taint.status, 'FAIL', 'a routine with contextFrom starts TAINTED and fails');
  A.ok(/initialTaint/.test(upstream.shared.taint.seen), 'naming cron-driver\'s initialTaint as the mechanism');
  // and the wire axis goes UNVERIFIED, because the text the host will classify is not the text checked here
  A.eq(upstream.shared.wireReachable.status, 'UNVERIFIED',
    'with contextFrom set the assembled prompt differs, so the wire axis is UNVERIFIED rather than assumed');
  A.eq(upstream.verdict, 'FAIL', 'and the overall verdict is FAIL');
}

function testUnknownAndSelfWorkerFail(M) {
  const unknown = M.assess(baseInput({ workers: ['scout', 'not-a-real-agent'] }));
  A.eq(unknown.verdict, 'FAIL', 'an agentId absent from the roster FAILS');
  const row = unknown.workers.find(w => w.agentId === 'not-a-real-agent');
  A.eq(row.verdict, 'FAIL', 'the unknown worker row is FAIL');
  A.eq(row.axes.inRoster.status, 'FAIL', 'and specifically on the roster axis');
  A.ok(/no such live worker/.test(row.axes.inRoster.detail), 'quoting the host\'s own refusal');
  A.eq(unknown.workers.find(w => w.agentId === 'scout').verdict, 'PASS',
    'a real worker in the same batch is still reported PASS — the failure is attributed, not smeared');

  const self = M.assess(baseInput({ workers: ['agent'] }));
  A.eq(self.verdict, 'FAIL', 'self-dispatch FAILS');
  A.eq(self.workers[0].axes.notSelf.status, 'FAIL', 'on the notSelf axis');
  A.ok(/cannot delegate to yourself/.test(self.workers[0].axes.notSelf.detail), 'quoting the host\'s refusal');

  const badChars = M.assess(baseInput({ workers: ['scout; rm -rf /'] }));
  A.eq(badChars.workers[0].axes.agentIdGrammar.status, 'FAIL', 'an agentId outside ID_RE FAILS the grammar axis');
  A.eq(badChars.verdict, 'FAIL', 'and the preflight FAILS');

  // FAIL CLOSED on an empty crew: "nothing to check" must never read as "everything is fine".
  const empty = M.assess(baseInput({ workers: [] }));
  A.eq(empty.verdict, 'FAIL', 'a preflight over zero workers FAILS rather than vacuously passing');
  A.ok(empty.notes.some(n => /empty crew/i.test(n)), 'and says why');
}

/* An axis that cannot be evaluated must come back UNVERIFIED and must drag the whole verdict to FAIL. The
   alternative — simulating the host's answer — is how a preflight starts lying. Each lock is knocked out one
   at a time so a single over-broad guard cannot satisfy this by accident. */
function testUnverifiableAxisFailsNeverPasses(M) {
  const cases = [
    { lock: 'consent.dispatchGrant', axis: 'consent' },
    { lock: 'consent.hardlinePathOnly', axis: 'consent' },
    { lock: 'wire.directDomainWithheld', axis: 'wireReachable' },
    { lock: 'wire.coreNames', axis: 'wireReachable' },
    { lock: 'capability.orchestratorGrant', axis: 'capability' },
    { lock: 'worker.idRe', axis: null },
    { lock: 'worker.noSelf', axis: null },
    { lock: 'worker.mustBeLiveCrew', axis: null }
  ];
  const real = M.checkSourceLocks();
  for (const c of cases) {
    const locks = { ok: false, locks: {} };
    for (const k of Object.keys(real.locks)) locks.locks[k] = { ok: k !== c.lock, file: '', why: '' };
    const r = M.assess(baseInput({ locks }));
    A.eq(r.verdict, 'FAIL', 'knocking out lock ' + c.lock + ' FAILS the preflight — never a silent pass');
    A.ok(r.counts.unverified > 0, 'and it fails as UNVERIFIED, not as a confident FAIL (' + c.lock + ')');
    if (c.axis) A.eq(r.shared[c.axis].status, 'UNVERIFIED', c.lock + ' makes the ' + c.axis + ' axis UNVERIFIED');
    A.ok(r.workers.every(w => w.verdict === 'UNVERIFIED'),
      'every worker row reports UNVERIFIED for ' + c.lock + ' rather than a guess');
  }
  // belt and braces: with EVERY lock stale, nothing may pass
  const allStale = { ok: false, locks: {} };
  for (const k of Object.keys(real.locks)) allStale.locks[k] = { ok: false, file: '', why: '' };
  const none = M.assess(baseInput({ locks: allStale }));
  A.eq(none.verdict, 'FAIL', 'with no verifiable predicate at all, the verdict is FAIL');
}

function testOwnerTrustedIsNotAShortcut(M) {
  // ownerTrusted is a real host posture (an authenticated owner DM) and it DOES grant the object + consent.
  // It must not, however, paper over the wire gate: that one is upstream of every authority question.
  const r = M.assess(baseInput({ promptText: BARE_MD_PROMPT, ownerTrusted: true, unattendedGrants: [] }));
  A.eq(r.shared.capability.status, 'PASS', 'ownerTrusted resolves the orchestrator object');
  A.eq(r.shared.wireReachable.status, 'FAIL', 'but it cannot rescue a direct-domain-stripped wire list');
  A.eq(r.verdict, 'FAIL', 'so the preflight still FAILS');
}

function testRenderingIsSafeAndInformative(M) {
  const r = M.assess(baseInput({ promptText: BARE_MD_PROMPT }));
  A.notThrows(() => M.renderText(r, { jobId: 'job-1', jobName: 'etsy', at: 'T' }), 'renderText does not throw on a FAIL');
  const text = M.renderText(r, { jobId: 'job-1', jobName: 'etsy', at: 'T' });
  A.ok(/VERDICT : FAIL/.test(text), 'the human summary leads with the verdict');
  A.ok(/etsy-creative-brief\.md/.test(text), 'and names the offending token');
  A.ok(/predicate:/.test(text), 'and names the predicate consulted for each axis');
  A.notThrows(() => JSON.parse(JSON.stringify(r)), 'the result is JSON-serialisable for the machine-readable block');

  // every axis on every worker must carry BOTH a predicate and what was seen — evidence, not a bare verdict.
  for (const w of r.workers) for (const k of Object.keys(w.axes)) {
    A.ok(w.axes[k].predicate && w.axes[k].seen, w.agentId + '.' + k + ' carries predicate + seen evidence');
    A.ok(['PASS', 'FAIL', 'UNVERIFIED'].indexOf(w.axes[k].status) >= 0, w.agentId + '.' + k + ' has a legal status');
  }
}

function testLiveInputHelpers(M) {
  A.eq(M.rosterIdsFrom({ doc: { agents: [{ id: 'a' }, { id: 'b' }] } }), ['a', 'b'], 'roster ids off the save envelope');
  A.eq(M.rosterIdsFrom({ agents: [{ agentId: 'c' }] }), ['c'], 'roster ids off a flat mirror');
  A.eq(M.rosterIdsFrom(null), [], 'a missing roster yields no ids rather than throwing');
  A.eq(M.findCronJob({ jobs: [{ id: 'abc-123' }] }, 'abc').id, 'abc-123', 'a cron job resolves by id prefix');
  A.eq(M.findCronJob({ jobs: [] }, 'abc'), null, 'an absent job resolves to null, never a guess');

  // the connector store may be SEALED by the vault; the helper must say UNREADABLE, not "there are none".
  const sealed = M.connectorIdsFrom({ format: 'starnet.connector-vault.v1', iv: 'x', tag: 'y', data: 'z' });
  A.eq(sealed.ids, [], 'a sealed connector store yields no ids');
  A.eq(sealed.readable, false, 'and is reported UNREADABLE rather than empty');
  A.ok(/vault/i.test(sealed.why), 'naming the vault as the reason');
  const plain = M.connectorIdsFrom({ connectors: [{ id: 'exa' }, { id: 'apify' }] });
  A.eq(plain.ids, ['exa', 'apify'], 'a plaintext store still reads');
  A.eq(plain.readable, true, 'and is reported readable');
  A.eq(M.disabledCapsFrom({ disabled: { dish: false, cabinet: true } }), { dish: true },
    'only families explicitly set to false become disabled caps');
}

/* ---- the dry run's own safety boundary -------------------------------------------------------------
   The dry run is a sibling deliverable; its hard refusals are asserted here rather than in a second file
   because they are the same contract — a dry run that can start without a passing preflight is not a dry
   run, it is a paid fire with extra steps. */
async function testDryRunSafetyBoundary(D) {
  const good = 'ask for a listing DRAFT only, and tell it draft only. Publish nothing. Buy nothing.';
  A.eq(D.requireDraftOnly(good).ok, true, 'a prompt with both draft-only clauses passes gate 2');
  A.eq(D.requireDraftOnly('ask for a listing draft only').ok, false, '"draft only" alone is not enough');
  A.eq(D.requireDraftOnly('publish nothing').ok, false, '"publish nothing" alone is not enough');
  A.eq(D.requireDraftOnly('').ok, false, 'an empty prompt fails gate 2');
  A.eq(D.requireDraftOnly(good).checked.length, 2, 'both clauses are reported as checked');
  A.eq(D.requireDraftOnly('publish nothing').missing[0].id, 'draft-only', 'the missing clause is named');

  // the intent screen must catch the things the dry run must never ask a worker to do
  for (const bad of ['publish the listing now', 'update the live listing', 'buy more credits',
                     'launch a new Apify actor run', 'write the row to Airtable', 'rotate the api key']) {
    A.eq(D.screenForForbiddenIntent(bad).ok, false, 'forbidden intent caught: ' + bad);
  }
  A.eq(D.screenForForbiddenIntent('DRY RUN, mechanism only. Reply with the single word ACK.').ok, true,
    'the dry run\'s own briefs pass their own screen');
  // and every shipped stage brief must pass it — otherwise the script would refuse its own stages
  for (const st of D.STAGES) {
    A.eq(D.screenForForbiddenIntent(st.brief).ok, true, 'shipped brief for ' + st.id + ' passes the screen');
    A.ok(/DRY RUN/.test(st.brief), st.id + ' brief announces itself as a dry run');
  }
  A.eq(D.STAGES.map(s => s.worker), WORKERS, 'the stages cover exactly the four chain workers, in order');

  /* VERIFY MODE drives the REAL team.dispatch run() with a fake run host. No network, no provider, $0. */
  const v = await D.runVerifyMode({ leadId: 'agent', roster: ROSTER.slice() });
  A.eq(v.mode, 'verify', 'verify mode reports itself');
  A.eq(v.spent, 0, 'verify mode spends nothing');
  A.eq(v.rows.length, 4, 'all four stages ran');
  A.ok(v.rows.every(r => r.outcome === 'DISPATCHED'), 'every stage dispatched through the real tool');
  A.ok(v.rows.every(r => r.usd === 0), 'every stage cost $0');
  A.ok(v.rows.every(r => r.startedAt && r.endedAt && typeof r.ms === 'number'), 'each stage is timestamped');
  A.ok(v.rows.every(r => r.taintedBy === ''), 'each stage records its taint status');
  A.ok(v.rows.every(r => typeof r.retries === 'number' && r.retriesNote), 'retries are recorded with their caveat');
  // the host's own refusals, proven by driving it rather than by reading its source
  A.ok(v.negatives.every(n => n.refused), 'self-dispatch and unknown-agentId are refused by the real tool');
  A.eq(v.negatives.length, 2, 'both negative probes ran');
  // the structural depth-1 fence
  A.eq(v.depthFenceHeld, true, 'every worker started surface:autonomous with parentRunId set');
  A.ok(v.workerLog.every(w => w.surface === 'autonomous'), 'no worker runs on an interactive surface');
  A.ok(v.workerLog.every(w => w.parentRunId === 'dryrun-lead'), 'every worker carries the lead as its parent');
  A.eq(v.workerLog.length, 4, 'exactly four workers were started — the two bad probes started none');
  // a handoff record for EVERY outcome, including the two refusals
  A.eq(v.handoffsRecorded, 6, 'a handoff record is produced for all six dispatches, refusals included');
  A.ok(v.proves.length > 0 && v.provesNot.length > 0, 'the mode states what it does and does not prove');

  // an unknown worker must surface as the HOST's refusal, not be silently skipped
  const missing = await D.runVerifyMode({ leadId: 'agent', roster: ['agent', 'scout'] });
  A.eq(missing.rows[0].outcome, 'DISPATCHED', 'scout still dispatches');
  A.ok(missing.rows.slice(1).every(r => r.outcome === 'REFUSED-BY-HOST'),
    'the three absent workers are REFUSED by the host, not skipped');
  A.ok(/no such live worker/.test(missing.rows[1].error), 'with the host\'s own reason recorded');

  // a brief that trips the screen must be refused BEFORE the dispatcher is reached
  const screened = await D.runVerifyMode({
    leadId: 'agent', roster: ROSTER.slice(),
    stages: [{ id: 'evil', worker: 'publisher', brief: 'publish the listing on etsy now' }]
  });
  A.eq(screened.rows[0].outcome, 'REFUSED-BY-GUARD', 'a forbidden brief is refused by the guard');
  A.eq(screened.workerLog.length, 0, 'and no worker was started at all');

  // SPEND MODE must refuse without a token rather than firing blind — no network is reachable in this test.
  const noToken = await D.runSpendMode({ env: {}, fetch: () => { throw new Error('no network in tests'); } });
  A.eq(noToken.started, false, 'spend mode refuses with no API token');
  A.ok(/token/i.test(noToken.reason), 'and says the token is why');
  const deadSidecar = await D.runSpendMode({
    env: { STARNET_API_TOKEN: 'fake' },
    fetch: async () => { throw new Error('ECONNREFUSED'); }
  });
  A.eq(deadSidecar.started, false, 'spend mode refuses when the sidecar is unreachable');
  A.ok(/unreachable/i.test(deadSidecar.reason), 'and says so rather than reporting a fired run');

  // blocker collapsing: four workers sharing one blocker must read as one line, attributed to all of them
  const collapsed = D.distinctBlockers({
    workers: [
      { agentId: 'a', blockers: ['same thing'] }, { agentId: 'b', blockers: ['same thing'] },
      { agentId: 'c', blockers: ['same thing'] }, { agentId: 'd', blockers: ['same thing'] }
    ]
  });
  A.eq(collapsed.length, 1, 'a shared blocker is reported once');
  A.eq(collapsed[0].who, 'all workers', 'and attributed to all workers');
}

(async () => {
  const M = await import('../scripts/etsy-preflight.mjs');
  const D = await import('../scripts/etsy-dryrun.mjs');
  LOCKS = M.checkSourceLocks();
  testSourceLocksAreReal(M);
  testRealToolDescriptor(M);
  testFullyGrantedLeadPasses(M);
  testBareMdFilenameFailsDirectDomain(M);
  testMissingOrchestratorGrantFails(M);
  testTaintedRunFails(M);
  testUnknownAndSelfWorkerFail(M);
  testUnverifiableAxisFailsNeverPasses(M);
  testOwnerTrustedIsNotAShortcut(M);
  testRenderingIsSafeAndInformative(M);
  testLiveInputHelpers(M);
  await testDryRunSafetyBoundary(D);
  A.report('etsy delegation preflight');
})();

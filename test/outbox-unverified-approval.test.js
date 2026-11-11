/* test/outbox-unverified-approval.test.js — THE UNVERIFIED-APPROVAL GATE (2026-11-10).

   WHAT PROVOKED THIS. Probed against the live station after the approval axis was made writable:

       POST /api/outbox/approval {id:"scout:general:outbox_readiness-check.md@v1", status:"approved"}
       -> ok: true | lifecycle: APPROVED | verification: unverified | qc: not_reviewed | approval: approved

   The top of the lifecycle ladder, reached by skipping the one rung the harness sets MECHANICALLY. At that
   moment 35 of the 53 visible rows had verification:'unverified' — because the verification axis is auto-wired
   for studio VIDEO only (sidecar/index.js, the single setVerification call site) and no host pass exists for
   images or files. So the common case was a two-tap approval of an artifact nothing had decoded, labelled
   APPROVED. That is the 1,056-byte-placeholder incident wearing a green pill, and it breaks the station's
   first law: the interface must never assert state the harness cannot prove.

   WHAT THIS FILE PINS, and why each half matters:
     A. lifecycleOf() splits APPROVED / APPROVED_UNVERIFIED on VERIFICATION — and NOT on qc. A Commander
        overriding a reviewer's opinion is a legitimate business decision; a Commander cannot override physics.
        Pinned in both directions so neither branch can regress alone.
     B. The derived lifecycle set stays CLOSED. The four axes are stored and already pinned; the lifecycle is
        derived, so without this a new rung could reach the UI and `?lifecycle=` with nothing asserting it.
     C. The route refuses a plain approve of an unverified row with 409 + needsAcknowledgement, accepts it with
        acknowledgeUnverified:true, and STAMPS the override itself rather than trusting the caller's detail.
     D. 'rejected' and 'pending' are NOT gated. Making the safe action harder than the risky one would be a
        worse bug than the one this gate fixes.
     E. The gate is a SPEED BUMP, NOT A VETO — the approval axis still records 'approved'. The Commander keeps
        the final word; only the derived summary and the audit trail get honest.

   Plain node, no framework (test/_assert.js), per this repo's convention. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { makeDeliverableManifest, lifecycleOf, LIFECYCLE } = require('../sidecar/deliverable-manifest.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'outbox-unverified-'));
const ws = path.join(tmp, 'workspaces');
const COMMANDER = 'agent';

function makeManifest() {
  const root = path.join(tmp, '.deliverables-' + crypto.randomBytes(4).toString('hex'));
  return makeDeliverableManifest({
    fs, path, crypto, root: root,
    workspaceRootOf: a => path.join(ws, a), now: () => Date.now()
  });
}

/* ---------- A. THE SPLIT IS ON VERIFICATION, NOT ON QC ---------- */
{
  // lifecycleOf is pure, so the ladder is asserted directly on rows rather than through a filesystem fixture.
  const base = { completion: 'complete', verification: 'unverified', qc: 'not_reviewed', approval: 'pending' };
  const row = (over) => Object.assign({}, base, over);

  A.eq(lifecycleOf(row({ approval: 'approved' })), 'APPROVED_UNVERIFIED',
    'approved + unverified -> APPROVED_UNVERIFIED (the live defect this gate closes)');
  A.eq(lifecycleOf(row({ approval: 'approved', verification: 'passed' })), 'APPROVED',
    'approved + verification passed -> a plain APPROVED');

  // QC is explicitly NOT part of the split: the Commander may override a reviewer, and does not need one.
  A.eq(lifecycleOf(row({ approval: 'approved', verification: 'passed', qc: 'not_reviewed' })), 'APPROVED',
    'a verified artifact no reviewer looked at is still APPROVED — QC is an opinion the Commander may override');
  A.eq(lifecycleOf(row({ approval: 'approved', verification: 'passed', qc: 'needs_review' })), 'APPROVED',
    'and an outstanding review request does not downgrade it either');

  // The rungs that must still outrank approval entirely — a rejected or broken artifact never reads approved.
  A.eq(lifecycleOf(row({ approval: 'approved', verification: 'failed' })), 'FAILED',
    'a FAILED verification still outranks approval — approving a broken file cannot hide it');
  A.eq(lifecycleOf(row({ approval: 'approved', verification: 'missing' })), 'MISSING',
    'and a missing original outranks it too');
  A.eq(lifecycleOf(row({ approval: 'approved', verification: 'passed', qc: 'rejected' })), 'REJECTED',
    'a QC rejection outranks a Commander approval');
  A.eq(lifecycleOf(row({ approval: 'approved', verification: 'passed', supersededBy: 'x@v2' })), 'SUPERSEDED',
    'and a superseded row reports SUPERSEDED regardless of its verdicts');

  // The unverified lower rungs are untouched by the split.
  A.eq(lifecycleOf(row({})), 'STAGED', 'an unapproved complete artifact is unchanged at STAGED');
  A.eq(lifecycleOf(row({ qc: 'passed' })), 'QC_REVIEWED', 'and QC_REVIEWED is unchanged');
  A.eq(lifecycleOf(row({ verification: 'passed' })), 'VERIFIED', 'and VERIFIED is unchanged');
}

/* ---------- B. THE DERIVED LIFECYCLE SET IS CLOSED ---------- */
{
  A.ok(LIFECYCLE instanceof Set, 'the module exports the lifecycle set as a drift guard');
  A.ok(LIFECYCLE.has('APPROVED') && LIFECYCLE.has('APPROVED_UNVERIFIED'),
    'both approval rungs are members');
  A.eq(Array.from(LIFECYCLE).sort().join(','),
    'APPROVED,APPROVED_UNVERIFIED,CREATED,FAILED,MISSING,NEEDS_REVIEW,QC_REVIEWED,REJECTED,STAGED,SUPERSEDED,VERIFIED',
    'the closed set is exactly these 11 — adding a rung must be deliberate, not incidental');

  /* Every value lifecycleOf can actually PRODUCE must be a declared member, so the guard cannot drift the
     other way either (a new branch returning an undeclared string). Enumerated by brute force over the axes
     rather than by reading the source, so the assertion survives a rewrite of the ladder. */
  const COMPLETIONS = ['created', 'staged', 'complete', 'failed'];
  const VERIFICATIONS = ['unverified', 'passed', 'failed', 'missing'];
  const QCS = ['not_reviewed', 'needs_review', 'passed', 'rejected'];
  const APPROVALS = ['pending', 'approved', 'rejected'];
  const produced = new Set();
  for (const c of COMPLETIONS) for (const v of VERIFICATIONS) for (const q of QCS) for (const a of APPROVALS) {
    for (const sup of [null, 'other@v2']) {
      produced.add(lifecycleOf({ completion: c, verification: v, qc: q, approval: a, supersededBy: sup }));
    }
  }
  const undeclared = Array.from(produced).filter(v => !LIFECYCLE.has(v));
  A.eq(undeclared.join(','), '', 'lifecycleOf produces no value outside the declared set');
  A.ok(produced.has('APPROVED_UNVERIFIED'), 'and APPROVED_UNVERIFIED is genuinely reachable, not dead code');
  A.ok(produced.has('APPROVED'), 'as is APPROVED');
}

/* ---------- C+D+E. THE ROUTE GATE, exercised through the real handler's logic ---------- */
{
  /* The route body lives inside sidecar/index.js (not independently requirable at ~22k lines), so the gate is
     proven two ways: the DECISION is replayed against the real manifest below, and the route's own source is
     asserted to contain the invariants that cannot be replayed (the host-stamped detail, the 409, and the fact
     that only 'approved' is gated). Source-locking is used ONLY for those, because a future "simplification"
     that trusted body.detail or gated 'rejected' would keep every other test in this file green. */
  fs.mkdirSync(path.join(ws, 'webdesigner'), { recursive: true });
  fs.writeFileSync(path.join(ws, 'webdesigner', 'art.png'),
    Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]));

  const man = makeManifest();
  const reg = man.register({
    ownerAgentId: 'webdesigner', projectId: 'p', files: ['art.png'], shareWith: [COMMANDER, 'qceditor']
  });
  A.ok(reg.ok && reg.entries.length === 1, 'fixture artifact registered');
  const id = reg.entries[0].id;
  A.eq(man.get(COMMANDER, id).verification, 'unverified', 'register() never asserts verification itself');

  // The gate's own predicate, stated exactly as the route states it.
  const needsAck = (status, row) => status === 'approved' && String(row.verification || '') !== 'passed';

  A.eq(needsAck('approved', man.get(COMMANDER, id)), true, 'approving an unverified artifact needs the override');
  A.eq(needsAck('rejected', man.get(COMMANDER, id)), false, 'REJECTING it does not — the safe action stays easy');
  A.eq(needsAck('pending', man.get(COMMANDER, id)), false, 'nor does resetting it to pending');

  // E. a speed bump, not a veto: with the override the approval axis really does record 'approved'.
  const stamp = 'APPROVED WITHOUT HOST VERIFICATION (verification: unverified)';
  A.eq(man.setApproval(id, 'approved', COMMANDER, 'ship it — ' + stamp).ok, true,
    'with the override acknowledged the approval still persists');
  const after = man.get(COMMANDER, id);
  A.eq(after.approval, 'approved', 'the Commander keeps the final word');
  A.eq(after.approvedBy, COMMANDER, 'recorded against the Commander');
  A.ok(/APPROVED WITHOUT HOST VERIFICATION/.test(after.approvalDetail),
    'and the override is in the audit trail, not merely in a log line');
  A.eq(lifecycleOf(after), 'APPROVED_UNVERIFIED', 'while the derived summary stays honest about why');

  // Once a real host pass lands, the SAME row reads APPROVED with no further Commander action.
  A.eq(man.setVerification(id, 'passed', '2400x3000 @300dpi, sha256 re-verified').ok, true, 'host verifies it');
  A.eq(lifecycleOf(man.get(COMMANDER, id)), 'APPROVED',
    'and the existing approval is upgraded to APPROVED — the Commander does not have to approve twice');

  /* ---- the route invariants that cannot be replayed outside the sidecar ---- */
  const src = fs.readFileSync(path.join(__dirname, '..', 'sidecar', 'index.js'), 'utf8');
  const fn = src.slice(src.indexOf('async function handleOutboxApproval'));
  const body = fn.slice(0, fn.indexOf('\n}\n') + 2);
  A.ok(body.length > 200 && /handleOutboxApproval/.test(body), 'the approval handler was located in the source');

  A.ok(/status === 'approved' && String\(parsed\.row\.verification \|\| ''\) !== 'passed'/.test(body),
    'the gate keys on status===approved AND a non-passed verification — not on qc, and not on every status');
  A.ok(/parsed\.body\.acknowledgeUnverified !== true/.test(body),
    'and it demands an explicit acknowledgeUnverified from the body');
  A.ok(/json\(409,[\s\S]{0,800}needsAcknowledgement: true/.test(body),
    'refused with 409 + needsAcknowledgement, so a client can tell this apart from a hard failure');
  A.ok(/if \(needsAck\) stamps\.push\(/.test(body) && /APPROVED WITHOUT HOST VERIFICATION/.test(body),
    'the override stamp is written BY THE HOST into the detail, never copied from the caller');
  A.ok(body.indexOf('stamps.push(') < body.indexOf('setApproval('),
    'and it is stamped before the write, so no approved row can exist without it');
  A.ok(/OUTBOX_COMMANDER/.test(body) && !/parsed\.body\.by\s*\)?\s*,\s*detail/.test(body),
    'the approver is still the hardcoded Commander — the 2026-11-10 authority rule is untouched by this gate');
}

/* ---------- F. THE AUDIT STAMP SURVIVES A CALLER WHO FILLS `detail` (security review, 2026-11-10) ----------
   The first version of this gate appended the stamp and THEN truncated to 400. readJudgmentRequest already
   clamps body.detail to 400, so any caller who filled that field pushed the override notice off the end: the
   manifest recorded approval:approved with the caller's own text and NO trace that host verification had been
   overridden — while the comment beside the code claimed the opposite. Found by audit, confirmed by replay.
   The stamps are now composed first and the caller's portion is truncated into what is left. */
{
  // The route's detail construction, replayed exactly. Kept as a local mirror because the handler lives inside
  // sidecar/index.js; the source assertions below pin that the real code still has this shape.
  const COMMANDER_ID = 'agent';
  const build = (bodyDetail, by, needsAck, owner, status) => {
    const pd = String(bodyDetail || '').slice(0, 400);
    const stamps = [];
    if (needsAck) stamps.push('APPROVED WITHOUT HOST VERIFICATION (verification: unverified)');
    if (status === 'approved' && String(owner || '') === COMMANDER_ID) {
      stamps.push('SELF-OWNED (approver is also the producing agent ' + COMMANDER_ID + ')');
    }
    const label = String(by || '').trim().slice(0, 64);
    const caller = label ? (pd ? label + ': ' + pd : label) : pd;
    const stamp = stamps.length ? stamps.join(' · ') : '';
    if (!stamp) return caller.slice(0, 400);
    const room = 400 - stamp.length - 3;
    return (room > 0 && caller ? caller.slice(0, room) + ' — ' : '') + stamp;
  };

  const flood = build('x'.repeat(500), 'someone', true, 'webdesigner', 'approved');
  A.ok(/APPROVED WITHOUT HOST VERIFICATION/.test(flood),
    'a 400-char caller detail can no longer erase the override stamp');
  A.ok(flood.length <= 400, 'and the result still fits the field the manifest stores');
  A.ok(/APPROVED WITHOUT HOST VERIFICATION/.test(build('', '', true, 'webdesigner', 'approved')),
    'an empty detail still carries the stamp');

  // Both stamps together must survive, not just the first.
  const both = build('x'.repeat(500), 'someone', true, COMMANDER_ID, 'approved');
  A.ok(/APPROVED WITHOUT HOST VERIFICATION/.test(both) && /SELF-OWNED/.test(both),
    'an unverified AND self-owned approval records both facts even under a flooded detail');
  A.ok(both.length <= 400, 'still within the field');

  /* The self-owned marker exists because OUTBOX_COMMANDER is 'agent' — NIGHT4CHRIST's own agentId — so
     approvedBy === owner cannot distinguish the human owner approving the Commander's work from the Commander
     approving its own. Recorded, deliberately NOT refused: the owner legitimately acts as 'agent', and unlike
     a QC reviewer the Commander is not substitutable. */
  A.eq(/SELF-OWNED/.test(build('ok', '', false, 'webdesigner', 'approved')), false,
    'another agent\'s artifact carries no self-owned marker');
  A.ok(/SELF-OWNED/.test(build('ok', '', false, COMMANDER_ID, 'approved')),
    'the Commander approving its own output is recorded as such');
  A.eq(/SELF-OWNED/.test(build('ok', '', false, COMMANDER_ID, 'rejected')), false,
    'and only on an approval — rejecting your own work needs no marker');

  A.eq(build('ship it', '', false, 'webdesigner', 'approved'), 'ship it',
    'a fully-verified approval records the caller detail unchanged — no stamp noise');

  const src = fs.readFileSync(path.join(__dirname, '..', 'sidecar', 'index.js'), 'utf8');
  const fn = src.slice(src.indexOf('async function handleOutboxApproval'));
  const h = fn.slice(0, fn.indexOf('\n}\n') + 2);
  A.ok(/const room = 400 - stamp\.length/.test(h),
    'the real handler reserves the stamp width rather than appending and truncating');
  A.ok(h.indexOf('const stamps = []') < h.indexOf('parsed.body.by'),
    'and composes the host stamps BEFORE folding in any caller-supplied text');
  A.ok(/SELF-OWNED \(approver is also the producing agent/.test(h),
    'the self-owned marker is in the real handler');
}

/* ---------- G. THE READ CEILING AND THE REGULAR-FILE CHECK ARE ON THE FD ---------- */
{
  /* verify() is on every retrieval path and had neither check, so a row registered small whose file had GROWN
     was read whole into one Buffer before the checksum could reject it — an OOM that takes the single-process
     sidecar down — and a FIFO swapped in at a registered path blocked open() forever. Both are now refused on
     the open fd, before the read. */
  fs.mkdirSync(path.join(ws, 'scout'), { recursive: true });
  const small = path.join(ws, 'scout', 'report.md');
  fs.writeFileSync(small, 'tiny');

  const man = makeDeliverableManifest({
    fs, path, crypto, root: path.join(tmp, '.dm-ceiling'),
    workspaceRootOf: a => path.join(ws, a), now: () => Date.now(), maxBytes: 64
  });
  const reg = man.register({ ownerAgentId: 'scout', projectId: 'p', files: ['report.md'], shareWith: [COMMANDER] });
  A.ok(reg.ok && reg.entries.length === 1, 'a file under the ceiling registers');
  const id = reg.entries[0].id;
  A.eq(man.readFor(COMMANDER, id).ok, true, 'and reads back fine');

  // Grow it past the ceiling behind the manifest's back — the real "file changed after registration" shape.
  fs.writeFileSync(small, 'y'.repeat(500));
  const grown = man.readFor(COMMANDER, id);
  A.eq(grown.ok, false, 'a file that grew past the ceiling is REFUSED, not read into memory');
  A.ok(/EFBIG|ceiling/i.test(String(grown.error)), 'and says why: ' + String(grown.error));

  const srcm = fs.readFileSync(path.join(__dirname, '..', 'sidecar', 'deliverable-manifest.js'), 'utf8');
  const rnf = srcm.slice(srcm.indexOf('function readNoFollow'));
  const rnfBody = rnf.slice(0, rnf.indexOf('\n  }\n') + 4);
  A.ok(/fstatSync\(fd\)/.test(rnfBody), 'the checks are made on the OPEN fd, not on a stat beside it');
  A.ok(/!st\.isFile\(\)/.test(rnfBody), 'a non-regular file (a FIFO blocks open forever) is refused');
  A.ok(rnfBody.indexOf('fstatSync') < rnfBody.indexOf('readFileSync(fd)'),
    'and refused BEFORE the read, so neither failure mode can allocate or block');
}

/* ---------- H. AN ID COLLISION IS REPORTED, NEVER SILENTLY SHADOWED ---------- */
{
  /* artifactId flattens path separators to '_', so 'sub/art.png' and 'sub_art.png' collide. The dedupe check
     read only the DISK, and the batch append happens after the loop — so two colliding files in one call both
     computed version 1 and were written with the identical id. currentRows() keeps the last, and the first
     artifact became permanently invisible to the feed, the tools and both judgment routes. */
  const dir = path.join(ws, 'publisher');
  fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'sub', 'art.png'), 'FIRST-FILE-CONTENT');
  fs.writeFileSync(path.join(dir, 'sub_art.png'), 'SECOND-DIFFERENT-CONTENT');

  const man = makeManifest();
  const reg = man.register({
    ownerAgentId: 'publisher', projectId: 'p', shareWith: [COMMANDER],
    files: ['sub/art.png', 'sub_art.png']
  });
  A.eq(reg.entries.length, 1, 'only the first of two colliding paths is indexed');
  A.eq(reg.invalid.length, 1, 'and the second is REPORTED, not swallowed');
  A.ok(/collision/i.test(String(reg.invalid[0].error)), 'naming it a collision: ' + String(reg.invalid[0].error));
  A.ok(/sub[\\/]art\.png/.test(String(reg.invalid[0].error)), 'and naming the path that already holds the id');
  A.eq(reg.invalid[0].path, 'sub_art.png', 'the rejected file is the later one, the first keeps its row');

  // The decisive property: the first artifact is still visible and still its own bytes.
  const rows = man.list(COMMANDER, {});
  A.eq(rows.length, 1, 'exactly one row exists');
  A.eq(rows[0].path, 'sub/art.png', 'and it is the FIRST file, not shadowed by the second');
  A.eq(man.readFor(COMMANDER, rows[0].id).buf.toString(), 'FIRST-FILE-CONTENT',
    'reading it returns the first file\'s bytes — no silent substitution');
  A.eq(rows[0].supersededBy, null, 'and it was not marked superseded by an unrelated file');

  // Re-registering the SAME path is still idempotent — the guard must not break dedupe.
  const again = man.register({ ownerAgentId: 'publisher', projectId: 'p', shareWith: [COMMANDER], files: ['sub/art.png'] });
  A.eq(again.entries.length, 1, 'a byte-identical re-registration still returns the existing row');
  A.eq(again.entries[0].deduped, true, 'as a dedupe, not a new version');
  A.eq(again.invalid.length, 0, 'and is not mistaken for a collision');
  A.eq(man.list(COMMANDER, {}).length, 1, 'the Outbox did not fan out into duplicates');
}

/* ---------- I. THE DISPLAYED PATH IS RESOLVED BY THE MANIFEST'S OWN ROOT RESOLVER ---------- */
{
  /* The feed used to rebuild this as path.join(WORKSPACES, owner, path), which is wrong for the 'studio'
     pseudo-producer whose root is $HOME/outbox. Live check at the time: all four studio rows advertised
     `workspaces/studio/<proj>/video.mp4` — a directory that does not exist — under a UI label reading
     "Shown so you can find it on disk". */
  const studioRoot = path.join(tmp, 'studio-outbox');
  fs.mkdirSync(path.join(studioRoot, 'proj-1-x'), { recursive: true });
  fs.writeFileSync(path.join(studioRoot, 'proj-1-x', 'video.mp4'), 'x'.repeat(40));

  const man = makeDeliverableManifest({
    fs, path, crypto, root: path.join(tmp, '.dm-paths'),
    // the same shape index.js injects: one named exception, every floor unchanged
    workspaceRootOf: a => (String(a) === 'studio' ? studioRoot : path.join(ws, a)),
    now: () => Date.now()
  });
  const reg = man.register({ ownerAgentId: 'studio', projectId: 'proj-1-x', shareWith: [COMMANDER], files: ['proj-1-x/video.mp4'] });
  A.ok(reg.ok && reg.entries.length === 1, 'a studio artifact registers under its own root');
  const row = man.get(COMMANDER, reg.entries[0].id);

  const shown = man.absolutePathOf(row);
  A.eq(shown, path.join(studioRoot, 'proj-1-x', 'video.mp4'), 'the displayed path is the studio root, not a workspace');
  A.ok(fs.existsSync(shown), 'and it is a path that genuinely exists on disk — the whole point');
  A.eq(/workspaces[\\/]studio/.test(shown), false, 'never the non-existent workspaces/studio directory');

  // An ordinary agent is unaffected.
  fs.writeFileSync(path.join(ws, 'scout', 'note.md'), 'n');
  const r2 = man.register({ ownerAgentId: 'scout', projectId: 'p', shareWith: [COMMANDER], files: ['note.md'] });
  A.eq(man.absolutePathOf(man.get(COMMANDER, r2.entries[0].id)), path.join(ws, 'scout', 'note.md'),
    'an agent-owned row still resolves inside that agent workspace');
  A.eq(man.absolutePathOf(null), '', 'and a missing row resolves to empty rather than throwing');

  const srci = fs.readFileSync(path.join(__dirname, '..', 'sidecar', 'index.js'), 'utf8');
  A.ok(/absolutePath: deliverableManifest\.absolutePathOf\(r\)/.test(srci),
    'the feed calls the one resolver instead of rebuilding the path itself');
}

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
A.report('outbox unverified approval');

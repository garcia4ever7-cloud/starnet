/* test/outbox-approval-route.test.js — the two routes that finally WRITE the judgment axes.
 *
 * WHY IT EXISTS (2026-11-10). deliverable-manifest.js has carried setQc() and setApproval() since the Central
 * Outbox landed, lifecycleOf() derives state from them, and frontend/app/outbox.js already renders the pills —
 * but nothing ever called them. Measured on the live station before this change:
 *
 *     approval      {"pending": 53}                      <- every row, 100%, permanently
 *     qc            {"not_reviewed": 51, "needs_review": 2}
 *     verification  {"passed": 17, "unverified": 35, "failed": 1}
 *
 * The one axis the HOST sets mechanically worked; the two needing a caller were dead. POST /api/outbox/approval
 * and POST /api/outbox/qc are that caller.
 *
 * THE TRAP THIS TEST EXISTS TO HOLD SHUT. setApproval()'s own comment says "the COMMANDER alone", but the
 * function validates NO identity — it only checks the status enum and records whatever commanderId it is
 * handed. The Commander-only rule therefore lives entirely in the route, and a future edit that "simplifies"
 * the handler by passing `body.by` through would silently let any token-holder forge the approving authority
 * while every other test stayed green. Section 2 pins that. Likewise patch()/setApproval() search the WHOLE
 * manifest ignoring `sharedWith`, so the route must resolve through the viewer-scoped get() — section 2 pins
 * that too.
 *
 * Verified live on 2026-11-10 against the running sidecar (status codes and bodies, not inferred):
 *   bad id charset   403 {"error":"forbidden"}          unknown id      403 {"error":"forbidden"}   (merged)
 *   invalid status   400 + accepts[]                    producer self-QC 409
 *   unknown reviewer 404                                neutral write    200 + row
 *
 * Run standalone: node test/outbox-approval-route.test.js */
'use strict';
const A = require('./_assert.js');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { makeDeliverableManifest, QC, APPROVAL } = require('../sidecar/deliverable-manifest.js');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'sidecar', 'index.js'), 'utf8');

(async () => {
  /* ---------- 1. BOTH ROUTES ARE REGISTERED, AND BEFORE THE GET PREFIX ---------- */
  {
    const iApproval = SRC.indexOf("exact: '/api/outbox/approval'");
    const iQc = SRC.indexOf("exact: '/api/outbox/qc'");
    const iFeed = SRC.indexOf("prefix: '/api/outbox'");
    A.ok(iApproval > 0, 'POST /api/outbox/approval is registered');
    A.ok(iQc > 0, 'POST /api/outbox/qc is registered');
    A.ok(iFeed > 0, 'the GET feed is still registered');
    /* The feed is a PREFIX entry. Order is documented as load-bearing in this table, and a stray GET to
       /api/outbox/approval would otherwise be answered as a feed rather than 404. */
    A.ok(iApproval < iFeed && iQc < iFeed, 'both exact POST entries sit BEFORE the GET prefix entry');
  }

  /* ---------- 2. AUTHORITY COMES FROM THE REQUEST, NEVER THE BODY ---------- */
  {
    const h = SRC.slice(SRC.indexOf('async function handleOutboxApproval'), SRC.indexOf('async function handleOutboxQc'));
    A.ok(h.length > 200, 'the approval handler was found');
    A.ok(/setApproval\(\s*parsed\.id,\s*status,\s*OUTBOX_COMMANDER/.test(h),
      'the approver is the hardcoded OUTBOX_COMMANDER — never a value taken from the request body');
    A.eq(/setApproval\([^)]*body\.by/.test(h), false,
      'body.by is NEVER passed as the approving authority (it is an audit label only)');
    A.ok(/parsed\.body\.by/.test(h), 'a `by` label is still accepted, folded into the audit detail');

    const q = SRC.slice(SRC.indexOf('async function handleOutboxQc'));
    A.ok(/isAgentId\(reviewer\)/.test(q), 'QC validates the reviewer id shape');
    A.ok(/agentRoster\.has\(reviewer\)/.test(q), 'QC requires the reviewer to be a real roster agent');
    A.ok(/reviewer === parsed\.row\.owner/.test(q),
      'QC re-proves producer-independence at the route, not only inside the manifest');

    const gate = SRC.slice(SRC.indexOf('async function readJudgmentRequest'), SRC.indexOf('async function handleOutboxApproval'));
    A.ok(/deliverableManifest\.get\(OUTBOX_COMMANDER, id\)/.test(gate),
      'resolution goes through the VIEWER-SCOPED get(), not bare patch()/setApproval() which ignore sharedWith');
    A.ok(/403/.test(gate) && !/404/.test(gate),
      'an unknown or invisible id answers 403 — never a 404 that would let a caller enumerate artifacts');
  }

  /* ---------- 3. NO TOOL MAY WRITE THESE AXES ---------- */
  {
    const tool = fs.readFileSync(path.join(__dirname, '..', 'sidecar', 'tools', 'builtin', 'outbox.js'), 'utf8');
    A.eq(/setQc\(|setApproval\(/.test(tool), false,
      'the outbox TOOL still cannot write qc or approval — an agent must never approve its own output');
  }

  /* ---------- 4. THE MANIFEST INVARIANTS THE ROUTES DEPEND ON ---------- */
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'obx-appr-'));
    const ws = path.join(tmp, 'ws');
    fs.mkdirSync(path.join(ws, 'designer'), { recursive: true });
    fs.writeFileSync(path.join(ws, 'designer', 'art.png'), Buffer.alloc(2048, 7));

    const man = makeDeliverableManifest({
      fs, path, crypto, root: path.join(tmp, '.deliverables'),
      workspaceRootOf: a => path.join(ws, a), now: () => Date.now(),
    });
    /* shareWith must include the Commander: get()/list() are viewer-scoped (owner OR sharedWith), so a
       fixture that shares only with the reviewer makes the artifact invisible to 'agent' — which is exactly
       what the route's 403 would (correctly) report. In production outboxShareFor() always includes it. */
    const reg = man.register({ ownerAgentId: 'designer', projectId: 'p', files: ['art.png'], shareWith: ['qceditor', 'agent'] });
    A.ok(reg.ok && reg.entries.length === 1, 'fixture artifact registered');
    const id = reg.entries[0].id;

    A.eq(man.get('designer', id).approval, 'pending', 'a new artifact starts approval:pending');
    A.eq(man.setQc(id, 'passed', 'designer').ok, false, 'the producer cannot QC its own artifact');
    A.ok(/cannot QC its own/.test(man.setQc(id, 'passed', 'designer').error), 'and says so');
    A.eq(man.setQc(id, 'passed', 'qceditor').ok, true, 'an independent reviewer can');
    A.eq(man.setApproval(id, 'nonsense', 'agent').ok, false, 'an invalid approval status is refused, never coerced');
    A.eq(man.setApproval(id, 'approved', 'agent', 'ship').ok, true, 'the Commander can approve');
    A.eq(man.get('agent', id).approval, 'approved', 'and it persists');
    /* The approval axis records what the Commander said; the DERIVED lifecycle refuses to overclaim. This
       fixture was never host-verified, so it reads APPROVED_UNVERIFIED (2026-11-10). Deliberately asserted
       here rather than after a setVerification call, so the line-count assertion below stays at 3 and keeps
       proving the "refusals write nothing" property on exactly the same trail it always did. */
    A.eq(man.get('agent', id).approval, 'approved', 'the approval axis still records the Commander verdict');
    A.eq(man.lifecycleOf(man.get('agent', id)), 'APPROVED_UNVERIFIED',
      'but the lifecycle will not say APPROVED over bytes the host never proved');

    /* Append-only: every ACCEPTED verdict appends a line and every earlier one stays on disk as the audit
       trail — while a REFUSED verdict writes nothing at all. Exactly 3 here: the registration, the qceditor
       QC pass, and the Commander approval. The two refusals (producer self-QC, invalid status) left no
       trace, which is the property that keeps the log an audit trail rather than an attempt log. */
    const lines = fs.readFileSync(man._manifestPath(), 'utf8').trim().split('\n');
    A.eq(lines.length, 3, 'one line per accepted amendment, and refusals wrote nothing');
    A.eq(JSON.parse(lines[0]).approval, 'pending', 'the original registration is still readable as line 1');
    A.eq(JSON.parse(lines[lines.length - 1]).approval, 'approved', 'and the latest line carries the current verdict');

    /* The enums the route echoes in its errors must stay in sync with the module. */
    A.eq(Array.from(APPROVAL).sort(), ['approved', 'pending', 'rejected'], 'APPROVAL enum unchanged');
    A.eq(Array.from(QC).sort(), ['needs_review', 'not_reviewed', 'passed', 'rejected'], 'QC enum unchanged');

    fs.rmSync(tmp, { recursive: true, force: true });
  }

  /* ---------- 5. THE STUDIO PIPELINE STILL MUST NOT GRANT THESE ---------- */
  {
    const i = SRC.indexOf('CENTRAL OUTBOX BRIDGE');
    A.ok(i > 0, 'the studio bridge block is still present');
    const win = SRC.slice(i, i + 2000);
    A.eq(/deliverableManifest\.setQc\(|deliverableManifest\.setApproval\(/.test(win), false,
      'the studio pipeline never sets qc or approval — those are not the host\'s to grant');
  }

  A.report('outbox approval route');
})().catch(e => { console.error(e); process.exit(1); });

/* test/outbox-studio-bridge.test.js — a studio render must reach the Commander's central Outbox, and the
 * manifest's path floors must apply to the studio root exactly as they do to an agent workspace.
 *
 * THE DEFECT THIS FIXES (found 2026-11-03 by auditing the live manifest, not by reading a report).
 *
 * There were TWO deliverable indexes that did not know about each other:
 *
 *   legacy deliverable store   <- studio videos landed here  (id 'studio:<proj>:video', status kept/failed)
 *   central Outbox manifest    <- agent-run artifacts only
 *
 * The live manifest held 34 rows and ZERO video rows against FOUR rendered projects. So:
 *   - the Commander's Outbox showed none of the team's video work at all
 *   - QC_EDITOR could not reach a video by ANY route. $HOME/outbox/<projectId>/ is outside every agent
 *     workspace, fs.* is jailed per agent, and pathtrust.js hard-denies a cross-root grant on an
 *     unattended run. There was no path, no tool and no grant that would open it. QC of a video was
 *     therefore structurally impossible, which is why QC_EDITOR's verdicts kept recording "pixels not viewed".
 *
 * THE FIX, and why it is where it is. `workspaceRootOf` is INJECTED into makeDeliverableManifest by
 * sidecar/index.js. A pseudo-producer 'studio' resolves to $HOME/outbox; every other id resolves to the
 * agent workspace as before. Nothing in deliverable-manifest.js changed — so the floors (no absolute path,
 * no '..', no NUL, lstat symlink refusal, realpath containment on BOTH ends, O_NOFOLLOW reads) govern the
 * studio root on exactly the same terms. 'studio' is not a real agent id, so no agent's reach widened.
 *
 * Section 3 is the point of the file: the floors are re-proven AGAINST THE STUDIO ROOT. A new root is
 * exactly the kind of change that quietly earns an exemption from a security check, and this asserts it did not.
 *
 * Run standalone: node test/outbox-studio-bridge.test.js */
'use strict';

const A = require('./_assert.js');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');

const { makeDeliverableManifest } = require('../sidecar/deliverable-manifest.js');

/* ---------- hermetic fixture: a fake studio root + a fake agent workspace tree ---------- */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'outbox-studio-'));
const WORKSPACES = path.join(TMP, 'workspaces');
const STUDIO_ROOT = path.join(TMP, 'outbox');
const STUDIO_OWNER = 'studio';
const STUDIO_CREW = ['storywriter', 'director', 'producer', 'qceditor'];

fs.mkdirSync(WORKSPACES, { recursive: true });
fs.mkdirSync(path.join(WORKSPACES, 'webdesigner'), { recursive: true });
fs.mkdirSync(STUDIO_ROOT, { recursive: true });

const PROJ = 'proj-1793024540897-knight';
fs.mkdirSync(path.join(STUDIO_ROOT, PROJ), { recursive: true });
/* a plausible mp4: 'ftyp' at byte 4 is what detectType() keys on */
const VIDEO = Buffer.concat([
  Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42', 'ascii'), Buffer.alloc(4096, 7)
]);
fs.writeFileSync(path.join(STUDIO_ROOT, PROJ, 'video.mp4'), VIDEO);

/* the resolver EXACTLY as sidecar/index.js injects it */
const workspaceRootOf = (agentId) => (String(agentId || '') === STUDIO_OWNER
  ? STUDIO_ROOT
  : path.join(WORKSPACES, String(agentId || 'agent')));

function freshManifest() {
  return makeDeliverableManifest({
    fs: fs, path: path, crypto: crypto, now: () => Date.now(),
    root: path.join(WORKSPACES, '.deliverables'), workspaceRootOf: workspaceRootOf
  });
}

/* the share policy EXACTLY as sidecar/index.js computes it */
function outboxShareFor(agentId) {
  const who = String(agentId || '');
  const out = new Set(['agent']);
  if (who === 'webdesigner') out.add('publisher');
  if (STUDIO_CREW.indexOf(who) >= 0) for (const a of STUDIO_CREW) out.add(a);
  if (who === STUDIO_OWNER) for (const a of STUDIO_CREW) out.add(a);
  out.delete(who);
  return Array.from(out);
}

/* ---------- 1. THE RESOLVER: studio is redirected, every agent is NOT ---------- */
{
  A.eq(workspaceRootOf('studio'), STUDIO_ROOT, "'studio' resolves to the pipeline's render root");
  for (const a of ['agent', 'webdesigner', 'qceditor', 'scout', 'publisher', 'harvest']) {
    A.eq(workspaceRootOf(a), path.join(WORKSPACES, a), a + ' still resolves to its own jailed workspace');
  }
  A.eq(workspaceRootOf(''), path.join(WORKSPACES, 'agent'), 'an empty id still defaults to the Commander');
  A.eq(workspaceRootOf(null), path.join(WORKSPACES, 'agent'), 'a null id still defaults to the Commander');
  // the redirect must be an EXACT match, not a prefix/substring — 'studio-x' is not the studio
  A.eq(workspaceRootOf('studio-x'), path.join(WORKSPACES, 'studio-x'), "'studio-x' is NOT the studio root");
  A.eq(workspaceRootOf('Studio'), path.join(WORKSPACES, 'Studio'), 'the match is case-sensitive');
}

/* ---------- 2. A RENDER REGISTERS, AND THE RIGHT PEOPLE SEE IT ---------- */
{
  const m = freshManifest();
  const reg = m.register({
    ownerAgentId: STUDIO_OWNER, runId: PROJ, projectId: PROJ,
    shareWith: outboxShareFor(STUDIO_OWNER), files: [path.join(PROJ, 'video.mp4')]
  });
  A.ok(reg.ok, 'a studio video registers: ' + (reg.error || 'ok'));
  A.eq(reg.entries.length, 1, 'exactly one entry');
  const e = reg.entries[0];
  A.eq(e.filename, 'video.mp4', 'the filename is recorded');
  A.eq(e.kind, 'video', 'classified as a video');
  A.eq(e.bytes, VIDEO.length, 'the real byte count is recorded');
  A.eq(e.sha256, crypto.createHash('sha256').update(VIDEO).digest('hex'), 'checksummed from the real bytes');

  // the Commander sees it — the whole point of a central Outbox
  const seen = m.list('agent', { kind: 'video' });
  A.eq(seen.length, 1, 'the Commander sees the studio video');
  A.eq(seen[0].projectId, PROJ, 'under its project id');

  // QC_EDITOR sees it — this is what was structurally impossible before
  A.eq(m.list('qceditor', { kind: 'video' }).length, 1, 'QC_EDITOR can now see a studio video');
  const got = m.readFor('qceditor', e.id);
  A.ok(got.ok, 'and can READ it: ' + (got.error || 'ok'));
  A.ok(got.buf.equals(VIDEO), 'getting the real, checksum-matched bytes');

  // the rest of the crew sees it; unrelated agents do NOT
  for (const a of STUDIO_CREW) A.eq(m.list(a, { kind: 'video' }).length, 1, a + ' (studio crew) sees it');
  for (const a of ['scout', 'publisher', 'webdesigner', 'harvest']) {
    A.eq(m.list(a, { kind: 'video' }).length, 0, a + ' is NOT in the studio share and sees nothing');
    A.ok(!m.readFor(a, e.id).ok, a + ' cannot read it either');
  }
}

/* ---------- 3. THE FLOORS STILL GOVERN THE STUDIO ROOT ----------
   A newly-introduced root is exactly where a path check quietly stops applying. It does not. */
{
  const m = freshManifest();
  const reg = (file) => m.register({
    ownerAgentId: STUDIO_OWNER, runId: PROJ, projectId: PROJ, shareWith: ['agent'], files: [file]
  });

  // absolute path — refused even though it points at the genuine file
  const absTry = reg(path.join(STUDIO_ROOT, PROJ, 'video.mp4'));
  A.ok(!absTry.ok || absTry.entries.length === 0, 'an ABSOLUTE path is refused for the studio root');

  // traversal out of the studio root
  const upTry = reg(path.join('..', 'workspaces', 'webdesigner', 'secret.png'));
  A.ok(!upTry.ok || upTry.entries.length === 0, "a '..' traversal out of the studio root is refused");

  // NUL byte in the path
  const nulTry = reg(PROJ + '/video.mp4' + String.fromCharCode(0) + '.txt');
  A.ok(!nulTry.ok || nulTry.entries.length === 0, 'a NUL byte in the path is refused');

  /* SYMLINK ESCAPE — the finding that produced the floor in the first place. A link planted inside the
     studio root pointing at another agent's workspace must not become a registrable studio deliverable. */
  const victimDir = path.join(WORKSPACES, 'webdesigner');
  fs.writeFileSync(path.join(victimDir, 'private-master.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
  let symlinkSupported = true;
  const linkPath = path.join(STUDIO_ROOT, PROJ, 'stolen.png');
  try { fs.symlinkSync(path.join(victimDir, 'private-master.png'), linkPath); }
  catch (e) { symlinkSupported = false; }

  if (symlinkSupported) {
    const linkTry = reg(path.join(PROJ, 'stolen.png'));
    const leaked = linkTry.ok && linkTry.entries.length > 0;
    A.ok(!leaked, 'a SYMLINK inside the studio root pointing at an agent workspace is refused');

    // and an INTERMEDIATE directory symlink, which escapes without the leaf being a link
    const dirLink = path.join(STUDIO_ROOT, 'escape-dir');
    try {
      fs.symlinkSync(victimDir, dirLink);
      const viaDir = reg(path.join('escape-dir', 'private-master.png'));
      A.ok(!(viaDir.ok && viaDir.entries.length > 0),
        'an INTERMEDIATE directory symlink out of the studio root is refused');
    } catch (e) { /* platform refused the link; the leaf case above already covers the floor */ }
  } else {
    A.ok(true, 'symlinks unsupported on this filesystem — leaf/dir escape cases skipped');
  }

  // the legitimate file still registers after all of that — the floor is not just "refuse everything"
  const good = reg(path.join(PROJ, 'video.mp4'));
  A.ok(good.ok && good.entries.length === 1, 'the genuine relative path still registers');
}

/* ---------- 4. VERIFICATION IS MECHANICAL; QC AND APPROVAL ARE NOT TOUCHED ----------
   A machine proving the bytes are real video is not a reviewer's opinion and is not the Commander's
   approval. A rejected render is indexed too, carrying its reason. */
{
  const m = freshManifest();
  const reg = m.register({
    ownerAgentId: STUDIO_OWNER, runId: PROJ, projectId: PROJ,
    shareWith: outboxShareFor(STUDIO_OWNER), files: [path.join(PROJ, 'video.mp4')]
  });
  const id = reg.entries[0].id;

  let row = m.list('agent', { kind: 'video' })[0];
  A.eq(row.verification, 'unverified', 'registration alone asserts nothing about quality');
  A.eq(row.qc, 'not_reviewed', 'and nothing about review');
  A.eq(row.approval, 'pending', 'and nothing about approval');

  m.setVerification(id, 'passed', 'video-verify: real footage, 3653913 bytes');
  row = m.list('agent', { kind: 'video' })[0];
  A.eq(row.verification, 'passed', 'a real render is mechanically verified');
  A.eq(row.qc, 'not_reviewed', 'VERIFIED still does not mean QC-passed');
  A.eq(row.approval, 'pending', 'and still does not mean approved');

  // a placeholder is recorded as FAILED, not omitted — "registering nothing taught the owner nothing"
  const m2 = freshManifest();
  fs.mkdirSync(path.join(STUDIO_ROOT, 'proj-fake'), { recursive: true });
  const tiny = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42', 'ascii'), Buffer.alloc(64, 0x41)]);
  fs.writeFileSync(path.join(STUDIO_ROOT, 'proj-fake', 'video.mp4'), tiny);
  const r2 = m2.register({
    ownerAgentId: STUDIO_OWNER, runId: 'proj-fake', projectId: 'proj-fake',
    shareWith: ['agent'], files: [path.join('proj-fake', 'video.mp4')]
  });
  A.ok(r2.ok, 'a placeholder render still registers');
  m2.setVerification(r2.entries[0].id, 'failed', 'video-verify: too-small: 136 bytes is under the 102400-byte floor');
  const bad = m2.list('agent', { projectId: 'proj-fake' })[0];
  A.eq(bad.verification, 'failed', 'and is marked FAILED rather than hidden');
  A.ok(/too-small/.test(String(bad.verificationDetail || bad.verifyReason || '')),
    'carrying the machine-checkable reason');
}

/* ---------- 5. A PRODUCER STILL CANNOT QC ITS OWN RENDER ---------- */
{
  const m = freshManifest();
  const reg = m.register({
    ownerAgentId: STUDIO_OWNER, runId: PROJ, projectId: PROJ,
    shareWith: outboxShareFor(STUDIO_OWNER), files: [path.join(PROJ, 'video.mp4')]
  });
  const id = reg.entries[0].id;
  const self = m.setQc(id, 'passed', STUDIO_OWNER, 'looks great to me');
  A.ok(!self || self.ok === false, 'the studio cannot pass QC on its own render');
  const indep = m.setQc(id, 'passed', 'qceditor', 'watched it; act transitions land');
  A.ok(indep && indep.ok !== false, 'an INDEPENDENT reviewer can');
  A.eq(m.list('agent', { kind: 'video' })[0].qc, 'passed', 'and that is what the Outbox reports');
  A.eq(m.list('agent', { kind: 'video' })[0].approval, 'pending',
    'QC passing still leaves approval to the Commander alone');
}

/* ---------- 6. THE SHIPPED WIRING IS ACTUALLY PRESENT IN sidecar/index.js ----------
   Sections 1-5 prove the DESIGN. This proves the running host is wired to it — the gap that let a route
   handler and its registration disagree once before, so no URL could reach it. */
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'sidecar', 'index.js'), 'utf8');
  A.ok(/const OUTBOX_STUDIO_OWNER = 'studio';/.test(src), 'index.js names the studio pseudo-producer');
  A.ok(/const STUDIO_OUTBOX_ROOT = path\.join\(require\('node:os'\)\.homedir\(\), 'outbox'\);/.test(src),
    'and points it at $HOME/outbox, where the pipeline actually renders');
  A.ok(/String\(agentId \|\| ''\) === OUTBOX_STUDIO_OWNER\s*\n?\s*\? STUDIO_OUTBOX_ROOT/.test(src.replace(/\r/g, '')),
    'the injected workspaceRootOf redirects ONLY that id');
  A.ok(/if \(who === OUTBOX_STUDIO_OWNER\) for \(const a of OUTBOX_STUDIO\) out\.add\(a\);/.test(src),
    'the share policy includes the studio crew so QC_EDITOR can reach a render');
  A.ok(/ownerAgentId: OUTBOX_STUDIO_OWNER,[\s\S]{0,240}files: \[path\.join\(projectId, 'video\.mp4'\)\]/.test(src),
    'the pipeline completion path registers the render with a RELATIVE path');
  A.ok(/deliverableManifest\.setVerification\(entryId, verdict\.ok \? 'passed' : 'failed'/.test(src),
    "and sets verification from verifyVideoFile()'s real verdict, both ways");
  A.ok(!/deliverableManifest\.setQc\(|deliverableManifest\.setApproval\(/.test(
    src.slice(src.indexOf('CENTRAL OUTBOX BRIDGE'), src.indexOf('CENTRAL OUTBOX BRIDGE') + 2000)),
    'and never sets qc or approval from the pipeline — those are not the host\'s to grant');
}

/* cleanup */
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}

A.report('outbox studio bridge');

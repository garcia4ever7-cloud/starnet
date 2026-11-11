/* test/deliverable-manifest.test.js — the DESIGNER -> PUBLISHER bridge.

   WHAT BROKE (live run dc3e312b, 2026-11-02). Every Etsy stage dispatched for the first time and DESIGNER
   produced real 300-DPI print files, then PUBLISHER drafted nothing: "The PNGs are in DESIGNER's workspace,
   which PUBLISHER cannot read." fs.* is jailed per agent, and pathtrust.js — the one sanctioned way out —
   refuses this by design ("standing grants and Full Access do NOT override ownership beneath this root";
   an autonomous run is "a HARD DENY with NO prompt"). So the bridge must NOT widen the jail.

   The isolation assertions below are the load-bearing half. It would be easy to "fix" this by letting a
   consumer read any path under another agent's workspace; sections 3 and 5 exist to make that regression
   fail loudly.

   Section 8 reads the REAL Matthew 11:28 deliverables (read-only, never modified) so the integration is
   proven against the actual artifacts rather than only synthetic fixtures. It self-skips when they are
   absent, so the gate stays green on a machine that never ran that pipeline.

   Run standalone: node test/deliverable-manifest.test.js */
'use strict';

const A = require('./_assert.js');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { makeDeliverableManifest, imageMeta, mimeOf, lifecycleOf } = require('../sidecar/deliverable-manifest.js');

const AT = Date.UTC(2026, 10, 2, 18, 30, 0);

// A minimal but REAL png: signature + IHDR(2x3) + pHYs(300dpi) + IEND, so header parsing is exercised for
// real rather than mocked. Hand-built because a fixture file would hide the parsing under file IO.
function tinyPng(wpx, hpx, dpi) {
  const chunks = [];
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crypto.createHash('md5').update(body).digest().readUInt32BE(0));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(wpx, 0); ihdr.writeUInt32BE(hpx, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  chunks.push(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  chunks.push(chunk('IHDR', ihdr));
  if (dpi) {
    const phys = Buffer.alloc(9);
    const ppm = Math.round(dpi / 0.0254);
    phys.writeUInt32BE(ppm, 0); phys.writeUInt32BE(ppm, 4); phys[8] = 1;
    chunks.push(chunk('pHYs', phys));
  }
  chunks.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(chunks);
}

function station(agents) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'starnet-manifest-'));
  const wsRoot = path.join(tmp, 'workspaces');
  const shared = path.join(wsRoot, '.deliverables');   // owned by no agent
  for (const a of (agents || ['webdesigner', 'publisher', 'scout'])) fs.mkdirSync(path.join(wsRoot, a), { recursive: true });
  const m = makeDeliverableManifest({
    fs, path, crypto, root: shared, now: () => AT,
    workspaceRootOf: (agentId) => path.join(wsRoot, String(agentId))
  });
  const write = (agentId, rel, buf) => {
    const abs = path.join(wsRoot, agentId, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, buf);
    return abs;
  };
  return { tmp, wsRoot, shared, m, write };
}

(async () => {
  /* ---------- 1. DESIGNER CAN REGISTER ARTIFACTS ---------- */
  const s = station();
  {
    s.write('webdesigner', 'outbox/hard-days/matthew-11-28/print-8x10.png', tinyPng(2400, 3000, 300));
    s.write('webdesigner', 'outbox/hard-days/matthew-11-28/notes.txt', Buffer.from('style: watercolor'));
    const r = s.m.register({
      ownerAgentId: 'webdesigner', projectId: 'matthew-11-28', shareWith: ['publisher'],
      files: ['outbox/hard-days/matthew-11-28/print-8x10.png', 'outbox/hard-days/matthew-11-28/notes.txt']
    });
    A.eq(r.ok, true, 'DESIGNER registers its finished deliverables');
    A.eq(r.entries.length, 2, 'both files are indexed');
    A.eq(r.invalid.length, 0, 'and none were rejected');
    const png = r.entries.find(e => e.mime === 'image/png');
    A.eq(png.bytes > 0, true, 'the row carries real byte size');
    A.eq(png.width, 2400, 'pixel width is read from the file header, not the filename');
    A.eq(png.height, 3000, 'and height');
    A.eq(png.dpi, 300, 'and the embedded DPI — the thing that makes it a print file');
    A.eq(png.sha256.length, 64, 'with a sha256 checksum');
    A.eq(png.owner, 'webdesigner', 'ownership is recorded');
    A.eq(mimeOf('x.pdf'), 'application/pdf', 'PDF is a supported future deliverable type');
    A.eq(mimeOf('x.jpg'), 'image/jpeg', 'and JPG');
  }

  /* ---------- 2. PUBLISHER CAN READ REGISTERED ARTIFACTS ---------- */
  let pubRows;
  {
    pubRows = s.m.list('publisher', { projectId: 'matthew-11-28' });
    A.eq(pubRows.length, 2, 'PUBLISHER sees the deliverables published to it, across the workspace boundary');
    const got = s.m.readFor('publisher', pubRows.find(r => r.mime === 'image/png').id);
    A.eq(got.ok, true, 'and can read the bytes');
    A.eq(got.buf.length, got.row.bytes, 'the bytes match the indexed size');
    A.eq(crypto.createHash('sha256').update(got.buf).digest('hex'), got.row.sha256,
      'and the checksum — proving it read the ORIGINAL, not a copy that drifted');
    // THE ORIGINAL IS UNTOUCHED: no duplicate was made anywhere under the shared root.
    const strays = fs.readdirSync(s.shared).filter(f => f !== 'manifest.jsonl');
    A.eq(strays.length, 0, 'no artifact bytes are duplicated into the shared area — metadata only');
  }

  /* ---------- 3. PUBLISHER CANNOT READ UNRELATED PRIVATE FILES (the isolation floor) ---------- */
  {
    s.write('webdesigner', 'private/secret-notes.md', Buffer.from('not for publisher'));
    s.write('scout', 'research/private.md', Buffer.from('scout only'));
    const seen = s.m.list('publisher', {});
    A.eq(seen.some(r => /secret-notes/.test(r.path)), false,
      'an UNREGISTERED private file in DESIGNER\'s workspace is invisible to PUBLISHER');
    A.eq(seen.some(r => r.owner === 'scout'), false, 'and another agent\'s workspace stays invisible entirely');
    // Even knowing the exact id shape must not help: the row simply is not published to this agent.
    const forged = 'webdesigner:matthew-11-28:private_secret-notes.md';
    A.eq(s.m.readFor('publisher', forged).ok, false, 'guessing an id for an unregistered file is refused');
    // And a deliverable shared with PUBLISHER is NOT thereby readable by a third agent.
    A.eq(s.m.readFor('scout', pubRows[0].id).ok, false,
      'sharing with PUBLISHER does not publish to everyone — isolation outside the share is preserved');
  }

  /* ---------- 4. MISSING FILES FAIL GRACEFULLY, AND ARE RECORDED ---------- */
  {
    const r = s.m.register({
      ownerAgentId: 'webdesigner', projectId: 'gone', shareWith: ['publisher'],
      files: ['outbox/hard-days/does-not-exist.png']
    });
    A.eq(r.entries.length, 0, 'a file that does not exist is never indexed as a deliverable');
    A.eq(r.invalid.length, 1, 'but it IS reported — a short list must not look like "nothing was produced"');
    A.ok(/unreadable|ENOENT/i.test(r.invalid[0].error), 'and the reason names the real failure');

    // A row whose file is deleted AFTER registration must fail the read, not serve a stale promise.
    s.write('webdesigner', 'outbox/temp.png', tinyPng(10, 10, 72));
    const reg = s.m.register({ ownerAgentId: 'webdesigner', projectId: 'temp', shareWith: ['publisher'], files: ['outbox/temp.png'] });
    fs.rmSync(path.join(s.wsRoot, 'webdesigner', 'outbox/temp.png'));
    const after = s.m.readFor('publisher', reg.entries[0].id);
    A.eq(after.ok, false, 'a deliverable deleted after registration fails the read');
    A.ok(/missing|unreadable/i.test(after.error), 'with an honest reason');
  }

  /* ---------- 5. INVALID PATHS ARE REJECTED (traversal, absolute, NUL) ---------- */
  {
    const r = s.m.register({
      ownerAgentId: 'webdesigner', projectId: 'evil', shareWith: ['publisher'],
      // 'a\x00b.png' carries a real NUL at runtime, written as the ESCAPE rather than as a literal NUL byte.
      // A literal NUL in tracked source makes rg treat the file as binary and silently skip merge/security
      // scans (test/source-text-integrity.test.js, which this file failed at gate step 77 until 2026-11-10).
      files: ['../publisher/stolen.png', '../../etc/passwd', '/etc/passwd', 'a\x00b.png', 'ok/../../escape.png']
    });
    A.eq(r.entries.length, 0, 'not one traversal or absolute path is indexed');
    A.eq(r.invalid.length, 5, 'every one is reported');
    A.ok(r.invalid.some(i => /traversal/.test(i.error)), '".." is refused as traversal');
    A.ok(r.invalid.some(i => /absolute/.test(i.error)), 'an absolute path is refused');
    A.ok(r.invalid.some(i => /NUL/.test(i.error)), 'a NUL byte is refused');
    // The ownership proof: a producer cannot publish out of someone else's workspace even without "..".
    const other = s.m.register({ ownerAgentId: 'publisher', projectId: 'x', files: ['../webdesigner/outbox/hard-days/matthew-11-28/notes.txt'] });
    A.eq(other.entries.length, 0, 'an agent cannot register a file that lives in another agent\'s workspace');
  }

  /* ---------- 5b. SYMLINK ESCAPE (HIGH finding, security review 2026-11-02) ----------
     The lexical containment check passed these: P.resolve collapses '..' but never follows links, so a
     symlink planted inside the producer's OWN workspace reached straight out of it. The rest of the station
     calls this a hardline ("path escapes workspace via symlink" — fs.js; "the REAL target must stay inside
     the blessed root's REAL path, re-proven on every access" — pathtrust.js), and this module had to match. */
  {
    const outside = path.join(s.tmp, 'outside-secret.txt');
    fs.writeFileSync(outside, Buffer.from('TOP SECRET — outside every workspace'));
    const victim = path.join(s.wsRoot, 'publisher', 'private-publisher.txt');
    fs.writeFileSync(victim, Buffer.from('publisher private'));

    const linkDir = path.join(s.wsRoot, 'webdesigner', 'outbox');
    fs.mkdirSync(linkDir, { recursive: true });
    let linksMade = true;
    try {
      fs.symlinkSync(outside, path.join(linkDir, 'leak-outside.png'));
      fs.symlinkSync(victim, path.join(linkDir, 'leak-victim.png'));
      // an INTERMEDIATE directory symlink: the leaf is a real file, the parent is the link
      fs.symlinkSync(path.join(s.wsRoot, 'publisher'), path.join(linkDir, 'peek'));
    } catch (e) { linksMade = false; }

    if (!linksMade) {
      A.ok(true, 'SKIP symlink cases: this filesystem refused to create symlinks');
    } else {
      const r = s.m.register({
        ownerAgentId: 'webdesigner', projectId: 'leak', shareWith: ['publisher'],
        files: ['outbox/leak-outside.png', 'outbox/leak-victim.png', 'outbox/peek/private-publisher.txt']
      });
      A.eq(r.entries.length, 0, 'NOT ONE symlinked path is indexed — lexical containment alone was a HIGH hole');
      A.eq(r.invalid.length, 3, 'all three escapes are reported');
      A.ok(r.invalid.some(i => /symlink/.test(i.error)), 'a symlinked LEAF is refused as a symlink');
      A.ok(r.invalid.some(i => /via symlink/.test(i.error)),
        'and an INTERMEDIATE directory symlink is caught by the realpath comparison');
      // the bytes never reached the manifest or a consumer
      const rows = s.m.list('publisher', { projectId: 'leak' });
      A.eq(rows.length, 0, 'nothing from the escape is published to PUBLISHER');
      const idx = fs.existsSync(s.m._manifestPath()) ? fs.readFileSync(s.m._manifestPath(), 'utf8') : '';
      A.eq(/TOP SECRET/.test(idx), false, 'and no out-of-workspace content leaked into the index');
      A.eq(/leak-outside|leak-victim|peek/.test(idx), false, 'nor any escaping path');
    }
  }

  /* ---------- 6. CHECKSUMS DETECT ALTERED FILES ---------- */
  {
    s.write('webdesigner', 'outbox/mutable.png', tinyPng(100, 100, 300));
    const reg = s.m.register({ ownerAgentId: 'webdesigner', projectId: 'mut', shareWith: ['publisher'], files: ['outbox/mutable.png'] });
    A.eq(s.m.readFor('publisher', reg.entries[0].id).ok, true, 'reads fine while pristine');
    s.write('webdesigner', 'outbox/mutable.png', tinyPng(100, 100, 72));   // same name, different bytes
    const altered = s.m.readFor('publisher', reg.entries[0].id);
    A.eq(altered.ok, false, 'an altered file is REFUSED, not served as though it were the approved artifact');
    A.ok(/checksum mismatch/.test(altered.error), 'and the reason says the checksum changed');
    A.eq(s.m.verify(reg.entries[0]).ok, false, 'verify() reports it independently of readFor()');
  }

  /* ---------- 7. UNWIRED / DEGENERATE INPUT NEVER THROWS INTO A RUN ---------- */
  {
    const bare = makeDeliverableManifest({});
    A.eq(bare.register({ ownerAgentId: 'x', files: ['a.png'] }).ok, false, 'an unwired manifest refuses honestly');
    A.eq(bare.list('x', {}).length, 0, 'and lists nothing rather than throwing');
    A.eq(s.m.register({ files: ['a.png'] }).ok, false, 'a missing ownerAgentId is refused');
    A.eq(s.m.register({ ownerAgentId: 'webdesigner', files: [] }).entries.length, 0, 'an empty file list indexes nothing');
    A.eq(imageMeta(Buffer.from('not an image')).width, null, 'a non-image reports null dimensions, never a guess');
  }

  fs.rmSync(s.tmp, { recursive: true, force: true });

  /* ---------- 8. INTEGRATION: the REAL Matthew 11:28 deliverables (read-only) ---------- */
  {
    const live = path.join(os.homedir(), '.local/share/StarNet/workspaces');
    const rel = 'outbox/hard-days/matthew-11-28/verses-for-hard-days-matthew-11-28-8x10in-300ppi.png';
    const abs = path.join(live, 'webdesigner', rel);
    if (!fs.existsSync(abs)) {
      A.ok(true, 'SKIP live fixture: Matthew 11:28 deliverables absent on this machine');
    } else {
      const before = fs.statSync(abs);
      const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'starnet-manifest-live-'));
      const m = makeDeliverableManifest({
        fs, path, crypto, root: path.join(tmp2, '.deliverables'), now: () => AT,
        workspaceRootOf: (a) => path.join(live, String(a))
      });
      const reg = m.register({ ownerAgentId: 'webdesigner', projectId: 'matthew-11-28', shareWith: ['publisher'], files: [rel] });
      A.eq(reg.ok, true, 'the REAL DESIGNER deliverable registers');
      A.eq(reg.entries.length, 1, 'one real artifact indexed');
      const row = reg.entries[0];
      A.eq(row.mime, 'image/png', 'identified as a PNG');
      A.eq(row.width, 2400, 'real pixel width read from the real file');
      A.eq(row.height, 3000, 'real pixel height');
      A.eq(row.dpi, 300, 'real embedded 300 DPI — a genuine print file');
      const got = m.readFor('publisher', row.id);
      A.eq(got.ok, true, 'and PUBLISHER CAN READ THE REAL MATTHEW 11:28 ARTWORK across the workspace boundary');
      A.eq(got.buf.length, before.size, 'byte-for-byte the same file DESIGNER wrote');
      // PROVE WE DID NOT TOUCH IT: same size and same mtime after all of the above.
      const after = fs.statSync(abs);
      A.eq(after.size, before.size, 'the original is unchanged in size');
      A.eq(after.mtimeMs, before.mtimeMs, 'and its mtime is untouched — the bridge is strictly read-only');
      fs.rmSync(tmp2, { recursive: true, force: true });
    }
  }

  /* ---------- 9. ALL NINE AGENT ROLES REGISTER AND APPEAR ---------- */
  const NINE = ['scout', 'webdesigner', 'publisher', 'harvest', 'agent',
                'storywriter', 'director', 'producer', 'qceditor'];
  {
    const s9 = station(NINE);
    for (const a of NINE) {
      s9.write(a, 'outbox/' + a + '-note.txt', Buffer.from('deliverable from ' + a));
      const r = s9.m.register({ ownerAgentId: a, projectId: 'org-wide', runId: 'run-' + a, shareWith: ['agent'], files: ['outbox/' + a + '-note.txt'] });
      A.eq(r.entries.length, 1, a + ' can register a deliverable');
      A.eq(r.entries[0].owner, a, 'and the row names ' + a + ' as producer, from the host run context');
      A.eq(r.entries[0].runId, 'run-' + a, 'with the run id that produced it (provenance back-reference)');
    }
    // COMMANDER sees the whole organisation's work in one place — the central Outbox requirement.
    const commanderView = s9.m.list('agent', { projectId: 'org-wide' });
    A.eq(commanderView.length, 9, 'the Commander sees deliverables from all NINE agents in one Outbox');
    A.eq(new Set(commanderView.map(r => r.owner)).size, 9, 'one row per agent, none lost inside a private workspace');
    // ...but a peer still does not. Central visibility for the Commander is not global visibility for everyone.
    A.eq(s9.m.list('publisher', { projectId: 'org-wide' }).length, 1,
      'a peer agent sees only its own row — a central Outbox is not a shared filesystem');
    fs.rmSync(s9.tmp, { recursive: true, force: true });
  }

  /* ---------- 10. IDEMPOTENCY + VERSIONING + SUPERSEDE ---------- */
  {
    const s10 = station(['webdesigner', 'publisher']);
    s10.write('webdesigner', 'outbox/art.png', tinyPng(1200, 1500, 300));
    const a1 = s10.m.register({ ownerAgentId: 'webdesigner', projectId: 'p', shareWith: ['publisher'], files: ['outbox/art.png'] });
    const a2 = s10.m.register({ ownerAgentId: 'webdesigner', projectId: 'p', shareWith: ['publisher'], files: ['outbox/art.png'] });
    A.eq(a2.entries[0].deduped, true, 'registering byte-identical content again is a no-op');
    A.eq(a2.entries[0].version, 1, 'and does NOT mint a new version');
    A.eq(s10.m.list('publisher', {}).length, 1, 'so the Outbox shows ONE row, not a duplicate per retry');

    s10.write('webdesigner', 'outbox/art.png', tinyPng(2400, 3000, 300));   // genuinely new content
    const a3 = s10.m.register({ ownerAgentId: 'webdesigner', projectId: 'p', shareWith: ['publisher'], files: ['outbox/art.png'] });
    A.eq(a3.entries[0].version, 2, 'changed content at the same path becomes version 2');
    const live = s10.m.list('publisher', {});
    A.eq(live.length, 1, 'the Outbox shows only the current version by default');
    A.eq(live[0].version, 2, 'and it is the newest one');
    const hist = s10.m.versions('publisher', a1.entries[0].artifactId);
    A.ok(hist.length >= 2, 'version history preserves the older record rather than overwriting it');
    const v1 = hist.find(r => r.version === 1);
    A.ok(v1.supersededBy, 'the old version is marked superseded, pointing forward to its replacement');
    A.eq(lifecycleOf(v1), 'SUPERSEDED', 'and its lifecycle reads SUPERSEDED');
    fs.rmSync(s10.tmp, { recursive: true, force: true });
  }

  /* ---------- 11. THE FOUR AXES ARE SEPARATE, AND A PRODUCER CANNOT APPROVE ITSELF ---------- */
  {
    const s11 = station(['webdesigner', 'qceditor', 'agent', 'publisher']);
    s11.write('webdesigner', 'outbox/print.png', tinyPng(2400, 3000, 300));
    const reg = s11.m.register({ ownerAgentId: 'webdesigner', projectId: 'mat', shareWith: ['publisher', 'qceditor', 'agent'], files: ['outbox/print.png'] });
    const id = reg.entries[0].id;
    A.eq(reg.entries[0].verification, 'unverified', 'registration NEVER asserts technical verification');
    A.eq(reg.entries[0].qc, 'not_reviewed', 'nor QC');
    A.eq(reg.entries[0].approval, 'pending', 'nor Commander approval');
    A.eq(lifecycleOf(reg.entries[0]), 'STAGED', 'a registered-but-unverified artifact is STAGED, not COMPLETE');

    // THE LOAD-BEARING REFUSAL: the producer may not QC its own artifact.
    const self = s11.m.setQc(id, 'passed', 'webdesigner', 'looks great to me');
    A.eq(self.ok, false, 'DESIGNER cannot QC_approve its OWN artwork');
    A.ok(/cannot QC its own/.test(self.error), 'and the refusal says exactly why');

    A.eq(s11.m.setVerification(id, 'passed', '2400x3000 @300dpi, checksum ok').ok, true, 'the HOST records technical verification');
    A.eq(s11.m.get('publisher', id).verification, 'passed', 'which the Outbox shows as its own field');
    A.eq(s11.m.get('publisher', id).qc, 'not_reviewed', 'verification does NOT imply QC');
    A.eq(lifecycleOf(s11.m.get('publisher', id)), 'VERIFIED', 'lifecycle advances to VERIFIED only');

    A.eq(s11.m.setQc(id, 'needs_review', 'qceditor', 'print-ready but art is flat').ok, true, 'an INDEPENDENT reviewer may set QC');
    A.eq(s11.m.get('agent', id).qc, 'needs_review', 'recorded');
    A.eq(s11.m.get('agent', id).approval, 'pending', 'and QC does NOT imply Commander approval');
    A.eq(lifecycleOf(s11.m.get('agent', id)), 'NEEDS_REVIEW', 'lifecycle reflects it honestly');

    A.eq(s11.m.setApproval(id, 'approved', 'agent', 'ship it').ok, true, 'the Commander approves separately');
    A.eq(lifecycleOf(s11.m.get('agent', id)), 'APPROVED', 'only now is it APPROVED');
    A.eq(s11.m.setVerification(id, 'nonsense').ok, false, 'an invalid axis value is refused, never coerced');
    fs.rmSync(s11.tmp, { recursive: true, force: true });
  }

  /* ---------- 12. SCRATCH HELPERS + MISLABELLED SIGNATURES ARE NOT DELIVERABLES ---------- */
  {
    const s12 = station(['webdesigner', 'publisher']);
    s12.write('webdesigner', 'outbox/build_matthew_11_28.py', Buffer.from('# builds the art'));
    s12.write('webdesigner', 'outbox/real.png', tinyPng(100, 100, 300));
    s12.write('webdesigner', 'outbox/liar.png', Buffer.from('%PDF-1.4 this is not a png'));
    const r = s12.m.register({ ownerAgentId: 'webdesigner', projectId: 'z', shareWith: ['publisher'],
      files: ['outbox/build_matthew_11_28.py', 'outbox/real.png', 'outbox/liar.png'] });
    A.ok(r.invalid.some(i => /scratch helper/.test(i.error)),
      'a .py build script is NOT registered as a deliverable — reuses deliverable-files.js scratch rule');
    A.eq(r.entries.some(e => /\.py$/.test(e.path)), false, 'so no build script reaches the Outbox');
    const liar = r.entries.find(e => /liar/.test(e.path));
    A.eq(liar.typeDetected, 'pdf', 'the real type is sniffed from magic bytes, not the .png extension');
    A.eq(liar.signatureMismatch, true, 'and the extension/content disagreement is RECORDED, not silently resolved');
    const real = r.entries.find(e => /real\.png/.test(e.path));
    A.eq(real.signatureMismatch, false, 'a genuine PNG shows no mismatch');
    fs.rmSync(s12.tmp, { recursive: true, force: true });
  }

  /* ---------- 13. COMMANDER FILTERS (§F) ---------- */
  {
    const s13 = station(['scout', 'webdesigner', 'agent']);
    s13.write('scout', 'outbox/r.md', Buffer.from('research'));
    s13.write('webdesigner', 'outbox/d.png', tinyPng(10, 10, 300));
    s13.m.register({ ownerAgentId: 'scout', projectId: 'alpha', shareWith: ['agent'], files: ['outbox/r.md'] });
    const d = s13.m.register({ ownerAgentId: 'webdesigner', projectId: 'beta', shareWith: ['agent'], files: ['outbox/d.png'] });
    A.eq(s13.m.list('agent', { owner: 'scout' }).length, 1, 'filter by agent');
    A.eq(s13.m.list('agent', { projectId: 'beta' }).length, 1, 'filter by project');
    A.eq(s13.m.list('agent', { kind: 'image' }).length, 1, 'filter by deliverable type');
    A.eq(s13.m.list('agent', { approval: 'pending' }).length, 2, 'filter by approval status');
    s13.m.setQc(d.entries[0].id, 'passed', 'qceditor');
    A.eq(s13.m.list('agent', { qc: 'passed' }).length, 1, 'filter by QC status');
    A.eq(s13.m.list('agent', { lifecycle: 'QC_REVIEWED' }).length, 1, 'filter by lifecycle');
    A.eq(s13.m.list('agent', { since: '2030-01-01T00:00:00Z' }).length, 0, 'filter by date range (since)');
    A.eq(s13.m.list('agent', { until: '2030-01-01T00:00:00Z' }).length, 2, 'filter by date range (until)');
    fs.rmSync(s13.tmp, { recursive: true, force: true });
  }

  A.report('deliverable manifest bridge');
})().catch(e => { console.error(e); process.exit(1); });

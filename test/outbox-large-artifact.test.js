/* test/outbox-large-artifact.test.js — an Outbox file larger than the whole-file ceiling can be listed and
 * streamed, and loses none of the floor on the way.
 *
 * WHY IT EXISTS (2026-11-24). deliverable-manifest.js refused every file over 64 MB at registration, and
 * /api/artifact read the whole file into memory, so a finished 4-minute memorial film (68.4 MB) could neither
 * appear in the Outbox nor play there. Large files are now hashed in chunks and served through openFor() as a
 * stream. This test drives that path with a tiny injected ceiling (maxBytes 1 KB), so it needs no 64 MB file:
 *
 *  - a file over maxBytes registers, with the SAME sha256 a whole-file hash gives
 *  - readFor() still refuses it (no buffer-expecting consumer is handed a huge buffer)
 *  - openFor() returns a readable fd whose bytes are exactly the file
 *  - viewer scoping, the symlink floor and the stream ceiling still refuse
 *  - an original edited after registration is refused with "checksum mismatch", even after a cached proof,
 *    INCLUDING a same-size, in-place edit whose mtime was put back (`touch -r`) — the hole an independent
 *    review found in the first version of the proof cache (fixed by keying on ctime)
 *  - verifyFor() proves a large file without handing out an fd; outbox_read reports it present, not missing
 *  - the page mints an 'artifact' ticket that the server's verifier accepts (every Outbox link was a 403)
 *
 * Run standalone: node test/outbox-large-artifact.test.js */
'use strict';
const A = require('./_assert.js');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { makeDeliverableManifest, MAX_READ_BYTES, MAX_STREAM_BYTES } = require('../sidecar/deliverable-manifest.js');

(async () => {
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'outbox-large-'));
try {
  const wsRoot = path.join(TMP, 'ws');
  let clock = 1_700_000_000_000;
  const mk = (extra = {}) => makeDeliverableManifest({
    fs, path, crypto, root: path.join(wsRoot, '.deliverables'), now: () => clock,
    workspaceRootOf: (a) => path.join(wsRoot, String(a)), maxBytes: 1024, ...extra,
  });
  const m = mk();
  const write = (agent, rel, buf) => { const abs = path.join(wsRoot, agent, rel); fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, buf); return abs; };
  const sha = b => crypto.createHash('sha256').update(b).digest('hex');

  A.eq(MAX_READ_BYTES, 64 * 1024 * 1024, 'the whole-file ceiling is unchanged at 64 MB');
  A.ok(MAX_STREAM_BYTES >= 1024 * 1024 * 1024, 'the streaming ceiling holds a long film (>= 1 GB)');

  /* A fake MP4: a real ftyp box up front so type detection still works from the head alone. */
  const big = Buffer.concat([Buffer.from('000000206674797069736f6d0000020069736f6d69736f32617663316d703431', 'hex'),
    crypto.randomBytes(1024 * 1024 + 4321)]);      // > the hash chunk, so the chunk loop runs more than once
  const abs = write('agent', 'outbox/memorial/film/film.mp4', big);

  const reg = m.register({ ownerAgentId: 'agent', runId: 'film', projectId: 'memorial-film', shareWith: ['agent'], files: ['outbox/memorial/film/film.mp4'] });
  A.ok(reg.ok && reg.entries.length === 1 && reg.invalid.length === 0, `a file over maxBytes registers (invalid: ${JSON.stringify(reg.invalid)})`);
  const row = reg.entries[0];
  A.eq(row.sha256, sha(big), 'with the same sha256 a whole-file hash gives (chunked hashing is exact)');
  A.eq(row.bytes, big.length, 'and its true size');
  A.eq(row.kind, 'video', 'its type is still detected from the head (mp4 → video)');

  const again = m.register({ ownerAgentId: 'agent', runId: 'film', projectId: 'memorial-film', shareWith: ['agent'], files: ['outbox/memorial/film/film.mp4'] });
  A.ok(again.entries[0].deduped, 're-registering the same large file is a no-op (dedupe works on the chunked hash)');

  const rf = m.readFor('agent', row.id);
  A.ok(!rf.ok && /EFBIG/.test(String(rf.error)), 'readFor still refuses it — no consumer expecting a buffer gets a huge one');

  const o = await m.openFor('agent', row.id);
  A.ok(o.ok && o.size === big.length, 'openFor opens it');
  if (o.ok) {
    const got = Buffer.alloc(o.size);
    fs.readSync(o.fd, got, 0, o.size, 0);
    fs.closeSync(o.fd);
    A.ok(got.equals(big), 'and the bytes read through its fd are exactly the file');
  }

  A.ok(!(await m.openFor('publisher', row.id)).ok, 'a viewer it was not shared with cannot open it');
  A.ok(!(await m.openFor('agent', 'agent:nope:x@v1')).ok, 'an unknown id cannot be opened');

  const vf = await m.verifyFor('agent', row.id);
  A.ok(vf.ok && vf.bytes === big.length && vf.row.id === row.id, 'verifyFor proves the large file without handing out an fd');

  /* The cached proof must not survive an in-place, SAME-SIZE edit whose mtime is put back — mtime is
     settable by the file's owner; ctime is not. */
  clock += 1000;
  const o2 = await m.openFor('agent', row.id); if (o2.ok) fs.closeSync(o2.fd);
  A.ok(o2.ok, 'a second open within the cache window succeeds (proof cached)');
  const st0 = fs.statSync(abs);
  const fdw = fs.openSync(abs, 'r+'); fs.writeSync(fdw, Buffer.from([9, 9, 9, 9]), 0, 4, 100); fs.closeSync(fdw);
  fs.utimesSync(abs, st0.atimeMs / 1000, st0.mtimeMs / 1000);
  const st1 = fs.statSync(abs);
  A.ok(st1.size === st0.size && st1.mtimeMs === st0.mtimeMs, 'setup: the edit kept the same size and the same mtime');
  const t0 = await m.openFor('agent', row.id); if (t0.ok) fs.closeSync(t0.fd);
  A.ok(!t0.ok && /checksum mismatch/.test(String(t0.error)), `a same-size in-place edit with mtime restored is refused (${t0.error || 'it was SERVED'})`);
  fs.writeFileSync(abs, big);                                        // restore the original bytes
  fs.appendFileSync(abs, Buffer.from('tampered'));
  const t = await m.openFor('agent', row.id);
  A.ok(!t.ok && /checksum mismatch/.test(String(t.error)), `an original edited after registration is refused (${t.error})`);

  /* The CACHED case: a file unchanged for over a second gets its proof cached; an edit after that — same size,
     mtime put back — must still be refused. (The kernel's coarse timestamp clock made a same-tick edit match a
     ctime-keyed cache; proofs are now cached only for settled files. Measured 2026-11-24.) */
  {
    const settled = write('agent', 'outbox/memorial/film/settled.mp4', big);
    const rs2 = m.register({ ownerAgentId: 'agent', runId: 'film', projectId: 'memorial-film', shareWith: ['agent'], files: ['outbox/memorial/film/settled.mp4'] });
    const sid = rs2.entries[0].id;
    await new Promise(r => setTimeout(r, 1300));                     // let the file settle past CACHE_SETTLE_MS
    const c1 = await m.openFor('agent', sid); if (c1.ok) fs.closeSync(c1.fd);
    A.ok(c1.ok, 'a settled large file opens (its proof is now cached)');
    const s0 = fs.statSync(settled);
    const fw = fs.openSync(settled, 'r+'); fs.writeSync(fw, Buffer.from([7, 7, 7, 7]), 0, 4, 0); fs.closeSync(fw);
    fs.utimesSync(settled, s0.atimeMs / 1000, s0.mtimeMs / 1000);
    const c2 = await m.openFor('agent', sid); if (c2.ok) fs.closeSync(c2.fd);
    A.ok(!c2.ok && /checksum mismatch/.test(String(c2.error)), `after a cached proof, a same-size edit with mtime restored is still refused (${c2.error || 'it was SERVED'})`);
  }

  /* outbox_read, the agents' door: a present large film must not be reported missing. */
  fs.writeFileSync(abs, big);
  const { makeOutboxTools } = require('../sidecar/tools/builtin/outbox.js');
  const tools = {}; makeOutboxTools({ manifest: m }).register({ register: (t) => { tools[t.name] = t; } });
  const out = await tools.outbox_read.run({ id: row.id }, { agentId: 'agent' });
  A.ok(!/not available|missing|unreadable/i.test(out.content) && /checksum-matched/.test(out.content), `outbox_read reports the large film present and verified, not missing (${String(out.content).slice(0, 80)})`);

  /* The page's ticket for /api/artifact is accepted by the server — every Outbox link used to be a 403. */
  const C = require('../frontend/app/apiticket.js');
  const S = require('../sidecar/apitickets.js');
  const key = 'k'.repeat(64), when = Date.now();
  const ticket = C._test.mintWith(key, 'artifact', C._test.scopeArtifact('agent', row.id), when, 'ab'.repeat(16));
  A.ok(S.verify(key, ticket, 'artifact', S.scopeArtifact('agent', row.id), { now: when }).ok, 'the page mints an artifact ticket the server accepts');
  A.ok(!S.verify(key, ticket, 'artifact', S.scopeArtifact('publisher', row.id), { now: when }).ok, 'and it cannot be replayed as another viewer');
  A.ok(!S.verify(key, ticket, 'artifact', S.scopeArtifact('agent', row.id), { now: when + 6 * 60 * 1000 }).ok, 'and it expires (5-minute cap)');

  /* Symlink floor. */
  const real = write('agent', 'outbox/elsewhere/real.mp4', big);
  const link = path.join(wsRoot, 'agent', 'outbox', 'memorial', 'film', 'link.mp4');
  fs.symlinkSync(real, link);
  const rl = m.register({ ownerAgentId: 'agent', runId: 'film', projectId: 'memorial-film', files: ['outbox/memorial/film/link.mp4'] });
  A.ok(rl.entries.length === 0 && rl.invalid.length === 1, 'a symlinked large file is refused at registration');

  /* Stream ceiling. */
  const tight = mk({ maxStreamBytes: 2048 });
  const r2 = tight.register({ ownerAgentId: 'agent', runId: 'x', projectId: 'x', files: ['outbox/elsewhere/real.mp4'] });
  A.ok(r2.entries.length === 0 && /ceiling/.test(String((r2.invalid[0] || {}).error)), 'a file over the stream ceiling is still refused');

  /* Small files take the unchanged whole-file path. */
  write('agent', 'outbox/small.txt', Buffer.from('hello'));
  const rs = m.register({ ownerAgentId: 'agent', runId: 's', projectId: 's', shareWith: ['agent'], files: ['outbox/small.txt'] });
  const rr = m.readFor('agent', rs.entries[0].id);
  A.ok(rr.ok && rr.buf.toString() === 'hello', 'a small file is still registered and read whole, as before');
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}
A.report('outbox-large-artifact');
})().catch(e => { A.ok(false, 'test threw: ' + (e && e.stack || e)); A.report('outbox-large-artifact'); });

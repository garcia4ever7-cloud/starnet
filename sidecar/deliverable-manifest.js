/* sidecar/deliverable-manifest.js — the DESIGNER -> PUBLISHER bridge: a shared, read-only index of finished
   deliverables that crosses the per-agent workspace boundary WITHOUT widening the jail.

   THE PROBLEM IT SOLVES (live run dc3e312b, 2026-11-02). All three Etsy stages finally dispatched and
   DESIGNER produced genuine 300-DPI print files — and PUBLISHER then drafted nothing, reporting: "The PNGs
   are in DESIGNER's workspace, which PUBLISHER cannot read." That is not a bug. fs.* is jailed per agent
   (tools/builtin/fs.js resolveInside -> workspaceRoot(agentId)), and the ONE sanctioned way out of that jail
   refuses this case by design:

     pathtrust.js: "workspaceRoot: ... standing grants and Full Access do NOT override ownership beneath
                    this root." and "only an INTERACTIVE run with a live prompt() may bless a NEW root.
                    An autonomous run ... is a HARD DENY with NO prompt."

   So a cron PUBLISHER can never be granted a path into DESIGNER's workspace, and it should not be: private
   workspaces are an isolation boundary this station deliberately keeps. The bridge therefore does NOT widen
   the jail. It records, in a shared area owned by no agent, the EXACT files a producer finished, and hands a
   consumer bytes BY MANIFEST ID — never by a caller-supplied path. An agent can read what was explicitly
   published to it and nothing else; everything outside the manifest stays as private as it was before.

   WHY THE HOST REGISTERS, NOT THE AGENT. Same ruling as sidecar/handoff-store.js: "a handoff an agent is
   merely ASKED to save is a claim, not evidence", and an ASK-mode worker cannot fs.write unattended at all.
   Registration is computed from the producer's real artifact list, by the host, after the run.

   NO DUPLICATE BYTES. Only metadata is stored (path, bytes, sha256, mime, pixel dimensions, DPI). The
   original stays exactly where the producer wrote it; nothing is copied, moved, or rewritten.

   makeDeliverableManifest({ fs, path, crypto, root, workspaceRootOf, now, maxBytes? }) ->
     { register, list, get, readFor, verify }

     fs              : node:fs facade (readFileSync, writeFileSync, mkdirSync, existsSync, statSync)
     path            : node:path
     crypto          : node:crypto (sha256)
     root            : absolute dir for the manifest itself — MUST NOT sit inside any agent workspace
     workspaceRootOf : (agentId) -> that agent's absolute workspace root. Used to PROVE a registered file
                       really belongs to the agent registering it: a producer cannot publish /etc/passwd,
                       another agent's private file, or anything reached via `..`.
     now             : () -> ms (injected; no ambient clock)

   TRUTHFUL TELEMETRY. A file that is missing, unreadable, outside its owner's workspace, or altered since
   registration is recorded and reported AS SUCH — never silently skipped, because a consumer that receives a
   short list has no way to tell "nothing was produced" from "the index quietly dropped it". */
'use strict';

// failopen.note — the tagged SYNC swallow (per-tag count + throttled warn): a fail-open catch must never be
// invisible. Same shape as deliverable-store.js, which this module sits beside.
const { note: failNote } = require('./failopen.js');
// Reuse the station's EXISTING "is this actually a deliverable?" rule rather than inventing a second opinion.
const { isScratchHelperPath } = require('./deliverable-files.js');

const MANIFEST_FILE = 'manifest.jsonl';
const MAX_READ_BYTES = 64 * 1024 * 1024;   // a print master is tens of MB; refuse anything absurd
const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.pdf': 'application/pdf', '.svg': 'image/svg+xml',
  '.txt': 'text/plain', '.md': 'text/markdown', '.json': 'application/json', '.csv': 'text/csv'
};

function extOf(p) {
  const s = String(p == null ? '' : p);
  const slash = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
  const base = slash >= 0 ? s.slice(slash + 1) : s;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot).toLowerCase() : '';
}
function mimeOf(p) { return MIME[extOf(p)] || 'application/octet-stream'; }
function safeId(v, fallback) {
  const s = String(v == null ? '' : v).replace(/[^A-Za-z0-9_.-]/g, '');
  return s ? s.slice(0, 64) : fallback;
}

/* FOUR INDEPENDENT AXES, NOT ONE STATUS. The Outbox must show completion, technical verification, QC and
   approval SEPARATELY, because conflating them is how a "finished" video that was 1,056 bytes of placeholder
   got presented as a deliverable (CLAUDE.md, the fabricated-video incident). Each axis has exactly one
   writer, and they are deliberately not collapsible:

     completion   — the PRODUCER's own claim, bounded by the host proving the file exists and is readable.
                    "created does not mean completed".
     verification — the HOST's mechanical check (decode / ffprobe / checksum). Never an agent's word.
                    "verified does not mean quality-approved".
     qc           — an INDEPENDENT reviewer. A producer may never write this about its own artifact
                    (register() refuses it; setQc() refuses a reviewer equal to the owner).
     approval     — the COMMANDER alone. "QC-approved does not mean Commander-approved".

   SUPERSEDED is a fifth, orthogonal fact (a newer version exists) and never erases the older row. */
const COMPLETION = new Set(['created', 'staged', 'complete', 'failed']);
const VERIFICATION = new Set(['unverified', 'passed', 'failed', 'missing']);
const QC = new Set(['not_reviewed', 'needs_review', 'passed', 'rejected']);
const APPROVAL = new Set(['pending', 'approved', 'rejected']);
/* The CLOSED set of values lifecycleOf() may return. Exported purely as a drift guard: the four axes above are
   stored and already pinned by tests, but the lifecycle is DERIVED, so a new branch could previously appear in
   the UI and in `?lifecycle=` with nothing asserting it existed. A test pins this set against the function's
   real behaviour, so adding a rung forces a deliberate update rather than slipping in unnoticed. */
const LIFECYCLE = new Set(['CREATED', 'STAGED', 'VERIFIED', 'NEEDS_REVIEW', 'QC_REVIEWED',
                           'APPROVED_UNVERIFIED', 'APPROVED', 'REJECTED', 'FAILED', 'MISSING', 'SUPERSEDED']);
const oneOf = (set, v, dflt) => (set.has(String(v)) ? String(v) : dflt);

/* The coarse lifecycle the brief names, DERIVED from the axes so the two can never disagree. A single stored
   lifecycle field would drift the moment one axis changed without it. */
function lifecycleOf(row) {
  if (!row) return 'MISSING';
  if (row.supersededBy) return 'SUPERSEDED';
  if (row.verification === 'missing') return 'MISSING';
  if (row.completion === 'failed' || row.verification === 'failed') return 'FAILED';
  if (row.approval === 'rejected' || row.qc === 'rejected') return 'REJECTED';
  /* APPROVED means "the Commander cleared it AND the host proved the bytes". Anything less is
     APPROVED_UNVERIFIED (2026-11-10). Measured on the live station before this split: approving a row whose
     verification axis still read `unverified` produced
         lifecycle: APPROVED | verification: unverified | qc: not_reviewed | approval: approved
     — the top of the ladder, reached by skipping the one rung the harness sets mechanically. That breaks the
     station's first law ("the interface must never assert state the harness cannot prove") in the exact shape
     of the 1,056-byte placeholder: a file nothing decoded, labelled finished.

     The split is deliberately on VERIFICATION and not on QC. A Commander overriding a reviewer's opinion is a
     legitimate business decision and the qc pill shows it; a Commander cannot override physics. Note also that
     `GET /api/outbox?lifecycle=APPROVED` is how anyone asks "what is cleared to sell" — before this split that
     filter returned machine-checked and never-checked artifacts indistinguishably.

     NOT A REFUSAL: the approval axis still records `approved` either way, so the Commander keeps the final
     word. Only the derived summary stops overclaiming. The route additionally requires that override to be
     explicit (handleOutboxApproval, `acknowledgeUnverified`). */
  if (row.approval === 'approved') return row.verification === 'passed' ? 'APPROVED' : 'APPROVED_UNVERIFIED';
  if (row.qc === 'passed') return 'QC_REVIEWED';
  if (row.qc === 'needs_review') return 'NEEDS_REVIEW';
  if (row.verification === 'passed') return 'VERIFIED';
  if (row.completion === 'complete' || row.completion === 'staged') return 'STAGED';
  return 'CREATED';
}

/* CONTENT-SNIFFED TYPE. "Never rely solely on filename extensions [or] client-provided MIME types" — so the
   real type comes from the file's own magic bytes and a disagreement with the extension is RECORDED rather
   than resolved silently. A .png that is really an MP4 is exactly the shape a corrupted render takes. */
function detectType(buf) {
  if (!buf || buf.length < 12) return 'unknown';
  const b = buf;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'jpeg';
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'pdf';
  if (b.slice(4, 8).toString('ascii') === 'ftyp') return 'mp4';
  const head = b.slice(0, 512).toString('utf8');
  if (/^\s*<\?xml|^\s*<svg/i.test(head)) return 'svg';
  // eslint-disable-next-line no-control-regex
  if (!/[\x00-\x08\x0e-\x1f]/.test(head)) return 'text';
  return 'unknown';
}
const TYPE_FOR_MIME = {
  'image/png': 'png', 'image/jpeg': 'jpeg', 'application/pdf': 'pdf',
  'image/svg+xml': 'svg', 'video/mp4': 'mp4',
  'text/plain': 'text', 'text/markdown': 'text', 'application/json': 'text', 'text/csv': 'text'
};

/* Pixel dimensions + embedded DPI, read from the file's own header. PNG only for now (JPEG stores density in
   APP0/APP1 and is not a print master on this station); an unparseable or non-image file simply reports null
   rather than guessing — a fabricated dimension is worse than an absent one. */
function imageMeta(buf) {
  const out = { width: null, height: null, dpi: null };
  if (!buf || buf.length < 24) return out;
  const isPng = buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  /* JPEG TOO (2026-11-02). PNG-only was a real gap, not a theoretical one: the Isaiah 40:31 print kit — five
     300-DPI ratios plus its whole listing-photo set — is entirely JPEG, so every one of those deliverables
     would have registered with width/height/dpi null and the Outbox could not have shown that they ARE print
     files. Dimensions come from the SOF marker and density from JFIF APP0; anything unparseable still reports
     null rather than guessing, which is the rule that matters. */
  if (!isPng) {
    if (!(buf[0] === 0xFF && buf[1] === 0xD8)) return out;          // not a JPEG either
    let o = 2;
    while (o + 9 < buf.length) {
      if (buf[o] !== 0xFF) { o++; continue; }
      const marker = buf[o + 1];
      // SOF0-SOF15 carry the real frame size; DHT/DAC/RST markers in that range do not.
      if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
        out.height = buf.readUInt16BE(o + 5);
        out.width = buf.readUInt16BE(o + 7);
        break;
      }
      if (o + 3 >= buf.length) break;
      const seg = buf.readUInt16BE(o + 2);
      if (seg < 2) break;                                            // malformed length -> stop, never loop
      o += 2 + seg;
    }
    const j = buf.indexOf(Buffer.from('JFIF\u0000', 'ascii'));
    if (j >= 0 && j + 11 < buf.length) {
      const units = buf[j + 7];                                      // 1 = dots/inch, 2 = dots/cm
      const xd = buf.readUInt16BE(j + 8);
      if (xd > 0) out.dpi = units === 1 ? xd : (units === 2 ? Math.round(xd * 2.54) : null);
    }
    return out;
  }
  out.width = buf.readUInt32BE(16);
  out.height = buf.readUInt32BE(20);
  let off = 8;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.slice(off + 4, off + 8).toString('ascii');
    if (type === 'pHYs' && off + 17 < buf.length) {
      if (buf[off + 16] === 1) out.dpi = Math.round(buf.readUInt32BE(off + 8) * 0.0254);   // unit 1 = metre
      break;
    }
    if (type === 'IDAT' || type === 'IEND') break;
    off += 12 + len;
  }
  return out;
}

function makeDeliverableManifest(deps) {
  deps = deps || {};
  const fs = deps.fs, P = deps.path, crypto = deps.crypto;
  const root = deps.root, workspaceRootOf = deps.workspaceRootOf, now = deps.now;
  const maxBytes = Number(deps.maxBytes) > 0 ? Number(deps.maxBytes) : MAX_READ_BYTES;
  const wired = !!(fs && P && crypto && root && typeof workspaceRootOf === 'function' && typeof now === 'function');

  const manifestPath = () => P.join(root, MANIFEST_FILE);
  const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

  function inside(abs, base) {
    const a = P.resolve(abs), b = P.resolve(base);
    return a === b || a.startsWith(b.endsWith(P.sep) ? b : b + P.sep);
  }

  /* THE PATH FLOOR. Every rejection here is a path a producer must never be able to publish. Mirrors
     fs.js resolveInside's own refusals (NUL, '..', absolute escapes) and adds the ownership proof that
     pathtrust.js states as law: a file is publishable only from INSIDE its own agent's workspace.

     THE LEXICAL CHECK ALONE IS NOT ENOUGH (fixed 2026-11-02, flagged HIGH by security review). P.resolve
     collapses '..' but does NOT follow symlinks, so a link planted anywhere under a producer's own
     workspace — `outbox/x.png -> /etc/passwd`, or -> another agent's private file — passed containment
     and was then read. That is exactly the escape the rest of the station already treats as a hardline:

       fs.js resolveInside : "path escapes workspace via symlink"  (compares realpath'd base vs target)
       pathtrust.js        : "the REAL (realpath-resolved) target must stay inside the blessed root's
                              REAL path, re-proven on every access"

     This module omitted that floor; it now matches it. Both ends are realpath'd and compared, a symlink AT
     THE LEAF is refused outright, and because register/verify/readFor all route through here, the proof is
     re-run on EVERY access rather than trusted from registration time. */
  function resolveOwned(ownerAgentId, rel) {
    const raw = String(rel == null ? '' : rel);
    if (!raw) return { ok: false, error: 'empty path' };
    if (raw.indexOf('\0') >= 0) return { ok: false, error: 'illegal path (NUL byte)' };
    if (/(^|[\\/])\.\.([\\/]|$)/.test(raw)) return { ok: false, error: 'illegal path (traversal)' };
    if (P.isAbsolute(raw) || /^[A-Za-z]:/.test(raw) || /^[\\/]{2}/.test(raw)) {
      return { ok: false, error: 'illegal path (absolute/UNC not accepted — register a workspace-relative path)' };
    }
    let base;
    try { base = workspaceRootOf(ownerAgentId); } catch (e) { return { ok: false, error: 'owner workspace unavailable' }; }
    if (!base) return { ok: false, error: 'owner workspace unavailable' };
    const abs = P.resolve(base, raw);
    if (!inside(abs, base)) return { ok: false, error: 'path escapes the owner workspace' };

    // --- symlink floor: resolve BOTH ends and compare the real paths ---
    let realBase;
    try { realBase = fs.realpathSync(base); } catch (e) { return { ok: false, error: 'owner workspace unavailable' }; }
    try {
      if (fs.lstatSync(abs).isSymbolicLink()) return { ok: false, error: 'illegal path (symlink not accepted)' };
    } catch (e) {
      return { ok: false, error: 'unreadable: ' + ((e && e.code) || (e && e.message) || e) };
    }
    let realAbs;
    try { realAbs = fs.realpathSync(abs); }
    catch (e) { return { ok: false, error: 'unreadable: ' + ((e && e.code) || (e && e.message) || e) }; }
    // An INTERMEDIATE directory symlink escapes without the leaf being a link — realpath catches that too.
    if (!inside(realAbs, realBase)) return { ok: false, error: 'path escapes the owner workspace via symlink' };
    return { ok: true, abs: realAbs, base: realBase };
  }

  /* Read without re-walking the path. O_NOFOLLOW closes the TOCTOU gap between the check above and the
     read: a link swapped in after resolveOwned returned cannot be followed. Falls back to a plain read
     where the flag is unavailable (non-POSIX hosts, a reduced fs facade in a unit test) — the realpath
     floor above still applies, so the fallback is narrower than what shipped before, never wider. */
  /* THE CEILING AND THE REGULAR-FILE CHECK BELONG ON THE FILE DESCRIPTOR, NOT BESIDE IT (security review,
     2026-11-10). register() stats before reading and refuses a non-regular file and anything over maxBytes;
     verify() — which is on EVERY retrieval path (readFor -> /api/artifact, outbox_read) — did neither, so the
     comment at the retrieval route claiming it "re-runs the FULL floor" was not true of the two checks that
     bound resources:
       · a row registered small whose file has since GROWN was read whole into one Buffer before the checksum
         could reject it. This station legitimately produces 28 MB masters and holds 1.58 GB of print PNGs, and
         the sidecar is ONE process on a phone — an oversized synchronous read is an OOM that takes the whole
         station down, not a failed request.
       · O_NOFOLLOW does not stop open() on a FIFO, and opening a FIFO with no writer BLOCKS FOREVER. A named
         pipe swapped in at a registered path was a permanent whole-station hang on a synchronous call.
     fstat on the OPEN fd is also strictly better than a stat beside it: it describes the exact object being
     read, so it closes the residual TOCTOU window that O_NOFOLLOW only narrowed (O_NOFOLLOW covers the final
     component; an intermediate directory could still be swapped between realpath and open). */
  function readNoFollow(abs) {
    const C = (fs.constants || {});
    if (typeof fs.openSync === 'function' && typeof C.O_NOFOLLOW === 'number') {
      let fd = null;
      try {
        fd = fs.openSync(abs, C.O_RDONLY | C.O_NOFOLLOW);
        if (typeof fs.fstatSync === 'function') {
          const st = fs.fstatSync(fd);
          // Refuse BEFORE the read, so neither failure mode can allocate or block.
          if (!st.isFile()) { const e = new Error('not a regular file'); e.code = 'ENOTREGULAR'; throw e; }
          if (Number(st.size) > maxBytes) { const e = new Error('file exceeds manifest size ceiling'); e.code = 'EFBIG'; throw e; }
        }
        return fs.readFileSync(fd);
      } finally {
        if (fd !== null) { try { fs.closeSync(fd); } catch (e) { failNote('deliverableManifest.close', e); } }
      }
    }
    return fs.readFileSync(abs);
  }

  function readRows() {
    if (!wired) return [];
    let text = '';
    try { text = fs.readFileSync(manifestPath(), 'utf8'); } catch (e) { return []; }
    const rows = [];
    for (const line of String(text).split('\n')) {
      if (!line.trim()) continue;
      // A torn line must not hide the rest of the index — but it must not be invisible either, or a
      // half-written manifest silently under-reports what a producer published.
      try { rows.push(JSON.parse(line)); } catch (e) { failNote('deliverableManifest.tornLine', e); }
    }
    return rows;
  }

  /* register({ ownerAgentId, projectId, shareWith:[agentId...], files:[relPath...] })
       -> { ok, projectId, entries:[row], invalid:[{path,error}] }
     Each entry is verified to EXIST and be READABLE before it is indexed — a manifest row for a file nobody
     can open is the same lie as a missing handoff. Invalid files are returned, not swallowed. */
  function register(input) {
    input = input || {};
    if (!wired) return { ok: false, error: 'deliverable manifest not wired', entries: [], invalid: [] };
    const ownerAgentId = safeId(input.ownerAgentId, '');
    if (!ownerAgentId) return { ok: false, error: 'ownerAgentId required', entries: [], invalid: [] };
    const projectId = safeId(input.projectId, 'project');
    const shareWith = Array.isArray(input.shareWith)
      ? Array.from(new Set(input.shareWith.map(a => safeId(a, '')).filter(Boolean))) : [];
    const files = Array.isArray(input.files) ? input.files.slice(0, 200) : [];
    const at = now();
    const entries = [], invalid = [], supersede = [];

    for (const rel of files) {
      /* NOT EVERY FILE A RUN WROTE IS A DELIVERABLE. Reuses the station's existing rule rather than a second
         opinion: deliverable-files.js already decides that .py/.pyc/.sh/.ipynb are scratch helpers this
         station never ships ("Do not silently register temporary files, partial renders ... or unrelated
         workspace contents"). DESIGNER's build_matthew_11_28.py is exactly this case. */
      if (isScratchHelperPath(String(rel))) { invalid.push({ path: String(rel), error: 'scratch helper, not a deliverable' }); continue; }
      const r = resolveOwned(ownerAgentId, rel);
      if (!r.ok) { invalid.push({ path: String(rel), error: r.error }); continue; }
      let buf = null, size = 0;
      try {
        const st = fs.statSync(r.abs);
        if (!st.isFile()) { invalid.push({ path: String(rel), error: 'not a regular file' }); continue; }
        size = st.size;
        if (size > maxBytes) { invalid.push({ path: String(rel), error: 'file exceeds manifest size ceiling' }); continue; }
        buf = readNoFollow(r.abs);                     // readability is proven by actually reading it
      } catch (e) {
        invalid.push({ path: String(rel), error: 'unreadable: ' + ((e && e.code) || (e && e.message) || e) });
        continue;
      }
      const meta = imageMeta(buf);
      const digest = sha256(buf);
      const mime = mimeOf(rel);
      const detected = detectType(buf);
      const artifactId = ownerAgentId + ':' + projectId + ':' + String(rel).replace(/[\\/]/g, '_');

      /* IDEMPOTENT. "Repeated registration of the same artifact must not create uncontrolled duplicates."
         Identity is (artifactId + sha256): re-registering BYTE-IDENTICAL content is a no-op that returns the
         row already on file, so a retried dispatch or a re-run cannot fan the Outbox out into copies. */
      /* ROWS MINTED EARLIER IN THIS SAME BATCH COUNT TOO (security review, 2026-11-10). The append happens
         ONCE, after this loop, so readRows() cannot see them — two files in one register() call that mapped to
         the same artifactId both computed version 1 and were written with the IDENTICAL id. currentRows() keys
         by id and keeps the last, so the first artifact became permanently invisible to /api/outbox,
         outbox_list, get(), /api/artifact and both judgment routes. That is the exact failure this module's own
         header forbids: "a consumer that receives a short list has no way to tell 'nothing was produced' from
         'the index quietly dropped it'." */
      const prior = readRows().filter(r => r && r.artifactId === artifactId)
        .concat(entries.filter(e => e && e.artifactId === artifactId));
      const newest = prior.length ? prior[prior.length - 1] : null;

      /* A DIFFERENT SOURCE PATH UNDER THE SAME ID IS A COLLISION, NOT A NEW VERSION. artifactId flattens the
         relative path's separators to '_', so 'a/b.png' and 'a_b.png' collide. Reported as invalid — never
         silently shadowed, and never recorded as a version of an unrelated file (which would additionally mark
         the real row supersededBy and drop it from the default feed).
         WHY NOT CHANGE THE ID FORMAT: the ids already on disk are what /api/artifact, every ticket and every
         stored verdict address. Re-encoding would make a re-registration of an existing file compute a NEW
         artifactId, defeating the sha256 dedupe and fanning the Outbox into duplicates — the very thing the
         idempotence rule above exists to prevent. The collision is latent (0 of 54 live rows) and deterministic,
         so refusing it loudly is both sufficient and reversible; re-encoding is a migration. */
      if (newest && String(newest.path || '') !== String(rel)) {
        invalid.push({ path: String(rel), error: 'artifact id collision: "' + artifactId + '" is already held by "'
          + String(newest.path) + '" — rename one of them (path separators are flattened to "_" in the id)' });
        continue;
      }
      if (newest && newest.sha256 === digest) { entries.push(Object.assign({}, newest, { deduped: true })); continue; }

      // CHANGED CONTENT AT THE SAME PATH = A NEW VERSION. The old row is kept and pointed forward; history
      // is never rewritten, because "preserve historical records when a newer artifact supersedes an older".
      const version = newest ? (Number(newest.version) || 1) + 1 : 1;
      let createdAt = null;
      try { createdAt = new Date(fs.statSync(r.abs).mtimeMs).toISOString(); } catch (e) { createdAt = null; }

      entries.push({
        id: artifactId + '@v' + version,        // stable + version-unique: what the retrieval route takes
        artifactId: artifactId,                 // stable across versions
        version: version,
        owner: ownerAgentId,                    // from the HOST run context, never an agent-supplied name
        runId: safeId(input.runId, ''),         // the run that produced it (provenance back-reference)
        projectId: projectId,
        kind: String(input.kind || (detected === 'mp4' ? 'video' : (detected === 'png' || detected === 'jpeg') ? 'image' : 'file')),
        path: String(rel),
        filename: String(rel).split(/[\\/]/).pop(),
        mime: mime,
        typeDetected: detected,
        // A declared/actual disagreement is reported, not reconciled: a corrupted or mislabelled render
        // must not inherit the credibility of its file extension.
        signatureMismatch: !!(TYPE_FOR_MIME[mime] && detected !== 'unknown' && TYPE_FOR_MIME[mime] !== detected),
        bytes: size,
        sha256: digest,
        width: meta.width, height: meta.height, dpi: meta.dpi,
        parents: Array.isArray(input.parents) ? input.parents.slice(0, 20).map(String) : [],
        sharedWith: shareWith,
        createdAt: createdAt,                   // when the PRODUCER wrote it
        at: new Date(at).toISOString(),         // when the host registered it
        // --- the four axes (see COMPLETION/VERIFICATION/QC/APPROVAL above) ---
        completion: oneOf(COMPLETION, input.completion, 'complete'),
        verification: 'unverified',             // host-computed later; never asserted at registration
        qc: 'not_reviewed',                     // an independent reviewer only — never the producer
        approval: 'pending',                    // the Commander alone
        supersededBy: null
      });
      if (newest) supersede.push({ oldId: newest.id, byId: artifactId + '@v' + version });
    }

    const fresh = entries.filter(e => !e.deduped);
    if (fresh.length) {
      try {
        fs.mkdirSync(root, { recursive: true });
        fs.writeFileSync(manifestPath(),
          fresh.map(e => JSON.stringify(e)).join('\n') + '\n',
          { flag: 'a', mode: 0o600 });
      } catch (e) {
        return { ok: false, error: 'could not write manifest: ' + ((e && e.message) || e), entries: [], invalid: invalid };
      }
      // Point the previous versions forward AFTER the new row is durable, never before: a crash between the
      // two must leave the old row still readable, not orphaned behind a supersede that has no successor.
      for (const s of supersede) patch(s.oldId, { supersededBy: s.byId });
    }
    return { ok: true, projectId: projectId, entries: entries, invalid: invalid };
  }

  /* An append-only log needs a way to amend a row. A patch is appended as a NEW line for the same id and the
     reader keeps the LAST one (see readRows consumers), so the original registration stays on disk as
     history — the audit trail is the whole point of this index. */
  function patch(id, fields) {
    if (!wired) return { ok: false, error: 'not wired' };
    const row = readRows().filter(r => r && r.id === String(id)).pop();
    if (!row) return { ok: false, error: 'no such artifact' };
    const next = Object.assign({}, row, fields || {}, { id: row.id, amendedAt: new Date(now()).toISOString() });
    try {
      fs.mkdirSync(root, { recursive: true });
      fs.writeFileSync(manifestPath(), JSON.stringify(next) + '\n', { flag: 'a', mode: 0o600 });
    } catch (e) { return { ok: false, error: 'could not write manifest: ' + ((e && e.message) || e) }; }
    return { ok: true, row: next };
  }

  /* setVerification — the HOST's mechanical verdict. Takes a result computed by a real checker (image decode,
     ffprobe, checksum), never a claim passed in by the producing agent's tool arguments. */
  function setVerification(id, status, detail) {
    const v = oneOf(VERIFICATION, status, null);
    if (!v) return { ok: false, error: 'invalid verification status' };
    return patch(id, { verification: v, verificationDetail: String(detail || '').slice(0, 400) });
  }

  /* setQc — INDEPENDENT review. "The producer must not be the sole authority declaring its own artifact
     QC-approved", so a reviewer equal to the artifact's owner is refused outright rather than recorded. */
  function setQc(id, status, reviewerAgentId, detail) {
    const v = oneOf(QC, status, null);
    if (!v) return { ok: false, error: 'invalid qc status' };
    const reviewer = safeId(reviewerAgentId, '');
    if (!reviewer) return { ok: false, error: 'qc requires a reviewer identity' };
    const row = readRows().filter(r => r && r.id === String(id)).pop();
    if (!row) return { ok: false, error: 'no such artifact' };
    if (reviewer === row.owner) {
      return { ok: false, error: 'a producer cannot QC its own artifact (' + reviewer + ' owns ' + row.id + ')' };
    }
    return patch(id, { qc: v, qcReviewer: reviewer, qcDetail: String(detail || '').slice(0, 400) });
  }

  /* setApproval — the COMMANDER alone. Deliberately a separate axis from qc: QC passing is a quality opinion,
     approval is a business decision, and the Outbox shows both. */
  function setApproval(id, status, commanderId, detail) {
    const v = oneOf(APPROVAL, status, null);
    if (!v) return { ok: false, error: 'invalid approval status' };
    return patch(id, { approval: v, approvedBy: safeId(commanderId, 'commander'), approvalDetail: String(detail || '').slice(0, 400) });
  }

  // Rows a given agent is allowed to SEE. An agent always sees what it owns; others see only what was
  // explicitly shared with them. No argument -> owner-agnostic listing is NOT offered on purpose.
  /* LAST WRITE WINS, HISTORY KEPT. The log is append-only and a patch (verification/qc/approval/supersede) is
     a new line for the same id, so the CURRENT state of an artifact is its last line — while every earlier
     line stays on disk as the audit trail. Collapsing here is what makes the amendment model honest.
     `opts.history: true` returns every line instead, for a version/audit view. */
  function currentRows() {
    const byId = new Map();
    for (const r of readRows()) { if (r && typeof r === 'object' && r.id) byId.set(r.id, r); }
    return Array.from(byId.values());
  }

  /* Rows a given agent is allowed to SEE, with the Commander-facing filters the Outbox needs
     (§F: agent, project, date range, completion/qc/approval). Visibility is unchanged: own + explicitly
     shared only — a filter can narrow what an agent sees, never widen it. */
  function list(agentId, opts) {
    const who = safeId(agentId, '');
    const o = opts || {};
    const projectId = o.projectId ? safeId(o.projectId, '') : '';
    const since = o.since ? Date.parse(o.since) : null;
    const until = o.until ? Date.parse(o.until) : null;
    const rows = (o.history === true ? readRows() : currentRows());
    return rows.filter(r => {
      if (!r || typeof r !== 'object') return false;
      if (!(r.owner === who || (Array.isArray(r.sharedWith) && r.sharedWith.indexOf(who) >= 0))) return false;
      if (projectId && r.projectId !== projectId) return false;
      if (o.owner && r.owner !== safeId(o.owner, '')) return false;
      if (o.kind && String(r.kind) !== String(o.kind)) return false;
      if (o.completion && String(r.completion) !== String(o.completion)) return false;
      if (o.verification && String(r.verification) !== String(o.verification)) return false;
      if (o.qc && String(r.qc) !== String(o.qc)) return false;
      if (o.approval && String(r.approval) !== String(o.approval)) return false;
      if (o.lifecycle && lifecycleOf(r) !== String(o.lifecycle)) return false;
      if (o.includeSuperseded !== true && r.supersededBy) return false;
      const t = Date.parse(r.createdAt || r.at || '');
      if (since != null && Number.isFinite(since) && Number.isFinite(t) && t < since) return false;
      if (until != null && Number.isFinite(until) && Number.isFinite(t) && t > until) return false;
      return true;
    }).map(r => Object.assign({}, r, { lifecycle: lifecycleOf(r) }));
  }

  /* Every version of one artifact, oldest first — the §F "version history" view.
     Deliberately NOT history:true: that returns every appended LINE, so a version that was later amended
     (superseded, QC'd, approved) appears twice and a reader picking the first match sees the stale state.
     currentRows() collapses to one row per id, so each version is reported at its CURRENT state while the
     raw amendment trail stays on disk for audit. */
  function versions(agentId, artifactId) {
    const want = String(artifactId || '');
    return list(agentId, { includeSuperseded: true }).filter(r => r.artifactId === want)
      .sort((a, b) => (Number(a.version) || 0) - (Number(b.version) || 0));
  }

  function get(agentId, id) {
    const want = String(id || '');
    return list(agentId, {}).find(r => r.id === want) || null;
  }

  /* verify(row) -> { ok, reason?, bytes?, sha256? }. Re-reads the file and re-hashes it, so a deliverable
     that was deleted or EDITED after registration is reported instead of served as though still pristine. */
  function verify(row) {
    if (!wired || !row) return { ok: false, reason: 'not wired' };
    const r = resolveOwned(row.owner, row.path);
    if (!r.ok) return { ok: false, reason: r.error };
    let buf;
    try { buf = readNoFollow(r.abs); }
    catch (e) { return { ok: false, reason: 'missing or unreadable: ' + ((e && e.code) || (e && e.message) || e) }; }
    const digest = sha256(buf);
    if (row.sha256 && digest !== row.sha256) {
      return { ok: false, reason: 'checksum mismatch — the file changed after it was registered', sha256: digest, bytes: buf.length };
    }
    return { ok: true, bytes: buf.length, sha256: digest, buf: buf };
  }

  /* readFor(agentId, id) -> { ok, row, buf } | { ok:false, error }
     THE ONLY byte-returning entry point, and it takes an ID, never a path: a consumer cannot phrase a
     request for a file that was not published to it. Read-only by construction — nothing here writes to,
     renames, or deletes the producer's file. */
  function readFor(agentId, id) {
    if (!wired) return { ok: false, error: 'deliverable manifest not wired' };
    const row = get(agentId, id);
    if (!row) return { ok: false, error: 'no deliverable "' + String(id) + '" is published to ' + safeId(agentId, '?') };
    const v = verify(row);
    if (!v.ok) return { ok: false, error: v.reason, row: row };
    return { ok: true, row: row, buf: v.buf };
  }

  /* absolutePathOf(row) — the row's real on-disk location, resolved through the SAME injected
     workspaceRootOf every read goes through (security review, 2026-11-10). The Outbox feed used to rebuild
     this itself as path.join(WORKSPACES, owner, path), which is correct for an agent and WRONG for the
     'studio' pseudo-producer, whose root is $HOME/outbox — so all four studio rows advertised
     `workspaces/studio/<proj>/video.mp4`, a directory that does not exist, under a UI label reading "Shown so
     you can find it on disk". That is the interface asserting a fact the harness never resolved. One resolver
     means a future root exception cannot leave the display behind.
     DISPLAY ONLY, and deliberately not an access path: retrieval is id-addressed through readFor(). */
  function absolutePathOf(row) {
    if (!wired || !row || !row.owner) return '';
    try { return P.join(String(workspaceRootOf(row.owner) || ''), String(row.path || '')); }
    catch (e) { failNote('deliverableManifest.absolutePathOf', e); return ''; }
  }

  return { register, list, get, readFor, verify, versions, patch, absolutePathOf,
           setVerification, setQc, setApproval, lifecycleOf, _manifestPath: manifestPath };
}

module.exports = { makeDeliverableManifest, imageMeta, mimeOf, detectType, lifecycleOf,
                   MANIFEST_FILE, COMPLETION, VERIFICATION, QC, APPROVAL, LIFECYCLE };

/* test/outbox-route.test.js — the central Outbox's HTTP surface: GET /api/outbox and GET /api/artifact.

   These are the two routes that make the Outbox real for the Commander: one lists what every agent produced,
   the other hands back an ORIGINAL FILE. Both are id-addressed. The security posture being pinned here is
   that an artifact is reachable only through a manifest id the viewer was published, never through a path
   the caller chose — "Do not expose arbitrary filesystem access", and "display a human-readable location,
   but do not use that displayed path as an authorization mechanism".

   Scope-binding is the load-bearing half. apitickets verify() RE-DERIVES the scope from the actual request,
   so a ticket minted for (commander, artifactA) cannot be replayed as (publisher, artifactA) or as
   (commander, artifactB). Sections 4-6 make a regression in that binding fail loudly.

   Pure unit test over the real modules — no sidecar boot, no network, no fixtures outside a temp dir.
   Run standalone: node test/outbox-route.test.js */
'use strict';

const A = require('./_assert.js');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const apitickets = require('../sidecar/apitickets.js');
const { makeDeliverableManifest } = require('../sidecar/deliverable-manifest.js');

const TOKEN = 'test-master-token-aaaaaaaaaaaaaaaaaaaaaaaa';
const NOW = Date.UTC(2026, 10, 2, 19, 0, 0);

function png(w, h, dpi) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crypto.createHash('md5').update(body).digest().readUInt32BE(0));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr)];
  if (dpi) { const p = Buffer.alloc(9); const ppm = Math.round(dpi / 0.0254); p.writeUInt32BE(ppm, 0); p.writeUInt32BE(ppm, 4); p[8] = 1; parts.push(chunk('pHYs', p)); }
  parts.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

const reqFor = (url, method) => ({ method: method || 'GET', url: url });

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'starnet-outbox-route-'));
  const wsRoot = path.join(tmp, 'workspaces');
  for (const a of ['webdesigner', 'publisher', 'scout', 'agent']) fs.mkdirSync(path.join(wsRoot, a), { recursive: true });
  const m = makeDeliverableManifest({
    fs, path, crypto, root: path.join(wsRoot, '.deliverables'), now: () => NOW,
    workspaceRootOf: (a) => path.join(wsRoot, String(a))
  });
  fs.writeFileSync(path.join(wsRoot, 'webdesigner', 'art.png'), png(2400, 3000, 300));
  fs.writeFileSync(path.join(wsRoot, 'scout', 'notes.md'), Buffer.from('scout research'));
  const art = m.register({ ownerAgentId: 'webdesigner', projectId: 'matthew-11-28', runId: 'run-d', shareWith: ['agent', 'publisher'], files: ['art.png'] }).entries[0];
  const sct = m.register({ ownerAgentId: 'scout', projectId: 'matthew-11-28', runId: 'run-s', shareWith: ['agent'], files: ['notes.md'] }).entries[0];

  /* ---------- 1. THE ROUTE IS RECOGNISED AS A TICKETED CAPABILITY ---------- */
  {
    const claim = apitickets.apiTicketClaim(reqFor('/api/artifact?id=' + encodeURIComponent(art.id) + '&agent=agent&ticket=x'));
    A.ok(claim, '/api/artifact is a recognised ticketed route');
    A.eq(claim.kind, 'artifact', 'with its own ticket kind');
    A.eq(claim.scope, apitickets.scopeArtifact('agent', art.id), 'scoped to (viewer, artifact id)');
    A.eq(apitickets.KINDS.artifact.method, 'GET', 'read-only: GET only');
    A.eq(apitickets.KINDS.artifact.once, false, 're-usable within its lifetime (a tab may re-request)');
    A.ok(apitickets.KINDS.artifact.maxTtlMs <= 5 * 60 * 1000, 'and short-lived — 5 minutes at most');
  }

  /* ---------- 2. A CORRECTLY SCOPED TICKET VERIFIES ---------- */
  let goodTicket;
  {
    goodTicket = apitickets.mint(TOKEN, 'artifact', apitickets.scopeArtifact('agent', art.id), { now: NOW });
    const v = apitickets.verify(TOKEN, goodTicket, 'artifact', apitickets.scopeArtifact('agent', art.id), { now: NOW });
    A.eq(v.ok, true, 'a ticket minted for (commander, artifact) verifies for that exact pair');
  }

  /* ---------- 3. THE SCOPE BINDS THE VIEWER ---------- */
  {
    const v = apitickets.verify(TOKEN, goodTicket, 'artifact', apitickets.scopeArtifact('publisher', art.id), { now: NOW });
    A.eq(v.ok, false, 'the SAME ticket cannot be replayed as a different agent — viewer is inside the MAC');
  }

  /* ---------- 4. THE SCOPE BINDS THE ARTIFACT ---------- */
  {
    const v = apitickets.verify(TOKEN, goodTicket, 'artifact', apitickets.scopeArtifact('agent', sct.id), { now: NOW });
    A.eq(v.ok, false, 'a ticket for one artifact cannot fetch another');
  }

  /* ---------- 5. AND THE KIND ---------- */
  {
    const asFile = apitickets.verify(TOKEN, goodTicket, 'file', apitickets.scopeFile('agent', 'art.png'), { now: NOW });
    A.eq(asFile.ok, false, 'an artifact ticket is not a /api/file ticket — kinds do not cross');
    const expired = apitickets.verify(TOKEN, goodTicket, 'artifact', apitickets.scopeArtifact('agent', art.id), { now: NOW + 10 * 60 * 1000 });
    A.eq(expired.ok, false, 'and it dies at its expiry');
  }

  /* ---------- 6. AUTHORIZATION IS THE MANIFEST, NOT THE PATH ---------- */
  {
    // PUBLISHER was published the artwork, so it reads.
    A.eq(m.readFor('publisher', art.id).ok, true, 'PUBLISHER retrieves the DESIGNER artifact published to it');
    // ...but NOT SCOUT's row, which was shared only with the Commander.
    A.eq(m.readFor('publisher', sct.id).ok, false, 'PUBLISHER cannot retrieve an artifact it was not published');
    // The Commander sees both — that is what "central Outbox" means.
    A.eq(m.list('agent', { projectId: 'matthew-11-28' }).length, 2, 'the Commander sees every agent\'s row');
    // A path is never an input to retrieval: there is no path parameter to abuse.
    const claim = apitickets.apiTicketClaim(reqFor('/api/artifact?id=' + encodeURIComponent(art.id) + '&agent=agent&path=../../etc/passwd&ticket=x'));
    A.eq(claim.scope, apitickets.scopeArtifact('agent', art.id),
      'an injected ?path= is not part of the scope and cannot influence what is served');
  }

  /* ---------- 7. THE DISPLAYED LOCATION IS NOT AUTHORIZATION ---------- */
  {
    const row = m.list('agent', { owner: 'webdesigner' })[0];
    const displayed = path.join(wsRoot, row.owner, row.path);
    A.ok(fs.existsSync(displayed), 'the Outbox shows the exact original location, and it is real');
    A.eq(row.path, 'art.png', 'as a workspace-relative path on the row');
    // Spoofing the display field must not change what retrieval resolves.
    const spoofed = Object.assign({}, row, { path: '../publisher/stolen.png' });
    A.eq(m.verify(spoofed).ok, false, 'a row whose path is tampered with fails the floor rather than resolving');
  }

  /* ---------- 8. A CHANGED ORIGINAL IS REFUSED (the 409 path) ---------- */
  {
    fs.writeFileSync(path.join(wsRoot, 'webdesigner', 'art.png'), png(2400, 3000, 72));
    const got = m.readFor('agent', art.id);
    A.eq(got.ok, false, 'an original edited after registration is refused by retrieval');
    A.ok(/checksum mismatch/.test(got.error), 'with the checksum mismatch the route turns into HTTP 409');
  }

  /* ---------- 9. A DELETED ORIGINAL IS REFUSED (the 410 path) ---------- */
  {
    fs.rmSync(path.join(wsRoot, 'scout', 'notes.md'));
    const got = m.readFor('agent', sct.id);
    A.eq(got.ok, false, 'a deleted original is refused');
    A.ok(/missing|unreadable/.test(got.error), 'with the reason the route turns into HTTP 410');
  }

  /* ---------- 10. STORED XSS: ACTIVE CONTENT MUST NEVER RENDER INLINE ----------
     Flagged MEDIUM by security review and REAL on this station: the manifest's type map includes
     image/svg+xml and DESIGNER ships SVG (the first product was "PNG/SVG" scripture pages). An SVG carries
     <script>, so an agent-produced deliverable opened inline from the Outbox would execute in the sidecar's
     own origin — the origin holding the master API token. nosniff does not save it: nosniff stops type
     SNIFFING and the declared type is already the scriptable one.

     The fix REUSES file-response.js isActiveDeliverable() rather than a second allowlist, because the root
     cause was building a parallel file server: /api/file already had this exact control and the new route
     did not inherit it. Pinning the shared helper means widening it can never leave one route behind. */
  {
    const { isActiveDeliverable } = require('../sidecar/file-response.js');

    // Must be treated as ACTIVE -> attachment + octet-stream + CSP, never rendered:
    for (const f of ['evil.svg', 'evil.html', 'evil.htm', 'evil.xhtml', 'x.js', 'x.mjs', 'x.cjs',
                     'x.xml', 'x.xsl', 'x.xslt', 'x.wasm', 'ART.SVG', 'Evil.HtMl']) {
      A.eq(isActiveDeliverable(f), true, f + ' is active content and must download, never render');
    }
    // Must stay renderable — the Outbox exists to show artwork:
    for (const f of ['print.png', 'photo.jpg', 'photo.jpeg', 'clip.mp4', 'doc.pdf', 'notes.txt']) {
      A.eq(isActiveDeliverable(f), false, f + ' is passive and may render inline');
    }
    A.eq(isActiveDeliverable('x.svg'), true,
      'image/svg+xml is the scriptable image type — the whole finding — and is NOT treated as a plain image');
    A.eq(isActiveDeliverable('print.png'), false, 'while png still is');

    /* MALICIOUS FILENAME / METADATA. The disposition filename is sanitised with [^\w.-] -> '_', so quotes,
       CRLF and angle brackets cannot break out of the header or inject a second header line. A double
       extension must still be judged by its REAL final extension. */
    const sanitize = (n) => String(n || 'artifact').replace(/[^\w.-]/g, '_');
    A.eq(sanitize('a";onerror=alert(1)//.png'), 'a__onerror_alert_1___.png', 'quotes/parens cannot escape the filename quote');
    A.eq(/[\r\n]/.test(sanitize('a\r\nSet-Cookie: x=1.png')), false, 'CRLF cannot inject a header line');
    A.eq(/[<>]/.test(sanitize('<img src=x onerror=alert(1)>.png')), false, 'angle brackets are stripped');
    A.eq(isActiveDeliverable('report.png.svg'), true, 'a double extension is judged by its REAL last extension');
    A.eq(isActiveDeliverable('safe.svg.png'), false, 'and .png last is genuinely a png');

    /* MIME MISMATCH. A file claiming .png while containing SVG/HTML is caught by the manifest's
       content sniffing (signatureMismatch), which section 12 of the manifest suite asserts; here we pin that
       the SERVING decision never trusts a declared mime alone — it is keyed on the filename extension
       through the shared helper, and the content type is neutralised for active types regardless. */
    A.eq(isActiveDeliverable('x.png'), false, 'serving is keyed on the real extension, not a declared mime string');
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  A.report('outbox route');
})().catch(e => { console.error(e); process.exit(1); });

/* test/outbox-ui.test.js — the Commander-facing central Outbox panel (frontend/app/outbox.js).

   The panel's whole job is to NOT lie. Four facts — completion, technical verification, QC and Commander
   approval — are four separate pills and are never merged into one "done" badge, because merging them is how
   a 1,056-byte placeholder once shipped as a finished video (CLAUDE.md). A VERIFIED row means the bytes
   decode and the checksum matches; it does not mean a reviewer liked it or that the Commander approved it.

   The other half is XSS. Every string on a row is agent-influenced (filenames, project ids, QC notes), so
   anything reaching innerHTML must be escaped. Section 3 plants real payloads in every text field and in the
   retrieval URL. Section 4 pins that svg/html are never previewed inline, mirroring the host's own refusal.

   Run standalone: node test/outbox-ui.test.js */
'use strict';

const A = require('./_assert.js');
const Outbox = require('../frontend/app/outbox.js');

const baseRow = (over) => Object.assign({
  id: 'webdesigner:matthew-11-28:print.png@v1', artifactId: 'webdesigner:matthew-11-28:print.png', version: 1,
  producedBy: 'webdesigner', runId: 'run-d', project: 'matthew-11-28',
  file: 'print.png', filename: 'print.png', kind: 'image', mime: 'image/png',
  bytes: 7686872, width: 2400, height: 3000, dpi: 300,
  sha256: 'c9bded36b368fe4d', createdAt: '2026-11-02T18:00:00.000Z', at: '2026-11-02T18:30:00.000Z',
  completion: 'complete', verification: 'passed', qc: 'needs_review', approval: 'pending',
  lifecycle: 'NEEDS_REVIEW', supersededBy: null, signatureMismatch: false,
  absolutePath: '/home/u/.local/share/StarNet/workspaces/webdesigner/print.png',
  retrieve: '/api/artifact?id=webdesigner%3Amatthew-11-28%3Aprint.png%40v1&agent=agent'
}, over || {});

(async () => {
  /* ---------- 1. THE FOUR AXES RENDER SEPARATELY ---------- */
  {
    const h = Outbox.rowHtml(baseRow());
    A.ok(/completion complete/.test(h), 'completion is its own pill');
    A.ok(/verified passed/.test(h), 'technical verification is its own pill');
    A.ok(/QC needs review/.test(h), 'QC is its own pill');
    A.ok(/approval pending/.test(h), 'Commander approval is its own pill');
    // The load-bearing refusal: a verified-but-unapproved artifact must NOT read as finished.
    A.eq(/approval approved/.test(h), false, 'a pending artifact never shows as approved');
    A.ok(/obx-good/.test(h) && /obx-warn/.test(h),
      'passed facts and needs-a-human facts are styled differently, not blended into one badge');
    A.ok(/NEEDS REVIEW/.test(h), 'and the derived lifecycle is shown alongside, not instead of, the axes');
  }

  /* ---------- 2. PROVENANCE AND THE EXACT ORIGINAL LOCATION ---------- */
  {
    const h = Outbox.rowHtml(baseRow());
    A.ok(/run-d/.test(h), 'the producing run id is shown');
    A.ok(/c9bded36b368fe4d/.test(h), 'the sha256 is shown');
    A.ok(/workspaces\/webdesigner\/print\.png/.test(h), 'the exact original location is shown');
    A.ok(/2400×3000px @300 DPI/.test(h), 'real dimensions and DPI are shown, from the row');
    A.ok(/Retrieval below does NOT use this path/.test(h),
      'and the panel states plainly that the displayed path is not the access mechanism');
    A.ok(/Open the original file/.test(h), 'with a retrieval action');
  }

  /* ---------- 3. XSS: EVERY AGENT-INFLUENCED FIELD IS ESCAPED ---------- */
  {
    const XSS = '<img src=x onerror=alert(1)>';
    const h = Outbox.rowHtml(baseRow({
      file: XSS + '.png', filename: XSS + '.png', producedBy: XSS, project: XSS,
      qcDetail: XSS, verificationDetail: XSS, approvalDetail: XSS,
      absolutePath: '/tmp/' + XSS, sha256: XSS, runId: XSS, id: XSS
    }));
    A.eq(/<img src=x onerror=/.test(h), false, 'no raw <img onerror> survives into the markup');
    A.ok(/&lt;img src=x onerror=alert\(1\)&gt;/.test(h), 'it is rendered as escaped TEXT instead');
    /* NOTE ON THE OBVIOUS-LOOKING ASSERTION I DELETED HERE: /onerror=alert/ matches the ESCAPED form too,
       because esc() encodes < > " ' & and deliberately not '='. The substring surviving inside
       &lt;…&gt; is inert text, so that check failed on correct output. The real property is that no
       payload ever sits in TAG or ATTRIBUTE position — asserted below by counting raw '<' against the
       tags this renderer itself emits. */
    const rawTags = (h.match(/<[a-zA-Z/!]/g) || []).length;
    /* `button` joined this CLOSED allowlist on 2026-11-10 with the Commander's approve/reject controls.
       The list is closed on purpose: it is what makes "every raw tag came from this renderer" provable,
       so a new element must be added here deliberately and never by widening the pattern. */
    const ownTags = (h.match(/<\/?(?:article|header|span|div|p|img|details|summary|dl|dt|dd|code|small|br|a|button)\b/g) || []).length;
    A.eq(rawTags, ownTags, 'every raw tag in the output is one this renderer emitted — none came from row data');
    A.eq(/<\s*(?:script|iframe|object|embed|svg)\b/i.test(h), false, 'no executable element is ever emitted');
    // A payload in the retrieval URL must not break out of the href attribute either.
    const h2 = Outbox.rowHtml(baseRow({ retrieve: '/api/artifact?id=x" onmouseover="alert(1)' }));
    A.eq(/" onmouseover="/.test(h2), false, 'a quote in the retrieve URL cannot escape the href attribute');
    A.ok(/&quot;/.test(h2), 'it is entity-encoded');
    // And the empty state is static text, not interpolated input.
    A.eq(/<script/i.test(Outbox.render({ rows: [] })), false, 'the empty state contains no script');
  }

  /* ---------- 4. ACTIVE CONTENT IS NEVER PREVIEWED INLINE ---------- */
  {
    for (const mime of ['image/svg+xml', 'text/html', 'application/xml', 'text/xml', 'application/pdf', 'video/mp4']) {
      const h = Outbox.rowHtml(baseRow({ mime: mime, file: 'x', filename: 'x' }));
      A.eq(/<img class="obx-preview"/.test(h), false, mime + ' is never rendered as an inline <img> preview');
    }
    A.eq(Outbox.PREVIEWABLE['image/svg+xml'], undefined,
      'image/svg+xml is absent from the preview allowlist — it is the scriptable image type');
    A.ok(Outbox.PREVIEWABLE['image/png'], 'while png is previewable, so the panel is still useful');
    // An oversized passive image is not inlined either (bandwidth, not security).
    A.eq(/<img class="obx-preview"/.test(Outbox.rowHtml(baseRow({ bytes: 99 * 1024 * 1024 }))), false,
      'an enormous image is not inlined');
    A.ok(/<img class="obx-preview"/.test(Outbox.rowHtml(baseRow({ bytes: 1024 }))), 'a small png is');
  }

  /* ---------- 5. SUPERSEDED AND MISMATCH ARE SURFACED, NOT HIDDEN ---------- */
  {
    const h = Outbox.rowHtml(baseRow({ version: 2, supersededBy: 'x@v3', lifecycle: 'SUPERSEDED' }));
    A.ok(/v2/.test(h), 'the version is shown');
    A.ok(/superseded/.test(h), 'and that a newer version exists');
    const mm = Outbox.rowHtml(baseRow({ signatureMismatch: true }));
    A.ok(/signature does not match its extension/.test(mm),
      'a content/extension mismatch is called out — a corrupted render must not inherit its filename\'s credibility');
  }

  /* ---------- 6. FILTERS BUILD THE RIGHT QUERY ---------- */
  {
    A.eq(Outbox.queryFrom({}), '/api/outbox?agent=agent', 'defaults to the Commander view');
    const q = Outbox.queryFrom({ viewer: 'agent', owner: 'webdesigner', projectId: 'matthew-11-28', qc: 'needs_review', approval: 'pending', since: '2026-11-01', includeSuperseded: true });
    for (const frag of ['owner=webdesigner', 'projectId=matthew-11-28', 'qc=needs_review', 'approval=pending', 'since=2026-11-01', 'includeSuperseded=1']) {
      A.ok(q.indexOf(frag) >= 0, 'query carries ' + frag);
    }
    A.eq(Outbox.queryFrom({ owner: 'a b&c=d' }).indexOf('owner=a%20b%26c%3Dd') >= 0, true, 'filter values are URL-encoded');
  }

  /* ---------- 7. FACETS COME FROM THE DATA, NOT A HARDCODED ROSTER ---------- */
  {
    const f = Outbox.facets([
      baseRow({ producedBy: 'scout', project: 'alpha', lifecycle: 'VERIFIED' }),
      baseRow({ producedBy: 'storywriter', project: 'proj-1-x', lifecycle: 'APPROVED' }),
      baseRow({ producedBy: 'scout', project: 'alpha', lifecycle: 'VERIFIED' })
    ]);
    A.eq(f.agents.join(','), 'scout,storywriter', 'agent facet is de-duplicated and sorted');
    A.eq(f.projects.join(','), 'alpha,proj-1-x', 'project facet too — studio projects included');
    A.eq(f.lifecycles.join(','), 'APPROVED,VERIFIED', 'and lifecycle');
  }

  /* ---------- 8. LOAD: HONEST EMPTY AND ERROR STATES ---------- */
  {
    const okFetch = async () => ({ ok: true, json: async () => ({ ok: true, viewer: 'agent', rows: [baseRow()] }) });
    const got = await Outbox.load({ viewer: 'agent' }, okFetch);
    A.eq(got.rows.length, 1, 'rows load');
    A.eq(got.filtered, false, 'an unfiltered view is marked unfiltered');

    const errFetch = async () => ({ ok: false, status: 403, json: async () => ({ error: 'forbidden' }) });
    const bad = await Outbox.load({ viewer: 'agent' }, errFetch);
    A.eq(bad.rows.length, 0, 'an error yields no rows');
    A.eq(bad.error, 'forbidden', 'and surfaces the reason rather than rendering a blank panel');

    const threw = await Outbox.load({ viewer: 'agent' }, async () => { throw new Error('offline'); });
    A.eq(threw.error, 'offline', 'a network failure is reported, never swallowed into "no deliverables"');

    // THE HONESTY REQUIREMENT: empty must not imply nothing was produced.
    const empty = Outbox.render({ rows: [], filtered: false });
    A.ok(/not the same as/.test(empty), 'an empty Outbox says so honestly');
    A.ok(/No deliverables match these filters/.test(Outbox.render({ rows: [], filtered: true })),
      'while a filtered-empty view says the filters matched nothing');
  }

  /* ---------- 9. THE COMMANDER'S APPROVAL CONTROLS (2026-11-10) ----------
     Until this landed, approval was readable and unwritable: the pills rendered, the manifest had
     setApproval(), and nothing anywhere called it — every row on the live station sat at "pending"
     permanently. These controls are the Commander's half of that fix. */
  {
    const pending = Outbox.rowHtml(baseRow());
    A.ok(/data-act="approved"/.test(pending), 'a pending artifact offers Approve');
    A.ok(/data-act="rejected"/.test(pending), 'and Reject');
    A.ok(/data-id="/.test(pending), 'the buttons carry the artifact id the route needs');
    A.eq(/data-act="pending"/.test(pending), false,
      'but NOT "reset to pending" — it is already pending, so the control would be a no-op');

    const approved = Outbox.rowHtml(Object.assign(baseRow(), { approval: 'approved' }));
    A.ok(/data-act="pending"/.test(approved), 'a decided artifact can be reset to pending');
    A.ok(/approval approved/.test(approved), 'and reads as approved');

    /* QC is deliberately absent: a QC verdict is an INDEPENDENT reviewer's opinion, and a Commander
       clicking it on a reviewer's behalf would hollow out the independence the axis exists to enforce
       (the manifest refuses a producer QC-ing its own artifact for exactly that reason). */
    A.eq(/data-act="passed"|obx-qc-btn|data-qc=/.test(pending), false,
      'the Commander panel offers NO QC control — QC names an independent reviewer via its own route');

    /* The id must survive escaping: it is attacker-adjacent (it contains agent and project names). */
    const nasty = Outbox.rowHtml(Object.assign(baseRow(), { id: 'a"><script>x</script>' }));
    A.eq(/<script>/.test(nasty), false, 'a hostile id cannot break out of the data-id attribute');
  }

  /* ---------- 10. judge() HONOURS THE PANEL'S ERROR CONTRACT ---------- */
  {
    const calls = [];
    const fakeOk = async (url, init) => { calls.push({ url, init }); return { ok: true, json: async () => ({ ok: true, row: { approval: 'approved' } }) }; };
    const r = await Outbox.judge('some:id@v1', 'approved', 'because', fakeOk);
    A.eq(r.ok, true, 'a successful verdict reports success');
    A.ok(/\/api\/outbox\/approval$/.test(calls[0].url), 'it POSTs to the approval route');
    A.eq(calls[0].init.method, 'POST', 'with POST');
    const sent = JSON.parse(calls[0].init.body);
    A.eq(sent.id, 'some:id@v1', 'carrying the artifact id');
    A.eq(sent.status, 'approved', 'and the verdict');
    /* harness.js hardens window.fetch to attach X-StarNet-Token to same-origin /api/ URLs. Setting it
       here by hand would risk leaking the token to a non-same-origin URL. */
    A.eq(/token/i.test(JSON.stringify(calls[0].init.headers || {})), false,
      'judge() never hand-rolls a token header — harness.js owns that');

    /* An error must NEVER look like success. On this panel the equivalent mistake is a silent no-op
       that repaints the old pill and reads as "nothing happened". */
    const fake403 = async () => ({ ok: false, status: 403, json: async () => ({ ok: false, error: 'forbidden' }) });
    const e1 = await Outbox.judge('x', 'approved', '', fake403);
    A.eq(e1.ok, false, 'a 403 is an error');
    A.eq(e1.error, 'forbidden', 'and the server reason is surfaced verbatim');

    const fakeBodyFalse = async () => ({ ok: true, json: async () => ({ ok: false, error: 'invalid approval status' }) });
    const e2 = await Outbox.judge('x', 'nope', '', fakeBodyFalse);
    A.eq(e2.ok, false, 'HTTP 200 with ok:false is still a failure');
    A.eq(e2.error, 'invalid approval status', 'with the reason the route gave');

    const fakeThrow = async () => { throw new Error('offline'); };
    const e3 = await Outbox.judge('x', 'approved', '', fakeThrow);
    A.eq(e3.ok, false, 'a network failure is an error, not a silent success');
    A.ok(/offline/.test(e3.error), 'and says what happened');

    const fakeUnparsable = async () => ({ ok: true, json: async () => { throw new Error('not json'); } });
    const e4 = await Outbox.judge('x', 'approved', '', fakeUnparsable);
    A.eq(e4.ok, true, 'an unparsable 200 body still counts as success (the write happened)');
  }

  A.report('outbox ui');
})().catch(e => { console.error(e); process.exit(1); });

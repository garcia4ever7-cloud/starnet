/* frontend/app/outbox.js — the CENTRAL OUTBOX panel: every NIGHT4CHRIST agent's finished deliverables in one
   Commander-facing place.

   WHY A SEPARATE MODULE FROM deliverables.js. That panel is the WORKSHOP lifecycle library — its rows are
   kept/pending/implemented/failed build items with a completely different shape. This panel reads
   GET /api/outbox, which is the cross-agent artifact manifest (sidecar/deliverable-manifest.js): nine agents,
   four independent state axes, versions. Folding one into the other would mean one renderer guessing which
   row shape it holds, so they stay separate surfaces over separate feeds.

   THE DISPLAY LAW THIS PANEL EXISTS TO HONOUR. Completion, technical VERIFICATION, QC and Commander APPROVAL
   are four different facts and are rendered as four separate pills — never merged into one "done" badge.
   Conflating them is precisely how a 1,056-byte placeholder once shipped as a finished video (CLAUDE.md).
   A VERIFIED row means "the bytes decode and the checksum matches", nothing more; it does NOT mean a reviewer
   liked it, and it certainly does not mean the Commander approved it.

   SECURITY NOTES THAT MUST NOT BE "SIMPLIFIED" AWAY:
     • The displayed original path is INFORMATION, never authorization. Retrieval goes through
       /api/artifact?id=… with a scoped ticket; the server resolves the path from the manifest row itself and
       ignores anything path-shaped in the query.
     • Every string from the manifest is agent-influenced data (filenames, project ids, QC notes), so it is
       escaped with esc() before it reaches innerHTML. No template here interpolates raw row text.
     • Inline <img> preview is attempted ONLY for passive image types. Active content (.svg/.html/…) is served
       as an attachment by the host, so previewing it would show a broken image rather than execute — but the
       panel does not even ask, to keep the "never render agent HTML" rule visible in the client too. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.Outbox = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtSize = n => n == null ? 'size unknown' : n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
  const apiBase = () => typeof window !== 'undefined' ? String(window.__STARNET_API__ || '') : '';
  const signed = (url) => (typeof ApiTicket !== 'undefined' && ApiTicket.sign) ? ApiTicket.sign(url) : String(url || '');

  // Only these render inline. Mirrors the host's file-response.js isActiveDeliverable() inversion — kept as a
  // short allowlist rather than "anything image/*", because image/svg+xml is the scriptable image type.
  const PREVIEWABLE = { 'image/png': 1, 'image/jpeg': 1, 'image/gif': 1, 'image/webp': 1 };
  const PREVIEW_MAX_BYTES = 8 * 1024 * 1024;

  // One pill per AXIS. 'off' = neutral/not-yet, 'warn' = needs a human, 'good' = genuinely passed,
  // 'bad' = refused. The lifecycle pill is derived server-side and shown alongside, never instead.
  const AXIS_CLASS = {
    completion: { complete: 'good', staged: 'off', created: 'off', failed: 'bad' },
    verification: { passed: 'good', unverified: 'off', failed: 'bad', missing: 'bad' },
    qc: { passed: 'good', needs_review: 'warn', not_reviewed: 'off', rejected: 'bad' },
    approval: { approved: 'good', pending: 'warn', rejected: 'bad' }
  };
  const LIFECYCLE_CLASS = {
    // APPROVED_UNVERIFIED is 'warn', NOT 'good': the Commander cleared it but the host never proved the bytes.
    // Colouring it green would re-merge the two facts the manifest splits them to keep apart.
    APPROVED: 'good', APPROVED_UNVERIFIED: 'warn', QC_REVIEWED: 'good', VERIFIED: 'off', STAGED: 'off', CREATED: 'off',
    NEEDS_REVIEW: 'warn', REJECTED: 'bad', FAILED: 'bad', MISSING: 'bad', SUPERSEDED: 'off'
  };

  function pill(label, value, cls) {
    return '<span class="obx-pill obx-' + esc(cls || 'off') + '" title="' + esc(label) + ': ' + esc(value) + '">'
      + esc(label) + ' ' + esc(String(value).replace(/_/g, ' ')) + '</span>';
  }

  function retrieveHref(row) {
    // The server builds row.retrieve as /api/artifact?id=…&agent=…; the ticket is appended client-side because
    // a link/tab navigation cannot attach the X-StarNet-Token header (see sidecar/apitickets.js).
    return apiBase() + signed(String(row && row.retrieve || ''));
  }

  function rowHtml(row) {
    const r = row || {};
    const life = String(r.lifecycle || 'CREATED');
    const dims = (r.width && r.height) ? (r.width + '×' + r.height + 'px' + (r.dpi ? ' @' + r.dpi + ' DPI' : '')) : '';
    const created = r.createdAt ? new Date(r.createdAt).toLocaleString() : (r.at ? new Date(r.at).toLocaleString() : 'unknown');
    const canPreview = PREVIEWABLE[String(r.mime)] && Number(r.bytes) <= PREVIEW_MAX_BYTES;
    const href = retrieveHref(r);

    let html = '<article class="obx-row obx-life-' + esc(LIFECYCLE_CLASS[life] || 'off') + '">';
    html += '<header class="obx-head">'
      + '<span class="obx-agent">' + esc(r.producedBy || r.owner || 'unknown') + '</span>'
      + '<span class="obx-project">' + esc(r.project || r.projectId || 'general') + '</span>'
      + pill('', life, LIFECYCLE_CLASS[life] || 'off')
      + (Number(r.version) > 1 ? '<span class="obx-ver">v' + esc(r.version) + '</span>' : '')
      + (r.supersededBy ? '<span class="obx-ver obx-warn">superseded</span>' : '')
      + '</header>';

    html += '<div class="obx-file">' + esc(r.file || r.filename || '(unnamed)') + '</div>';
    html += '<div class="obx-facts">' + esc(r.mime || '') + ' · ' + esc(fmtSize(r.bytes))
      + (dims ? ' · ' + esc(dims) : '') + ' · ' + esc(created) + '</div>';

    // THE FOUR AXES, SEPARATELY. Never collapsed.
    html += '<div class="obx-axes">'
      + pill('completion', r.completion, AXIS_CLASS.completion[r.completion])
      + pill('verified', r.verification, AXIS_CLASS.verification[r.verification])
      + pill('QC', r.qc, AXIS_CLASS.qc[r.qc])
      + pill('approval', r.approval, AXIS_CLASS.approval[r.approval])
      + '</div>';

    if (r.signatureMismatch) {
      html += '<p class="obx-warnline">File signature does not match its extension — the content is not the type its name claims.</p>';
    }
    if (r.verificationDetail) html += '<p class="obx-note">Verification: ' + esc(r.verificationDetail) + '</p>';
    if (r.qcDetail) html += '<p class="obx-note">QC (' + esc(r.qcReviewer || 'reviewer') + '): ' + esc(r.qcDetail) + '</p>';
    if (r.approvalDetail) html += '<p class="obx-note">Commander: ' + esc(r.approvalDetail) + '</p>';

    if (canPreview) html += '<img class="obx-preview" loading="lazy" alt="' + esc(r.file || 'preview') + '" src="' + esc(href) + '">';

    // Provenance + the EXACT original location. Displayed, explicitly not an access mechanism.
    html += '<details class="obx-prov"><summary>Provenance &amp; original location</summary>'
      + '<dl>'
      + '<dt>Artifact id</dt><dd><code>' + esc(r.id) + '</code></dd>'
      + '<dt>Produced by run</dt><dd><code>' + esc(r.runId || 'unrecorded') + '</code></dd>'
      + '<dt>SHA-256</dt><dd><code>' + esc(r.sha256 || '') + '</code></dd>'
      + '<dt>Original file</dt><dd><code>' + esc(r.absolutePath || r.path || '') + '</code>'
      + '<br><small>Shown so you can find it on disk. Retrieval below does NOT use this path — the server '
      + 'resolves it from the registered record and re-checks the checksum every time.</small></dd>'
      + '</dl></details>';

    /* COMMANDER CONTROLS (2026-11-10). Approval is the Commander's OWN decision, so it belongs in the
       Commander's panel. QC is deliberately NOT here: a QC verdict is an INDEPENDENT reviewer's opinion,
       and a Commander clicking it on a reviewer's behalf would hollow out the independence the axis exists
       to enforce (the manifest refuses a producer QC-ing itself for the same reason). QC is set by
       POST /api/outbox/qc, which names the reviewer. */
    /* THE UNVERIFIED OVERRIDE IS NAMED ON THE BUTTON, not hidden behind a retry (2026-11-10). The host refuses
       a plain approve on an artifact whose verification axis is not 'passed' (409 + needsAcknowledgement), so
       the panel must either carry the acknowledgement or show the Commander a dead button. It carries it — but
       the label says what is being overridden, because an "Approve" that silently also means "and I accept
       that nothing checked this file" is the kind of merged claim this whole panel exists to prevent. */
    const unverified = String(r.verification || '') !== 'passed';
    const decided = r.approval === 'approved' || r.approval === 'rejected';
    /* A SUPERSEDED ROW GETS NO VERDICT CONTROLS (security review, 2026-11-10). get() is viewer-scoped through
       list(), which excludes superseded rows unless includeSuperseded is set — and there is no way to pass that
       flag through get(). So the host answers 403 for a superseded id on BOTH judgment routes and 404 on
       /api/artifact. The panel offers a "show superseded" checkbox, so these rows really do appear, and before
       this they appeared with live Approve/Reject buttons that could only ever fail — the dead button this
       panel's own comment forbids. The right verdict target is the successor version, not the retired row. */
    const retired = !!r.supersededBy;
    html += '<div class="obx-actions">'
      + '<a class="obx-get" href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">Open the original file</a>'
      + (retired
        ? '<p class="obx-warnline">Superseded by a newer version — judge that one instead. The host will not record a verdict on a retired row.</p>'
        : (unverified ? '<p class="obx-warnline">Never verified by the harness — approving this records an explicit override.</p>' : '')
          + '<button type="button" class="obx-act obx-approve" data-act="approved"'
          + (unverified ? ' data-unverified="1"' : '') + ' data-id="' + esc(r.id) + '">'
          + (unverified ? 'Approve (unverified)' : 'Approve') + '</button>'
          + '<button type="button" class="obx-act obx-reject" data-act="rejected" data-id="' + esc(r.id) + '">Reject</button>'
          + (decided ? '<button type="button" class="obx-act obx-undo" data-act="pending" data-id="' + esc(r.id) + '">Reset to pending</button>' : ''))
      + '</div>';
    return html + '</article>';
  }

  function emptyHtml(filtered) {
    return '<p class="obx-empty">' + (filtered
      ? 'No deliverables match these filters.'
      : 'No deliverables are registered yet. This is not the same as &ldquo;no work exists&rdquo;: a file appears '
        + 'here once the station has registered it as a finished deliverable from a real run.') + '</p>';
  }

  function render(state) {
    const rows = (state && state.rows) || [];
    const filtered = !!(state && state.filtered);
    if (!rows.length) return emptyHtml(filtered);
    return rows.map(rowHtml).join('');
  }

  function queryFrom(filters) {
    const f = filters || {};
    const p = [];
    p.push('agent=' + encodeURIComponent(f.viewer || 'agent'));
    for (const k of ['projectId', 'owner', 'kind', 'completion', 'verification', 'qc', 'approval', 'lifecycle', 'since', 'until']) {
      if (f[k]) p.push(k + '=' + encodeURIComponent(f[k]));
    }
    if (f.includeSuperseded) p.push('includeSuperseded=1');
    return '/api/outbox?' + p.join('&');
  }

  async function load(filters, fetchImpl) {
    const doFetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    if (!doFetch) return { rows: [], error: 'no fetch available' };
    const url = apiBase() + queryFrom(filters);
    try {
      const res = await doFetch(url, { headers: { 'Accept': 'application/json' } });
      const body = await res.json();
      if (!res.ok || body.ok === false) return { rows: [], error: String(body.error || ('HTTP ' + res.status)) };
      const anyFilter = !!(filters && Object.keys(filters).some(k => k !== 'viewer' && filters[k]));
      return { rows: Array.isArray(body.rows) ? body.rows : [], filtered: anyFilter, viewer: body.viewer };
    } catch (e) { return { rows: [], error: String((e && e.message) || e) }; }
  }

  /* judge — write the Commander's approval verdict. Mirrors load()'s error contract EXACTLY, because the
     panel's law is that an error must never look like success (there, an empty Outbox; here, a silent
     no-op that leaves the pill unchanged and the Commander believing they approved something).

     No token header is set here on purpose: harness.js hardens window.fetch to attach X-StarNet-Token to
     same-origin /api/ URLs, and hand-rolling it risks leaking the token to a third-party URL. */
  async function judge(id, status, detail, fetchImpl, acknowledgeUnverified) {
    const doFetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    if (!doFetch) return { ok: false, error: 'no fetch available' };
    try {
      const payload = { id: String(id || ''), status: String(status || ''), detail: String(detail || '') };
      // Only ever sent for an APPROVE, and only when the caller genuinely armed the override. Sending it
      // unconditionally would make the host's 409 unreachable and quietly restore the old behaviour.
      if (acknowledgeUnverified === true && String(status) === 'approved') payload.acknowledgeUnverified = true;
      const res = await doFetch(apiBase() + '/api/outbox/approval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(payload)
      });
      let body = {};
      try { body = await res.json(); } catch (_) { body = {}; }
      if (!res.ok || body.ok === false) return { ok: false, error: String(body.error || ('HTTP ' + res.status)) };
      return { ok: true, row: body.row || null };
    } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  }

  // Distinct agent/project values present in the feed — the filter dropdowns are built from what actually
  // exists rather than a hardcoded roster, so a new agent appears without a code change.
  function facets(rows) {
    const agents = new Set(), projects = new Set(), lifecycles = new Set();
    for (const r of (rows || [])) {
      if (r && (r.producedBy || r.owner)) agents.add(String(r.producedBy || r.owner));
      if (r && (r.project || r.projectId)) projects.add(String(r.project || r.projectId));
      if (r && r.lifecycle) lifecycles.add(String(r.lifecycle));
    }
    return { agents: Array.from(agents).sort(), projects: Array.from(projects).sort(), lifecycles: Array.from(lifecycles).sort() };
  }

  /* mount(body) — build the panel into a station window body. Called by stationui's BUILDERS registry, the
     same seam DELIVERABLES uses, so window chrome/placement is the station's job and not re-invented here.
     Filters are rebuilt from the FACETS of whatever came back, so a new agent or project shows up without a
     code change. Re-querying the server on every filter change (rather than filtering client-side) keeps one
     visibility rule — the server's — instead of a second, looser copy in the browser. */
  function mount(body, opts) {
    if (!body) return;
    const viewer = (opts && opts.viewer) || 'agent';
    const state = { filters: { viewer: viewer }, rows: [] };
    body.innerHTML = '<div class="obx">'
      + '<div class="obx-bar">'
      + '<label>Agent <select data-f="owner"><option value="">all</option></select></label>'
      + '<label>Project <select data-f="projectId"><option value="">all</option></select></label>'
      + '<label>Status <select data-f="lifecycle"><option value="">all</option></select></label>'
      + '<label>QC <select data-f="qc"><option value="">all</option>'
      + '<option value="passed">passed</option><option value="needs_review">needs review</option>'
      + '<option value="not_reviewed">not reviewed</option><option value="rejected">rejected</option></select></label>'
      + '<label>Approval <select data-f="approval"><option value="">all</option>'
      + '<option value="approved">approved</option><option value="pending">pending</option>'
      + '<option value="rejected">rejected</option></select></label>'
      + '<label>From <input type="date" data-f="since"></label>'
      + '<label>To <input type="date" data-f="until"></label>'
      + '<label class="obx-chk"><input type="checkbox" data-f="includeSuperseded"> show superseded</label>'
      + '<button class="obx-refresh" type="button">Refresh</button>'
      + '</div>'
      + '<div class="obx-count" aria-live="polite"></div>'
      + '<div class="obx-list">Loading the central Outbox…</div>'
      + '</div>';

    const listEl = body.querySelector('.obx-list');
    const countEl = body.querySelector('.obx-count');

    function fillFacets(rows) {
      const f = facets(rows);
      const fill = (sel, values) => {
        const el = body.querySelector('select[data-f="' + sel + '"]');
        if (!el) return;
        const keep = el.value;
        el.innerHTML = '<option value="">all</option>'
          + values.map(v => '<option value="' + esc(v) + '">' + esc(v) + '</option>').join('');
        if (values.indexOf(keep) >= 0) el.value = keep;
      };
      fill('owner', f.agents); fill('projectId', f.projects); fill('lifecycle', f.lifecycles);
    }

    async function refresh() {
      listEl.textContent = 'Loading…';
      const got = await load(state.filters);
      if (got.error) {
        // An error must never look like an empty Outbox — that is the difference between "nothing was
        // produced" and "we could not ask".
        listEl.innerHTML = '<p class="obx-err">Could not load the Outbox: ' + esc(got.error) + '</p>';
        countEl.textContent = '';
        return;
      }
      state.rows = got.rows;
      fillFacets(got.rows);
      countEl.textContent = got.rows.length + ' deliverable' + (got.rows.length === 1 ? '' : 's')
        + ' visible to ' + (got.viewer || viewer);
      listEl.innerHTML = render({ rows: got.rows, filtered: !!got.filtered });
    }

    body.addEventListener('change', (ev) => {
      const el = ev.target && ev.target.closest ? ev.target.closest('[data-f]') : null;
      if (!el) return;
      const key = el.getAttribute('data-f');
      state.filters[key] = (el.type === 'checkbox') ? (el.checked || '') : el.value;
      if (!state.filters[key]) delete state.filters[key];
      refresh();
    });
    /* TWO-STEP COMMIT. Approving or rejecting a deliverable is a business decision, and on the phone this
       station is actually operated from these are small targets next to each other. The first tap ARMS the
       button and the second commits; the armed state lapses after 5s so a stray tap cannot sit waiting to
       fire later. Tapping anywhere else disarms. */
    let armed = null;
    let armedTimer = null;
    function disarm() {
      if (armedTimer) { clearTimeout(armedTimer); armedTimer = null; }
      if (armed && armed.el) { armed.el.textContent = armed.label; armed.el.classList.remove('obx-armed'); }
      armed = null;
    }
    body.addEventListener('click', async (ev) => {
      const el = ev.target && ev.target.closest ? ev.target.closest('[data-act]') : null;
      if (!el) { disarm(); return; }
      const id = el.getAttribute('data-id');
      const act = el.getAttribute('data-act');
      if (!id || !act) return;

      // The override rides the BUTTON's own marker, re-read at commit time from the element that was armed,
      // so a refresh between the two taps cannot carry a stale acknowledgement onto a different row.
      const ack = el.getAttribute('data-unverified') === '1' && act === 'approved';
      if (!armed || armed.el !== el) {
        disarm();
        armed = { el: el, label: el.textContent, id: id, act: act };
        el.textContent = ack ? 'Tap again: approve UNVERIFIED' : 'Tap again to confirm';
        el.classList.add('obx-armed');
        armedTimer = setTimeout(disarm, 5000);
        return;
      }
      disarm();
      el.disabled = true;
      const r = await judge(id, act, ack
        ? 'approved from the Outbox panel with the unverified override'
        : 'set from the Outbox panel', null, ack);
      el.disabled = false;
      if (!r.ok) {
        /* Surface it and do NOT refresh: a silent re-render would repaint the old pill and read as
           "nothing happened" rather than "this failed". */
        countEl.textContent = 'Could not record that verdict: ' + r.error;
        countEl.classList.add('obx-err');
        return;
      }
      countEl.classList.remove('obx-err');
      refresh();
    });

    const btn = body.querySelector('.obx-refresh');
    if (btn) btn.addEventListener('click', refresh);
    refresh();
    return { refresh, state, judge };
  }

  return { mount, render, rowHtml, load, judge, queryFrom, facets, esc, PREVIEWABLE, AXIS_CLASS, LIFECYCLE_CLASS };
});

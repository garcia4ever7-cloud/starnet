/* sidecar/tools/builtin/outbox.js — the CONSUMER side of the central Outbox: how an agent reads a deliverable
   another agent produced, without ever reaching into that agent's private workspace.

   WHY IT EXISTS. Live run dc3e312b (2026-11-02): DESIGNER produced genuine 300-DPI print files and PUBLISHER
   then drafted nothing — "The PNGs are in DESIGNER's workspace, which PUBLISHER cannot read." That is correct
   behaviour, not a bug: fs.* is jailed per agent and pathtrust.js refuses a cross-agent grant outright
   ("standing grants and Full Access do NOT override ownership beneath this root"; an autonomous run is "a HARD
   DENY with NO prompt"). The jail must stay. So this tool is the narrow, published door instead.

   THE SHAPE OF THE PERMISSION. Both tools are scope:'read', requiresConsent:false, network:false — they reach
   no third party, spend nothing, and write nothing. They cannot take a PATH: `outbox_read` accepts a manifest
   ID only, so an agent cannot phrase a request for a file that was not published to it, and the authorization
   never depends on a string the model chose. Everything outside the manifest stays exactly as private as it
   was before this file existed.

   WHAT IT DELIBERATELY CANNOT DO: write, delete, move, re-register, set QC, or approve. A producer still
   cannot QC its own artifact (deliverable-manifest.setQc refuses it) and no agent can approve anything — that
   is the Commander's axis alone. This door is read-only in both directions.

   makeOutboxTools({ manifest, maxInlineBytes? }) -> { register(reg) } */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).outboxTools = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // A 28MB print master must never be inlined into a model's context. Text deliverables (a brief, a listing
  // draft, a QC report) are the ones an agent can actually use as TEXT; anything binary comes back as facts
  // plus the retrieval id, which is what a consumer needs in order to reference it.
  const MAX_INLINE_BYTES = 256 * 1024;
  const TEXTUAL = /^(text\/|application\/json$)/;

  function makeOutboxTools(deps) {
    deps = deps || {};
    const manifest = deps.manifest;
    if (!manifest) throw new Error('outbox.js requires { manifest }');
    const maxInline = Number(deps.maxInlineBytes) > 0 ? Number(deps.maxInlineBytes) : MAX_INLINE_BYTES;

    const describe = (r) => ({
      id: r.id, artifactId: r.artifactId, version: r.version,
      producedBy: r.owner, runId: r.runId, project: r.projectId,
      file: r.filename, type: r.kind, mime: r.mime, detected: r.typeDetected,
      bytes: r.bytes, width: r.width, height: r.height, dpi: r.dpi,
      sha256: r.sha256, createdAt: r.createdAt, registeredAt: r.at,
      // The four axes are reported SEPARATELY and never collapsed into one "ok" — a consumer must be able to
      // tell "the bytes decode" from "a reviewer approved it" from "the Commander approved it".
      completion: r.completion, verification: r.verification, qc: r.qc, approval: r.approval,
      lifecycle: r.lifecycle, supersededBy: r.supersededBy || null,
      signatureMismatch: !!r.signatureMismatch
    });

    const listTool = {
      name: 'outbox_list', capability: 'outbox', scope: 'read', requiresConsent: false, network: false, timeoutMs: 10000,
      description: 'List the finished deliverables other agents have PUBLISHED to you, plus your own. '
        + 'This is how you see work that lives in another agent\'s workspace — you cannot read their files directly, '
        + 'and you should not try. Filter with project, producedBy, type, or qc/approval status. '
        + 'Each row tells you what the file is, where the original lives, whether the station mechanically VERIFIED it, '
        + 'whether an independent reviewer passed QC, and whether the Commander approved it. '
        + 'Those are four separate facts: verified does not mean QC-passed, and QC-passed does not mean approved. '
        + 'Use the returned id with outbox_read to fetch a text deliverable or to reference a file precisely.',
      schema: { type: 'object', properties: {
        project: { type: 'string', description: 'project/product id, e.g. matthew-11-28' },
        producedBy: { type: 'string', description: 'agent id of the producer, e.g. webdesigner' },
        type: { type: 'string', enum: ['image', 'video', 'file'] },
        qc: { type: 'string', enum: ['not_reviewed', 'needs_review', 'passed', 'rejected'] },
        approval: { type: 'string', enum: ['pending', 'approved', 'rejected'] },
        includeSuperseded: { type: 'boolean' }
      } },
      run: async (args, ctx) => {
        const me = String((ctx && ctx.agentId) || '');
        if (!me) return { content: 'No agent identity on this run, so there is no Outbox to read.', summary: 'no identity' };
        const a = args || {};
        let rows = [];
        try {
          rows = manifest.list(me, {
            projectId: a.project, owner: a.producedBy, kind: a.type,
            qc: a.qc, approval: a.approval, includeSuperseded: a.includeSuperseded === true
          });
        } catch (e) { return { content: 'The Outbox index could not be read: ' + ((e && e.message) || e), summary: 'error' }; }
        if (!rows.length) {
          return { content: 'No deliverables are published to you' + (a.project ? ' for project "' + a.project + '"' : '')
            + '. This is not the same as "no work exists": a file only appears here once the station has registered it '
            + 'as a finished deliverable. Ask the producing agent, or the Commander, rather than guessing a path.',
            summary: '0 deliverables' };
        }
        return { content: JSON.stringify(rows.map(describe)), summary: rows.length + ' deliverable(s)' };
      }
    };

    const readTool = {
      name: 'outbox_read', capability: 'outbox', scope: 'read', requiresConsent: false, network: false, timeoutMs: 20000,
      description: 'Read ONE deliverable that was published to you, by its Outbox id (from outbox_list). '
        + 'Takes an id, never a path. Text deliverables come back as text; an image or video comes back as its '
        + 'verified facts (size, dimensions, DPI, checksum) and its exact original location, because the bytes '
        + 'are not something you can use in context. Every read re-checks that the original still exists and '
        + 'still matches its registered checksum, so a file that was changed or deleted after it was published '
        + 'is refused rather than quietly served as though it were still the approved version.',
      schema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      run: async (args, ctx) => {
        const me = String((ctx && ctx.agentId) || '');
        const id = String((args && args.id) || '');
        if (!me) return { content: 'No agent identity on this run.', summary: 'no identity' };
        if (!id) return { content: 'outbox_read needs the id of a deliverable (get it from outbox_list).', summary: 'no id' };
        let got;
        try { got = manifest.readFor(me, id); }
        catch (e) { return { content: 'Could not read that deliverable: ' + ((e && e.message) || e), summary: 'error' }; }
        if (!got.ok) {
          // Say WHY in the agent's own terms, so it neither retries blindly nor invents a path to go around it.
          return { content: 'That deliverable is not available to you: ' + String(got.error || 'unknown reason')
            + ' Do not try to reach the file by path — a deliverable is only readable through the Outbox once it '
            + 'has been published to you.', summary: 'unavailable' };
        }
        const row = got.row;
        const facts = describe(row);
        const isText = TEXTUAL.test(String(row.mime || '')) || row.typeDetected === 'text' || row.typeDetected === 'svg';
        if (isText && got.buf.length <= maxInline) {
          return { content: 'DELIVERABLE ' + row.filename + ' (from ' + row.owner + ', '
            + row.verification + '/' + row.qc + '/' + row.approval + ')\n\n' + got.buf.toString('utf8'),
            summary: row.filename };
        }
        /* SHOW THE REVIEWER THE ARTWORK (2026-11-03). Facts-only was a real blocker, not a nicety: QC_EDITOR
           is asked to judge visual quality, and the judgment-rubrics skill says plainly "you opened the
           artifact itself. Reviewing a description of a file is not QC." PUBLISHER hit the same wall and
           correctly recorded "pixels not viewed" as an unresolved risk on its own verdict.
           So a PASSIVE raster image is returned as a real image part the model can see. Deliberately narrow:
             • only png/jpeg/gif/webp — never svg, which is script-bearing (same reason the host serves it
               as an attachment and the Outbox panel refuses to preview it)
             • only under the inline ceiling; a 28MB 4800x6000 print master is never pushed into context
           Everything else still returns facts, and the note says WHY, so "I could not see it" is never
           silently rendered as "I saw it and it was fine". */
        const VIEWABLE = { 'image/png': 1, 'image/jpeg': 1, 'image/gif': 1, 'image/webp': 1 };
        if (VIEWABLE[String(row.mime)] && got.buf.length <= maxInline) {
          return {
            content: JSON.stringify(Object.assign({}, facts, {
              note: 'Image attached for visual inspection. You are seeing the ACTUAL registered file '
                + '(checksum re-verified at read time), so you may judge its appearance directly.'
            })),
            images: [{ mime: String(row.mime), data: got.buf.toString('base64') }],
            summary: row.filename
          };
        }
        return { content: JSON.stringify(Object.assign({}, facts, {
          note: isText
            ? 'Text deliverable too large to inline (' + row.bytes + ' bytes); reference it by id.'
            : (VIEWABLE[String(row.mime)]
              ? 'Image too large to view inline (' + row.bytes + ' bytes, ceiling ' + maxInline + '). You have NOT seen '
                + 'these pixels — say so in any verdict and do not describe the artwork. A smaller preview of the same '
                + 'work, if one is registered, can be viewed instead.'
              : 'Binary deliverable — facts only. The bytes are verified present and checksum-matched; reference it by id rather than describing pixels you have not seen.')
        })), summary: row.filename };
      }
    };

    return {
      register(reg) {
        if (!reg || typeof reg.register !== 'function') throw new Error('outbox.js: a tool registry is required');
        reg.register(listTool);
        reg.register(readTool);
      }
    };
  }

  return { makeOutboxTools, MAX_INLINE_BYTES };
});

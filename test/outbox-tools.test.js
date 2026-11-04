/* test/outbox-tools.test.js — the CONSUMER door: outbox_list / outbox_read.

   These two tools are the reason the fs jail could stay closed. PUBLISHER could not read DESIGNER's print
   files on live run dc3e312b, and pathtrust.js refuses a cross-agent path grant by design, so the fix was a
   narrow published door rather than a wider jail. What must stay true:

     • a consumer reads ONLY what was published to it, BY ID — never by a path it chose
     • the four state axes arrive SEPARATELY (verified != QC-passed != Commander-approved)
     • a changed/deleted original is refused at read time, not served as the approved version
     • a producer cannot use these tools to approve its own work (they cannot write at all)

   Run standalone: node test/outbox-tools.test.js */
'use strict';

const A = require('./_assert.js');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { makeDeliverableManifest } = require('../sidecar/deliverable-manifest.js');
const OutboxTools = require('../sidecar/tools/builtin/outbox.js');
const { makeOutboxTools } = OutboxTools;
const { CAP_REGISTRY } = require('../sidecar/capability/registry.js');
const { impactOfTool } = require('../sidecar/inputpolicy.js');

const NOW = Date.UTC(2026, 10, 2, 19, 30, 0);
const NINE = ['scout', 'webdesigner', 'publisher', 'harvest', 'agent', 'storywriter', 'director', 'producer', 'qceditor'];

function png(w, h, dpi) {
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length);
    const b = Buffer.concat([Buffer.from(t, 'ascii'), d]); const c = Buffer.alloc(4);
    c.writeUInt32BE(crypto.createHash('md5').update(b).digest().readUInt32BE(0)); return Buffer.concat([l, b, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ih)];
  if (dpi) { const p = Buffer.alloc(9); const ppm = Math.round(dpi / 0.0254); p.writeUInt32BE(ppm, 0); p.writeUInt32BE(ppm, 4); p[8] = 1; parts.push(chunk('pHYs', p)); }
  parts.push(chunk('IEND', Buffer.alloc(0))); return Buffer.concat(parts);
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'starnet-outbox-tools-'));
  const ws = path.join(tmp, 'workspaces');
  for (const a of NINE) fs.mkdirSync(path.join(ws, a), { recursive: true });
  const manifest = makeDeliverableManifest({ fs, path, crypto, now: () => NOW,
    root: path.join(ws, '.deliverables'), workspaceRootOf: (a) => path.join(ws, String(a)) });
  const tools = {};
  OutboxTools.makeOutboxTools({ manifest }).register({ register: d => { tools[d.name] = d; } });

  /* ---------- 1. THE PERMISSION SHAPE IS SAFE BY CONSTRUCTION ---------- */
  {
    A.ok(tools.outbox_list && tools.outbox_read, 'both consumer tools register');
    for (const t of [tools.outbox_list, tools.outbox_read]) {
      A.eq(t.scope, 'read', t.name + ' is read-only');
      A.eq(t.requiresConsent, false, t.name + ' needs no consent — it writes nothing and reaches nothing');
      A.eq(t.network, false, t.name + ' touches no network');
      A.eq(impactOfTool({ name: t.name, capability: t.capability }), 'none',
        t.name + ' is impact NONE, so enforceRunAuthority cannot strip it from an ASK-mode unattended run');
    }
    // THE TRAP THIS AVOIDS: deliverable_note/todo/routine.notepad were silently stripped from every ASK-mode
    // unattended run because their capIds were missing from SAFE_BUILTIN_CAPS. PUBLISHER is the ASK-mode agent
    // the Outbox exists for, so a missing row here would make the whole feature invisible to its main consumer.
    // CAP_REGISTRY is keyed by STATION OBJECT TYPE (computer, notebook, cabinet, ...), not a flat array.
    const allCaps = Object.values(CAP_REGISTRY).flat();
    const rows = allCaps.filter(r => r && r.capId === 'outbox');
    A.ok((CAP_REGISTRY.computer || []).some(r => r && r.capId === 'outbox'),
      'granted on `computer` — the ONE object present in both the compute-only office and fullOffice, so a '
      + 'consumer firing its own cron routine is never stranded without the door');
    A.eq(rows.length, 2, 'both tools are granted in CAP_REGISTRY under capId "outbox"');
    A.ok(rows.every(r => r.scope === 'read' && r.requiresConsent === false && r.network === false),
      'and granted as read-only, consent-free, network-free');
    // There is NO write/approve tool in this family — approval is the Commander's axis, not an agent's.
    A.eq(allCaps.some(r => r && r.capId === 'outbox' && r.scope === 'write'), false,
      'the Outbox family exposes NO write tool: an agent can never approve or alter a deliverable through it');
  }

  /* ---------- 2. ALL NINE ROLES PUBLISH; THE COMMANDER SEES EVERY ONE ---------- */
  {
    for (const a of NINE) {
      fs.writeFileSync(path.join(ws, a, 'out.txt'), Buffer.from('work by ' + a));
      manifest.register({ ownerAgentId: a, projectId: 'org', runId: 'r-' + a, shareWith: ['agent'], files: ['out.txt'] });
    }
    const seen = await tools.outbox_list.run({ project: 'org' }, { agentId: 'agent' });
    const rows = JSON.parse(seen.content);
    A.eq(rows.length, 9, 'the Commander sees deliverables from all NINE agents through the tool');
    A.eq(new Set(rows.map(r => r.producedBy)).size, 9, 'one per agent — none hidden in a private workspace');
    A.ok(rows.every(r => r.runId), 'each carries the run id that produced it');
  }

  /* ---------- 3. A CONSUMER READS WHAT WAS PUBLISHED, WITH THE AXES SEPARATE ---------- */
  let artId;
  {
    fs.writeFileSync(path.join(ws, 'webdesigner', 'print.png'), png(2400, 3000, 300));
    const reg = manifest.register({ ownerAgentId: 'webdesigner', projectId: 'mat', runId: 'r-d', shareWith: ['publisher', 'agent'], files: ['print.png'] });
    artId = reg.entries[0].id;
    manifest.setVerification(artId, 'passed', '2400x3000 @300dpi');
    manifest.setQc(artId, 'needs_review', 'qceditor', 'print-ready but art is flat');

    const got = await tools.outbox_read.run({ id: artId }, { agentId: 'publisher' });
    const f = JSON.parse(got.content);
    A.eq(f.verification, 'passed', 'PUBLISHER is told the file mechanically verified');
    A.eq(f.qc, 'needs_review', 'AND that QC did not pass — a separate fact');
    A.eq(f.approval, 'pending', 'AND that the Commander has not approved it');
    A.eq(f.lifecycle, 'NEEDS_REVIEW', 'with an honest coarse lifecycle');
    A.eq(f.width, 2400, 'dimensions come from the real file header');
    /* VISUAL INSPECTION (2026-11-03). This used to assert "binary bytes are not inlined" — correct for the
       original facts-only tool, but it blocked the thing QC exists to do. judgment-rubrics is explicit:
       "you opened the artifact itself. Reviewing a description of a file is not QC", and PUBLISHER logged
       "pixels not viewed" as an unresolved risk on a real run. A PASSIVE raster under the ceiling is now
       attached as a real image part. The refusals below are the load-bearing half. */
    A.ok(Array.isArray(got.images) && got.images.length === 1,
      'a small PNG is attached as a viewable image so a reviewer can actually judge it');
    A.eq(got.images[0].mime, 'image/png', 'with its real mime');
    A.ok(got.images[0].data && got.images[0].data.length > 0, 'and real base64 bytes');
    A.ok(/Image attached for visual inspection/.test(f.note), 'and the note says the pixels are genuinely shown');
  }

  /* ---------- 3b. WHAT MUST NEVER BE ATTACHED AS AN IMAGE ---------- */
  {
    // SVG is script-bearing: the host serves it as an attachment and the Outbox panel refuses to preview it,
    // so the model-facing path must refuse it too, or the one safe surface becomes the unsafe one.
    fs.writeFileSync(path.join(ws, 'webdesigner', 'vector.svg'),
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>'));
    const svg = manifest.register({ ownerAgentId: 'webdesigner', projectId: 'mat', runId: 'r', shareWith: ['publisher'], files: ['vector.svg'] });
    const gotSvg = await tools.outbox_read.run({ id: svg.entries[0].id }, { agentId: 'publisher' });
    A.eq(gotSvg.images, undefined, 'an SVG is NEVER attached as a viewable image — it is the scriptable type');

    // An oversized image must not be pushed into context, and must SAY it was not seen.
    const big = makeOutboxTools({ manifest, maxInlineBytes: 10 });   // ceiling below any real file
    const bigTools = {}; big.register({ register: d => { bigTools[d.name] = d; } });
    const gotBig = await bigTools.outbox_read.run({ id: artId }, { agentId: 'publisher' });
    A.eq(gotBig.images, undefined, 'an image over the inline ceiling is not attached');
    A.ok(/You have NOT seen/.test(gotBig.content),
      'and the model is told plainly it did not see the pixels — "could not see it" must never read as "it was fine"');
  }

  /* ---------- 4. ISOLATION: NOT-PUBLISHED IS UNREADABLE, AND SAYS WHY ---------- */
  {
    fs.writeFileSync(path.join(ws, 'webdesigner', 'private.md'), Buffer.from('designer private'));
    const sneak = await tools.outbox_read.run({ id: 'webdesigner:mat:private.md@v1' }, { agentId: 'publisher' });
    A.eq(sneak.summary, 'unavailable', 'an unregistered private file is unreadable even with a guessed id');
    A.ok(/not available to you/.test(sneak.content), 'and the refusal is explicit');
    A.ok(/Do not try to reach the file by path/.test(sneak.content),
      'and it steers the model away from working around the jail');
    const third = await tools.outbox_read.run({ id: artId }, { agentId: 'scout' });
    A.eq(third.summary, 'unavailable', 'an agent it was not published to cannot read it');
    const emptyList = await tools.outbox_list.run({ project: 'mat' }, { agentId: 'harvest' });
    A.eq(emptyList.summary, '0 deliverables', 'and sees nothing in that project');
    A.ok(/not the same as "no work exists"/.test(emptyList.content),
      'an empty list says so honestly instead of implying nothing was produced');
  }

  /* ---------- 5. A TEXT DELIVERABLE COMES BACK AS TEXT ---------- */
  {
    fs.writeFileSync(path.join(ws, 'scout', 'brief.md'), Buffer.from('# Research\nPrice band $4.92-$9.99'));
    const reg = manifest.register({ ownerAgentId: 'scout', projectId: 'mat', runId: 'r-s', shareWith: ['publisher'], files: ['brief.md'] });
    const got = await tools.outbox_read.run({ id: reg.entries[0].id }, { agentId: 'publisher' });
    A.ok(/Price band \$4\.92-\$9\.99/.test(got.content), 'PUBLISHER receives a text deliverable as usable text');
    A.ok(/unverified\/not_reviewed\/pending/.test(got.content),
      'with its state axes stated inline, so text cannot be mistaken for approved work');
  }

  /* ---------- 6. A CHANGED ORIGINAL IS REFUSED AT READ TIME ---------- */
  {
    fs.writeFileSync(path.join(ws, 'webdesigner', 'print.png'), png(2400, 3000, 72));
    const got = await tools.outbox_read.run({ id: artId }, { agentId: 'publisher' });
    A.eq(got.summary, 'unavailable', 'an original edited after publication is refused');
    A.ok(/checksum/.test(got.content), 'because the checksum no longer matches what was registered');
  }

  /* ---------- 7. DEGENERATE INPUT NEVER THROWS INTO A RUN ---------- */
  {
    A.eq((await tools.outbox_read.run({}, { agentId: 'publisher' })).summary, 'no id', 'a missing id is answered, not thrown');
    A.eq((await tools.outbox_list.run({}, {})).summary, 'no identity', 'a run with no agent identity is answered');
    A.eq((await tools.outbox_read.run({ id: 'nope' }, { agentId: 'publisher' })).summary, 'unavailable', 'an unknown id is answered');
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  A.report('outbox tools');
})().catch(e => { console.error(e); process.exit(1); });

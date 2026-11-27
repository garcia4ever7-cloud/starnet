/* test/studio-qc-integration.test.js — video.inspect, the dark-grant purge, and completion != approval.
   (2026-11-11)

   THREE DEFECTS, ONE CAUSE: the studio bay advertised capabilities nothing implemented, so QC could not be
   done, and the pipeline then called a run "complete" without it.

   A. video.inspect was GRANTED by CAP_REGISTRY and registered by nobody. QC_EDITOR's own blueprint records
      the consequence verbatim: "video.inspect is not available … VERDICT: FAILED — The media cannot be
      verified, so this production cannot be approved." It refused correctly and could never do its job.
      sidecar/tools/builtin/video-inspect.js (234 lines) was NOT wired instead of being fixed, because it is
      written against a foreign tool API and carries two defects that must not enter the station: it accepts
      ANY absolute path (no jail) and it interpolates that path into an execSync SHELL STRING. The replacement
      (tools/builtin/video-probe.js) is ID-addressed through the deliverable manifest and shells nothing.

   B. SIX studio grants had no reachable implementation at all. The worst was video.process, whose
      description promised clip assembly — the exact missing capability — with zero code behind it.

   C. workflow.status became 'complete' on "all four stages ran", where a stage counts as >= 20 characters of
      text. Nothing read blueprint.outputs.qceditor.approved. A real run recorded complete + approved:false.

   Plain node, no framework (test/_assert.js). */
'use strict';
const A = require('./_assert.js');
const fs = require('node:fs');
const path = require('node:path');

const { makeTool, assertToolName } = require('../sidecar/tools/tool.js');
const { CAP_REGISTRY } = require('../sidecar/capability/registry.js');
const { makeVideoProbeTools } = require('../sidecar/tools/builtin/video-probe.js');
const videoVerify = require('../sidecar/video-verify.js');

const ROOT = path.join(__dirname, '..');
const idxSrc = require('./helpers/source.js').readSidecarIndex()   /* PORT: through the source helper (source-helper H5) */;

(async () => {

/* ---------- A1. THE TOOL CONTRACT ---------- */
{
  const tool = makeVideoProbeTools({
    manifest: { resolvedPathFor: () => ({ ok: false, error: 'x' }) },
    videoVerify
  })._tool;
  const built = makeTool(tool);   // throws if the def is malformed in either guarded way

  A.eq(built.name, 'video.inspect', 'the tool declares a top-level name');
  A.eq(built.capability, 'studio', 'under the studio capability, matching the CAP_REGISTRY grant');
  A.eq(built.scope, 'read', 'read-scoped');
  A.eq(built.readOnly, true, 'and therefore readOnly');
  A.eq(built.requiresConsent, false, 'no consent — it is local and free');
  A.eq(tool.network, false, 'and declares no network');
  A.eq(built.schema.required.join(','), 'artifactId', 'it takes an artifact id');
  A.eq(built.schema.additionalProperties, false, 'and nothing else');
  A.eq(/path/i.test(JSON.stringify(built.schema.properties)), true,
    'the schema says plainly that a path is not accepted');

  /* THE GRANT AND THE IMPLEMENTATION MUST AGREE. A grant that is more permissive than the tool (or vice
     versa) is the incoherent state this station has hit before — an offered tool consent then refuses. */
  const grant = (CAP_REGISTRY.studio || []).find(g => g.tool === 'video.inspect');
  A.ok(grant, 'video.inspect is still granted on the studio bay');
  A.eq(grant.scope, built.scope, 'grant scope matches the tool');
  A.eq(grant.requiresConsent, built.requiresConsent, 'grant consent matches the tool');
  A.eq(grant.network, tool.network, 'grant network matches the tool');

  // And it is actually WIRED — the whole original defect was a grant with no require.
  A.ok(/require\(['"]\.\/tools\/builtin\/video-probe\.js['"]\)/.test(idxSrc),
    'index.js requires the implementation');
  A.ok(/VideoProbeTools\.makeVideoProbeTools\(\{[\s\S]{0,160}\}\)\.register\(registry\)/.test(idxSrc),
    'and registers it against the real registry');
}

/* ---------- A2. REAL FFPROBE FACTS, AND THE GATE'S VERDICT ---------- */
{
  const film = path.join(ROOT, 'memorial/examples/life-worth-remembering/render/out/life-worth-remembering.mp4');
  if (!fs.existsSync(film)) {
    A.ok(true, 'SKIP: the memorial reference film is not on this device (renders are gitignored)');
  } else {
    const row = { filename: 'life-worth-remembering.mp4', owner: 'studio', completion: 'complete',
      verification: 'unverified', qc: 'not_reviewed', approval: 'pending', bytes: 0, sha256: 'x' };
    const tool = makeVideoProbeTools({
      manifest: { resolvedPathFor: () => ({ ok: true, abs: film, row }) }, videoVerify
    })._tool;
    const res = await tool.run({ artifactId: 'studio:p:v@v1' }, { agentId: 'qceditor' });
    {
      /* Pinned against an INDEPENDENT ffprobe run of the same file:
           h264 1920x1080 | aac 2ch | duration 171.200000 | bit_rate 1532883 */
      A.eq(res.ok, true, 'a real film inspects cleanly');
      A.eq(res.playable, true, 'and the station gate calls it playable');
      A.eq(res.facts.durationSec, 171.2, 'duration matches ffprobe exactly');
      A.eq(res.facts.streams.video[0].width, 1920, 'width matches ffprobe');
      A.eq(res.facts.streams.video[0].height, 1080, 'height matches ffprobe');
      A.eq(res.facts.streams.video[0].codec, 'h264', 'video codec matches ffprobe');
      A.eq(res.facts.streams.audio[0].codec, 'aac', 'audio codec matches ffprobe');
      A.eq(res.facts.streams.audio[0].channels, 2, 'channel count matches ffprobe');
      A.eq(res.hasAudioStream, true, 'and the audio stream is reported present');
      A.eq(res.gate.bitrate, 1532883, 'bitrate matches ffprobe');

      /* IT REPORTS THE AXES, IT DOES NOT DECIDE THEM. An inspection is evidence for a QC verdict and must
         never read like one — this row is still unverified/not_reviewed/pending and says so. */
      A.eq(res.registered.verification, 'unverified', 'the manifest axes are echoed, not re-derived');
      A.eq(res.registered.qc, 'not_reviewed', 'qc is untouched by an inspection');
      A.eq(res.registered.approval, 'pending', 'and so is approval');
      A.ok(/not a QC approval/i.test(res.note), 'and it says a passing verdict is not an approval');
      A.ok(/cannot judge content/i.test(res.note), 'and that it cannot judge content');
    }
  }
}

/* ---------- A3. FAIL-CLOSED IN EVERY DIRECTION ---------- */
{
  const real = path.join(ROOT, 'memorial/examples/life-worth-remembering/render/out/life-worth-remembering.mp4');
  const permissive = { resolvedPathFor: () => ({ ok: true, abs: real, row: {} }) };
  const mk = (deps) => makeVideoProbeTools(deps)._tool;

  // The TOOL refuses these, not the manifest — the stub above would resolve anything.
  const refusals = ['/etc/passwd', '../../../../etc/passwd', 'outbox/p/video.mp4', '', 'a'.repeat(301),
    'studio:$(id):y@v1', 'studio:x":y@v1', 'studio:x\x00:y@v1'];
  const rs = await Promise.all(refusals.map(id =>
    mk({ manifest: permissive, videoVerify }).run({ artifactId: id }, { agentId: 'qceditor' })
  ));
  rs.forEach((r, i) => A.eq(r.ok, false, 'refuses a non-id: ' + JSON.stringify(refusals[i].slice(0, 24))));

  const noAgent = await mk({ manifest: permissive, videoVerify }).run({ artifactId: 'studio:x:y@v1' }, {});
  const noManifest = await mk({ videoVerify }).run({ artifactId: 'studio:x:y@v1' }, { agentId: 'qceditor' });
  const noVerifier = await mk({ manifest: permissive }).run({ artifactId: 'studio:x:y@v1' }, { agentId: 'qceditor' });
  A.eq(noAgent.ok, false, 'no calling identity -> refused, never resolved unscoped');
  A.eq(noManifest.ok, false, 'no manifest wired -> refused (fail-closed)');
  A.eq(noVerifier.ok, false, 'no verifier wired -> refused rather than reporting unverified facts');
}

/* ---------- B. THE DARK GRANTS ARE GONE, AND CANNOT COME BACK ALONE ---------- */
{
  const studio = (CAP_REGISTRY.studio || []).map(g => g.tool);
  for (const dead of ['video.process', 'video.generate', 'video.kling', 'audio.generate',
    'audio.inspect', 'higgsfield.enhance', 'image_upscale_kling']) {
    A.eq(studio.indexOf(dead), -1, 'the dark grant ' + dead + ' is no longer advertised');
  }
  A.eq(studio.indexOf('video.inspect') >= 0, true, 'while video.inspect — now implemented — remains');

  /* video.kling's registration is removed because its def shape made it UNCALLABLE, not because the feature
     is unwanted. Re-adding the grant without porting the file would restore a tool named `undefined`. */
  A.eq(/makeVideoKlingTools\([^)]*\)\.register\(registry\)/.test(idxSrc), false,
    'the malformed video-kling registration is gone');
  /* SECOND live offender, found only because the guard broke a boot: image-kling-upscale.js declares `id:`
     and attaches its body as `.impl`, so makeTool saw name:undefined AND run:undefined. Both nameless
     registrations collided on the same tools["undefined"] key, so the second silently replaced the first. */
  A.eq(/makeKlingUpscaleTools\([^)]*\)\.register\(registry\)/.test(idxSrc), false,
    'the malformed image-kling-upscale registration is gone too');
  A.throws(() => assertToolName({ id: 'image_upscale_kling', scope: 'write', requiresConsent: true }),
    'a top-level `id:` (instead of name) is also rejected');
  // makeTool's default run() REJECTS rather than silently succeeding — that is what an `.impl`-only def got.
  const stub = makeTool({ name: 'x.y', schema: { type: 'object' } });
  let stubThrew = false;
  try { await stub.run({}, {}); } catch (e) { stubThrew = /has no run\(\)/.test(String(e && e.message)); }
  A.eq(stubThrew, true, "makeTool's default run() rejects with 'has no run()', never a silent success");

  /* THE GUARD THAT CLOSES THE CLASS. assertToolName must reject the foreign shape AND a bare unnamed def,
     and must name the real failure modes so the next author is not left guessing. */
  A.throws(() => assertToolName({ properties: { id: 'video.kling' } }), 'the foreign properties.id shape throws');
  A.throws(() => assertToolName({}), 'a def with no name throws');
  A.throws(() => makeTool({ properties: { id: 'x.y' }, schema: { type: 'object' } }),
    'and makeTool refuses to build one');
  let msg = '';
  try { assertToolName({ properties: { id: 'video.kling', scope: 'write', requiresConsent: true } }); }
  catch (e) { msg = String(e.message); }
  A.ok(/undefined/.test(msg), 'the error explains the tool would be keyed "undefined"');
  A.ok(/scope:read|requiresConsent:false/.test(msg), 'and that its safety attributes would be downgraded');
  A.ok(/video-probe/.test(msg), 'and points at a correctly-shaped example');
  A.notThrows(() => assertToolName({ name: 'fs.read' }), 'a native def passes');

  /* The downgrade this guard prevents, demonstrated: without a top-level scope/consent a write+network tool
     becomes a free read. Asserted on makeTool's real defaults so the stakes stay visible. */
  const downgraded = makeTool({ name: 'x.y', schema: { type: 'object' } });
  A.eq(downgraded.scope, 'read', 'an omitted scope defaults to read');
  A.eq(downgraded.requiresConsent, false, 'and an omitted consent flag defaults to FALSE');
}

/* ---------- C. "ALL STAGES RAN" IS NOT "APPROVED" ---------- */
{
  const orchSrc = fs.readFileSync(path.join(ROOT, 'sidecar/cron-orchestrator.js'), 'utf8');

  A.ok(/async function pipelineOutcome\(/.test(orchSrc), 'the pipeline derives its outcome in one place');
  A.eq(/ok: true, status: 'complete'/.test(orchSrc), false,
    'no site returns ok:true merely because every stage ran');
  A.ok(/ok: stagesDone && approved/.test(orchSrc), 'ok requires the stages AND the QC verdict');
  A.ok(/stagesComplete/.test(orchSrc) && /qcApproved/.test(orchSrc),
    'and the two facts are reported SEPARATELY so a caller can tell them apart');
  A.ok(/qc-missing/.test(orchSrc), 'an absent QC verdict is named, not treated as approval');
  A.ok(/qc-refused/.test(orchSrc), 'and a refusal is named');

  // The lifecycle enum is deliberately UNCHANGED — other consumers read workflow.status.
  const projSrc = fs.readFileSync(path.join(ROOT, 'sidecar/project-orchestration.js'), 'utf8');
  A.ok(/workflow\.status = 'complete'/.test(projSrc),
    "workflow.status still becomes 'complete' when stages finish (enum compatibility preserved)");

  /* The QC verdict itself must stay derived from what QC_EDITOR actually wrote, defaulting to NOT approved.
     This is the line that kept an unearned approval out; it must not be relaxed. */
  A.ok(/slot\.approved = passed && !failed/.test(orchSrc), 'QC approval is earned from the text, never defaulted');
  A.ok(/VERDICT|fail|reject/i.test(orchSrc), 'and failure words are what revoke it');

  // PRODUCER must no longer be told to call tools that do not exist.
  A.eq(/Call video\.kling/.test(orchSrc), false, 'the PRODUCER prompt no longer instructs calling video.kling');
  A.ok(/neither is a registered tool/.test(orchSrc), 'and says plainly that those tools are not registered');
}

  A.report('studio qc integration');
})().catch(e => { console.error(e); process.exit(1); });

/* sidecar/tools/builtin/video-probe.js — video.inspect: the technical facts of a registered video, read
   by ffprobe, for an agent that has to QC it.

   WHY THIS FILE EXISTS INSTEAD OF WIRING sidecar/tools/builtin/video-inspect.js.
   That file (234 lines, unwired — `grep -c "builtin/video-inspect.js" sidecar/index.js` → 0) was written
   against a DIFFERENT tool API than this station's and carries two defects that must not be imported:

     · it is shaped `{ properties: { id }, schema, async invoke(args, context) }` and expects
       `context.workspaceRoot`. The real contract is makeTool's `{ name, schema, scope, run(args, ctx) }`
       (sidecar/tools/tool.js), so registering it would produce a tool with name `undefined` whose run()
       throws "has no run()".
     · `video-inspect.js:46-47` — `if (path.isAbsolute(videoPath)) fullPath = videoPath;` — accepts ANY
       absolute path. No jail, no containment, no viewer scoping: an agent could probe (and with
       `detailed:true`, run ffmpeg filter graphs over) any file on the device.
     · `video-inspect.js:59` — `` `ffprobe … "${fullPath}"` `` into execSync. That is a shell string, so a
       filename containing `"` or `$(…)` executes. Lines 157/161 do it twice more.

   The original file is left on disk untouched (it is the owner's work) but stays unwired.

   THE DESIGN, and why it is ID-ADDRESSED.
   A studio video lives in $HOME/outbox/<projectId>/, which is outside EVERY agent workspace — so a
   path-taking tool could not help QC_EDITOR without widening the fs jail, and the jail must stay
   (pathtrust.js: "standing grants and Full Access do NOT override ownership beneath this root").

   So this tool takes a MANIFEST ID, never a path — the same rule outbox_read follows, and the station's
   stated law: ID-addressed, never path-addressed; the displayed path is information, not authorization.
   Resolution goes through deliverableManifest.resolvedPathFor(), which runs the viewer-scoped get() and then
   resolveOwned()'s full floor (no absolute paths, no '..', no NUL, leaf-symlink refusal, realpath containment
   on BOTH ends). The manifest's injected workspaceRootOf already maps the 'studio' pseudo-producer to
   $HOME/outbox, so QC_EDITOR reaches exactly the four studio videos it is already `sharedWith` on — and
   nothing else. No new filesystem reach is created by this file.

   ONE FFPROBE IMPLEMENTATION. The probe comes from sidecar/video-verify.js (`probe`, exported additively for
   this), which calls execFileSync with an ARRAY — no shell. The same module's verifyVideoFile() supplies the
   GATE verdict, so the inspector and the gate can never disagree about a file. That matters: the gate is what
   decides whether a video may be called real, after a 32 KB solid-colour clip was once handed over as a
   finished 1080p film.

   THE PERMISSION SHAPE: scope 'read', requiresConsent false, network false, capability 'studio' — matching
   the grant CAP_REGISTRY already publishes for video.inspect. It writes nothing, spends nothing, needs no API
   key, and reaches no third party. It cannot set QC or approve anything; those axes belong to an independent
   reviewer and the Commander respectively.

   makeVideoProbeTools({ manifest, videoVerify }) -> { register(reg) } */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).videoProbeTools = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const ID_RE = /^[A-Za-z0-9_.:@-]+$/;   // the manifest's own id charset, same gate /api/artifact applies

  function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

  /* Report streams as FACTS, flat and small. A model does not need ffprobe's full JSON (it is thousands of
     tokens of tags and side-data); it needs to answer "is this the video I was told it is, and does it have
     sound". Anything omitted here is still derivable by the Commander through /api/artifact. */
  function streamFacts(streams) {
    const out = { video: [], audio: [], other: 0 };
    for (const s of (Array.isArray(streams) ? streams : [])) {
      const kind = String((s && s.codec_type) || '');
      if (kind === 'video') {
        out.video.push({
          codec: String(s.codec_name || ''), width: num(s.width), height: num(s.height),
          frameRate: String(s.r_frame_rate || ''), pixelFormat: String(s.pix_fmt || ''),
          frames: num(s.nb_frames), bitrate: num(s.bit_rate)
        });
      } else if (kind === 'audio') {
        out.audio.push({
          codec: String(s.codec_name || ''), channels: num(s.channels),
          sampleRate: num(s.sample_rate), bitrate: num(s.bit_rate)
        });
      } else out.other++;
    }
    return out;
  }

  function makeVideoProbeTools(deps) {
    deps = deps || {};
    const manifest = deps.manifest;
    const videoVerify = deps.videoVerify;

    const inspectTool = {
      name: 'video.inspect',
      capability: 'studio', scope: 'read', requiresConsent: false, network: false, timeoutMs: 30000,
      description:
        'Read the real technical properties of a registered video deliverable with ffprobe: duration, '
        + 'resolution, codecs, frame rate, bitrate, frame count, and whether an audio stream is present. '
        + 'Takes an Outbox artifact id (from outbox_list) — never a file path. Also returns the station\'s '
        + 'own playability verdict. Local, read-only, free: no network, no provider key, no spend. Use this '
        + 'to QC a video instead of trusting what another agent SAID about it.',
      schema: {
        type: 'object',
        properties: {
          artifactId: {
            type: 'string', minLength: 1, maxLength: 300,
            description: 'The Outbox artifact id of the video, e.g. "studio:proj-1793603158934-r0x5zq:…@v1". '
              + 'Get it from outbox_list. A filesystem path is NOT accepted.'
          }
        },
        required: ['artifactId'],
        additionalProperties: false
      },
      async run(args, ctx) {
        const a = args || {};
        const me = String((ctx && ctx.agentId) || '');
        if (!me) return { ok: false, error: 'no calling agent identity — refusing to resolve an artifact unscoped' };
        if (!manifest || typeof manifest.resolvedPathFor !== 'function') {
          return { ok: false, error: 'the deliverable manifest is not wired; video.inspect cannot resolve an artifact' };
        }
        if (!videoVerify || typeof videoVerify.probe !== 'function' || typeof videoVerify.verifyVideoFile !== 'function') {
          return { ok: false, error: 'video verification is not wired; refusing to report facts from an unknown prober' };
        }

        const id = String(a.artifactId || '').trim();
        // Shape-gate before any lookup, exactly as /api/artifact does: a malformed id is a refusal, never a
        // filesystem probe. This is also what stops a path being smuggled in as an "id".
        if (!id || id.length > 300 || !ID_RE.test(id)) {
          return { ok: false, error: 'that is not a valid artifact id. video.inspect takes an Outbox id from outbox_list, not a file path.' };
        }

        const got = manifest.resolvedPathFor(me, id);
        if (!got.ok) return { ok: false, error: String(got.error || 'could not resolve that artifact') };
        const row = got.row || {};

        /* THE GATE FIRST, then the facts. verifyVideoFile fails CLOSED — a missing ffprobe, an unreadable
           file or a missing ftyp box all come back not-ok — so a verdict is never inferred from absent
           evidence. We still report the facts on a failure, because "why did it fail" is the whole point of
           an inspection; what we never do is call it playable. */
        let verdict;
        try { verdict = videoVerify.verifyVideoFile(got.abs); }
        catch (e) { return { ok: false, error: 'verification threw: ' + ((e && e.message) || e) }; }

        let facts = null, probeError = null;
        try {
          const raw = videoVerify.probe(got.abs);
          const format = (raw && raw.format) || {};
          facts = {
            durationSec: Math.round(num(format.duration) * 1000) / 1000,
            bytes: num(format.size),
            containerBitrate: num(format.bit_rate),
            formatName: String(format.format_name || ''),
            streams: streamFacts(raw && raw.streams)
          };
        } catch (e) { probeError = 'ffprobe failed: ' + ((e && e.message) || e); }

        const hasAudio = !!(facts && facts.streams.audio.length);
        return {
          ok: true,
          artifactId: id,
          filename: String(row.filename || ''),
          owner: String(row.owner || ''),
          // The four axes are reported as the manifest holds them, never re-derived here. An inspection is
          // EVIDENCE for a QC verdict; it is not a verdict, and it must not read like one.
          registered: {
            completion: String(row.completion || ''), verification: String(row.verification || ''),
            qc: String(row.qc || ''), approval: String(row.approval || ''),
            sha256: String(row.sha256 || ''), registeredBytes: num(row.bytes)
          },
          playable: verdict.ok === true,
          playabilityReason: String(verdict.reason || (verdict.ok ? 'passed' : 'unknown')),
          gate: {
            bytes: num(verdict.bytes), durationSec: num(verdict.durationSec),
            width: num(verdict.width), height: num(verdict.height),
            bitrate: num(verdict.bitrate), frames: num(verdict.frames),
            floors: {
              minBytes: num(videoVerify.MIN_BYTES), minBitrate: num(videoVerify.MIN_BITRATE),
              minDurationSec: num(videoVerify.MIN_DURATION_SEC), minFrames: num(videoVerify.MIN_FRAMES)
            }
          },
          hasAudioStream: hasAudio,
          facts: facts,
          probeError: probeError,
          /* Said plainly because this is the exact trap the station has already fallen into: these checks
             prove the bytes DECODE, not that the picture is right. A 171-second film of solid black clears
             every floor here. */
          note: 'These are mechanical facts only. A technically valid video can still be visually wrong — '
            + 'this tool cannot judge content, and a passing verdict is not a QC approval.'
        };
      }
    };

    return {
      register(reg) {
        if (!reg || typeof reg.register !== 'function') return;
        reg.register(inspectTool);
      },
      _tool: inspectTool   // test seam: assert the declared contract without a live registry
    };
  }

  return { makeVideoProbeTools };
});

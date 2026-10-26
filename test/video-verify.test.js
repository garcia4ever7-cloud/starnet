/* test/video-verify.test.js — the gate that stops a placeholder being handed over as a
   finished video (qa/bugs/c7abfee9-...).

   The anchor case is real: a 32,770-byte solid-colour clip was delivered to the owner as
   a QC-approved anime battle sequence. It is a structurally valid 1080p/24fps/242-frame
   MP4, so it defeats naive "has ftyp and some frames" checks. Bitrate is what exposes it. */

'use strict';

const assert = require('./_assert.js');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { verifyVideoFile, MIN_BYTES, MIN_BITRATE } = require('../sidecar/video-verify.js');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'video-verify-'));
const p = name => path.join(TMP, name);

function haveFfmpeg() {
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; }
  catch (_) { return false; }
}

function ffmpeg(args) {
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error'].concat(args), { stdio: 'ignore', timeout: 120000 });
}

/* ---- rejections that need no encoder ---------------------------------------- */

assert.eq(verifyVideoFile(p('absent.mp4')).reason, 'file-missing',
  'a missing file is rejected as file-missing');

fs.writeFileSync(p('empty.mp4'), '');
assert.eq(verifyVideoFile(p('empty.mp4')).reason, 'file-empty',
  'a zero-byte file is rejected as file-empty');

assert.eq(verifyVideoFile(TMP).reason, 'not-a-regular-file',
  'a directory is rejected, not probed');

// 200KB of zeros: over the size floor, but carries no ftyp box.
fs.writeFileSync(p('notmp4.bin'), Buffer.alloc(200 * 1024));
assert.eq(verifyVideoFile(p('notmp4.bin')).reason, 'not-an-mp4',
  'non-MP4 bytes are rejected even when large enough to clear the size floor');

// A bare ftyp header — the shape of the original 1,056-byte stub.
const ftypOnly = Buffer.from([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
fs.writeFileSync(p('stub.mp4'), ftypOnly);
const stub = verifyVideoFile(p('stub.mp4'));
assert.ok(!stub.ok, 'a bare ftyp stub is rejected');
assert.ok(/^too-small/.test(stub.reason), 'the stub is rejected for size, reason: ' + stub.reason);

/* ---- the real defect: valid video, no actual content ------------------------- */

if (!haveFfmpeg()) {
  console.log('SKIP: ffmpeg unavailable — encoder-dependent cases not run');
} else {
  // THE REGRESSION CASE. A 3-minute solid-colour clip: >100KB, >4000 frames, 1080p24,
  // valid h264. Every naive check passes. Only the bitrate betrays it.
  ffmpeg(['-f', 'lavfi', '-i', 'color=c=#4169E1:s=1920x1080:d=180',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28', '-pix_fmt', 'yuv420p', '-r', '24',
    p('placeholder.mp4')]);
  const ph = verifyVideoFile(p('placeholder.mp4'));
  assert.ok(!ph.ok, 'a large multi-frame solid-colour clip is still rejected');
  assert.ok(/^placeholder-bitrate/.test(ph.reason),
    'it is rejected specifically on bitrate, reason: ' + ph.reason);
  assert.ok(ph.bytes > MIN_BYTES,
    'and it genuinely cleared the size floor (' + ph.bytes + ' > ' + MIN_BYTES + ') — proving size alone is insufficient');
  assert.ok(ph.frames > 100, 'and it genuinely had many frames (' + ph.frames + ') — proving a frame count alone is insufficient');
  assert.ok(ph.bitrate < MIN_BITRATE, 'its bitrate was under the floor: ' + ph.bitrate);

  // Real content: noise does not compress, standing in for genuine footage.
  ffmpeg(['-f', 'lavfi', '-i', 'nullsrc=s=640x360:d=4,geq=random(1)*255:128:128',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-r', '24',
    p('real.mp4')]);
  const real = verifyVideoFile(p('real.mp4'));
  assert.ok(real.ok, 'genuine high-entropy footage is accepted, reason given: ' + real.reason);
  assert.ok(real.bitrate >= MIN_BITRATE, 'and its bitrate is above the floor: ' + real.bitrate);
  assert.ok(real.width > 0 && real.height > 0, 'and dimensions are reported');

  // A single still frame is not a video.
  ffmpeg(['-f', 'lavfi', '-i', 'nullsrc=s=640x360:d=0.04,geq=random(1)*255:128:128',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-frames:v', '1',
    p('oneframe.mp4')]);
  const one = verifyVideoFile(p('oneframe.mp4'));
  assert.ok(!one.ok, 'a single-frame file is rejected, reason: ' + one.reason);
}

/* ---- fail closed ------------------------------------------------------------- */

// With ffprobe unreachable, an unprovable video must report not-ok rather than pass.
{
  const realPath = process.env.PATH;
  process.env.PATH = p('no-such-dir');
  try {
    // Needs a file that gets far enough to attempt a probe: valid ftyp, over the floor.
    const big = Buffer.alloc(MIN_BYTES + 1024);
    ftypOnly.copy(big, 0);
    fs.writeFileSync(p('probe-me.mp4'), big);
    const r = verifyVideoFile(p('probe-me.mp4'));
    assert.ok(!r.ok, 'with ffprobe unavailable the verdict fails closed');
    assert.ok(/ffprobe/.test(r.reason), 'and says so: ' + r.reason);
  } finally {
    process.env.PATH = realPath;
  }
}

/* ---- the actual delivered artifact, if it is still on this station ----------- */

const DELIVERED = path.join(os.homedir(), 'outbox', 'proj-1792964044657-xs9vyt', 'video.mp4');
if (fs.existsSync(DELIVERED)) {
  const d = verifyVideoFile(DELIVERED);
  assert.ok(!d.ok, 'the artifact the owner was actually handed is rejected (' + d.reason + ')');
}

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}

assert.report('video-verify');

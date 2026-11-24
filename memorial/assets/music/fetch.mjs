/* memorial/assets/music/fetch.mjs — rebuild the music library from its recorded sources.
 *
 * The audio files are not kept in git (50 MB). manifest.json records, for every track, where the
 * original came from and its sha256; this script downloads each original, REFUSES it unless the
 * checksum matches, and transcodes it to the AAC copy the engine plays. Licence evidence for each
 * track is in LICENSES.md beside this file.
 *
 *   node memorial/assets/music/fetch.mjs            fetch whatever is missing
 *   node memorial/assets/music/fetch.mjs <slug>...  fetch (or re-fetch) the named tracks
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(HERE, 'manifest.json'), 'utf8'));
const want = process.argv.slice(2);
const sha256 = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
let failed = 0;

for (const t of manifest.tracks) {
  const out = path.join(HERE, t.file);
  if (want.length ? !want.includes(t.slug) : fs.existsSync(out)) continue;
  if (!t.original || !t.original.url) { console.log(`${t.slug}: no source URL recorded`); failed++; continue; }
  const tmp = path.join(HERE, `.dl-${t.slug}${path.extname(t.original.file)}`);
  console.log(`${t.slug}: downloading ${t.original.bytes} bytes`);
  const dl = spawnSync('curl', ['-sSL', '--fail', '-m', '900', '-o', tmp, t.original.url], { stdio: 'inherit' });
  if (dl.status !== 0 || !fs.existsSync(tmp)) { console.log(`${t.slug}: download failed`); failed++; continue; }
  const got = sha256(tmp);
  if (got !== t.original.sha256) {
    console.log(`${t.slug}: CHECKSUM MISMATCH — got ${got.slice(0, 16)}…, recorded ${t.original.sha256.slice(0, 16)}…. Not installed.`);
    fs.rmSync(tmp, { force: true }); failed++; continue;
  }
  const part = out + '.part.m4a';
  const enc = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', tmp, '-vn', '-map_metadata', '-1', '-af', 'aresample=48000',
    '-c:a', 'aac', '-b:a', '256k', '-ac', '2', '-movflags', '+faststart', part], { stdio: 'inherit' });
  fs.rmSync(tmp, { force: true });
  if (enc.status !== 0 || !fs.existsSync(part)) { console.log(`${t.slug}: transcode failed`); fs.rmSync(part, { force: true }); failed++; continue; }
  fs.renameSync(part, out);
  console.log(`${t.slug}: installed (${fs.statSync(out).size} bytes, original verified)`);
}
process.exit(failed ? 1 : 0);

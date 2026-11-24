/* memorial/faces.mjs — find the faces, so nothing downstream can cut one.
 *
 * WHY THIS EXISTS
 * ---------------
 * Until 2026-11-24 this device had no face detector (no OpenCV, no onnxruntime — bionic libc),
 * so the engine protected faces by never cropping anything that might contain one. That is safe
 * and timid: every group photo sat small inside a blurred border. The pico cascade (MIT, 240 KB,
 * pure arithmetic over a grayscale buffer) runs here with Node core alone. It is vendored in
 * memorial/vendor/pico/ and never touches the network.
 *
 * WHAT IT CAN AND CANNOT DO — measured on this phone, 19 images, 21 main faces (2026-11-24):
 *   - frontal faces, upright or tilted to about 30 degrees: found (19 of 21), no false boxes
 *     at these thresholds on 8 face-free backgrounds
 *   - a face in PROFILE: not found, at any angle. It is a frontal cascade.
 *   - a face cut by the edge of the photo, or very small in a crowd: not found
 *   - sunglasses, heavy shadow, black-and-white scans, babies: NOT TESTED
 *
 * THEREFORE THREE RULES, enforced by the callers and stated here so nobody weakens them:
 *   1. "Detector found nothing" means UNKNOWN, never "no faces". Unknown photos get the
 *      original conservative treatment (portraits never cropped, tight caps). Only an operator
 *      can declare a photo face-free, by writing `"faces": []` in the order.
 *   2. The operator's marks always win. `"faces": [[x0,y0,x1,y1], …]` in the order replaces
 *      detection for that photo entirely.
 *   3. Detection is a proposal for a human to check. `cli.mjs faces <order>` draws every box on
 *      a contact sheet; QC reports whether the order says the sheet was reviewed.
 *
 * Coordinates are fractions (0..1) of the UPRIGHT, decoded photo — see prep.mjs for why that
 * distinction matters.
 */
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { unpackCascade, runCascade, cluster } from './vendor/pico/picoface.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CASCADE = path.join(HERE, 'vendor', 'pico', 'facefinder');

/* Tuned 2026-11-24. The tilted passes need a stricter gate: single-angle false boxes reached
 * 13.3 while the one tilted face that mattered scored 100.9. */
export const DETECT = {
  work: 640, minFrac: 0.06, scalefactor: 1.1, shiftfactor: 0.1, clusterIou: 0.2,
  uprightMin: 5, tilt: 30, tiltMin: 20, mergeIou: 0.3,
};

let CAS = null;
function cascade() {
  if (!CAS) CAS = unpackCascade(fs.readFileSync(CASCADE));
  return CAS;
}

/* Decode to 8-bit gray at `work` px on the long side. ffmpeg applies EXIF orientation. */
function decodeGray(file, work) {
  return new Promise((resolve, reject) => {
    const vf = `scale='if(gt(iw,ih),${work},-2)':'if(gt(iw,ih),-2,${work})':flags=area,format=gray`;
    const p = spawn('ffmpeg', ['-hide_banner', '-nostats', '-v', 'error', '-i', file, '-frames:v', '1',
      '-vf', vf, '-f', 'image2pipe', '-vcodec', 'pgm', '-'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = []; let err = '';
    p.stdout.on('data', d => chunks.push(d));
    p.stderr.on('data', d => { err += d; });
    p.on('error', e => reject(new Error(`ffmpeg unavailable: ${e.message}`)));
    p.on('close', code => {
      if (code !== 0) return reject(new Error(`cannot decode ${path.basename(file)} for face detection: ${err.trim().split('\n').pop() || code}`));
      const buf = Buffer.concat(chunks);
      /* PGM: "P5\n<w> <h>\n<max>\n" then w*h bytes. */
      const m = buf.subarray(0, 64).toString('latin1').match(/^P5\s+(\d+)\s+(\d+)\s+(\d+)\s/);
      if (!m) return reject(new Error('face detection: unexpected decoder output'));
      const width = Number(m[1]), height = Number(m[2]);
      const pixels = buf.subarray(m[0].length, m[0].length + width * height);
      if (pixels.length !== width * height) return reject(new Error('face detection: short frame'));
      resolve({ pixels, width, height });
    });
  });
}

const iouBox = (a, b) => {
  const ow = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  const oh = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const ua = (a.x1 - a.x0) * (a.y1 - a.y0) + (b.x1 - b.x0) * (b.y1 - b.y0) - ow * oh;
  return ua > 0 ? (ow * oh) / ua : 0;
};

/** Detect on an already-decoded gray buffer. Exposed so the test can run without ffmpeg. */
export function detectInGray(img, cfg = DETECT) {
  const cas = cascade();
  const p = {
    minsize: Math.max(20, Math.round(cfg.minFrac * Math.min(img.width, img.height))),
    maxsize: Math.max(img.width, img.height), scalefactor: cfg.scalefactor, shiftfactor: cfg.shiftfactor,
  };
  const cand = [];
  for (const angle of [0, -cfg.tilt, cfg.tilt]) {
    const gate = angle === 0 ? cfg.uprightMin : cfg.tiltMin;
    for (const d of cluster(runCascade(img, cas, { ...p, angle }), cfg.clusterIou)) {
      if (d.q < gate) continue;
      cand.push({
        x0: Math.max(0, (d.c - d.s / 2) / img.width), y0: Math.max(0, (d.r - d.s / 2) / img.height),
        x1: Math.min(1, (d.c + d.s / 2) / img.width), y1: Math.min(1, (d.r + d.s / 2) / img.height),
        score: Number(d.q.toFixed(2)), angle,
      });
    }
  }
  cand.sort((a, b) => b.score - a.score);
  const faces = [];
  for (const f of cand) if (!faces.some(g => iouBox(f, g) > cfg.mergeIou)) faces.push(f);
  /* Left-to-right, top-to-bottom: a stable order makes faces.json diffable. */
  return faces.sort((a, b) => (a.x0 - b.x0) || (a.y0 - b.y0));
}

/** detectFaces — [{x0,y0,x1,y1,score,angle}] as fractions of the upright photo. */
export async function detectFaces(file, cfg = DETECT) {
  const img = await decodeGray(file, cfg.work);
  return detectInGray(img, cfg);
}

/**
 * resolveFaces — what the planner should believe about one photo.
 * @returns {{faces: Array|null, source: 'operator'|'detector'|'unknown', detected: number}}
 *   faces === null  → unknown: conservative rules apply
 *   faces === []    → only when the OPERATOR declared the photo face-free
 */
export function resolveFaces(orderFaces, detected) {
  if (Array.isArray(orderFaces)) return { faces: orderFaces, source: 'operator', detected: detected ? detected.length : 0 };
  if (detected && detected.length) return { faces: detected.map(({ x0, y0, x1, y1 }) => ({ x0, y0, x1, y1 })), source: 'detector', detected: detected.length };
  return { faces: null, source: 'unknown', detected: 0 };
}

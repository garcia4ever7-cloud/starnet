/* memorial/outbox.mjs — put a finished memorial film into the StarNet Outbox.
 *
 * WHY THIS EXISTS
 * ---------------
 * The Outbox panel lists the deliverable manifest (GET /api/outbox, sidecar/deliverable-manifest.js).
 * Rows reach it only from inside the sidecar: at the end of an agent run, or from the studio
 * pipeline. The memorial engine is a production line with no agent run behind it, so its films
 * never appeared there. (POST /api/deliverables/register exists, but it feeds the separate Library
 * list, not the Outbox.)
 *
 * This does what the sidecar's studio bridge does for a studio video (sidecar/index.js,
 * `registerOrchestrationOutputs`), using the SAME module — nothing here re-implements the manifest:
 *   1. the film is copied into the owner agent's workspace (NIGHT4CHRIST, `agent`, by default) at
 *      outbox/memorial/<orderId>/ — the manifest only indexes files inside an owner's own folder;
 *   2. makeDeliverableManifest({...}).register() indexes it, with the same root and resolver the
 *      sidecar uses. That module re-reads its append-only log on every request and appends one
 *      line per row, so the running sidecar sees the row at once — no restart, no sidecar change;
 *   3. the `verification` axis is set from sidecar/video-verify.js's real verdict, exactly as the
 *      studio bridge sets it. The memorial QC result goes into the verification detail.
 *   4. `qc` and `approval` are NOT touched: a machine gate is not an independent reviewer, and
 *      approval is the Commander's alone.
 *
 * Registration is idempotent (the manifest dedupes byte-identical content); a re-rendered film
 * becomes a new version of the same row, and the old one is kept as history.
 */
'use strict';

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* Same resolution as the sidecar: WORKSPACES env, else the default data directory. */
export function workspacesRoot() {
  if (process.env.MEMORIAL_WORKSPACES) return path.resolve(process.env.MEMORIAL_WORKSPACES);
  if (process.env.WORKSPACES) return path.resolve(process.env.WORKSPACES);
  return path.join(os.homedir(), '.local', 'share', 'StarNet', 'workspaces');
}

function manifest(WS) {
  const { makeDeliverableManifest } = require(path.join(REPO, 'sidecar', 'deliverable-manifest.js'));
  return makeDeliverableManifest({
    fs, path, crypto, now: () => Date.now(),
    root: path.join(WS, '.deliverables'),
    workspaceRootOf: (agentId) => path.join(WS, String(agentId || 'agent')),
  });
}

const safe = s => String(s || '').replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'film';

/**
 * sendToOutbox
 * @param files  [{ file: absolute path, as?: name in the outbox folder }] — the film first
 * @param opts   { orderId, owner='agent', shareWith=['agent'], qcSummary?, workspaces? }
 * @returns { ok, rows:[{id, filename, version, verification, deduped}], invalid:[…], folder }
 */
export async function sendToOutbox(files, opts = {}) {
  const WS = opts.workspaces || workspacesRoot();
  const owner = safe(opts.owner || 'agent');
  const orderId = safe(opts.orderId);
  if (!fs.existsSync(path.join(WS, owner))) throw new Error(`outbox: no workspace for agent '${owner}' under ${WS}`);
  const relDir = path.posix.join('outbox', 'memorial', orderId);
  const absDir = path.join(WS, owner, relDir);
  await fsp.mkdir(absDir, { recursive: true });

  const rels = [];
  for (const f of files) {
    if (!f || !f.file || !fs.existsSync(f.file)) throw new Error(`outbox: file not found: ${f && f.file}`);
    const name = safe(f.as || path.basename(f.file));
    const dest = path.join(absDir, name);
    /* Copy through a temp name so the Outbox can never index a half-written film. */
    const tmp = dest + '.part';
    await fsp.copyFile(f.file, tmp);
    await fsp.rename(tmp, dest);
    rels.push(path.posix.join(relDir, name));
  }

  const m = manifest(WS);
  const reg = m.register({
    ownerAgentId: owner, runId: orderId, projectId: 'memorial-' + orderId,
    shareWith: Array.isArray(opts.shareWith) ? opts.shareWith : ['agent'],
    files: rels, provider: 'memorial-engine',
  });
  if (!reg.ok) throw new Error(`outbox: register refused: ${reg.error}`);

  const vv = require(path.join(REPO, 'sidecar', 'video-verify.js'));
  const { mimeOf } = require(path.join(REPO, 'sidecar', 'deliverable-manifest.js'));
  const rows = [];
  for (const e of reg.entries) {
    /* Rows registered before .mp4 was in the manifest's type table carry application/octet-stream and
       download instead of playing. Correct them through the manifest's own append-only patch(). */
    const want = mimeOf(e.path);
    if (e.mime !== want && want !== 'application/octet-stream') {
      const p = m.patch(e.id, { mime: want });
      if (p.ok) e.mime = want;
    }
    let verification = e.verification;
    if (!e.deduped && e.kind === 'video') {
      const verdict = await vv.verifyVideoFile(path.join(WS, owner, e.path));
      verification = verdict.ok ? 'passed' : 'failed';
      const base = verdict.ok ? `video-verify: real footage, ${verdict.bytes} bytes` : `video-verify: ${verdict.reason} (${verdict.bytes} bytes)`;
      const detail = e.path === rels[0] && opts.qcSummary ? `${base}; memorial QC: ${opts.qcSummary}` : base;
      const r = m.setVerification(e.id, verification, detail);
      if (!r.ok) throw new Error(`outbox: could not record verification for ${e.id}: ${r.error}`);
    }
    rows.push({ id: e.id, filename: e.filename, version: e.version, kind: e.kind, bytes: e.bytes, verification, deduped: !!e.deduped });
  }
  return { ok: true, rows, invalid: reg.invalid, folder: absDir };
}

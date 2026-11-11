/* memorial/business/jsonl.mjs — a durable append-only log, and nothing else.
 *
 * WHY THIS EXISTS
 * ---------------
 * The order ledger, the exception queue and the cost ledger are all append-only event logs whose
 * state is derived by replay. That is one primitive, written once.
 *
 * WHY NOT writeFileDurable: StarNet's sidecar/durable-write.js is the right tool for replacing a
 * whole document (it writes a tmp, fsyncs, renames). For an append-only log that would mean
 * rewriting the entire file on every event — O(n) writes and a window where the file is a tmp.
 * The correct primitive for a log is open('a') -> write -> fsync -> close, which is what this is.
 * The durability property we need is the same one durable-write.js is careful about: the bytes
 * are on the platter before the call returns, so a kill between events cannot lose a committed one.
 *
 * WHY NOT project-orchestration.js's atomicWrite: it has no fsync, no backup, and a Date.now()
 * temp suffix that collides under concurrency. It is the counter-example, not the model.
 *
 * A torn final line (power loss mid-write) is tolerated on read rather than throwing: a log whose
 * last line is half-written must still yield every complete event before it. Silently dropping a
 * COMPLETE line would be a correctness bug, so only a trailing unparseable line is forgiven, and
 * it is reported.
 */
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export function businessRoot() {
  return process.env.MEMORIAL_BUSINESS_ROOT
    || path.join(os.homedir(), '.local', 'share', 'StarNet', 'workspaces', '.business');
}

export function logPath(name) {
  return path.join(businessRoot(), name);
}

/** Append one event, durably. Returns the event as written (with ts/seq filled). */
export function append(file, event) {
  if (!event || typeof event !== 'object') throw new Error('append: event must be an object');
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

  const row = { ts: event.ts || new Date().toISOString(), ...event };
  const line = JSON.stringify(row) + '\n';

  const fd = fs.openSync(file, 'a', 0o600);
  try {
    const buf = Buffer.from(line, 'utf8');
    let off = 0;
    while (off < buf.length) off += fs.writeSync(fd, buf, off, buf.length - off);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  return row;
}

/** Read every complete event. A single torn trailing line is tolerated and reported. */
export function readAll(file) {
  if (!fs.existsSync(file)) return { rows: [], torn: 0 };
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n');
  const rows = [];
  let torn = 0;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (!ln.trim()) continue;
    try {
      rows.push(JSON.parse(ln));
    } catch {
      /* Only the final line may be torn. Anything else means real corruption and must be loud. */
      const isLast = lines.slice(i + 1).every(l => !l.trim());
      if (isLast) { torn++; break; }
      throw new Error(`${path.basename(file)}: corrupt event at line ${i + 1} (not the final line)`);
    }
  }
  return { rows, torn };
}

/** Replay rows into a Map keyed by `key`, last write wins. Used for state-by-replay. */
export function replay(rows, key = 'id') {
  const m = new Map();
  for (const r of rows) {
    if (!r || r[key] == null) continue;
    const prev = m.get(r[key]);
    m.set(r[key], prev ? { ...prev, ...r } : { ...r });
  }
  return m;
}

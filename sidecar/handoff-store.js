/* sidecar/handoff-store.js — the HOST's own record of one lead→worker handoff, written into the lead's
   OUTBOX as a file the owner can read without a browser.

   WHY THE HOST WRITES IT, NOT THE AGENT. The studio pipeline already learned this the expensive way: agents
   asked to persist their own state did not persist it, the collector polled a file nobody was going to write,
   and four stages reported 300s timeouts while every agent was succeeding (STATION_FIELD_NOTES §13). A handoff
   file written by the model is a claim; a handoff file written here, from the worker row team.dispatch actually
   returned, is evidence. It is also the only version that survives an ASK-mode worker, which cannot fs.write at
   all on an unattended run (cabinet:write default-denies — "silence is not consent").

   TRUTHFUL TELEMETRY. Every field is copied from the dispatch row or minted by the host. `reason` is the
   worker's real terminal reason ('done' | 'timeout' | 'error' | 'refused' | …) and `usd` its real cost — a
   failed handoff is written exactly like a successful one and says so, because a missing file for a worker
   that ran would be the lie. Nothing here infers success.

   makeHandoffStore({ fs, path, dir, now, maxBytes? }) -> { record(h) -> {ok, file, relPath} | {ok:false, error} }
     fs   : node:fs facade — needs mkdirSync + writeFileSync (injected so this is headless-testable)
     path : node:path
     dir  : (agentId) -> that agent's OUTBOX directory (absolute). The LEAD owns the record: it is the lead's
            synthesis input, and a worker's own jail is not writable by this process's notion of the lead.
     now  : () -> ms (injected; no ambient clock here)

   The file is Markdown with a JSON front-block: readable on a phone, parseable by the next routine in the
   chain. Named <ts>-<lead>-to-<worker>.md so an outbox listing sorts chronologically. */
'use strict';

const MAX_BYTES = 256 * 1024;   // one handoff is a result summary, never a payload dump

function safeId(v, fallback) {
  const s = String(v == null ? '' : v).replace(/[^A-Za-z0-9_-]/g, '');
  return s ? s.slice(0, 40) : fallback;
}

// yyyymmdd-hhmmss in UTC, from the INJECTED clock (lint-determinism: no ambient Date.now here).
function stamp(ms) {
  const d = new Date(ms);
  const p = n => String(n).padStart(2, '0');
  return String(d.getUTCFullYear()) + p(d.getUTCMonth() + 1) + p(d.getUTCDate())
    + '-' + p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds());
}

function makeHandoffStore(deps) {
  deps = deps || {};
  const fs = deps.fs, path = deps.path, dirOf = deps.dir, now = deps.now;
  const maxBytes = Number(deps.maxBytes) > 0 ? Number(deps.maxBytes) : MAX_BYTES;

  function record(h) {
    h = h || {};
    if (!fs || !path || typeof dirOf !== 'function' || typeof now !== 'function') {
      return { ok: false, error: 'handoff store not wired' };
    }
    const leadId = safeId(h.leadId, 'agent');
    const workerId = safeId(h.workerId, 'worker');
    const at = now();
    const name = stamp(at) + '-' + leadId + '-to-' + workerId + '.md';
    let dir;
    try { dir = dirOf(leadId); } catch (e) { return { ok: false, error: 'outbox unavailable: ' + ((e && e.message) || e) }; }
    if (!dir) return { ok: false, error: 'outbox unavailable' };
    const file = path.join(dir, name);

    const reason = String(h.reason || 'unknown');
    const usd = (typeof h.usd === 'number' && isFinite(h.usd)) ? h.usd : 0;
    const meta = {
      kind: 'handoff',
      from: leadId,
      to: workerId,
      at: new Date(at).toISOString(),
      reason: reason,
      // the host's one-word verdict. 'done' is the ONLY value that means the worker finished its own contract;
      // everything else is written down as-is so a chain can refuse to advance on it (cron-driver does the same).
      complete: reason === 'done',
      usd: usd,
      leadRunId: String(h.leadRunId || ''),
      workerRunId: String(h.workerRunId || ''),
      cronJobId: String(h.cronJobId || ''),
      artifacts: Array.isArray(h.artifacts) ? h.artifacts.slice(0, 50).map(a => String(a)) : []
    };

    const clip = (s, n) => { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n) + '\n\n[... truncated at ' + n + ' chars ...]' : s; };
    const body = '<!-- starnet-handoff ' + JSON.stringify(meta) + ' -->\n'
      + '# HANDOFF ' + leadId + ' -> ' + workerId + '\n\n'
      + '- when: ' + meta.at + '\n'
      + '- outcome: **' + reason + '**' + (meta.complete ? '' : ' (NOT a completed subtask — do not treat the result below as finished work)') + '\n'
      + '- cost: $' + usd.toFixed(4) + '\n'
      + (meta.cronJobId ? '- routine: ' + meta.cronJobId + '\n' : '')
      + (meta.artifacts.length ? '- files the worker saved: ' + meta.artifacts.join(', ') + '\n' : '')
      + '\n## TASK SENT\n\n' + clip(h.prompt, 8000)
      + (h.context ? '\n\n## CONTEXT SENT\n\n' + clip(h.context, 8000) : '')
      + '\n\n## RESULT RETURNED\n\n' + clip(h.result, maxBytes - 20000) + '\n';

    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, body.length > maxBytes ? body.slice(0, maxBytes) : body, { mode: 0o600 });
    } catch (e) {
      return { ok: false, error: 'could not write handoff: ' + ((e && e.message) || e) };
    }
    return { ok: true, file: file, relPath: 'outbox/' + name, meta: meta };
  }

  return { record };
}

module.exports = { makeHandoffStore, MAX_BYTES };

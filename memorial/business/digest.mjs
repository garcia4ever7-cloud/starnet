/* memorial/business/digest.mjs — one screen that answers "what needs me, and is anything on fire".
 *
 * WHY THIS EXISTS
 * ---------------
 * Exception-based management only works if there is one place to look. This is that place.
 * It deliberately leads with STATION HEALTH rather than with orders, because the most expensive
 * failure this business has actually suffered was not a bad render — it was the sidecar running
 * for six days without its environment file while three cron routines failed silently and nothing
 * said so. A digest that reports "0 open orders" on a dead station is worse than no digest.
 *
 * Everything here is read-only and local. No network beyond 127.0.0.1, no model call, no spend.
 */
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

import * as orders from './orders.mjs';
import * as exceptions from './exceptions.mjs';
import * as costs from './costs.mjs';

function quiet(fn, dflt = null) { try { return fn(); } catch { return dflt; } }

export function stationHealth() {
  const h = { sidecarUp: false, sidecarPid: null, providerKeys: [], spendPending: null, ffmpeg: null, notes: [] };

  h.ffmpeg = quiet(() => execFileSync('ffmpeg', ['-version'], { encoding: 'utf8' }).split('\n')[0].split(' ')[2], null);

  const pid = quiet(() => execFileSync('pgrep', ['-f', 'node sidecar/index\\.js'], { encoding: 'utf8' }).trim().split('\n')[0], null);
  if (pid) {
    h.sidecarPid = Number(pid);
    const body = quiet(() => execFileSync('curl', ['-s', '-m', '4', 'http://127.0.0.1:8787/api/health'], { encoding: 'utf8' }), '');
    h.sidecarUp = /ok/i.test(body || '');

    /* The six-day failure was invisible because nobody checked what the PROCESS holds, as opposed
     * to what the env FILE contains. Those are different things and only the first one matters. */
    const env = quiet(() => fs.readFileSync(`/proc/${pid}/environ`, 'utf8'), '');
    const names = ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'HF_CREDENTIALS', 'KLING_API_KEY', 'STARNET_API_TOKEN'];
    h.providerKeys = names.filter(n => env.includes(n + '='));
    if (!h.providerKeys.includes('STARNET_API_TOKEN')) {
      h.notes.push('sidecar holds no STARNET_API_TOKEN — it minted a random boot token, so documented curl recipes will 403');
    }
    if (h.providerKeys.filter(k => /API_KEY|CREDENTIALS/.test(k)).length === 0) {
      h.notes.push('sidecar holds NO provider keys — no agent can take a turn');
    }
  }

  const sp = path.join(os.homedir(), '.local', 'share', 'StarNet', 'workspaces', '.spend-pending');
  const pend = quiet(() => fs.readdirSync(sp).filter(f => f.endsWith('.json')), null);
  h.spendPending = pend ? pend.length : null;
  if (pend && pend.length) h.notes.push(`${pend.length} unsettled spend receipt(s) — every agent will silently refuse to run`);

  return h;
}

export function build(opts = {}) {
  return {
    at: new Date().toISOString(),
    health: stationHealth(),
    exceptions: exceptions.open(opts),
    orders: {
      open: orders.list({ ...opts, open: true }),
      overdue: orders.overdue(opts),
    },
    costs: costs.summary(opts),
  };
}

export function render(d) {
  const L = [];
  const rule = '─'.repeat(64);
  L.push(rule);
  L.push(`NIGHT4CHRIST — business digest   ${d.at.replace('T', ' ').slice(0, 19)}Z`);
  L.push(rule);

  const h = d.health;
  L.push('');
  L.push('STATION');
  L.push(`  sidecar      ${h.sidecarUp ? 'UP' : (h.sidecarPid ? 'process alive but not answering' : 'DOWN')}${h.sidecarPid ? ` (pid ${h.sidecarPid})` : ''}`);
  L.push(`  ffmpeg       ${h.ffmpeg || 'MISSING'}`);
  L.push(`  provider keys in process  ${h.providerKeys.length ? h.providerKeys.join(', ') : 'NONE'}`);
  L.push(`  spend-pending ${h.spendPending == null ? 'unknown' : (h.spendPending === 0 ? 'clear' : h.spendPending + ' UNSETTLED')}`);
  for (const n of h.notes) L.push(`  !! ${n}`);

  L.push('');
  L.push(`NEEDS YOU (${d.exceptions.length})`);
  if (!d.exceptions.length) L.push('  nothing — routine work is proceeding');
  for (const e of d.exceptions) {
    L.push(`  [${e.severity.toUpperCase()}] ${e.kind}  ${e.id}${e.deadline ? '  due ' + e.deadline : ''}`);
    L.push(`      what      ${e.what}`);
    L.push(`      why you   ${e.why}`);
    if (e.ifIgnored) L.push(`      if left   ${e.ifIgnored}`);
    if (e.suggested) L.push(`      suggest   ${e.suggested}`);
    if (e.seenCount > 1) L.push(`      seen      ${e.seenCount}x, last ${String(e.lastSeen).slice(0, 19)}`);
  }

  L.push('');
  L.push(`ORDERS (${d.orders.open.length} open${d.orders.overdue.length ? `, ${d.orders.overdue.length} OVERDUE` : ''})`);
  if (!d.orders.open.length) L.push('  none in flight');
  for (const o of d.orders.open) {
    const late = o.due && new Date(o.due) < new Date() ? '  ** OVERDUE **' : '';
    L.push(`  ${o.id.padEnd(22)} ${String(o.engine).padEnd(9)} ${o.state.padEnd(10)}${o.due ? ' due ' + String(o.due).slice(0, 10) : ''}${late}`);
  }

  L.push('');
  L.push('COSTS');
  L.push(`  recorded     $${d.costs.total.toFixed(4)} across ${d.costs.rows} entries` +
         (d.costs.estimated ? `  (includes $${d.costs.estimated.toFixed(4)} ESTIMATED — vendor exposes no real figure)` : ''));
  for (const [k, v] of Object.entries(d.costs.byKind)) L.push(`    ${k.padEnd(10)} $${v.toFixed(4)}`);

  L.push(rule);
  return L.join('\n');
}

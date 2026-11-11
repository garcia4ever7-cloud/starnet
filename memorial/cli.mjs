#!/usr/bin/env node
/* memorial/cli.mjs — the operator surface for the memorial engine.
 *
 * Runs with zero model calls, zero network and zero spend. Everything here works on a station
 * with no provider credit and, apart from `status`, with the sidecar switched off entirely.
 *
 *   node memorial/cli.mjs render <order.json> [--force]
 *   node memorial/cli.mjs verify <order.json>
 *   node memorial/cli.mjs status
 *   node memorial/cli.mjs orders
 *   node memorial/cli.mjs exceptions
 *   node memorial/cli.mjs raise --id X --kind blocked --what "..." --why "..." [--severity high]
 *   node memorial/cli.mjs resolve <exceptionId> [note]
 */
'use strict';

import fs from 'node:fs';
import path from 'node:path';

import { renderOrder, buildPlan, dirsFor } from './render.mjs';
import { verifyFilm, formatChecks } from './verify.mjs';
import * as orders from './business/orders.mjs';
import * as exceptions from './business/exceptions.mjs';
import * as costs from './business/costs.mjs';
import * as digest from './business/digest.mjs';

const argv = process.argv.slice(2);
const cmd = argv[0];

function flag(name, dflt = null) {
  const i = argv.indexOf('--' + name);
  return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : dflt;
}

function loadOrder(file) {
  if (!file) die('an order JSON path is required');
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) die(`order file not found: ${abs}`);
  const order = JSON.parse(fs.readFileSync(abs, 'utf8'));
  order.__file = abs;
  return { order, baseDir: path.dirname(abs) };
}

function die(msg) { console.error('memorial: ' + msg); process.exit(2); }

async function cmdRender() {
  const { order, baseDir } = loadOrder(argv[1]);
  const engine = 'memorial';

  if (!orders.get(order.orderId)) {
    orders.create({ orderId: order.orderId, engine, tier: order.tier, title: order.subject && order.subject.name, due: order.due });
    orders.transition(order.orderId, 'ready', { note: 'order file present' });
  }
  const cur = orders.get(order.orderId);
  if (cur.state === 'ready') orders.transition(order.orderId, 'rendering', { worker: 'cli' });

  let res;
  try {
    res = await renderOrder(order, { baseDir, log: s => console.log(s) });
  } catch (e) {
    orders.transition(order.orderId, 'blocked', { error: e.message });
    exceptions.raise({
      id: `render-failed:${order.orderId}`, kind: 'blocked', severity: 'high', engine, orderId: order.orderId,
      what: `Render failed for ${order.orderId}: ${e.message}`,
      why: 'The pipeline cannot diagnose a failed render on its own; the order is stopped until someone looks.',
      ifIgnored: 'The order is never delivered and, if it has a service date, the family is let down on the day.',
      suggested: 'Run `node memorial/cli.mjs render <order.json>` again — segments already rendered are reused — and read the ffmpeg tail above.',
      deadline: order.due || null,
    });
    die(e.message);
  }

  orders.transition(order.orderId, 'rendered', { path: res.path, bytes: res.bytes });

  /* Labour is the only real cost in this design, so it is recorded rather than left implied. */
  costs.record({ orderId: order.orderId, engine, kind: 'labour', usd: 0,
    units: `${res.wallSec.toFixed(0)}s render`, note: `${res.segments} segments, ${res.realtimeRatio?.toFixed(2)}x realtime` });

  const plan = buildPlan(order);
  const dirs = dirsFor(order, baseDir);
  const v = await verifyFilm(res.path, {
    width: plan.w, height: plan.h, durationSec: plan.totalSec,
    expectAudio: !!(order.music && order.music.file),
    workDir: dirs.work, segments: plan.items.length,
  });
  console.log('\nverification:');
  console.log(formatChecks(v));

  if (v.ok) {
    orders.transition(order.orderId, 'verified', { path: res.path });
    console.log(`\nVERIFIED  ${res.path}`);
  } else {
    orders.transition(order.orderId, 'blocked', { failed: v.failed });
    exceptions.raise({
      id: `verify-failed:${order.orderId}`, kind: 'quality', severity: 'high', engine, orderId: order.orderId,
      what: `Film rendered but failed verification: ${v.failed.join(', ')}`,
      why: 'A film that fails mechanical checks must never be sent to a grieving family; a human has to decide whether to fix or re-shoot the order.',
      ifIgnored: 'Either nothing is delivered, or something broken is.',
      suggested: 'Inspect the failing checks above, correct the order JSON or source photos, and re-render.',
      deadline: order.due || null,
    });
    console.log(`\nNOT DELIVERABLE — ${v.failed.join(', ')}`);
    process.exit(1);
  }
}

async function cmdVerify() {
  const { order, baseDir } = loadOrder(argv[1]);
  const plan = buildPlan(order);
  const dirs = dirsFor(order, baseDir);
  const file = path.join(dirs.out, `${order.orderId}.mp4`);
  const v = await verifyFilm(file, {
    width: plan.w, height: plan.h, durationSec: plan.totalSec,
    expectAudio: !!(order.music && order.music.file),
    workDir: dirs.work, segments: plan.items.length,
  });
  console.log(file);
  console.log(formatChecks(v));
  process.exit(v.ok ? 0 : 1);
}

function cmdStatus() { console.log(digest.render(digest.build())); }

function cmdOrders() {
  const rows = orders.list({});
  if (!rows.length) return console.log('(no orders)');
  for (const o of rows) console.log(`${o.id.padEnd(24)} ${String(o.engine).padEnd(9)} ${o.state.padEnd(10)} ${o.title || ''}`);
}

function cmdExceptions() {
  const rows = exceptions.open();
  if (!rows.length) return console.log('(no open exceptions)');
  for (const e of rows) console.log(`[${e.severity}] ${e.kind.padEnd(9)} ${e.id}\n    ${e.what}\n    why: ${e.why}`);
}

function cmdRaise() {
  const ex = exceptions.raise({
    id: flag('id'), kind: flag('kind', 'decision'), severity: flag('severity', 'normal'),
    engine: flag('engine', null), orderId: flag('order', null),
    what: flag('what'), why: flag('why'), ifIgnored: flag('if-ignored', null),
    suggested: flag('suggest', null), deadline: flag('deadline', null),
  });
  console.log('raised ' + ex.id);
}

function cmdResolve() {
  const id = argv[1];
  if (!id) die('exception id required');
  exceptions.resolve(id, argv.slice(2).join(' ') || null);
  console.log('resolved ' + id);
}

const TABLE = {
  render: cmdRender, verify: cmdVerify, status: cmdStatus,
  orders: cmdOrders, exceptions: cmdExceptions, raise: cmdRaise, resolve: cmdResolve,
};

(async () => {
  const fn = TABLE[cmd];
  if (!fn) {
    console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(3, 14).map(l => l.replace(/^ \* ?/, '')).join('\n'));
    process.exit(cmd ? 2 : 0);
  }
  await fn();
})().catch(e => { console.error('memorial: ' + (e && e.message || e)); process.exit(1); });

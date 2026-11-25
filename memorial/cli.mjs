#!/usr/bin/env node
/* memorial/cli.mjs — the operator surface for the memorial engine.
 *
 * Runs with zero model calls, zero network and zero spend. Everything here works on a station
 * with no provider credit and, apart from `status`, with the sidecar switched off entirely.
 *
 *   node memorial/cli.mjs new <photos-dir> --name "Full Name" [--born YYYY-MM-DD] [--died YYYY-MM-DD]
 *                                          [--music <track>] [--out order.json]
 *   node memorial/cli.mjs faces  <order.json>     face sheet: check what the detector found
 *   node memorial/cli.mjs plan   <order.json>     storyboard + audit, in seconds, no rendering
 *   node memorial/cli.mjs render <order.json> [--force]
 *   node memorial/cli.mjs verify <order.json>
 *   node memorial/cli.mjs qc     <order.json>     re-run the quality gate on a finished film
 *   node memorial/cli.mjs proof  <order.json>     watermarked copy for the family's approval
 *   node memorial/cli.mjs tv     <order.json> [--seconds 12] [--start 0]
 *   node memorial/cli.mjs outbox <order.json> send the film (+ proof, TV clip) to the StarNet Outbox
 *   node memorial/cli.mjs music                   the licensed library
 *   node memorial/cli.mjs status | orders | exceptions
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
  let order;
  try { order = JSON.parse(fs.readFileSync(abs, 'utf8')); } catch (e) { die(`order file is not valid JSON: ${e.message}`); }
  order.__file = abs;
  return { order, baseDir: path.dirname(abs) };
}

function die(msg) { console.error('memorial: ' + msg); process.exit(2); }

const isGallery = order => order.style === 'gallery';
const mmss = sec => { const t = Math.round(sec); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };

/* Move the order's state only along edges the state machine allows. A re-render of an order
 * that was already verified has no legal edge back to `rendering`; it is recorded as a note. */
function move(orderId, to, detail) {
  const cur = orders.get(orderId);
  if (cur && cur.state === to) return;
  if (cur && orders.canTransition(cur.state, to)) orders.transition(orderId, to, detail);
  else if (cur && to === 'rendering' && orders.canTransition(cur.state, 'blocked')) {
    orders.transition(orderId, 'blocked', { note: 're-render requested' });
    orders.transition(orderId, 'rendering', detail);
  }
}

/* Mechanical checks for a finished film: the original six, plus the quality gate for gallery. */
async function checkFilm(order, baseDir, filePath, ctx = null) {
  let plan, report = null;
  if (isGallery(order)) {
    if (ctx) ({ plan, report } = ctx);
    else {
      const { planGallery } = await import('./gallery.mjs');
      ({ plan, report } = await planGallery(order, { baseDir }));
      const saved = path.join(dirsFor(order, baseDir).out, `${order.orderId}.report.json`);
      try { report = JSON.parse(fs.readFileSync(saved, 'utf8')); } catch { /* use the fresh plan's */ }
    }
  } else plan = buildPlan(order);
  const dirs = dirsFor(order, baseDir);
  const narrated = !!(order.narration && order.narration.file);
  const hasAudio = narrated || !!(order.music && order.music !== 'none');
  const v = await verifyFilm(filePath, {
    width: plan.w, height: plan.h, durationSec: plan.totalSec,
    expectAudio: hasAudio, workDir: dirs.work, segments: plan.items.length,
  });
  const { qcFilm } = await import('./qc.mjs');
  const q = await qcFilm(filePath, { plan, report, expectAudio: hasAudio, gallery: isGallery(order), targetLufs: isGallery(order) && !narrated ? undefined : -14 });
  /* Classic films predate the gate; it reports on them but only the original checks block. */
  const blocking = isGallery(order) ? q.failed : [];
  return { v, q, ok: v.ok && blocking.length === 0, failed: [...v.failed, ...blocking] };
}

async function cmdRender() {
  const { order, baseDir } = loadOrder(argv[1]);
  const engine = 'memorial';

  if (!orders.get(order.orderId)) {
    orders.create({ orderId: order.orderId, engine, tier: order.tier, title: order.subject && order.subject.name, due: order.due });
    orders.transition(order.orderId, 'ready', { note: 'order file present' });
  }
  move(order.orderId, 'rendering', { worker: 'cli' });

  let res;
  try {
    res = await renderOrder(order, { baseDir, force: flag('force') === true, log: s => console.log(s) });
  } catch (e) {
    move(order.orderId, 'blocked', { error: e.message });
    exceptions.raise({
      id: `render-failed:${order.orderId}`, kind: 'blocked', severity: 'high', engine, orderId: order.orderId,
      what: `Render failed for ${order.orderId}: ${e.message}`,
      why: 'The pipeline cannot diagnose a failed render on its own; the order is stopped until someone looks.',
      ifIgnored: 'The order is never delivered and, if it has a service date, the family is let down on the day.',
      suggested: 'Run `node memorial/cli.mjs render <order.json>` again — segments already rendered are reused — and read the message above.',
      deadline: order.due || null,
    });
    die(e.message);
  }

  move(order.orderId, 'rendered', { path: res.path, bytes: res.bytes });

  /* Labour is the only real cost in this design, so it is recorded rather than left implied. */
  costs.record({ orderId: order.orderId, engine, kind: 'labour', usd: 0,
    units: `${res.wallSec.toFixed(0)}s render`, note: `${res.segments} segments, ${res.realtimeRatio?.toFixed(2)}x realtime` });

  const c = await checkFilm(order, baseDir, res.path, res.plan ? { plan: res.plan, report: res.report } : null);
  console.log('\nverification:');
  console.log(formatChecks(c.v));
  const { formatQc } = await import('./qc.mjs');
  console.log('\nquality gate:');
  console.log(formatQc(c.q));

  if (c.ok) {
    move(order.orderId, 'verified', { path: res.path });
    console.log(`\nVERIFIED  ${res.path}`);
    if (c.q.warnings.length) console.log(`  ${c.q.warnings.length} warning(s) above need a person's eye before delivery: ${c.q.warnings.join(', ')}`);
  } else {
    move(order.orderId, 'blocked', { failed: c.failed });
    exceptions.raise({
      id: `verify-failed:${order.orderId}`, kind: 'quality', severity: 'high', engine, orderId: order.orderId,
      what: `Film rendered but failed verification: ${c.failed.join(', ')}`,
      why: 'A film that fails mechanical checks must never be sent to a grieving family; a human has to decide whether to fix or re-shoot the order.',
      ifIgnored: 'Either nothing is delivered, or something broken is.',
      suggested: 'Inspect the failing checks above, correct the order JSON or source photos, and re-render.',
      deadline: order.due || null,
    });
    console.log(`\nNOT DELIVERABLE — ${c.failed.join(', ')}`);
    process.exit(1);
  }
}

function filmPath(order, baseDir) { return path.join(dirsFor(order, baseDir).out, `${order.orderId}.mp4`); }

async function cmdVerify() {
  const { order, baseDir } = loadOrder(argv[1]);
  const file = filmPath(order, baseDir);
  const c = await checkFilm(order, baseDir, file);
  console.log(file);
  console.log(formatChecks(c.v));
  process.exit(c.v.ok ? 0 : 1);
}

async function cmdQc() {
  const { order, baseDir } = loadOrder(argv[1]);
  const file = filmPath(order, baseDir);
  const c = await checkFilm(order, baseDir, file);
  const { formatQc } = await import('./qc.mjs');
  console.log(file);
  console.log(formatChecks(c.v));
  console.log(formatQc(c.q));
  console.log(c.ok ? `\nPASS${c.q.warnings.length ? ` with ${c.q.warnings.length} warning(s)` : ''}` : `\nFAIL — ${c.failed.join(', ')}`);
  process.exit(c.ok ? 0 : 1);
}

function needGallery(order, what) {
  if (!isGallery(order)) die(`${what} needs a gallery order — add "style": "gallery" to the order JSON`);
}

async function cmdFaces() {
  const { order, baseDir } = loadOrder(argv[1]);
  needGallery(order, 'faces');
  const { planGallery } = await import('./gallery.mjs');
  const { faceSheet } = await import('./proof.mjs');
  const { photos, dirs } = await planGallery(order, { baseDir, force: flag('force') === true, log: s => console.log(s) });
  const out = path.join(dirs.out, `${order.orderId}.faces.jpg`);
  await faceSheet(photos, out);
  console.log('');
  for (const p of photos) {
    const boxes = (p.faces || []).map(f => `[${[f.x0, f.y0, f.x1, f.y1].map(v => v.toFixed(3)).join(', ')}]`).join(', ');
    console.log(`${String(p.index + 1).padStart(3)}. ${path.basename(p.order.file).padEnd(28)} ${p.faceSource.padEnd(9)} ${p.faces ? p.faces.length : '?'} face(s)${boxes ? '  "faces": [' + boxes + ']' : ''}`);
  }
  console.log(`\nface sheet: ${out}`);
  console.log('Look at it. For any face that is missing or wrong, add  "faces": [[x0,y0,x1,y1], ...]  (fractions of the');
  console.log('photo, left/top/right/bottom) to that photo in the order; use  "faces": []  only for a photo with nobody in it.');
  console.log('When every photo is right, add  "facesReviewed": true  to the order.');
}

async function cmdPlan() {
  const { order, baseDir } = loadOrder(argv[1]);
  needGallery(order, 'plan');
  const { planGallery } = await import('./gallery.mjs');
  const { storyboard, faceSheet } = await import('./proof.mjs');
  const { plan, report, dirs, photos } = await planGallery(order, { baseDir, force: flag('force') === true, log: s => console.log(s) });
  console.log('');
  for (const r of report.items) {
    const what = r.kind === 'card' ? `card ${r.type}` : `${r.layout.padEnd(7)} photo ${r.photos.map(i => i + 1).join(',')}`;
    console.log(`${String(r.n + 1).padStart(3)}. ${mmss(Math.floor(r.at))}  ${what.padEnd(26)} ${r.hold.toFixed(1).padStart(5)}s  ${r.actBreak ? 'ACT BREAK  ' : ''}${r.why || ''}`);
  }
  console.log(`\nfilm length ${mmss(report.durationSec)}  (${report.items.length} items, ${photos.length} photos)`);
  if (report.musicFit) console.log(report.musicFit.applied ? `music fit: photo holds ×${report.musicFit.scale} to end with the music` : `music fit NOT applied: ${report.musicFit.reason}`);
  const bad = report.audit.filter(a => !a.ok);
  const warn = report.audit.filter(a => a.warn);
  console.log(`audit: ${report.audit.length - bad.length} of ${report.audit.length} placement checks pass`);
  for (const a of bad) console.log(`  FAIL item ${a.item + 1} ${a.check}: ${a.detail}`);
  for (const a of warn) console.log(`  WARN item ${a.item + 1}: ${a.detail}`);
  const sb = path.join(dirs.out, `${order.orderId}.storyboard.jpg`);
  await storyboard(plan, report, sb);
  const fsheet = path.join(dirs.out, `${order.orderId}.faces.jpg`);
  await faceSheet(photos, fsheet);
  console.log(`storyboard: ${sb}\nface sheet: ${fsheet}`);
  process.exit(bad.length ? 1 : 0);
}

async function cmdProof() {
  const { order, baseDir } = loadOrder(argv[1]);
  const { makeProof } = await import('./proof.mjs');
  const out = path.join(dirsFor(order, baseDir).out, `${order.orderId}.proof.mp4`);
  await makeProof(filmPath(order, baseDir), out, { text: typeof flag('text') === 'string' ? flag('text') : undefined });
  console.log(`${out}  (${(fs.statSync(out).size / 1048576).toFixed(1)} MB)`);
}

async function cmdTv() {
  const { order, baseDir } = loadOrder(argv[1]);
  const { makeTvPreview } = await import('./proof.mjs');
  const dirs = dirsFor(order, baseDir);
  const out = path.join(dirs.out, `${order.orderId}.tv.mp4`);
  const still = path.join(dirs.out, `${order.orderId}.tv.jpg`);
  await makeTvPreview(filmPath(order, baseDir), out, { seconds: Number(flag('seconds', 12)), start: Number(flag('start', 0)), still });
  console.log(`${out}\n${still}`);
}

/* The finished film into the StarNet Outbox. Refuses a film that has not passed the gate: the
 * Outbox is where the owner decides what goes to a family, so nothing unverified is put there. */
async function cmdOutbox() {
  const { order, baseDir } = loadOrder(argv[1]);
  const film = filmPath(order, baseDir);
  if (!fs.existsSync(film)) die(`no finished film at ${film} — render it first`);
  const c = await checkFilm(order, baseDir, film);
  if (!c.ok) die(`the film does not pass its checks (${c.failed.join(', ')}) — not sent to the Outbox`);
  const out = dirsFor(order, baseDir).out;
  const files = [{ file: film }];
  for (const extra of ['proof.mp4', 'tv.mp4', 'storyboard.jpg']) {
    const f = path.join(out, `${order.orderId}.${extra}`);
    if (fs.existsSync(f)) files.push({ file: f });
  }
  const warn = c.q.warnings.length ? `, ${c.q.warnings.length} warning(s): ${c.q.warnings.join(', ')}` : '';
  const summary = `${c.q.checks.filter(x => x.ok).length}/${c.q.checks.length} checks pass${warn}`;
  const { sendToOutbox } = await import('./outbox.mjs');
  /* Shared with `agent` only: NIGHT4CHRIST is the Commander, so this is the owner's own Outbox. */
  const r = await sendToOutbox(files, { orderId: order.orderId, shareWith: ['agent'], qcSummary: summary });
  for (const row of r.rows) console.log(`  ${row.deduped ? 'already there' : 'added       '}  ${row.filename.padEnd(44)} v${row.version}  ${row.kind}  verification: ${row.verification}`);
  for (const i of r.invalid) console.log(`  REFUSED  ${i.path}: ${i.error}`);
  console.log(`\nOutbox folder: ${r.folder}`);
  /* The film itself refused is a failure, not a footnote. Known cause: a sidecar older than the
   * 2026-11-24 streaming change caps manifest files at 64 MB (deliverable-manifest.js MAX_READ_BYTES).
   * Since that change (live 2026-11-25) files up to 2 GB register and stream with Range support.
   * The proof copy is small and still goes in. */
  const filmName = path.basename(film);
  if (r.invalid.some(i => path.basename(i.path) === filmName)) {
    console.log(`\nTHE FILM ITSELF WAS NOT ADDED (${(fs.statSync(film).size / 1048576).toFixed(1)} MB). This StarNet holds files up to 64 MB — is it running the 2026-11-24 streaming change?`);
    console.log(fs.existsSync(path.join(out, `${order.orderId}.proof.mp4`))
      ? 'The watermarked proof was added instead, so it can be watched there.'
      : `Run  node memorial/cli.mjs proof ${argv[1]}  and send again to put a watchable copy in the Outbox.`);
    process.exit(1);
  }
  console.log('Open StarNet → Outbox. QC and approval are left for you.');
}

async function cmdMusic() {
  const { library, MUSIC_DIR } = await import('./audio.mjs');
  const lib = library();
  if (!lib.tracks.length) return console.log('(no music library — memorial/assets/music/manifest.json is missing)');
  for (const t of lib.tracks) {
    const have = fs.existsSync(path.join(MUSIC_DIR, t.file));
    console.log(`${t.slug.padEnd(26)} ${mmss(t.durationSec)}  ${t.tier.padEnd(7)} ${have ? '' : '[FILE MISSING] '}${t.title} — ${t.performer}; ${t.mood}`);
  }
  console.log(`\ndefault: ${lib.default}\n${lib.note}`);
}

/* Scaffold an order from a folder of photographs. Sorted by file name, so naming the files in
 * the order they should appear (01-…, 02-…) is the whole interface. */
async function cmdNew() {
  const dir = argv[1] && !argv[1].startsWith('--') ? path.resolve(argv[1]) : null;
  if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) die('new: a folder of photographs is required');
  const name = flag('name');
  if (typeof name !== 'string') die('new: --name "Full Name" is required');
  const files = fs.readdirSync(dir).filter(f => /\.(jpe?g|png|webp|heic|heif|tiff?|bmp)$/i.test(f)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!files.length) die(`new: no photographs found in ${dir}`);
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'order';
  const outFile = path.resolve(typeof flag('out') === 'string' ? flag('out') : path.join(dir, 'order.json'));
  if (fs.existsSync(outFile)) die(`new: ${outFile} already exists — not overwriting`);
  const { library } = await import('./audio.mjs');
  const lib = library();
  const track = typeof flag('music') === 'string' ? flag('music') : lib.default;
  const order = {
    orderId: `mem-${stamp}-${slug}`,
    engine: 'memorial',
    style: 'gallery',
    theme: 'warm',
    subject: { name, born: typeof flag('born') === 'string' ? flag('born') : '', died: typeof flag('died') === 'string' ? flag('died') : '' },
    music: track ? { track, fit: true } : 'none',
    facesReviewed: false,
    recap: true,
    photos: files.map(f => ({ file: path.relative(path.dirname(outFile), path.join(dir, f)) || f, caption: '' })),
    cards: [
      { at: 'open', type: 'title' },
      { at: 'close', type: 'verse', ref: 'Psalm 23:4', translation: 'KJV',
        text: 'Yea, though I walk through the valley of the shadow of death, I will fear no evil: for thou art with me; thy rod and thy staff they comfort me.' },
      { at: 'close', type: 'closing', line: 'Forever in our hearts' },
    ],
  };
  fs.writeFileSync(outFile, JSON.stringify(order, null, 2) + '\n');
  console.log(`wrote ${outFile}  (${files.length} photos)`);
  console.log('next:  edit captions / add chapter cards, then');
  console.log(`  node memorial/cli.mjs faces ${path.relative(process.cwd(), outFile)}`);
  console.log(`  node memorial/cli.mjs plan  ${path.relative(process.cwd(), outFile)}`);
  console.log(`  node memorial/cli.mjs render ${path.relative(process.cwd(), outFile)}`);
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
  new: cmdNew, faces: cmdFaces, plan: cmdPlan, render: cmdRender, verify: cmdVerify, qc: cmdQc,
  proof: cmdProof, tv: cmdTv, outbox: cmdOutbox, music: cmdMusic, status: cmdStatus,
  orders: cmdOrders, exceptions: cmdExceptions, raise: cmdRaise, resolve: cmdResolve,
};

(async () => {
  const fn = TABLE[cmd];
  if (!fn) {
    console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(3, 20).map(l => l.replace(/^ \* ?/, '')).join('\n'));
    process.exit(cmd ? 2 : 0);
  }
  await fn();
})().catch(e => { console.error('memorial: ' + (e && e.message || e)); process.exit(1); });

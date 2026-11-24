/* test/memorial-actbreak.test.js — an order's act break must actually dip to black.
 *
 * WHY IT EXISTS (2026-11-24). render.mjs's join has always chosen `fadeblack` for an item with
 * `actBreak` set, but buildPlan() never copied that flag from the order onto the plan items, so
 * the branch was unreachable: every film was all-dissolve whatever the order said. The second,
 * quieter half of the same defect: the join cache reused an existing join whenever no segment
 * was newer than it, and the transitions live in no segment file — so even with the flag
 * carried, an order edited to add an act break would re-render with its OLD join.
 *
 * What must stay true:
 *  - with no actBreak anywhere, every transition stays the default dissolve (existing films unchanged)
 *  - actBreak: true on a photo or a card (open / mid / close) reaches its plan item
 *  - the transition INTO that item, and only that one, is a dip to black in the join graph
 *  - the dip is SYMMETRIC and reaches legal video black (2026-11-24, stage 2): ffmpeg's built-in
 *    `fadeblack` was replaced because it is lopsided (outgoing picture gone in a fifth of the
 *    transition) and bottoms out below video black. The dip is now a fade-out on the outgoing
 *    segment, a short plain dissolve between the two black ends, and an equal fade-in.
 *  - actBreak must be a real boolean; a typo fails the order instead of being ignored
 *  - LIVE: the rendered film dips to near-black inside that transition and nowhere else
 *  - LIVE: re-rendering the same order after adding, then removing, an act break rebuilds the
 *    join each time instead of reusing a stale one
 *
 * The live part renders three solid-colour photos at 320x180 with no oversampling, so it takes
 * seconds, and uses no cards (cards need a serif font that CI machines do not have).
 *
 * Run standalone: node test/memorial-actbreak.test.js [path/to/render.mjs]
 * The optional path exists only to replay this test against an older copy of render.mjs and
 * watch it fail; by default it tests memorial/render.mjs. */
'use strict';
const A = require('./_assert.js');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

/* The transition is what is under test, not drift smoothness, so 1x keeps the render fast.
 * Must be set before render.mjs is imported: OVERSAMPLE is read once at module load. */
process.env.MEMORIAL_OVERSAMPLE = '1';

function haveFfmpeg() {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
    return true;
  } catch { return false; }
}

/* Per-frame mean luma of a video as [{t, y}], from ffmpeg signalstats (YAVG, 8-bit scale). */
function lumaTrace(file, tmp) {
  const log = path.join(tmp, 'yavg.txt');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', file, '-vf',
    `signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=${log}`, '-an', '-f', 'null', '-'],
    { stdio: 'ignore', timeout: 120000 });
  const out = [];
  let t = null;
  for (const line of fs.readFileSync(log, 'utf8').split('\n')) {
    const m = line.match(/pts_time:([0-9.]+)/);
    if (m) t = Number(m[1]);
    const y = line.match(/YAVG=([0-9.]+)/);
    if (y && t !== null) out.push({ t, y: Number(y[1]) });
  }
  return out;
}
const minIn = (trace, a, b) => Math.min(...trace.filter(p => p.t >= a && p.t <= b).map(p => p.y));

(async () => {
  const modPath = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(__dirname, '..', 'memorial', 'render.mjs');
  const R = await import(pathToFileURL(modPath).href);
  const hasJoinGraph = typeof R.joinGraph === 'function';
  A.ok(hasJoinGraph, 'render.mjs exports joinGraph(plan) — the join graph as a pure function');

  /* ---------- 1. PLAN: the flag reaches the right item, and only when asked ---------- */
  /* buildPlan never opens photo files, so placeholder paths are fine here. Item order:
   * 0 open card, 1 p1, 2 p2, 3 mid card (after 2), 4 p3, 5 p4, 6 close card. */
  const order = (edit) => {
    const o = {
      orderId: 'actbreak-plan', hold: 2.0, xfade: 1.0,
      photos: [1, 2, 3, 4].map(n => ({ file: `/nonexistent/${n}.jpg` })),
      cards: [{ at: 'open', type: 'title' }, { after: 2, type: 'verse' }, { at: 'close', type: 'closing' }],
    };
    if (edit) edit(o);
    return o;
  };
  const breaks = plan => plan.items.map(it => it.actBreak === true);
  /* A dip INTO item i shows up as a fade-in pre-filter on input i (and a matching fade-out on
   * input i-1). The classic style has no head fade, so any fade-in here is an act break. */
  const dipInto = g => [...g.matchAll(/\[(\d+):v\][^;\[]*fade=t=in/g)].map(m => Number(m[1]));
  const fadeOutOf = g => [...g.matchAll(/\[(\d+):v\][^;\[]*fade=t=out/g)].map(m => Number(m[1]));
  const fadeLen = (g, i, dir) => { const m = g.match(new RegExp(`\\[${i}:v\\][^;\\[]*fade=t=${dir}:st=[0-9.]+:d=([0-9.]+)`)); return m ? Number(m[1]) : null; };

  {
    const p = R.buildPlan(order());
    A.eq(p.items.length, 7, 'plan has 7 items (open, 2 photos, mid card, 2 photos, close)');
    A.eq(breaks(p), [false, false, false, false, false, false, false], 'no actBreak in the order → no item asks for one');
    if (hasJoinGraph) {
      const g = R.joinGraph(p);
      A.eq(dipInto(g), [], 'no actBreak → no dip anywhere in the join');
      A.ok(!g.includes('fade=t='), 'no actBreak → no fade filters at all (classic graph unchanged)');
      A.eq((g.match(/transition=fade:duration=1:/g) || []).length, 6, 'no actBreak → all 6 joins are the default 1 s dissolve');
      A.ok(!g.includes('fadeblack'), 'the lopsided built-in fadeblack is never used');
    }
  }

  const cases = [
    ['mid card', o => { o.cards[1].actBreak = true; }, 3],
    ['photo', o => { o.photos[2].actBreak = true; }, 4],
    ['close card', o => { o.cards[2].actBreak = true; }, 6],
  ];
  for (const [label, edit, idx] of cases) {
    const p = R.buildPlan(order(edit));
    const want = [false, false, false, false, false, false, false];
    want[idx] = true;
    A.eq(breaks(p), want, `actBreak on the ${label} reaches plan item ${idx} and no other`);
    if (hasJoinGraph) {
      const g = R.joinGraph(p);
      A.eq(dipInto(g), [idx], `actBreak on the ${label} → dip into item ${idx} only`);
      A.eq(fadeOutOf(g), [idx - 1], `actBreak on the ${label} → the item before it fades out`);
      A.eq(fadeLen(g, idx - 1, 'out'), fadeLen(g, idx, 'in'), `actBreak on the ${label} → fade-out and fade-in are the same length (symmetric)`);
      A.ok(!g.includes('fadeblack'), `actBreak on the ${label} → built with fades, not fadeblack`);
    }
  }

  {
    const p = R.buildPlan(order(o => { o.cards[0].actBreak = true; }));
    A.eq(p.items[0].actBreak === true, true, 'actBreak on the opening card is carried onto item 0');
    if (hasJoinGraph) A.eq(dipInto(R.joinGraph(p)), [], 'but nothing leads into item 0, so the join has no dip');
  }

  /* A dip overlaps its two segments by the black hold (0.315 s for these 2 s test holds) instead
   * of the 1.0 s dissolve, so the film is longer by exactly the difference — and the plan says so. */
  {
    const plain = R.buildPlan(order()).totalSec;
    const broken = R.buildPlan(order(o => { o.cards[1].actBreak = true; })).totalSec;
    A.ok(Math.abs((broken - plain) - 0.685) < 1e-9, `an act break lengthens the film by xfade − black hold (got ${(broken - plain).toFixed(3)} s, want 0.685)`);
  }

  A.throws(() => R.buildPlan(order(o => { o.photos[0].actBreak = 'yes'; })), 'actBreak: "yes" is refused, not silently ignored');
  A.throws(() => R.buildPlan(order(o => { o.cards[1].actBreak = 1; })), 'actBreak: 1 on a card is refused');
  A.notThrows(() => R.buildPlan(order(o => { o.photos[0].actBreak = null; })), 'actBreak: null is treated as absent');
  A.notThrows(() => R.buildPlan(order(o => { o.photos[0].actBreak = false; })), 'actBreak: false is accepted');

  /* ---------- 2. LIVE: the film really dips to black, and a re-render really rebuilds ---------- */
  if (!haveFfmpeg()) {
    console.log('SKIP: ffmpeg/ffprobe unavailable — live act-break render not run');
    A.report('memorial-actbreak');
    return;
  }

  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-actbreak-'));
  try {
    /* Three bright, distinct colours: a plain dissolve between any two stays bright throughout. */
    const files = ['0xffffff', '0xffe0a0', '0xa0e0ff'].map((c, i) => {
      const f = path.join(TMP, `p${i + 1}.png`);
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${c}:s=640x360`, '-frames:v', '1', f],
        { stdio: 'ignore', timeout: 60000 });
      return f;
    });
    const live = (breakOnThird) => ({
      orderId: 'actbreak-live', hold: 2.0, xfade: 1.0, outputRoot: path.join(TMP, 'render'),
      photos: files.map((f, i) => ({ file: f, motion: 'still', ...(breakOnThird && i === 2 ? { actBreak: true } : {}) })),
    });
    /* Timeline without a break: 3 x 2.0 s holds, 1.0 s joins → 4.0 s. Join 1 (p1→p2) spans
     * 1.0–2.0 s, join 2 (p2→p3) spans 2.0–3.0 s.
     * With a dip into p3 (fade 0.585 s each side, 0.315 s black): p2 fades out 2.1–2.685 s, black
     * holds 2.685–3.0 s, p3 fades in 3.0–3.585 s, film ends at 4.685 s.
     * Windows are trimmed so neighbouring frames cannot leak in. */
    const render = async (breakOnThird) => {
      const logs = [];
      const res = await R.renderOrder(live(breakOnThird), { height: 180, log: m => logs.push(m) });
      const tr = lumaTrace(res.path, TMP);
      const graph = fs.readFileSync(path.join(TMP, 'render', 'work', '.graph-assemble.txt'), 'utf8');
      return breakOnThird
        ? { res, logs, graph, tr, hold1: minIn(tr, 0.0, 0.95), j1: minIn(tr, 1.05, 1.95), j2: minIn(tr, 2.72, 2.97), hold3: minIn(tr, 3.65, 4.6) }
        : { res, logs, graph, tr, hold1: minIn(tr, 0.0, 0.95), j1: minIn(tr, 1.05, 1.95), j2: minIn(tr, 2.05, 2.95), hold3: minIn(tr, 3.05, 4.0) };
    };
    const fmt = r => `hold1 ${r.hold1.toFixed(1)} | join1 ${r.j1.toFixed(1)} | join2 ${r.j2.toFixed(1)} | hold3 ${r.hold3.toFixed(1)}`;

    const a = await render(false);
    console.log(`  run 1 (no act break)        min luma: ${fmt(a)}`);
    A.ok(a.res.ok && Math.abs(a.res.durationSec - 4.0) < 0.1, `run 1 renders a 4.0 s film (got ${a.res.durationSec})`);
    A.ok(!a.graph.includes('fade=t='), 'run 1 join graph has no dip');
    A.ok(a.j1 > 150 && a.j2 > 150, `run 1: both dissolves stay bright (join1 ${a.j1}, join2 ${a.j2})`);

    const b = await render(true);
    console.log(`  run 2 (act break into p3)   min luma: ${fmt(b)}`);
    A.ok(b.logs.some(l => /reuse seg-000/.test(l)) && b.logs.some(l => /reuse seg-002/.test(l)),
      'run 2 reuses the existing photo segments (only the join should change)');
    A.ok(!b.logs.some(l => /reuse existing join/.test(l)), 'run 2 does NOT reuse the stale all-dissolve join');
    A.ok(/\[2:v\]fade=t=in/.test(b.graph) && /\[1:v\]fade=t=out/.test(b.graph), 'run 2 join graph fades p2 out and p3 in');
    A.ok(b.j2 < 40, `run 2: the act-break join dips to near-black (min luma ${b.j2}, want < 40)`);
    A.ok(b.j2 >= 14, `run 2: black is legal video black, not below it (min luma ${b.j2}, want >= 14; fadeblack gave ~1–7)`);
    {
      /* Symmetry, measured: the picture is as bright 0.3 s before the black hold as 0.3 s after. */
      const at = t => b.tr.reduce((best, p) => Math.abs(p.t - t) < Math.abs(best.t - t) ? p : best, b.tr[0]).y;
      const before = at(2.685 - 0.3), after = at(3.0 + 0.3);
      A.ok(Math.abs(before - after) < 25, `run 2: the dip is symmetric (luma ${before.toFixed(0)} at 0.3 s before black, ${after.toFixed(0)} at 0.3 s after)`);
    }
    A.ok(b.j1 > 150, `run 2: the ordinary join is still a bright dissolve (min luma ${b.j1})`);
    A.ok(b.hold1 > 150 && b.hold3 > 150, `run 2: no darkness outside the act break (hold1 ${b.hold1}, hold3 ${b.hold3})`);
    A.ok(Math.abs(b.res.durationSec - 4.685) < 0.1, `run 2 is 4.685 s — the plan's length, with the black hold (got ${b.res.durationSec})`);

    const c = await render(false);
    console.log(`  run 3 (act break removed)   min luma: ${fmt(c)}`);
    A.ok(!c.logs.some(l => /reuse existing join/.test(l)), 'run 3 rebuilds the join again after the act break is removed');
    A.ok(!c.graph.includes('fade=t=') && c.j2 > 150, `run 3: back to a plain bright dissolve (join2 ${c.j2})`);
  } finally {
    fs.rmSync(TMP, { recursive: true, force: true });
  }

  A.report('memorial-actbreak');
})().catch(e => {
  A.ok(false, 'test threw: ' + (e && e.stack || e));
  A.report('memorial-actbreak');
});

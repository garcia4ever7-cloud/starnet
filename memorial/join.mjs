/* memorial/join.mjs — how one segment hands over to the next. Pure: a plan in, a filter graph out.
 *
 * TWO TRANSITIONS, and why the second one is built by hand:
 *
 *   dissolve   xfade=transition=fade over `xfade` seconds. The default everywhere.
 *
 *   dip        a symmetric dip to black for an act break. ffmpeg's built-in `fadeblack` is NOT
 *              used. Measured on this device 2026-11-24 (white→white, 2 s): luma 235 → 7 in the
 *              first 0.4 s, then 1.6 s climbing back — the outgoing picture is gone in a fifth
 *              of the transition, so it reads as a cut to black, and 7 is below legal video
 *              black (16). Instead each side gets an ordinary `fade` (which goes to true video
 *              black, chroma untouched) and a short plain dissolve joins the two black ends:
 *
 *                 A ──fade out (f)──┐ black ┌──fade in (f)── B
 *                                   └─ D ───┘
 *
 *              Measured: 235→180→126→71→16, hold at 16 for D, then 16→71→125→180→235.
 *
 * Timeline arithmetic (the same for both kinds, which is what keeps this simple): join j overlaps
 * its two segments by D_j seconds, so
 *     offset_j = sum(hold_0..hold_{j-1}) - sum(D_1..D_j)        total = sum(hold) - sum(D)
 */
'use strict';

export const DIP_FADE = 0.9;      // seconds each side fades
export const DIP_HOLD = 0.5;      // seconds of black between them (the overlap)
export const HEAD_FADE = 1.0;     // the film fades up from black
export const TAIL_FADE = 2.0;     // and down to black at the end

const f3 = n => Number(n).toFixed(3);

/** The transition INTO item i (i >= 1). */
export function joinSpec(plan, i) {
  const it = plan.items[i];
  if (it && it.actBreak) {
    /* A dip takes d + f seconds out of each side. Each side may give up at most 45% of its
     * length, so a scene that dips at BOTH ends still has clear picture in the middle. Scenes of
     * normal length (over ~3.1 s) get the full dip; short test clips get a proportionally
     * shorter one rather than an invalid or overlapping graph. */
    const a = plan.items[i - 1].hold, b = it.hold;
    const room = Math.max(0.06, Math.min(a, b) * 0.45);
    const d = Number(Math.min(plan.dipHold ?? DIP_HOLD, room * 0.35).toFixed(3));
    const f = Number(Math.min(plan.dipFade ?? DIP_FADE, room - d).toFixed(3));
    return { type: 'dip', d, f };
  }
  return { type: 'dissolve', d: plan.xfade, f: 0 };
}

export function joinSpecs(plan, n = plan.items.length) {
  const out = [];
  for (let i = 1; i < n; i++) out.push(joinSpec(plan, i));
  return out;
}

/** Film length once every overlap is accounted for. */
export function totalSeconds(plan, n = plan.items.length) {
  const holds = plan.items.slice(0, n).reduce((a, it) => a + it.hold, 0);
  return holds - joinSpecs(plan, n).reduce((a, j) => a + j.d, 0);
}

/** Start time of item i on the film's clock, and the windows that are legitimately black. */
export function timeline(plan, n = plan.items.length) {
  const specs = joinSpecs(plan, n);
  const starts = [0];
  const black = [];
  let t = 0;
  for (let i = 1; i < n; i++) {
    t += plan.items[i - 1].hold - specs[i - 1].d;
    starts.push(t);
    if (specs[i - 1].type === 'dip') black.push({ from: t - specs[i - 1].f, to: t + specs[i - 1].d + specs[i - 1].f, into: i });
  }
  const total = totalSeconds(plan, n);
  if (plan.headFade) black.push({ from: 0, to: plan.headFade, into: 0 });
  if (plan.tailFade) black.push({ from: total - plan.tailFade, to: total, into: n });
  return { starts, black, total, specs };
}

/**
 * joinGraph — the assembly filter graph for n segments ([0:v]..[n-1:v]) → [vo].
 * `plan.headFade` / `plan.tailFade` (seconds, optional) fade the whole film up and down.
 * `plan.colour === 'bt709'` stamps the output's colour tags (the pixels must already be 709).
 */
export function joinGraph(plan, n = plan.items.length) {
  const specs = joinSpecs(plan, n);
  const pre = [];
  const label = [];
  for (let i = 0; i < n; i++) {
    const fx = [];
    const hold = plan.items[i].hold;
    const into = i > 0 ? specs[i - 1] : null;
    const out = i < n - 1 ? specs[i] : null;
    if (into && into.type === 'dip') fx.push(`fade=t=in:st=${f3(into.d)}:d=${f3(into.f)}`);
    if (out && out.type === 'dip') fx.push(`fade=t=out:st=${f3(hold - out.d - out.f)}:d=${f3(out.f)}`);
    if (i === 0 && plan.headFade) fx.push(`fade=t=in:st=0:d=${f3(plan.headFade)}`);
    if (i === n - 1 && plan.tailFade) fx.push(`fade=t=out:st=${f3(hold - plan.tailFade)}:d=${f3(plan.tailFade)}`);
    if (fx.length) { pre.push(`[${i}:v]${fx.join(',')}[p${i}]`); label.push(`p${i}`); }
    else label.push(`${i}:v`);
  }
  const chain = [];
  let prev = label[0];
  let offset = 0;
  for (let i = 1; i < n; i++) {
    const s = specs[i - 1];
    offset += plan.items[i - 1].hold - s.d;
    const tag = `x${i}`;
    chain.push(`[${prev}][${label[i]}]xfade=transition=fade:duration=${s.type === 'dip' ? f3(s.d) : s.d}:offset=${offset.toFixed(3)}[${tag}]`);
    prev = tag;
  }
  const tail = plan.colour === 'bt709'
    ? 'format=yuv420p,setsar=1,setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv'
    : 'format=yuv420p,setsar=1';
  return [...pre, ...chain, `[${prev}]${tail}[vo]`].join(';');
}

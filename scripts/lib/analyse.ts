/**
 * Per-episode measurement shared by the calibration scripts (UI-PRMD and Rehab-Pile): replay an episode
 * through the virtual webcam, measure the exercise's primary metric and every form check with the app's
 * own metric code, exactly as the engine would see them.
 */
import { METRICS } from "../../src/coach/metrics.ts";
import { repPhases } from "../../src/coach/engine.ts";
import type { ExerciseDef } from "../../src/coach/types.ts";
import type { Episode } from "./uiprmd.ts";
import { replay } from "./episodes.ts";

export const q = (xs: number[], p: number) => {
  const a = [...xs].sort((x, y) => x - y);
  if (!a.length) return NaN;
  const i = (a.length - 1) * p;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return a[lo] + (a[hi] - a[lo]) * (i - lo);
};
export const median = (xs: number[]) => q(xs, 0.5);
export const r1 = (x: number) => Math.round(x * 10) / 10;

export interface EpisodeStats {
  rest: number;
  excursion: number;
  checks: Record<string, number>; // worst value of each check metric during the movement
  /** lowering (eccentric) phase duration, ms — see ExerciseDef.lowerPhase */
  lowerMs?: number;
}

/** The rep window the engine would see (leave start at p > 0.3 … back below 0.2 after passing 0.7), timed
 *  with the engine's own repPhases(). Returns the duration of the exercise's lowering phase. */
function lowerPhaseMs(ex: ExerciseDef, progress: number[]): number | undefined {
  const start = progress.findIndex((p) => p > 0.3);
  if (start < 0) return undefined;
  let armed = false;
  for (let i = start; i < progress.length; i++) {
    if (progress[i] > 0.7) armed = true;
    if (armed && progress[i] < 0.2) {
      const ph = repPhases(progress.slice(start, i + 1).map((p, k) => ({ t: (k * 1000) / 30, p })));
      return ex.lowerPhase === "out" ? ph.outMs : ph.returnMs;
    }
  }
  return undefined;
}

export interface AnalyseOptions {
  /** excursion = furthest point in the exercise's direction (start → target), not just furthest from rest.
   *  Needed when a recording moves both ways (e.g. side bends to both sides). */
  directional?: boolean;
}

export function analyseEpisode(ex: ExerciseDef, ep: Episode, opts: AnalyseOptions = {}): EpisodeStats {
  const { frames, side, facing } = replay(ex, ep);
  const prim = frames.map((f) => METRICS[ex.primary.metric].fn({ pts: f.pts, vis: f.vis, side, facing }));
  // episodes start at rest; the excursion is the value farthest from it
  const rest = median(prim.slice(0, 5));
  const dir = Math.sign(ex.primary.target - ex.primary.start) || 1;
  const excursion = opts.directional
    ? prim.reduce((a, v) => ((v - a) * dir > 0 ? v : a), rest)
    : prim.reduce((a, v) => (Math.abs(v - rest) > Math.abs(a - rest) ? v : a), rest);
  // coaching progress exactly as the engine computes it (0 = start position, 1 = end of range)
  const [s0, s1] = ex.primary.startIsExcursion ? [excursion, rest] : [rest, excursion];
  const progress = prim.map((v) => (v - s0) / (s1 - s0 || 1));
  const moving = progress.map((p) => p > 0.3);
  const checks: Record<string, number> = {};
  for (const c of ex.checks) {
    const vals = frames.map((f) => METRICS[c.metric].fn({ pts: f.pts, vis: f.vis, side, facing }));
    const base = median(vals.slice(0, 5));
    const active = (i: number) => (c.phase === "peak" ? progress[i] >= 0.75 : moving[i]) && (c.maxProgress === undefined || progress[i] <= c.maxProgress);
    const sel = vals.filter((_, i) => active(i)).map((v) => (c.relative === "percent" ? (100 * (v - base)) / Math.max(1e-6, Math.abs(base)) : c.relative ? v - base : v));
    if (!sel.length) continue;
    checks[c.id] = c.op === ">" ? Math.max(...sel) : Math.min(...sel);
  }
  return { rest, excursion, checks, lowerMs: lowerPhaseMs(ex, progress) };
}

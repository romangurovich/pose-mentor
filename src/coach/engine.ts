/**
 * The coaching engine: turns a stream of (filtered) 2D poses into coaching state.
 *
 *   pose → side/facing → framing & orientation gates → primary-motion progress
 *        → rep state machine | hold timer → debounced form checks → cues + events
 *
 * Pure TypeScript with no DOM access, so it runs identically in the browser and in Node against
 * the UI-PRMD recordings (scripts/evaluate.ts).
 */
import { idx, other, type Joint, type PoseFrame, type Side } from "../pose/landmarks.ts";
import { clamp } from "../pose/geometry.ts";
import { METRICS, detectFacing, frontalness, type MetricId } from "./metrics.ts";
import type { ExerciseDef, FormCheck, JointRef } from "./types.ts";

export interface EngineOptions {
  /** fraction of the healthy reference range to aim for (rehab patients often start at 0.5–0.8) */
  rangeGoal: number;
  reps?: number;
  holdSeconds?: number;
  /** force the starting side for unilateral exercises */
  startSide?: Side | "auto";
}

export type Status =
  | "searching" // no person detected
  | "framing" // person detected but key joints not visible
  | "orient" // wrong orientation (e.g. facing camera for a side-view move)
  | "ready" // in the start position, waiting for movement
  | "active" // mid-rep / holding
  | "switch" // switch sides
  | "done";

export interface RepRecord {
  index: number;
  side: Side;
  peak: number;
  /** peak progress toward the goal (1 = reached the goal) */
  reach: number;
  durationMs: number;
  faults: string[];
  score: number;
  full: boolean;
}

export interface HoldRecord {
  side: Side;
  seconds: number;
  target: number;
  faultSeconds: Record<string, number>;
  bestValue: number;
}

export interface ActiveFault {
  id: string;
  label: string;
  cue: string;
  severity: "major" | "minor";
  value: number;
  threshold: number;
  unit: string;
}

export type CoachEvent =
  | { type: "say"; text: string; kind: "cue" | "count" | "praise" | "info"; key?: string }
  | { type: "rep"; rep: RepRecord }
  | { type: "side-done"; side: Side }
  /** a fault was detected but deliberately not spoken (cue tapering) — the UI plays a soft tick */
  | { type: "flag"; id: string }
  | { type: "done" };

export interface CoachState {
  status: Status;
  headline: string;
  detail: string;
  side: Side;
  facing: number;
  sideIndex: number;
  sidesTotal: number;
  value: number;
  progress: number;
  startValue: number;
  goalValue: number;
  refValue: number;
  unit: string;
  inPeak: boolean;
  reps: RepRecord[];
  repsThisSide: number;
  repTarget: number;
  hold: { elapsed: number; target: number; inPosition: boolean; paused: boolean } | null;
  holds: HoldRecord[];
  faults: ActiveFault[];
  /** landmark index → severity, for skeleton colouring */
  highlight: Map<number, "major" | "minor">;
  formScore: number | null;
  missing: string[];
  /** every required joint is visible and the orientation is right */
  inFrame: boolean;
  /** briefly true right after framing is confirmed, to show a "good to go" banner */
  goodToGo: boolean;
  events: CoachEvent[];
}

const JOINT_NAMES: Record<Joint, string> = {
  shoulder: "shoulders",
  elbow: "elbows",
  wrist: "hands",
  hip: "hips",
  knee: "knees",
  ankle: "feet",
  heel: "feet",
  toe: "feet",
  ear: "head",
  eye: "head",
};

const VIS_MIN = 0.5;
const FAULT_ON_MS = 220;
const FAULT_OFF_MS = 350;
const SAY_GAP_MS = 2600;
const SAME_CUE_GAP_MS = 7000;
/** how long framing must stay good before announcing "good to go" */
const FRAME_OK_MS = 400;
/** how long the "good to go" banner stays up */
const GOOD_TO_GO_SHOW_MS = 2500;

interface FaultTrack {
  on: boolean;
  since: number; // when the raw condition last changed
  raw: boolean;
  value: number;
}

/** faults the engine detects itself (timing / rhythm), as opposed to an exercise's metric-based form checks */
export interface FaultInfo {
  label: string;
  cue: string;
  short?: string;
  fixed?: string;
  severity: "major" | "minor";
}

export const BUILTIN_FAULTS: Record<string, FaultInfo> = {
  tempo: { label: "Rushing the rep", cue: "Take about 2 seconds each way", short: "Slower", fixed: "good pace", severity: "minor" },
  lowering: { label: "Dropping too fast", cue: "Lower slowly, with control", short: "Slow on the way down", fixed: "nice control", severity: "minor" },
  bounce: { label: "Bouncing", cue: "Hold still — no bouncing", fixed: "nice and still", severity: "minor" },
};

/** label / cue / severity for any fault id an exercise can produce */
export function faultInfo(ex: ExerciseDef, id: string): FaultInfo {
  const c = ex.checks.find((x) => x.id === id);
  return c ? { label: c.label, cue: c.cue, short: c.short, fixed: c.fixed, severity: c.severity } : BUILTIN_FAULTS[id] ?? { label: id, cue: "", severity: "minor" };
}

/**
 * Cue tapering for reps (feedback that fades as a fault repeats helps retention — the "guidance hypothesis",
 * Winstein & Schmidt 1990 — and avoids nagging):
 *   major faults            → full cue every rep
 *   1st and 2nd rep in a row → full cue
 *   after that              → short reminder every other rep, silent (soft tick) in between
 * `streak` = how many reps in a row *before this one* had the fault.
 */
export function cueLevel(severity: "major" | "minor", streak: number): "full" | "short" | null {
  if (severity === "major" || streak < 2) return "full";
  return (streak - 2) % 2 === 0 ? "short" : null;
}

/**
 * Split one rep's progress trace (from leaving the start until back near it) into its two halves:
 *   out    = start → first reaching the top of this rep's range (within 0.1 of its peak)
 *   return = last time at the top → back at the start
 * Shared with scripts/calibrate.ts so thresholds and the live check use the same definition.
 */
export function repPhases(samples: ReadonlyArray<{ t: number; p: number }>): { outMs: number; returnMs: number } {
  if (samples.length < 2) return { outMs: 0, returnMs: 0 };
  const maxP = Math.max(...samples.map((x) => x.p));
  let first = -1, last = -1;
  samples.forEach((x, i) => {
    if (x.p >= maxP - 0.1) {
      if (first < 0) first = i;
      last = i;
    }
  });
  const end = samples[samples.length - 1].t;
  return { outMs: samples[first].t - samples[0].t, returnMs: end - samples[last].t };
}

/** bounce detection in holds: a swing reverses direction after moving at least this far (primary-metric units) */
const BOUNCE_SWING = 5;
/** …and this many reversals inside the window count as bouncing */
const BOUNCE_REVERSALS = 3;
const BOUNCE_WINDOW_MS = 2500;

const PRAISE = ["Nice rep", "Good control", "That's it", "Great form", "Smooth"];

export class CoachEngine {
  readonly ex: ExerciseDef;
  readonly opts: Required<EngineOptions>;

  private status: Status = "searching";
  private side: Side = "right";
  private lockedSide: Side | null = null;
  private sideIndex = 0;
  private facingVotes = 0;
  private visVotes = 0;
  private gateBadSince: number | null = null;

  // reps
  private moving = false;
  private repStart = 0;
  private repMaxP = 0;
  private repPeakValue = 0;
  /** progress trace of the current rep, for timing its lowering phase */
  private repSamples: Array<{ t: number; p: number }> = [];
  private repFaults = new Set<string>();
  // cue tapering (reps)
  private attempt = 0;
  private faultStreak = new Map<string, number>();
  private repCued = new Set<string>();
  private lastCuedAttempt = new Map<string, number>();
  private restSince: number | null = null;
  /** a rep may only start after the start position has been seen */
  private armed = false;
  private reps: RepRecord[] = [];

  // holds
  private holdElapsed = 0;
  private inPosition = false;
  private lastT: number | null = null;
  private holds: HoldRecord[] = [];
  private holdFaultSec: Record<string, number> = {};
  private holdBest = 0;
  private holdAnnounced = new Set<string>();
  // bounce detection (holds)
  private bounceExtreme: number | null = null;
  private bounceDir = 0;
  private bounceRevs: number[] = [];
  private bounceOn = false;
  private bounceSwing = 0;

  // checks
  private baseline = new Map<string, number>();
  private faults = new Map<string, FaultTrack>();

  // voice throttling
  /** last utterance time per kind: form cues aren't blocked by a just-spoken rep count */
  private lastSay: Record<string, number> = {};
  private lastSaid = new Map<string, number>();
  private events: CoachEvent[] = [];
  private praiseIdx = 0;
  private switchSince = 0;
  /** when the person was last seen (brief detector dropouts shouldn't interrupt coaching) */
  private lastSeen: number | null = null;
  // framing confirmation
  private frameOkSince: number | null = null;
  private framedAnnounced = false;
  private goodToGoAt: number | null = null;

  constructor(ex: ExerciseDef, opts: EngineOptions) {
    this.ex = ex;
    this.opts = {
      rangeGoal: opts.rangeGoal,
      reps: opts.reps ?? ex.reps ?? 10,
      holdSeconds: opts.holdSeconds ?? ex.holdSeconds ?? 30,
      startSide: opts.startSide ?? "auto",
    };
    if (this.opts.startSide !== "auto") {
      this.side = this.opts.startSide;
      if (ex.sidePick !== "visible") this.lockedSide = this.opts.startSide;
    }
  }

  get sidesTotal(): number {
    return this.ex.bothSides ? 2 : 1;
  }

  // ───────────────────────────────────────────── helpers ─────────────────────────────────────────────

  private goalValue(): number {
    const { start, target } = this.ex.primary;
    return start + (target - start) * this.opts.rangeGoal;
  }

  private metric(id: MetricId, f: PoseFrame, side: Side, facing: number): number {
    return METRICS[id].fn({ pts: f.pts, vis: f.vis, side, facing });
  }

  private progressOf(value: number): number {
    const { start } = this.ex.primary;
    const span = this.goalValue() - start;
    return Math.abs(span) < 1e-6 ? 0 : (value - start) / span;
  }

  private requiredIdx(side: Side): Array<[number, Joint]> {
    const out: Array<[number, Joint]> = [];
    for (const r of this.ex.required) {
      if (r.endsWith("*")) {
        const j = r.slice(0, -1) as Joint;
        out.push([idx(j, "left"), j], [idx(j, "right"), j]);
      } else out.push([idx(r as Joint, side), r as Joint]);
    }
    return out;
  }

  private jointRefIdx(ref: JointRef, side: Side): number[] {
    if (typeof ref === "object") return [idx(ref.joint, ref.side === "same" ? side : other(side))];
    if (ref.endsWith("*")) {
      const j = ref.slice(0, -1) as Joint;
      return [idx(j, "left"), idx(j, "right")];
    }
    return [idx(ref as Joint, side)];
  }

  private say(text: string, kind: "cue" | "count" | "praise" | "info", t: number, key = text, force = false): boolean {
    const last = this.lastSaid.get(key) ?? -Infinity;
    if (t - last < SAME_CUE_GAP_MS) return false;
    if (!force && t - (this.lastSay[kind] ?? -Infinity) < SAY_GAP_MS) return false;
    this.lastSay[kind] = t;
    this.lastSaid.set(key, t);
    this.events.push({ type: "say", text, kind, key });
    return true;
  }

  /** speak a fault's cue during a rep, tapered by how many reps in a row it has shown up */
  private cueRepFault(id: string, t: number) {
    if (this.repCued.has(id)) return; // once per rep
    this.repCued.add(id);
    const info = faultInfo(this.ex, id);
    const level = cueLevel(info.severity, this.faultStreak.get(id) ?? 0);
    const text = level === "short" ? info.short ?? info.cue : info.cue;
    // unique key per rep: repetition is governed by the tapering, not the time-based gap
    if (level && this.say(text, "cue", t, `${id}#${this.attempt}`)) this.lastCuedAttempt.set(id, this.attempt);
    else this.events.push({ type: "flag", id });
  }

  /**
   * Update fault streaks at the end of a rep. Returns the faults that were cued during their latest run
   * and are now gone, so the coach can say "Better".
   */
  private endRepStreaks(faults: string[]): string[] {
    const fixed: string[] = [];
    const ids = new Set([...this.ex.checks.map((c) => c.id), ...Object.keys(BUILTIN_FAULTS), ...this.faultStreak.keys()]);
    for (const id of ids) {
      if (faults.includes(id)) this.faultStreak.set(id, (this.faultStreak.get(id) ?? 0) + 1);
      else {
        // it ran for `streak` reps before this one; acknowledge the fix if we spoke up at any point in that run
        const streak = this.faultStreak.get(id) ?? 0;
        if (streak > 0 && (this.lastCuedAttempt.get(id) ?? -Infinity) >= this.attempt - streak) fixed.push(id);
        this.faultStreak.delete(id);
      }
    }
    return fixed;
  }

  private setStatus(s: Status, _t: number) {
    this.status = s;
  }

  private sideWord(s: Side) {
    return s === "left" ? "left" : "right";
  }

  // ───────────────────────────────────────────── side & facing ─────────────────────────────────────────────

  private updateFacing(f: PoseFrame): number {
    if (this.ex.view !== "side") return 1;
    const raw = detectFacing(f);
    this.facingVotes = clamp(this.facingVotes + raw, -8, 8);
    return this.facingVotes >= 0 ? 1 : -1;
  }

  private chooseSide(f: PoseFrame, facing: number): Side {
    if (this.lockedSide) return this.lockedSide;
    const pick = this.ex.sidePick;
    if (pick === "visible") {
      const score = (s: Side) => {
        const ids = this.requiredIdx(s).map(([i]) => i);
        return ids.reduce((a, i) => a + f.vis[i], 0) / ids.length;
      };
      const d = score("left") - score("right");
      this.visVotes = clamp(this.visVotes + (d > 0.03 ? 1 : d < -0.03 ? -1 : 0), -10, 10);
      if (this.visVotes >= 6) this.side = "left";
      else if (this.visVotes <= -6) this.side = "right";
      return this.side;
    }
    if (pick === "front-foot") {
      const fwd = (s: Side) => (f.pts[idx("ankle", s)].x - f.pts[idx("ankle", other(s))].x) * facing;
      return fwd("left") > 0 ? "left" : "right";
    }
    // "active": whichever limb is further along the motion
    const pl = this.progressOf(this.metric(this.ex.primary.metric, f, "left", facing));
    const pr = this.progressOf(this.metric(this.ex.primary.metric, f, "right", facing));
    return pl > pr ? "left" : "right";
  }

  // ───────────────────────────────────────────── gates ─────────────────────────────────────────────

  private gate(f: PoseFrame, side: Side): { kind: "framing" | "orient"; missing: string[] } | null {
    const missing = new Set<string>();
    for (const [i, j] of this.requiredIdx(side)) {
      const p = f.pts[i];
      if (f.vis[i] < VIS_MIN || p.y < -0.02 || p.y > 1.02) missing.add(JOINT_NAMES[j]);
    }
    if (missing.size) return { kind: "framing", missing: [...missing] };
    const hipsVisible = Math.min(f.vis[idx("hip", "left")], f.vis[idx("hip", "right")]) > VIS_MIN;
    if (hipsVisible) {
      const fr = frontalness(f);
      if (this.ex.view === "side" && fr > 0.5) return { kind: "orient", missing: [] };
      if (this.ex.view === "front" && fr < 0.4) return { kind: "orient", missing: [] };
    }
    return null;
  }

  // ───────────────────────────────────────────── checks ─────────────────────────────────────────────

  private checkActive(c: FormCheck, p: number): boolean {
    if (c.maxProgress !== undefined && p > c.maxProgress) return false;
    if (this.ex.kind === "reps") {
      if (c.phase === "always") return true;
      if (c.phase === "moving") return this.moving;
      return this.moving && p >= 0.75;
    }
    if (c.phase === "always") return true;
    if (c.phase === "moving") return p > 0.5;
    return this.inPosition;
  }

  private evalChecks(f: PoseFrame, side: Side, facing: number, p: number, t: number): ActiveFault[] {
    const active: ActiveFault[] = [];
    for (const c of this.ex.checks) {
      const tr = this.faults.get(c.id) ?? { on: false, since: t, raw: false, value: 0 };
      let raw = false;
      let value = 0;
      if (this.checkActive(c, p)) {
        value = this.metric(c.metric, f, side, facing);
        if (c.relative) {
          const base = this.baseline.get(`${c.metric}:${side}`) ?? value;
          value = c.relative === "percent" ? (100 * (value - base)) / Math.max(1e-6, Math.abs(base)) : value - base;
        }
        raw = c.op === ">" ? value > c.threshold : value < c.threshold;
      }
      if (raw !== tr.raw) {
        tr.raw = raw;
        tr.since = t;
      }
      if (!tr.on && tr.raw && t - tr.since >= FAULT_ON_MS) {
        tr.on = true;
        if (this.status === "active") {
          if (this.ex.kind === "reps") this.cueRepFault(c.id, t);
          else if (!this.say(c.cue, "cue", t, c.id)) this.events.push({ type: "flag", id: c.id });
        }
      } else if (tr.on && !tr.raw && t - tr.since >= FAULT_OFF_MS) {
        tr.on = false;
        // holds: acknowledge a correction made right after the cue
        if (this.ex.kind === "hold" && this.inPosition && t - (this.lastSaid.get(c.id) ?? -Infinity) < 8000) {
          this.say(`Better — ${c.fixed ?? "that's it"}`, "praise", t, `fixed-${c.id}`, true);
        }
      }
      tr.value = value;
      this.faults.set(c.id, tr);
      if (tr.on) {
        active.push({
          id: c.id,
          label: c.label,
          cue: c.cue,
          severity: c.severity,
          value,
          threshold: c.threshold,
          unit: c.relative === "percent" ? "%" : METRICS[c.metric].unit,
        });
      }
    }
    active.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "major" ? -1 : 1));
    return active;
  }

  private updateBaseline(f: PoseFrame, facing: number) {
    for (const c of this.ex.checks) {
      if (!c.relative) continue;
      for (const s of ["left", "right"] as const) {
        const key = `${c.metric}:${s}`;
        const v = this.metric(c.metric, f, s, facing);
        const b = this.baseline.get(key);
        this.baseline.set(key, b === undefined ? v : b + (v - b) * 0.15);
      }
    }
  }

  private clearFaults() {
    for (const tr of this.faults.values()) {
      tr.on = false;
      tr.raw = false;
    }
  }

  // ───────────────────────────────────────────── framing confirmation ─────────────────────────────────────────────

  private resetFraming() {
    this.frameOkSince = null;
    this.framedAnnounced = false;
    this.goodToGoAt = null;
  }

  /** once everything needed is in view (and stays so briefly), tell the person they're good to go */
  private confirmFraming(t: number) {
    this.frameOkSince ??= t;
    if (this.framedAnnounced || t - this.frameOkSince < FRAME_OK_MS) return;
    this.framedAnnounced = true;
    this.goodToGoAt = t;
    const next = this.ex.kind === "reps" ? "start when you're ready" : "ease into the stretch";
    this.say(`I can see everything. You're good to go — ${next}.`, "info", t, "good-to-go-" + this.sideIndex, true);
  }

  private goodToGo(t: number): boolean {
    return this.goodToGoAt !== null && t - this.goodToGoAt < GOOD_TO_GO_SHOW_MS;
  }

  // ───────────────────────────────────────────── side completion ─────────────────────────────────────────────

  private finishSide(t: number) {
    this.events.push({ type: "side-done", side: this.side });
    if (this.sideIndex + 1 < this.sidesTotal) {
      this.sideIndex++;
      const next = other(this.side);
      this.lockedSide = next;
      this.side = next;
      this.moving = false;
      this.inPosition = false;
      this.holdElapsed = 0;
      this.holdAnnounced.clear();
      this.baseline.clear();
      this.clearFaults();
      this.faultStreak.clear();
      this.lastCuedAttempt.clear();
      this.switchSince = t;
      this.resetFraming();
      this.setStatus("switch", t);
      this.say(`Great work. Now switch to your ${this.sideWord(next)} side.`, "info", t, "switch", true);
    } else {
      this.setStatus("done", t);
      this.say(this.ex.kind === "reps" ? "Set complete. Nice work!" : "All done. Nice work!", "info", t, "done", true);
      this.events.push({ type: "done" });
    }
  }

  // ───────────────────────────────────────────── main update ─────────────────────────────────────────────

  update(f: PoseFrame | null): CoachState {
    this.events = [];
    const t = f?.t ?? this.lastT ?? 0;
    const dt = this.lastT === null ? 0 : Math.min(0.25, Math.max(0, (t - this.lastT) / 1000));
    this.lastT = t;

    if (this.status === "done") return this.snapshot(f, [], 0, 0, 1, []);

    if (!f) {
      if (this.lastSeen !== null && t - this.lastSeen < 700 && this.status !== "searching") {
        return this.snapshot(null, [], 0, 0, 1, []); // hold the current state through a short dropout
      }
      this.setStatus("searching", t);
      this.resetFraming();
      this.moving = false;
      this.inPosition = false;
      this.clearFaults();
      return this.snapshot(null, [], 0, 0, 1, []);
    }

    this.lastSeen = t;
    const facing = this.updateFacing(f);
    const side = this.chooseSide(f, facing);
    this.side = side;

    // gates (debounced so a single flickery frame doesn't interrupt a rep)
    const g = this.gate(f, side);
    if (g) this.gateBadSince ??= t;
    else this.gateBadSince = null;
    const gated = g !== null && (this.gateBadSince !== null && t - this.gateBadSince > 450 || (this.status !== "active" && this.status !== "ready"));
    if (gated) {
      const s: Status = g!.kind;
      if (this.status !== "switch" || t - this.switchSince > 2500) this.setStatus(s, t);
      this.moving = false;
      this.inPosition = false;
      this.restSince = null;
      this.armed = false;
      this.resetFraming();
      this.clearFaults();
      if (this.status === s) {
        const text = s === "framing" ? `Step back so I can see your ${g!.missing.join(" and ")}` : this.ex.view === "side" ? "Turn sideways to the camera" : "Face the camera";
        this.say(text, "info", t, s);
      }
      return this.snapshot(f, [], this.metric(this.ex.primary.metric, f, side, facing), 0, facing, g!.missing);
    }

    const value = this.metric(this.ex.primary.metric, f, side, facing);
    const p = this.progressOf(value);

    if (this.status === "switch" && t - this.switchSince < 2500) {
      return this.snapshot(f, [], value, p, facing, []);
    }

    if (!g) this.confirmFraming(t);
    else this.frameOkSince = null;

    return this.ex.kind === "reps" ? this.updateReps(f, side, facing, value, p, t) : this.updateHold(f, side, facing, value, p, t, dt);
  }

  private updateReps(f: PoseFrame, side: Side, facing: number, value: number, p: number, t: number): CoachState {
    const ex = this.ex;
    if (!this.moving) {
      // resting in the start position
      if (p < 0.25) {
        this.restSince ??= t;
        this.updateBaseline(f, facing);
        if (t - this.restSince > 350 && !this.armed) {
          this.armed = true;
          if (this.status !== "active" && this.framedAnnounced && !this.goodToGo(t)) this.say(this.reps.length || this.sideIndex ? "Ready" : "Ready when you are", "info", t, "ready-" + this.sideIndex);
        }
      } else this.restSince = null;
      if (this.status !== "active") this.setStatus("ready", t);
      if (p > 0.3 && this.armed) {
        // lock the side for unilateral exercises once the limb starts moving
        if (ex.sidePick !== "visible" && !this.lockedSide) this.lockedSide = side;
        this.moving = true;
        this.repStart = t;
        this.repMaxP = p;
        this.repPeakValue = value;
        this.repSamples = [{ t, p }];
        this.repFaults.clear();
        this.attempt++;
        this.repCued.clear();
        this.setStatus("active", t);
      }
    }

    const faults = this.evalChecks(f, side, facing, p, t);

    if (this.moving) {
      if (p > this.repMaxP) {
        this.repMaxP = p;
        this.repPeakValue = value;
      }
      this.repSamples.push({ t, p });
      for (const fl of faults) this.repFaults.add(fl.id);
      if (t - this.repStart > 20000) {
        this.moving = false; // abandoned
        this.restSince = null;
        this.armed = false;
      } else if (p < 0.2) {
        this.moving = false;
        this.restSince = t;
        this.completeRep(side, t);
        this.clearFaults();
      }
    }

    return this.snapshot(f, faults, value, p, facing, []);
  }

  private completeRep(side: Side, t: number) {
    const reach = this.repMaxP;
    const duration = t - this.repStart;
    if (reach < 0.7) {
      this.endRepStreaks([...this.repFaults]);
      if (reach >= 0.4) this.say("Go a little further — reach the target line", "cue", t, "further");
      return;
    }
    const faults = [...this.repFaults];
    const rushed = !!this.ex.minRepMs && duration < this.ex.minRepMs;
    if (rushed) faults.push("tempo");
    // eccentric control: the return to the start position shouldn't be a drop
    else if (this.ex.minLowerMs) {
      const ph = repPhases(this.repSamples);
      const lowerMs = this.ex.lowerPhase === "out" ? ph.outMs : ph.returnMs;
      if (lowerMs < this.ex.minLowerMs) faults.push("lowering");
    }
    const full = reach >= 0.95;
    let score = 100;
    for (const id of faults) {
      const c = this.ex.checks.find((x) => x.id === id);
      score -= id in BUILTIN_FAULTS ? 10 : c?.severity === "major" ? 25 : 12;
    }
    if (!full) score -= Math.round((0.95 - reach) * 100);
    score = clamp(Math.round(score), 0, 100);

    const rep: RepRecord = {
      index: this.reps.length + 1,
      side,
      peak: this.repPeakValue,
      reach,
      durationMs: duration,
      faults,
      score,
      full,
    };
    this.reps.push(rep);
    this.events.push({ type: "rep", rep });

    const n = this.reps.filter((r) => r.side === side).length;
    const repsThisSide = this.ex.bothSides ? n : this.reps.length;
    // voice: count, then one piece of feedback (timing cue > short of range > "better" > occasional praise)
    const timing = faults.includes("tempo") ? "tempo" : faults.includes("lowering") ? "lowering" : null;
    const timingLevel = timing ? cueLevel("minor", this.faultStreak.get(timing) ?? 0) : null;
    const fixed = this.endRepStreaks(faults);
    this.say(String(repsThisSide), "count", t, `count-${this.reps.length}`, true);
    if (timing && timingLevel) {
      const b = BUILTIN_FAULTS[timing];
      const text = timingLevel === "short" ? b.short ?? b.cue : timing === "tempo" ? "Slow it down a little" : b.cue;
      this.say(text, "cue", t, `${timing}#${this.attempt}`, true);
      this.lastCuedAttempt.set(timing, this.attempt);
    } else if (!full) this.say("Almost — a bit further next time", "cue", t, "almost", true);
    else if (fixed.length) {
      this.say(`Better — ${faultInfo(this.ex, fixed[0]).fixed ?? "that's it"}`, "praise", t, `fixed#${this.attempt}`, true);
    } else if (faults.length === 0 && repsThisSide % 3 === 0) {
      this.say(PRAISE[this.praiseIdx++ % PRAISE.length], "praise", t, "praise", true);
    }

    if (repsThisSide >= this.opts.reps) this.finishSide(t);
  }

  private updateHold(f: PoseFrame, side: Side, facing: number, value: number, p: number, t: number, dt: number): CoachState {
    const ex = this.ex;
    if (!this.inPosition && p < 0.3) this.updateBaseline(f, facing);

    const wasIn = this.inPosition;
    if (!this.inPosition && p >= 0.85) this.inPosition = true;
    else if (this.inPosition && p < 0.7) this.inPosition = false;
    if (this.inPosition && ex.sidePick !== "visible" && !this.lockedSide) this.lockedSide = side;

    this.setStatus(this.inPosition ? "active" : "ready", t);
    const faults = this.evalChecks(f, side, facing, p, t);
    const bounce = this.trackBounce(value, t);
    if (bounce) faults.push(bounce);
    const paused = faults.some((x) => x.severity === "major");

    if (this.inPosition) {
      if (!wasIn) this.say(this.holdElapsed > 0 ? "Back in position" : "Good. Hold it there", "info", t, "hold-in");
      if (!paused) this.holdElapsed += dt;
      for (const fl of faults) this.holdFaultSec[fl.id] = (this.holdFaultSec[fl.id] ?? 0) + dt;
      this.holdBest = Math.max(this.holdBest, value * Math.sign(ex.primary.target - ex.primary.start));
      const left = this.opts.holdSeconds - this.holdElapsed;
      const half = this.opts.holdSeconds / 2;
      if (this.holdElapsed >= half && !this.holdAnnounced.has("half") && this.opts.holdSeconds >= 20) {
        this.holdAnnounced.add("half");
        this.say("Halfway there", "info", t, "half-" + this.sideIndex, true);
      }
      if (left <= 5 && !this.holdAnnounced.has("5")) {
        this.holdAnnounced.add("5");
        this.say("Five more seconds", "info", t, "five-" + this.sideIndex, true);
      }
      if (left <= 0) {
        this.holds.push({
          side,
          seconds: this.opts.holdSeconds,
          target: this.opts.holdSeconds,
          faultSeconds: { ...this.holdFaultSec },
          bestValue: this.holdBest * Math.sign(ex.primary.target - ex.primary.start),
        });
        this.holdFaultSec = {};
        this.holdBest = 0;
        this.finishSide(t);
      }
    } else if (wasIn) {
      this.say("Ease back into the stretch", "cue", t, "hold-out");
    } else if (p > 0.4) {
      this.say("A little further", "cue", t, "further");
    }

    return this.snapshot(f, faults, value, p, facing, []);
  }

  /** zig-zag detector on the primary metric while holding: repeated quick reversals = ballistic bouncing */
  private trackBounce(value: number, t: number): ActiveFault | null {
    if (!this.inPosition) {
      this.resetBounce();
      return null;
    }
    if (this.bounceExtreme === null) this.bounceExtreme = value; // anchor until a first swing sets a direction
    if (this.bounceDir === 0) {
      if (Math.abs(value - this.bounceExtreme) >= BOUNCE_SWING) {
        this.bounceDir = Math.sign(value - this.bounceExtreme);
        this.bounceExtreme = value;
      }
    } else if ((value - this.bounceExtreme) * this.bounceDir > 0) {
      this.bounceExtreme = value; // still moving the same way
    } else if (Math.abs(value - this.bounceExtreme) >= BOUNCE_SWING) {
      this.bounceRevs.push(t);
      this.bounceSwing = Math.abs(value - this.bounceExtreme);
      this.bounceDir = -this.bounceDir;
      this.bounceExtreme = value;
    }
    this.bounceRevs = this.bounceRevs.filter((x) => t - x <= BOUNCE_WINDOW_MS);
    if (!this.bounceOn && this.bounceRevs.length >= BOUNCE_REVERSALS) {
      this.bounceOn = true;
      this.say(BUILTIN_FAULTS.bounce.cue, "cue", t, "bounce");
    } else if (this.bounceOn && (this.bounceRevs.length === 0 || t - this.bounceRevs[this.bounceRevs.length - 1] > 1500)) this.bounceOn = false;
    if (!this.bounceOn) return null;
    const b = BUILTIN_FAULTS.bounce;
    return { id: "bounce", label: b.label, cue: b.cue, severity: b.severity, value: this.bounceSwing, threshold: BOUNCE_SWING, unit: METRICS[this.ex.primary.metric].unit };
  }

  private resetBounce() {
    this.bounceExtreme = null;
    this.bounceDir = 0;
    this.bounceRevs = [];
    this.bounceOn = false;
  }

  // ───────────────────────────────────────────── snapshot ─────────────────────────────────────────────

  private headline(missing: string[]): [string, string] {
    const ex = this.ex;
    const sideTxt = ex.bothSides ? ` · ${this.side === "left" ? "Left" : "Right"} side` : "";
    switch (this.status) {
      case "searching":
        return ["Step into view", "Stand where the camera can see your whole body."];
      case "framing":
        return [`I can't see your ${missing.join(" & ")}`, "Step back or adjust the camera so they're in frame."];
      case "orient":
        return ex.view === "side" ? ["Turn sideways", "This move is judged from the side."] : ["Face the camera", "This move is judged from the front."];
      case "ready":
        if (this.goodToGo(this.lastT ?? 0))
          return [`You're good to go${sideTxt}`, ex.kind === "reps" ? "I can see everything I need — start when you're ready." : "I can see everything I need — ease into the stretch."];
        if (ex.kind === "reps" && !this.armed) return [`Return to the start${sideTxt}`, "Settle into the starting position."];
        return ex.kind === "reps" ? [`Ready${sideTxt}`, "Begin when you are — I'll count your reps."] : [`Get into the stretch${sideTxt}`, "Ease into position; the timer starts when you get there."];
      case "active":
        return ex.kind === "reps" ? [`Rep ${this.reps.filter((r) => !ex.bothSides || r.side === this.side).length + 1}${sideTxt}`, ""] : [`Hold${sideTxt}`, "Breathe slowly and relax into it."];
      case "switch":
        return [`Switch to your ${this.side} side`, "Turn around or swap limbs, then get ready."];
      case "done":
        return ["Set complete", "Nice work."];
    }
  }

  private snapshot(_f: PoseFrame | null, faults: ActiveFault[], value: number, p: number, facing: number, missing: string[]): CoachState {
    const highlight = new Map<number, "major" | "minor">();
    for (const fl of faults) {
      const c = this.ex.checks.find((x) => x.id === fl.id);
      if (!c) continue;
      for (const ref of c.joints)
        for (const i of this.jointRefIdx(ref, this.side)) {
          if (highlight.get(i) !== "major") highlight.set(i, fl.severity);
        }
    }
    const [headline, detail] = this.headline(missing);
    const reps = this.reps;
    const repsThisSide = this.ex.bothSides ? reps.filter((r) => r.side === this.side).length : reps.length;
    let formScore: number | null = null;
    if (this.ex.kind === "reps" && reps.length) formScore = Math.round(reps.reduce((a, r) => a + r.score, 0) / reps.length);
    if (this.ex.kind === "hold" && (this.holds.length || this.holdElapsed > 1)) {
      const recs = [...this.holds];
      const faultTime = recs.reduce((a, h) => a + Object.values(h.faultSeconds).reduce((x, y) => x + y, 0), 0) + Object.values(this.holdFaultSec).reduce((x, y) => x + y, 0);
      const total = recs.reduce((a, h) => a + h.seconds, 0) + this.holdElapsed;
      formScore = Math.round(100 * clamp(1 - faultTime / Math.max(1, total), 0, 1));
    }
    return {
      status: this.status,
      headline,
      detail,
      side: this.side,
      facing,
      sideIndex: this.sideIndex,
      sidesTotal: this.sidesTotal,
      value,
      progress: p,
      startValue: this.ex.primary.start,
      goalValue: this.goalValue(),
      refValue: this.ex.primary.target,
      unit: METRICS[this.ex.primary.metric].unit,
      inPeak: this.ex.kind === "reps" ? this.moving && p >= 0.75 : this.inPosition,
      reps,
      repsThisSide,
      repTarget: this.opts.reps,
      hold: this.ex.kind === "hold" ? { elapsed: this.holdElapsed, target: this.opts.holdSeconds, inPosition: this.inPosition, paused: this.inPosition && faults.some((x) => x.severity === "major") } : null,
      holds: this.holds,
      faults,
      highlight,
      formScore,
      missing,
      inFrame: this.framedAnnounced,
      goodToGo: this.status === "ready" && this.goodToGo(this.lastT ?? 0),
      events: this.events,
    };
  }
}

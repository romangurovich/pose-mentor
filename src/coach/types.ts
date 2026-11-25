import type { Joint, Side } from "../pose/landmarks.ts";
import type { MetricId } from "./metrics.ts";
import type { DemoSpec } from "../ui/demo/figure.ts";

export type Region = "knee-hip" | "shoulder" | "spine-neck";
export type View = "side" | "front";

/** a sided joint on the assessed side, `"x*"` both sides, or explicitly the other side */
export type JointRef = Joint | `${Joint}*` | { joint: Joint; side: "same" | "other" };

/**
 * When a form check is evaluated:
 *  - always: any time the person is being tracked
 *  - moving: during a rep (left the start position)
 *  - peak:   near the end-range of a rep, or while holding a stretch
 */
export type CheckPhase = "always" | "moving" | "peak";

export interface FormCheck {
  id: string;
  /** short name shown in the summary ("Trunk lean") */
  label: string;
  /** imperative coaching cue, spoken + shown ("Keep your chest up") */
  cue: string;
  /** terse reminder once the fault has repeated for a few reps ("Chest up") */
  short?: string;
  /** spoken after "Better — " when the person fixes it right after being cued ("chest is up") */
  fixed?: string;
  metric: MetricId;
  op: ">" | "<";
  threshold: number;
  /** compare against the value captured in the start position instead of the absolute value */
  relative?: boolean;
  phase: CheckPhase;
  severity: "major" | "minor";
  /** joints to highlight on the skeleton; `side: "other"` means the non-assessed side */
  joints: JointRef[];
  /** only evaluate while progress toward the goal is at or below this (e.g. shrugging matters early in a raise) */
  maxProgress?: number;
  /** why this threshold — shown in the UI and README */
  basis: string;
}

export interface PrimaryMotion {
  metric: MetricId;
  /** value in the start position */
  start: number;
  /** full-range reference value (healthy adults) */
  target: number;
  /** angle arc drawn on the skeleton (three joints, vertex in the middle) */
  arc?: [Joint, Joint, Joint];
  basis: string;
  /** UI-PRMD episodes begin at rest; set when the exercise's start position is the dataset's end-range
   *  (sit-to-stand: recordings go stand→sit→stand, but we coach seated→standing) */
  startIsExcursion?: boolean;
}

export type SidePick =
  /** bilateral move seen from the side: assess whichever side faces the camera */
  | "visible"
  /** unilateral: lock on to whichever limb starts moving, then do the other side */
  | "active"
  /** lunge: the leg whose foot is further forward */
  | "front-foot";

export interface ExerciseDef {
  id: string;
  name: string;
  tagline: string;
  kind: "reps" | "hold";
  region: Region;
  view: View;
  sidePick: SidePick;
  /** unilateral exercises are done on both sides in turn */
  bothSides: boolean;
  reps?: number;
  holdSeconds?: number;
  /** reps faster than this get a "slow down" cue, ms. For UI-PRMD moves ≈ 0.9 × the 10th-percentile duration
   *  of the healthy demonstration reps, so only genuinely rushed reps are flagged. */
  minRepMs?: number;
  /** a lowering (eccentric) phase faster than this gets a "lower slowly" cue, ms. For UI-PRMD moves
   *  ≈ 0.8 × the 10th-percentile duration of that phase in the healthy reps. */
  minLowerMs?: number;
  /** which half of the rep is the lowering one: "return" (raises: the way back down, default) or
   *  "out" (squat / lunge: the descent away from the start) */
  lowerPhase?: "out" | "return";
  primary: PrimaryMotion;
  checks: FormCheck[];
  /** landmarks that must be visible (sided joints use the assessed side; "*" both sides) */
  required: Array<Joint | `${Joint}*`>;
  steps: string[];
  camera: string;
  /** what public data informed this exercise */
  source: { dataset?: string; movement?: string; notes: string };
  demo: DemoSpec;
}

export interface AssessedSide {
  side: Side;
  facing: number;
}

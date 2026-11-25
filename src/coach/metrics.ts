/**
 * Biomechanical measurements computed from a single 2D pose.
 *
 * All angles are in degrees and follow clinical goniometry conventions where possible
 * (e.g. knee flexion 0° = straight). Each metric is defined for a specific camera view —
 * these are 2D projections, which is how video-based goniometry is done in clinic too.
 */
import { LM, idx, other, type PoseFrame, type Side, type Vec2 } from "../pose/landmarks.ts";
import { angleAt, dist, mid, signedFromDown, signedFromUp, tiltDown } from "../pose/geometry.ts";

export interface MetricCtx {
  pts: Vec2[];
  vis: number[];
  /** side of the body being assessed (for unilateral metrics) */
  side: Side;
  /** +1 when the person faces +x on screen, -1 when facing −x (side-view metrics only) */
  facing: number;
}

export type MetricId =
  | "kneeFlexion"
  | "otherKneeFlexion"
  | "hipFlexion"
  | "thighFlexion"
  | "thighFlexionAbs"
  | "trunkLean"
  | "trunkLeanAbs"
  | "trunkSway"
  | "shoulderFlexion"
  | "shoulderExtension"
  | "shoulderElevation"
  | "elbowBend"
  | "shrug"
  | "legAbduction"
  | "otherKneeFlexionFront"
  | "pelvisTilt"
  | "shoulderTilt"
  | "trunkSideBend"
  | "headTilt"
  | "hipShift"
  | "heelLift"
  | "shinLean"
  | "kneesForward"
  | "neckFlexion"
  | "headTurn"
  | "torsoLength";

export interface MetricInfo {
  label: string;
  unit: "°" | "%";
  fn: (c: MetricCtx) => number;
}

const P = (c: MetricCtx, joint: Parameters<typeof idx>[0], side: Side = c.side) => c.pts[idx(joint, side)];
const midShoulder = (c: MetricCtx) => mid(c.pts[LM.leftShoulder], c.pts[LM.rightShoulder]);
const midHip = (c: MetricCtx) => mid(c.pts[LM.leftHip], c.pts[LM.rightHip]);
/** +1 if the given side of the body lies at larger x on screen (front view). */
const lateralSign = (c: MetricCtx, side: Side) =>
  Math.sign(P(c, "hip", side).x - P(c, "hip", other(side)).x || P(c, "shoulder", side).x - P(c, "shoulder", other(side)).x) || 1;

/** In side view, use the hip/shoulder of the assessed side for trunk line (less occlusion noise). */
const trunkLine = (c: MetricCtx): [Vec2, Vec2] => [P(c, "hip"), P(c, "shoulder")];

export const METRICS: Record<MetricId, MetricInfo> = {
  // ── side view, lower body ────────────────────────────────────────────────────────────
  kneeFlexion: {
    label: "Knee flexion",
    unit: "°",
    fn: (c) => 180 - angleAt(P(c, "hip"), P(c, "knee"), P(c, "ankle")),
  },
  otherKneeFlexion: {
    label: "Standing-knee flexion",
    unit: "°",
    fn: (c) => 180 - angleAt(P(c, "hip", other(c.side)), P(c, "knee", other(c.side)), P(c, "ankle", other(c.side))),
  },
  hipFlexion: {
    label: "Hip flexion",
    unit: "°",
    // trunk–thigh angle (0° standing tall)
    fn: (c) => 180 - angleAt(P(c, "shoulder"), P(c, "hip"), P(c, "knee")),
  },
  thighFlexion: {
    label: "Hip flexion",
    unit: "°",
    // thigh vs. vertical, + when the knee moves forward
    fn: (c) => signedFromDown(P(c, "hip"), P(c, "knee"), c.facing),
  },
  thighFlexionAbs: {
    label: "Thigh off vertical",
    unit: "°",
    fn: (c) => Math.abs(signedFromDown(P(c, "hip"), P(c, "knee"), c.facing)),
  },
  trunkLean: {
    label: "Trunk lean",
    unit: "°",
    // + forward, − backward
    fn: (c) => {
      const [h, s] = trunkLine(c);
      return signedFromUp(h, s, c.facing);
    },
  },
  trunkLeanAbs: {
    label: "Trunk lean",
    unit: "°",
    fn: (c) => {
      const [h, s] = trunkLine(c);
      return Math.abs(signedFromUp(h, s, c.facing));
    },
  },
  shinLean: {
    label: "Shin angle",
    unit: "°",
    // shank vs. vertical, + when the knee travels forward past the ankle
    fn: (c) => signedFromUp(P(c, "ankle"), P(c, "knee"), c.facing),
  },
  kneesForward: {
    label: "Knees ahead of hips",
    unit: "°",
    // shin lean minus trunk lean: in a hip-dominant squat the shin and trunk stay roughly parallel;
    // a large positive gap means the knees shot forward instead of the hips sitting back
    fn: (c) => {
      const [h, s] = trunkLine(c);
      return signedFromUp(P(c, "ankle"), P(c, "knee"), c.facing) - signedFromUp(h, s, c.facing);
    },
  },
  neckFlexion: {
    label: "Head drop",
    unit: "°",
    // deviation of the shoulder→ear line from the trunk line (0° = head in line with the spine)
    fn: (c) => 180 - angleAt(P(c, "hip"), P(c, "shoulder"), P(c, "ear")),
  },
  heelLift: {
    label: "Heel lift",
    unit: "%",
    // heel height above toe as % of shank length
    fn: (c) => (100 * (P(c, "toe").y - P(c, "heel").y)) / Math.max(1e-6, dist(P(c, "knee"), P(c, "ankle"))),
  },

  // ── side view, upper body ────────────────────────────────────────────────────────────
  shoulderFlexion: {
    label: "Shoulder flexion",
    unit: "°",
    // unwrapped past vertical: an arm slightly behind the head reads 185°, not −175° (extension never gets near −120°)
    fn: (c) => {
      const v = signedFromDown(P(c, "shoulder"), P(c, "elbow"), c.facing);
      return v < -120 ? v + 360 : v;
    },
  },
  shoulderExtension: {
    label: "Shoulder extension",
    unit: "°",
    fn: (c) => -signedFromDown(P(c, "shoulder"), P(c, "elbow"), c.facing),
  },
  elbowBend: {
    label: "Elbow bend",
    unit: "°",
    fn: (c) => 180 - angleAt(P(c, "shoulder"), P(c, "elbow"), P(c, "wrist")),
  },

  // ── front view ───────────────────────────────────────────────────────────────────────
  shoulderElevation: {
    label: "Arm elevation",
    unit: "°",
    // angle between trunk (shoulder→hip) and upper arm: 0° at the side, 180° overhead
    fn: (c) => angleAt(P(c, "hip"), P(c, "shoulder"), P(c, "elbow")),
  },
  shrug: {
    label: "Shoulder shrug",
    unit: "%",
    // vertical ear→shoulder gap as % of shoulder width; it *shrinks* when shrugging (compare to baseline)
    fn: (c) =>
      (100 * (P(c, "shoulder").y - P(c, "ear").y)) /
      Math.max(1e-6, dist(c.pts[LM.leftShoulder], c.pts[LM.rightShoulder])),
  },
  legAbduction: {
    label: "Hip abduction",
    unit: "°",
    // leg (hip→ankle) relative to the body's long axis
    fn: (c) => {
      const axis = { x: midHip(c).x - midShoulder(c).x, y: midHip(c).y - midShoulder(c).y };
      const hip = P(c, "hip");
      return angleAt({ x: hip.x + axis.x, y: hip.y + axis.y }, hip, P(c, "ankle"));
    },
  },
  otherKneeFlexionFront: {
    label: "Standing-knee bend",
    unit: "°",
    fn: (c) => 180 - angleAt(P(c, "hip", other(c.side)), P(c, "knee", other(c.side)), P(c, "ankle", other(c.side))),
  },
  pelvisTilt: {
    label: "Pelvis tilt",
    unit: "°",
    // + when the assessed side's hip is LOWER than the other
    fn: (c) => tiltDown(P(c, "hip"), P(c, "hip", other(c.side))),
  },
  shoulderTilt: {
    label: "Shoulder tilt",
    unit: "°",
    // + when the assessed side's shoulder is LOWER than the other
    fn: (c) => tiltDown(P(c, "shoulder"), P(c, "shoulder", other(c.side))),
  },
  trunkSway: {
    label: "Side lean",
    unit: "°",
    fn: (c) => Math.abs(signedFromUp(midHip(c), midShoulder(c), 1)),
  },
  trunkSideBend: {
    label: "Side bend",
    unit: "°",
    // lateral flexion TOWARD the assessed side, + when bending that way
    fn: (c) => signedFromUp(midHip(c), midShoulder(c), lateralSign(c, c.side)),
  },
  headTilt: {
    label: "Neck side-bend",
    unit: "°",
    // ear line tilt toward the assessed side (that ear drops)
    fn: (c) => tiltDown(P(c, "ear"), P(c, "ear", other(c.side))),
  },
  headTurn: {
    label: "Head rotation",
    unit: "%",
    // nose offset from the midpoint between the ears, % of ear width (0 = facing straight ahead)
    fn: (c) => {
      const ears = mid(c.pts[LM.leftEar], c.pts[LM.rightEar]);
      return (100 * Math.abs(c.pts[LM.nose].x - ears.x)) / Math.max(1e-6, dist(c.pts[LM.leftEar], c.pts[LM.rightEar]));
    },
  },
  torsoLength: {
    label: "Trunk length",
    unit: "%",
    // shoulder-midpoint → hip-midpoint distance (% of frame height). Seen from the front it shortens when the trunk
    // folds forward but not in a true side bend — use as a % change from the start position
    fn: (c) => 100 * dist(midShoulder(c), midHip(c)),
  },
  hipShift: {
    label: "Hip shift",
    unit: "%",
    // lateral pelvis offset from the feet, % of hip width (+ away from the assessed side)
    fn: (c) => {
      const feet = mid(c.pts[LM.leftAnkle], c.pts[LM.rightAnkle]);
      const w = Math.max(1e-6, dist(c.pts[LM.leftHip], c.pts[LM.rightHip]));
      return (100 * (feet.x - midHip(c).x) * lateralSign(c, c.side)) / w;
    },
  },
};

export function measure(id: MetricId, frame: PoseFrame, side: Side, facing: number): number {
  return METRICS[id].fn({ pts: frame.pts, vis: frame.vis, side, facing });
}

/**
 * Which way is the person facing on screen in a side view? +1 = toward +x.
 * Uses heel→toe vectors (most reliable), falls back to nose vs. ears.
 */
export function detectFacing(frame: PoseFrame): number {
  const { pts, vis } = frame;
  let s = 0;
  for (const side of ["left", "right"] as const) {
    const h = idx("heel", side), t = idx("toe", side);
    const w = Math.min(vis[h], vis[t]);
    s += (pts[t].x - pts[h].x) * w;
  }
  if (Math.abs(s) > 0.004) return Math.sign(s);
  const ears = mid(pts[LM.leftEar], pts[LM.rightEar]);
  return Math.sign(pts[LM.nose].x - ears.x) || 1;
}

/**
 * Body-orientation ratio: shoulder width relative to torso length. ≈0.7–0.9 facing the camera,
 * ≈0–0.35 side-on.
 */
export function frontalness(frame: PoseFrame): number {
  const { pts } = frame;
  const sw = dist(pts[LM.leftShoulder], pts[LM.rightShoulder]);
  const hw = dist(pts[LM.leftHip], pts[LM.rightHip]);
  const torso = dist(mid(pts[LM.leftShoulder], pts[LM.rightShoulder]), mid(pts[LM.leftHip], pts[LM.rightHip]));
  return (sw + hw * 1.25) / 2 / Math.max(1e-6, torso);
}

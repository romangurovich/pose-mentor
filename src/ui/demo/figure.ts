/**
 * Procedural stick-figure kinematics for the animated exercise demos.
 * Poses are expressed in joint angles (degrees), so a demo is just two poses we interpolate.
 */

export interface SidePose {
  /** trunk lean, + forward */
  trunk: number;
  /** head pitch relative to trunk, + chin down */
  neck: number;
  /** thigh angle from straight down, + forward ("near" = leg closer to the viewer) */
  thighNear: number;
  thighFar: number;
  /** knee flexion (shank folds backward) */
  kneeNear: number;
  kneeFar: number;
  /** upper arm from straight down, + forward */
  armNear: number;
  armFar: number;
  /** elbow flexion (forearm folds forward/up) */
  elbowNear: number;
  elbowFar: number;
}

export interface FrontPose {
  /** trunk side-bend, + toward screen right */
  trunk: number;
  /** head side-tilt relative to trunk, + toward screen right */
  head: number;
  /** arm abduction from the side, outward + (L = screen left) */
  armL: number;
  armR: number;
  elbowL: number;
  elbowR: number;
  /** leg abduction, outward + */
  legL: number;
  legR: number;
}

export type Prop = "chair" | "wall";

export type DemoSpec =
  | { view: "side"; from: Partial<SidePose>; to: Partial<SidePose>; props?: Prop[]; anchor?: "near" | "far"; mode: "cycle" | "hold" }
  | { view: "front"; from: Partial<FrontPose>; to: Partial<FrontPose>; props?: Prop[]; mode: "cycle" | "hold" };

export const SIDE_REST: SidePose = {
  trunk: 0, neck: 0, thighNear: 0, thighFar: 0, kneeNear: 0, kneeFar: 0,
  armNear: 4, armFar: -4, elbowNear: 8, elbowFar: 8,
};
export const FRONT_REST: FrontPose = {
  trunk: 0, head: 0, armL: 8, armR: 8, elbowL: 6, elbowR: 6, legL: 4, legR: 4,
};

// segment lengths (SVG units; figure ≈ 175 tall)
const L = { neck: 7, head: 10, torso: 52, upper: 29, fore: 27, thigh: 44, shank: 43, foot: 15, shoulderW: 21, hipW: 12 };

export interface Pt { x: number; y: number }
export interface FigureGeometry {
  head: Pt;
  headR: number;
  /** polylines, drawn back-to-front; `far` limbs drawn dimmer */
  limbs: Array<{ pts: Pt[]; far: boolean }>;
  torso: Pt[];
  joints: Array<Pt & { far: boolean }>;
  ground: number;
}

const D2R = Math.PI / 180;
/** unit vector at angle a (deg) from straight down, rotating toward +x */
const down = (a: number): Pt => ({ x: Math.sin(a * D2R), y: Math.cos(a * D2R) });
const add = (p: Pt, v: Pt, s: number): Pt => ({ x: p.x + v.x * s, y: p.y + v.y * s });

export const GROUND_Y = 186;

export function sideFigure(p: SidePose, anchor: "near" | "far" = "near", seatY?: number): FigureGeometry {
  const hip: Pt = { x: 0, y: 0 };
  const shoulder = add(hip, down(180 - p.trunk), L.torso); // up and forward
  const neckTop = add(shoulder, down(180 - p.trunk - p.neck * 0.5), L.neck);
  const head = add(neckTop, down(180 - p.trunk - p.neck), L.head);

  const leg = (thigh: number, knee: number) => {
    const k = add(hip, down(thigh), L.thigh);
    const a = add(k, down(thigh - knee), L.shank);
    const toe = { x: a.x + L.foot, y: a.y + 2 };
    const heel = { x: a.x - 4, y: a.y + 2 };
    return [hip, k, a, heel, toe] as Pt[];
  };
  const arm = (upper: number, elbow: number) => {
    const e = add(shoulder, down(upper), L.upper);
    const w = add(e, down(upper + elbow), L.fore);
    return [shoulder, e, w] as Pt[];
  };

  const legN = leg(p.thighNear, p.kneeNear);
  const legF = leg(p.thighFar, p.kneeFar);
  const armN = arm(p.armNear, p.elbowNear);
  const armF = arm(p.armFar, p.elbowFar);

  // ground contact: anchor foot sits on the floor (or the pelvis on the seat)
  const anc = anchor === "near" ? legN : legF;
  const lowestFoot = Math.max(legN[3].y, legF[3].y, legN[4].y, legF[4].y);
  let dy = GROUND_Y - lowestFoot;
  if (seatY !== undefined && hip.y + dy > seatY) dy = seatY - hip.y;
  const dx = -anc[2].x;
  const T = (q: Pt): Pt => ({ x: q.x + dx, y: q.y + dy });

  return {
    head: T(head),
    headR: L.head,
    torso: [T(hip), T(shoulder), T(neckTop)],
    limbs: [
      { pts: legF.slice(0, 3).map(T).concat([T(legF[3]), T(legF[4]), T(legF[2])]), far: true },
      { pts: armF.map(T), far: true },
      { pts: legN.slice(0, 3).map(T).concat([T(legN[3]), T(legN[4]), T(legN[2])]), far: false },
      { pts: armN.map(T), far: false },
    ],
    joints: [
      ...[legF[1], legF[2], armF[1], armF[2]].map((q) => ({ ...T(q), far: true })),
      ...[hip, shoulder, legN[1], legN[2], armN[1], armN[2]].map((q) => ({ ...T(q), far: false })),
    ],
    ground: GROUND_Y,
  };
}

export function frontFigure(p: FrontPose): FigureGeometry {
  const pelvis: Pt = { x: 0, y: 0 };
  const up = down(180 + p.trunk);
  const neckBase = add(pelvis, up, L.torso);
  const across = { x: Math.cos(p.trunk * D2R), y: Math.sin(p.trunk * D2R) };
  const shL = add(neckBase, across, -L.shoulderW);
  const shR = add(neckBase, across, L.shoulderW);
  const hipL = { x: -L.hipW, y: 0 };
  const hipR = { x: L.hipW, y: 0 };
  const neckTop = add(neckBase, down(180 + p.trunk), L.neck);
  const head = add(neckTop, down(180 + p.trunk + p.head), L.head);

  const arm = (s: Pt, abd: number, elbow: number, dir: -1 | 1) => {
    const e = add(s, down(dir * abd + p.trunk), L.upper);
    const w = add(e, down(dir * (abd + elbow) + p.trunk), L.fore);
    return [s, e, w];
  };
  const leg = (h: Pt, abd: number, dir: -1 | 1) => {
    const k = add(h, down(dir * abd), L.thigh);
    const a = add(k, down(dir * abd), L.shank);
    return [h, k, a, { x: a.x + dir * 7, y: a.y + 3 }];
  };
  const aL = arm(shL, p.armL, p.elbowL, -1);
  const aR = arm(shR, p.armR, p.elbowR, 1);
  const lL = leg(hipL, p.legL, -1);
  const lR = leg(hipR, p.legR, 1);
  const lowest = Math.max(lL[3].y, lR[3].y);
  const dy = GROUND_Y - lowest;
  const T = (q: Pt): Pt => ({ x: q.x, y: q.y + dy });
  return {
    head: T(head),
    headR: L.head,
    torso: [T(hipL), T(shL), T(neckBase), T(shR), T(hipR), T(hipL)],
    limbs: [aL, aR, lL, lR].map((pts) => ({ pts: pts.map(T), far: false })),
    joints: [shL, shR, aL[1], aR[1], aL[2], aR[2], hipL, hipR, lL[1], lR[1], lL[2], lR[2]].map((q) => ({ ...T(q), far: false })),
    ground: GROUND_Y,
  };
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Interpolated geometry for animation phase t ∈ [0,1). */
export function demoFrame(spec: DemoSpec, t: number): FigureGeometry {
  // cycle: rest(0.15) → move(0.3) → hold(0.15) → return(0.3) → rest(0.1)
  // hold:  rest(0.15) → move(0.25) → hold(0.6)
  let k: number;
  if (spec.mode === "cycle") {
    if (t < 0.15) k = 0;
    else if (t < 0.45) k = ease((t - 0.15) / 0.3);
    else if (t < 0.6) k = 1;
    else if (t < 0.9) k = 1 - ease((t - 0.6) / 0.3);
    else k = 0;
  } else {
    k = t < 0.15 ? 0 : t < 0.4 ? ease((t - 0.15) / 0.25) : 1;
  }
  if (spec.view === "side") {
    const a = { ...SIDE_REST, ...spec.from }, b = { ...SIDE_REST, ...spec.to };
    const p = {} as SidePose;
    for (const key of Object.keys(a) as (keyof SidePose)[]) p[key] = a[key] + (b[key] - a[key]) * k;
    const seat = spec.props?.includes("chair") ? GROUND_Y - 88 : undefined;
    return sideFigure(p, spec.anchor ?? "near", seat);
  }
  const a = { ...FRONT_REST, ...spec.from }, b = { ...FRONT_REST, ...spec.to };
  const p = {} as FrontPose;
  for (const key of Object.keys(a) as (keyof FrontPose)[]) p[key] = a[key] + (b[key] - a[key]) * k;
  return frontFigure(p);
}

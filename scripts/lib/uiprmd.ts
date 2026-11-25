/**
 * UI-PRMD Kinect v2 loader + forward kinematics.
 *
 * The Kinect files store, per frame, 22 joints × 3 values:
 *   positions: joint 1 (waist) is absolute (cm); joints 2..22 are *offsets in the parent's frame*
 *   angles:    per-joint local Euler rotations in degrees, columns [x, y, z]
 * so absolute positions require forward kinematics through the BVH-style hierarchy below.
 *
 * Coordinate system (Brekel / Kinect): +X screen right (= the subject's LEFT, since they face the
 * sensor), +Y up, +Z towards the sensor.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

export const KJ = {
  waist: 0,
  spine: 1,
  chest: 2,
  neck: 3,
  head: 4,
  headTip: 5,
  lCollar: 6,
  lShoulder: 7, // "left upper arm"
  lElbow: 8, // "left forearm"
  lWrist: 9, // "left hand"
  rCollar: 10,
  rShoulder: 11,
  rElbow: 12,
  rWrist: 13,
  lHip: 14, // "left upper leg"
  lKnee: 15, // "left lower leg"
  lAnkle: 16, // "left foot"
  lToe: 17,
  rHip: 18,
  rKnee: 19,
  rAnkle: 20,
  rToe: 21,
} as const;

/** parent of each joint (0-based), -1 for root */
export const PARENT = [-1, 0, 1, 2, 3, 4, 2, 6, 7, 8, 2, 10, 11, 12, 0, 14, 15, 16, 0, 18, 19, 20];

export type V3 = [number, number, number];
export type M3 = number[]; // row-major 3x3

export const MOVEMENTS: Record<string, string> = {
  m01: "Deep squat",
  m02: "Hurdle step",
  m03: "Inline lunge",
  m04: "Side lunge",
  m05: "Sit to stand",
  m06: "Standing active straight leg raise",
  m07: "Standing shoulder abduction",
  m08: "Standing shoulder extension",
  m09: "Standing shoulder internal-external rotation",
  m10: "Standing shoulder scaption",
};

function rx(t: number): M3 {
  const c = Math.cos(t), s = Math.sin(t);
  return [1, 0, 0, 0, c, -s, 0, s, c];
}
function ry(t: number): M3 {
  const c = Math.cos(t), s = Math.sin(t);
  return [c, 0, s, 0, 1, 0, -s, 0, c];
}
function rz(t: number): M3 {
  const c = Math.cos(t), s = Math.sin(t);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}
export function mul(a: M3, b: M3): M3 {
  const r = new Array(9).fill(0);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return r;
}
function apply(m: M3, v: V3): V3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

/** Euler composition order, written as the matrix product left→right, e.g. "ZYX" = Rz·Ry·Rx. */
export type EulerOrder = "XYZ" | "XZY" | "YXZ" | "YZX" | "ZXY" | "ZYX";
export const EULER_ORDERS: EulerOrder[] = ["XYZ", "XZY", "YXZ", "YZX", "ZXY", "ZYX"];

export function eulerToMatrix(deg: V3, order: EulerOrder): M3 {
  const d = Math.PI / 180;
  const m: Record<string, M3> = { X: rx(deg[0] * d), Y: ry(deg[1] * d), Z: rz(deg[2] * d) };
  return mul(mul(m[order[0]], m[order[1]]), m[order[2]]);
}

function parseCsv(path: string): number[][] {
  return readFileSync(path, "utf8")
    .trim()
    .split(/\r?\n/)
    .map((l) => l.split(",").map(Number));
}

/** Absolute joint positions for every frame: frames × 22 × V3 (cm). */
export function forwardKinematics(pos: number[][], ang: number[][], order: EulerOrder): V3[][] {
  const out: V3[][] = [];
  for (let f = 0; f < pos.length; f++) {
    const p = pos[f], a = ang[f];
    const local: M3[] = [];
    for (let j = 0; j < 22; j++) local.push(eulerToMatrix([a[3 * j], a[3 * j + 1], a[3 * j + 2]], order));
    const glob: M3[] = new Array(22);
    const abs: V3[] = new Array(22);
    for (let j = 0; j < 22; j++) {
      const par = PARENT[j];
      const off: V3 = [p[3 * j], p[3 * j + 1], p[3 * j + 2]];
      if (par < 0) {
        abs[j] = off;
        glob[j] = local[j];
      } else {
        const o = apply(glob[par], off);
        abs[j] = [abs[par][0] + o[0], abs[par][1] + o[1], abs[par][2] + o[2]];
        glob[j] = mul(glob[par], local[j]);
      }
    }
    out.push(abs);
  }
  return out;
}

export interface Episode {
  movement: string; // "m01"
  subject: number;
  episode: number;
  correct: boolean;
  frames: V3[][];
}

export const DEFAULT_ROOT = join(import.meta.dirname, "..", "..", "data", "uiprmd");

/** Brekel BVH export composes rotations as Rz·Rx·Ry (channel order Zrotation Xrotation Yrotation);
 *  verified empirically in scripts/explore-euler.ts (feet stay planted during squats only for this order). */
export const BEST_ORDER: EulerOrder = "ZXY";

export function loadEpisodes(
  movement: string,
  split: "correct" | "incorrect",
  root = DEFAULT_ROOT,
  order: EulerOrder = BEST_ORDER,
): Episode[] {
  const pdir = join(root, split, "positions");
  const adir = join(root, split, "angles");
  if (!existsSync(pdir)) throw new Error(`UI-PRMD not found at ${pdir}. Run: python3 scripts/fetch_uiprmd.py`);
  const suffix = split === "correct" ? "" : "_inc";
  const files = readdirSync(pdir).filter((f) => f.startsWith(movement + "_")).sort();
  return files.map((f) => {
    const m = /m(\d+)_s(\d+)_e(\d+)/.exec(f)!;
    const pos = parseCsv(join(pdir, f));
    const ang = parseCsv(join(adir, f.replace(`_positions${suffix}`, `_angles${suffix}`)));
    return {
      movement,
      subject: Number(m[2]),
      episode: Number(m[3]),
      correct: split === "correct",
      frames: forwardKinematics(pos, ang, order),
    };
  });
}

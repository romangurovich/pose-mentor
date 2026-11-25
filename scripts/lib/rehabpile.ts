/**
 * Rehab-Pile loader (see scripts/fetch_rehabpile.py): converts each dataset's skeleton into the UI-PRMD
 * joint layout (`KJ`, centimetres, +X = subject's left, +Y up, +Z toward the sensor) so the same virtual
 * webcam and metric code can measure it.
 *
 * Source skeletons are Kinect v2 camera space (metres; +X = sensor's left, +Y up, +Z away from the sensor).
 * That frame is the UI-PRMD one rotated 180° about the vertical, so x and z are negated.
 *
 * Joints a dataset lacks are synthesised and must not be relied on by the metrics being calibrated:
 *   KIMORE  (18 joints): no feet → toes placed ahead of the ankles
 *   KERAAL  (11 joints): no legs → hips beside the pelvis, straight legs below them
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { KJ, type V3, type Episode } from "./uiprmd.ts";

export const RP_ROOT = join(import.meta.dirname, "..", "..", "data", "rehabpile");

export interface RPEpisode extends Episode {
  dataset: string;
  /** class id / letter (classification) or clinical score (regression) */
  label: number | string;
  /** sitting rather than standing (knees nearly level with the hips in the first frame) */
  seated: boolean;
}

interface RawFile {
  dataset: string;
  joints: number;
  samples: Array<{ subject: string | null; label: number | string; frames: number[][][] }>;
}

type Layout = "kinect25" | "kimore18" | "keraal11";

const layoutOf = (joints: number): Layout => (joints === 25 ? "kinect25" : joints === 18 ? "kimore18" : joints === 11 ? "keraal11" : (() => { throw new Error(`unknown layout with ${joints} joints`); })());

const add = (a: V3, b: V3, s = 1): V3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const lerp = (a: V3, b: V3, t: number): V3 => add(a, sub(b, a), t);
const unit = (a: V3): V3 => {
  const n = Math.hypot(...a) || 1;
  return [a[0] / n, a[1] / n, a[2] / n];
};
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const UP: V3 = [0, 1, 0];

/** Kinect camera space (m) → UI-PRMD frame (cm) */
const toUI = (p: number[]): V3 => [-p[0] * 100, p[1] * 100, -p[2] * 100];

function convertFrame(raw: number[][], layout: Layout, forward: V3, lateral: V3): V3[] {
  const J = raw.map(toUI);
  const out: V3[] = new Array(22);
  const set = (k: number, p: V3) => (out[k] = p);
  if (layout === "kinect25") {
    set(KJ.waist, J[0]); set(KJ.spine, J[1]); set(KJ.chest, J[20]); set(KJ.neck, J[2]); set(KJ.head, J[3]);
    set(KJ.lShoulder, J[4]); set(KJ.lElbow, J[5]); set(KJ.lWrist, J[6]);
    set(KJ.rShoulder, J[8]); set(KJ.rElbow, J[9]); set(KJ.rWrist, J[10]);
    set(KJ.lHip, J[12]); set(KJ.lKnee, J[13]); set(KJ.lAnkle, J[14]); set(KJ.lToe, J[15]);
    set(KJ.rHip, J[16]); set(KJ.rKnee, J[17]); set(KJ.rAnkle, J[18]); set(KJ.rToe, J[19]);
  } else if (layout === "kimore18") {
    set(KJ.waist, J[0]); set(KJ.spine, J[1]); set(KJ.chest, J[17]); set(KJ.neck, lerp(J[17], J[2], 0.5)); set(KJ.head, J[2]);
    set(KJ.lShoulder, J[3]); set(KJ.lElbow, J[4]); set(KJ.lWrist, J[5]);
    set(KJ.rShoulder, J[7]); set(KJ.rElbow, J[8]); set(KJ.rWrist, J[9]);
    set(KJ.lHip, J[11]); set(KJ.lKnee, J[12]); set(KJ.lAnkle, J[13]);
    set(KJ.rHip, J[14]); set(KJ.rKnee, J[15]); set(KJ.rAnkle, J[16]);
    set(KJ.lToe, add(add(J[13], forward, 14), UP, -4));
    set(KJ.rToe, add(add(J[16], forward, 14), UP, -4));
  } else {
    set(KJ.waist, J[0]); set(KJ.spine, J[1]); set(KJ.chest, J[10]); set(KJ.neck, J[2]); set(KJ.head, J[3]);
    set(KJ.lShoulder, J[4]); set(KJ.lElbow, J[5]); set(KJ.lWrist, J[6]);
    set(KJ.rShoulder, J[7]); set(KJ.rElbow, J[8]); set(KJ.rWrist, J[9]);
    for (const [s, hip, knee, ankle, toe] of [[1, KJ.lHip, KJ.lKnee, KJ.lAnkle, KJ.lToe], [-1, KJ.rHip, KJ.rKnee, KJ.rAnkle, KJ.rToe]] as const) {
      const h = add(J[0], lateral, 9 * s);
      set(hip, h);
      set(knee, add(h, UP, -44));
      set(ankle, add(h, UP, -86));
      set(toe, add(add(h, UP, -90), forward, 14));
    }
  }
  set(KJ.headTip, add(out[KJ.head], UP, 10));
  set(KJ.lCollar, out[KJ.chest]);
  set(KJ.rCollar, out[KJ.chest]);
  return out;
}

export function loadRehabPile(name: string): RPEpisode[] {
  const path = join(RP_ROOT, name + ".json");
  if (!existsSync(path)) throw new Error(`Rehab-Pile ${name} not found at ${path}. Run: python3 scripts/fetch_rehabpile.py`);
  const raw: RawFile = JSON.parse(readFileSync(path, "utf8"));
  const layout = layoutOf(raw.joints);
  const perSubject = new Map<string, number>();
  return raw.samples.map((s, i) => {
    // body axes from the first frame: lateral from the shoulders (all layouts have them), forward ⟂ lateral
    const f0 = s.frames[0].map(toUI);
    const [ls, rs] = layout === "kinect25" ? [f0[4], f0[8]] : layout === "kimore18" ? [f0[3], f0[7]] : [f0[4], f0[7]];
    const lateral = unit([ls[0] - rs[0], 0, ls[2] - rs[2]]);
    const forward = cross(lateral, UP);
    const frames = s.frames.map((fr) => convertFrame(fr, layout, forward, lateral));
    const first = frames[0];
    const seated = layout !== "keraal11" && (first[KJ.lHip][1] + first[KJ.rHip][1]) / 2 - (first[KJ.lKnee][1] + first[KJ.rKnee][1]) / 2 < 22;
    const subjKey = s.subject ?? `x${i}`;
    const n = (perSubject.get(subjKey) ?? 0) + 1;
    perSubject.set(subjKey, n);
    const subject = Number.parseInt(subjKey.replace(/\D/g, "") || String(i), 10);
    return {
      movement: name,
      dataset: raw.dataset,
      subject,
      episode: n,
      correct: typeof s.label === "number" ? s.label === 1 : s.label === "C",
      label: s.label,
      seated,
      frames,
    };
  });
}

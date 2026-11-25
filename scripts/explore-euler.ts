/**
 * Which Euler order makes UI-PRMD's Kinect forward kinematics physically plausible?
 * Criteria (healthy subjects, correct reps):
 *  - deep squat (m01) & sit-to-stand (m05): the feet stay planted -> ankle/toe positions barely move
 *  - bilateral squat: left & right knee flexion should be similar
 */
import { loadEpisodes, EULER_ORDERS, KJ, type V3 } from "./lib/uiprmd.ts";

const std = (a: number[]) => { const m = a.reduce((s, x) => s + x, 0) / a.length; return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length); };
const ang = (a: V3, b: V3, c: V3) => {
  const u = [a[0]-b[0], a[1]-b[1], a[2]-b[2]], v = [c[0]-b[0], c[1]-b[1], c[2]-b[2]];
  const d = u[0]*v[0]+u[1]*v[1]+u[2]*v[2]; const n = Math.hypot(...u) * Math.hypot(...v);
  return Math.acos(Math.max(-1, Math.min(1, d / n))) * 180 / Math.PI;
};

for (const order of EULER_ORDERS) {
  const row: string[] = [order];
  for (const mv of ["m01", "m05"]) {
    const eps = loadEpisodes(mv, "correct", undefined, order).slice(0, 40);
    let footMove = 0, kneeAsym = 0, minKnee = 0;
    for (const e of eps) {
      const ay = e.frames.map((f) => f[KJ.lAnkle][1] - f[KJ.waist][1] * 0); // absolute ankle height
      const ax = e.frames.map((f) => f[KJ.lAnkle][0]);
      const az = e.frames.map((f) => f[KJ.lAnkle][2]);
      const ry_ = e.frames.map((f) => f[KJ.rAnkle][1]);
      footMove += (std(ay) + std(ax) + std(az) + std(ry_)) / 4;
      const lk = e.frames.map((f) => ang(f[KJ.lHip], f[KJ.lKnee], f[KJ.lAnkle]));
      const rk = e.frames.map((f) => ang(f[KJ.rHip], f[KJ.rKnee], f[KJ.rAnkle]));
      kneeAsym += lk.reduce((s, x, i) => s + Math.abs(x - rk[i]), 0) / lk.length;
      minKnee += Math.min(...lk);
    }
    const n = eps.length;
    row.push(`${mv}: foot-move ${(footMove / n).toFixed(2)}cm  knee L/R diff ${(kneeAsym / n).toFixed(1)}°  min knee ${(minKnee / n).toFixed(0)}°`);
  }
  console.log(row.join("  |  "));
}

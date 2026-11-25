/**
 * Render a UI-PRMD Kinect skeleton through a *virtual webcam* into the exact representation the
 * app gets from MediaPipe: 33 BlazePose landmarks in aspect-corrected 2D image space.
 *
 * This lets the very same metric + coaching code be calibrated and evaluated on public data.
 */
import { LM, NUM_LANDMARKS, type PoseFrame, type Side, type Vec2 } from "../../src/pose/landmarks.ts";
import { KJ, type V3, type Episode } from "./uiprmd.ts";

export interface Camera {
  view: "side" | "front";
  /** side view: which side of the subject the camera stands on */
  cameraSide?: Side;
  /** stddev of Gaussian landmark noise, in frame heights (MediaPipe-like jitter ≈ 0.003–0.006) */
  noise?: number;
  seed?: number;
}

const ASPECT = 16 / 9;
const CM_PER_FRAME_HEIGHT = 230;

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const addS = (a: V3, b: V3, s: number): V3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V3): V3 => {
  const n = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / n, a[1] / n, a[2] / n];
};
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  const u = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  return () => Math.sqrt(-2 * Math.log(u() + 1e-12)) * Math.cos(2 * Math.PI * u());
}

/** Which limb moves most in this episode (for unilateral movements). */
export function movingSide(ep: Episode, limb: "arm" | "leg"): Side {
  const [l, r] = limb === "arm" ? [KJ.lWrist, KJ.rWrist] : [KJ.lAnkle, KJ.rAnkle];
  const travel = (j: number) => {
    let d = 0;
    for (let i = 1; i < ep.frames.length; i++) d += Math.hypot(...sub(ep.frames[i][j], ep.frames[i - 1][j]));
    return d;
  };
  return travel(l) > travel(r) ? "left" : "right";
}

/** Project a whole episode. Body axes come from the first frame so the subject's own heading defines "front". */
export function projectEpisode(ep: Episode, cam: Camera): PoseFrame[] {
  const f0 = ep.frames[0];
  const up: V3 = [0, 1, 0];
  const hipVec = sub(f0[KJ.lHip], f0[KJ.rHip]);
  const lateral = norm([hipVec[0], 0, hipVec[2]]); // toward the subject's LEFT
  const forward = cross(lateral, up); // toward the subject's front
  const ground = Math.min(f0[KJ.lAnkle][1], f0[KJ.rAnkle][1]) - 8;
  const origin = f0[KJ.waist];

  // image x axis in world coordinates (see header comment for derivation)
  let xAxis: V3;
  if (cam.view === "front") xAxis = lateral; // subject's left appears at image right (unmirrored webcam)
  else xAxis = cam.cameraSide === "left" ? [-forward[0], -forward[1], -forward[2]] : forward;

  const gauss = rng(cam.seed ?? 7);
  const noise = cam.noise ?? 0;
  const near: Side | null = cam.view === "side" ? (cam.cameraSide ?? "right") : null;

  return ep.frames.map((J, i) => {
    const P = (p: V3): Vec2 => ({
      x: ASPECT / 2 + dot(sub(p, origin), xAxis) / CM_PER_FRAME_HEIGHT + gauss() * noise,
      y: 0.93 - (p[1] - ground) / CM_PER_FRAME_HEIGHT + gauss() * noise,
    });
    const head = J[KJ.head];
    const pts: Vec2[] = new Array(NUM_LANDMARKS);
    const vis: number[] = new Array(NUM_LANDMARKS).fill(0.95);

    pts[LM.nose] = P(addS(head, forward, 9));
    pts[LM.leftEye] = P(addS(addS(addS(head, forward, 7.5), lateral, 3.2), up, 2.5));
    pts[LM.rightEye] = P(addS(addS(addS(head, forward, 7.5), lateral, -3.2), up, 2.5));
    pts[LM.leftEyeInner] = pts[LM.leftEye];
    pts[LM.leftEyeOuter] = pts[LM.leftEye];
    pts[LM.rightEyeInner] = pts[LM.rightEye];
    pts[LM.rightEyeOuter] = pts[LM.rightEye];
    pts[LM.leftEar] = P(addS(head, lateral, 7.5));
    pts[LM.rightEar] = P(addS(head, lateral, -7.5));
    pts[LM.mouthLeft] = P(addS(addS(addS(head, forward, 8), lateral, 2.2), up, -5));
    pts[LM.mouthRight] = P(addS(addS(addS(head, forward, 8), lateral, -2.2), up, -5));

    const limb = (side: Side) => {
      const L = side === "left";
      const sh = J[L ? KJ.lShoulder : KJ.rShoulder];
      const el = J[L ? KJ.lElbow : KJ.rElbow];
      const wr = J[L ? KJ.lWrist : KJ.rWrist];
      const hip = J[L ? KJ.lHip : KJ.rHip];
      const kn = J[L ? KJ.lKnee : KJ.rKnee];
      const an = J[L ? KJ.lAnkle : KJ.rAnkle];
      const toe = J[L ? KJ.lToe : KJ.rToe];
      const footDir = sub(toe, an);
      const heel = addS(addS(an, [footDir[0], 0, footDir[2]], -0.35), up, -5);
      const hand = addS(wr, sub(wr, el), 0.3);
      const set = (name: number, p: V3) => (pts[name] = P(p));
      set(L ? LM.leftShoulder : LM.rightShoulder, sh);
      set(L ? LM.leftElbow : LM.rightElbow, el);
      set(L ? LM.leftWrist : LM.rightWrist, wr);
      set(L ? LM.leftPinky : LM.rightPinky, hand);
      set(L ? LM.leftIndex : LM.rightIndex, hand);
      set(L ? LM.leftThumb : LM.rightThumb, hand);
      set(L ? LM.leftHip : LM.rightHip, hip);
      set(L ? LM.leftKnee : LM.rightKnee, kn);
      set(L ? LM.leftAnkle : LM.rightAnkle, an);
      set(L ? LM.leftHeel : LM.rightHeel, heel);
      set(L ? LM.leftFootIndex : LM.rightFootIndex, toe);
      if (near && side !== near) {
        for (const k of [LM.leftShoulder, LM.leftElbow, LM.leftWrist, LM.leftHip, LM.leftKnee, LM.leftAnkle, LM.leftHeel, LM.leftFootIndex, LM.leftEar]) {
          vis[L ? k : k + 1] = 0.62; // right-side landmark = left index + 1
        }
      }
    };
    limb("left");
    limb("right");
    return { t: (i * 1000) / 30, pts, vis };
  });
}

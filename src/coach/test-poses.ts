/** Synthetic poses for engine tests (shared by src/coach and src/tts tests). */
import type { CoachEngine, CoachEvent } from "./engine.ts";
import { LM, NUM_LANDMARKS, type PoseFrame, type Vec2 } from "../pose/landmarks.ts";

/**
 * Minimal side-view body builder (person facing +x, near side = right).
 * Angles in degrees; lengths in frame heights.
 */
export function sidePose(t: number, o: { knee?: number; thigh?: number; trunk?: number; arm?: number; frontal?: boolean } = {}): PoseFrame {
  const knee = o.knee ?? 0, thigh = o.thigh ?? knee / 2, trunk = o.trunk ?? 0, arm = o.arm ?? 0;
  const d2r = Math.PI / 180;
  const ankle = { x: 0.9, y: 0.9 };
  // shank angle from down (negative = leaning forward over the toes when facing +x)
  const shank = thigh - knee;
  const kneeP = { x: ankle.x + Math.sin(-shank * d2r) * -0.22 * -1, y: ankle.y - Math.cos(shank * d2r) * 0.22 };
  kneeP.x = ankle.x - Math.sin(shank * d2r) * 0.22;
  const hip = { x: kneeP.x - Math.sin(thigh * d2r) * 0.23, y: kneeP.y - Math.cos(thigh * d2r) * 0.23 };
  const shoulder = { x: hip.x + Math.sin(trunk * d2r) * 0.28, y: hip.y - Math.cos(trunk * d2r) * 0.28 };
  const elbow = { x: shoulder.x + Math.sin(arm * d2r) * 0.15, y: shoulder.y + Math.cos(arm * d2r) * 0.15 };
  const wrist = { x: elbow.x + Math.sin(arm * d2r) * 0.14, y: elbow.y + Math.cos(arm * d2r) * 0.14 };
  const pts: Vec2[] = new Array(NUM_LANDMARKS).fill(null).map(() => ({ ...shoulder, y: shoulder.y - 0.1 }));
  const w = o.frontal ? 0.09 : 0.01; // half body width on screen
  const put = (l: number, r: number, p: Vec2) => {
    pts[l] = { x: p.x - w, y: p.y };
    pts[r] = { x: p.x + w, y: p.y };
  };
  put(LM.leftShoulder, LM.rightShoulder, shoulder);
  put(LM.leftElbow, LM.rightElbow, elbow);
  put(LM.leftWrist, LM.rightWrist, wrist);
  put(LM.leftHip, LM.rightHip, hip);
  put(LM.leftKnee, LM.rightKnee, kneeP);
  put(LM.leftAnkle, LM.rightAnkle, ankle);
  put(LM.leftHeel, LM.rightHeel, { x: ankle.x - 0.03, y: ankle.y + 0.02 });
  put(LM.leftFootIndex, LM.rightFootIndex, { x: ankle.x + 0.07, y: ankle.y + 0.025 });
  // head stays in line with the trunk
  const head = { x: shoulder.x + Math.sin(trunk * d2r) * 0.09, y: shoulder.y - Math.cos(trunk * d2r) * 0.09 };
  put(LM.leftEar, LM.rightEar, head);
  pts[LM.nose] = { x: head.x + Math.cos(trunk * d2r) * 0.04, y: head.y + Math.sin(trunk * d2r) * 0.04 };
  return { t, pts, vis: new Array(NUM_LANDMARKS).fill(0.95) };
}

export function run(engine: CoachEngine, frames: PoseFrame[]) {
  const events: CoachEvent[] = [];
  let last = engine.update(frames[0]);
  for (const f of frames) {
    last = engine.update(f);
    events.push(...last.events);
  }
  return { last, events };
}

/** n squat reps: rest → descend → ascend → rest, at 30 fps. */
export function squats(n: number, depth: number, opts: { trunk?: number; repMs?: number; downMs?: number; thighRatio?: number; ratios?: number[] } = {}) {
  const frames: PoseFrame[] = [];
  let t = 0;
  const repMs = opts.repMs ?? 3000;
  const downFrames = Math.max(1, Math.round(((opts.downMs ?? repMs / 2) / 1000) * 30));
  const upFrames = Math.max(1, Math.round(((repMs - (opts.downMs ?? repMs / 2)) / 1000) * 30));
  // hip-dominant squat by default: thigh ≈ 0.7 × knee flexion, so shin and trunk stay roughly parallel
  let ratio = opts.thighRatio ?? 0.7;
  const push = (knee: number, trunk = 0) => frames.push(sidePose((t += 33.3), { knee, thigh: knee * ratio, trunk }));
  const pose = (k: number) => push(2 + (depth - 2) * k, (opts.trunk ?? 30) * k);
  for (let i = 0; i < 30; i++) push(2);
  for (let r = 0; r < n; r++) {
    ratio = opts.ratios?.[r] ?? opts.thighRatio ?? 0.7;
    for (let i = 0; i <= downFrames; i++) pose(Math.sin((Math.PI / 2) * (i / downFrames)));
    for (let i = 1; i <= upFrames; i++) pose(Math.cos((Math.PI / 2) * (i / upFrames)));
    for (let i = 0; i < 20; i++) push(2);
  }
  return frames;
}

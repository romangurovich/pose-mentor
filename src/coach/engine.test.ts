import { describe, expect, it } from "vitest";
import { CoachEngine, faultInfo, repPhases, type CoachEvent } from "./engine.ts";
import { getExercise } from "./exercises.ts";
import { METRICS } from "./metrics.ts";
import { angleAt, signedFromDown, tiltDown } from "../pose/geometry.ts";
import { LM, NUM_LANDMARKS, type PoseFrame, type Vec2 } from "../pose/landmarks.ts";

/**
 * Minimal side-view body builder (person facing +x, near side = right).
 * Angles in degrees; lengths in frame heights.
 */
function sidePose(t: number, o: { knee?: number; thigh?: number; trunk?: number; arm?: number; frontal?: boolean } = {}): PoseFrame {
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

function run(engine: CoachEngine, frames: PoseFrame[]) {
  const events: CoachEvent[] = [];
  let last = engine.update(frames[0]);
  for (const f of frames) {
    last = engine.update(f);
    events.push(...last.events);
  }
  return { last, events };
}

/** n squat reps: rest → descend → ascend → rest, at 30 fps. */
function squats(n: number, depth: number, opts: { trunk?: number; repMs?: number; downMs?: number; thighRatio?: number } = {}) {
  const frames: PoseFrame[] = [];
  let t = 0;
  const repMs = opts.repMs ?? 3000;
  const downFrames = Math.max(1, Math.round(((opts.downMs ?? repMs / 2) / 1000) * 30));
  const upFrames = Math.max(1, Math.round(((repMs - (opts.downMs ?? repMs / 2)) / 1000) * 30));
  // hip-dominant squat by default: thigh ≈ 0.7 × knee flexion, so shin and trunk stay roughly parallel
  const ratio = opts.thighRatio ?? 0.7;
  const push = (knee: number, trunk = 0) => frames.push(sidePose((t += 33.3), { knee, thigh: knee * ratio, trunk }));
  const pose = (k: number) => push(2 + (depth - 2) * k, (opts.trunk ?? 30) * k);
  for (let i = 0; i < 30; i++) push(2);
  for (let r = 0; r < n; r++) {
    for (let i = 0; i <= downFrames; i++) pose(Math.sin((Math.PI / 2) * (i / downFrames)));
    for (let i = 1; i <= upFrames; i++) pose(Math.cos((Math.PI / 2) * (i / upFrames)));
    for (let i = 0; i < 20; i++) push(2);
  }
  return frames;
}

describe("geometry", () => {
  it("measures interior and signed angles", () => {
    expect(angleAt({ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 })).toBeCloseTo(90);
    expect(signedFromDown({ x: 0, y: 0 }, { x: 1, y: 1 }, 1)).toBeCloseTo(45);
    expect(signedFromDown({ x: 0, y: 0 }, { x: 1, y: 1 }, -1)).toBeCloseTo(-45);
    expect(tiltDown({ x: 0, y: 1 }, { x: 1, y: 0 })).toBeCloseTo(45);
  });

  it("computes clinical knee flexion from a synthetic pose", () => {
    const f = sidePose(0, { knee: 90 });
    const v = METRICS.kneeFlexion.fn({ pts: f.pts, vis: f.vis, side: "right", facing: 1 });
    expect(v).toBeCloseTo(90, 0);
  });
});

describe("CoachEngine · reps", () => {
  const squat = getExercise("squat");

  it("counts clean squats and stays quiet about form", () => {
    const engine = new CoachEngine(squat, { rangeGoal: 0.8, reps: 5 });
    const { events, last } = run(engine, squats(5, squat.primary.target));
    const reps = events.filter((e) => e.type === "rep");
    expect(reps).toHaveLength(5);
    expect(last.status).toBe("done");
    expect(reps.every((e) => e.type === "rep" && e.rep.faults.length === 0 && e.rep.full)).toBe(true);
  });

  it("flags excessive trunk lean", () => {
    const engine = new CoachEngine(squat, { rangeGoal: 0.8, reps: 10 });
    const { events } = run(engine, squats(3, squat.primary.target, { trunk: 60 }));
    const reps = events.flatMap((e) => (e.type === "rep" ? [e.rep] : []));
    expect(reps).toHaveLength(3);
    expect(reps.every((r) => r.faults.includes("trunk"))).toBe(true);
    expect(events.some((e) => e.type === "say" && e.text === "Keep your chest up")).toBe(true);
  });

  it("doesn't count shallow reps but nudges for more range", () => {
    const engine = new CoachEngine(squat, { rangeGoal: 1, reps: 10 });
    const { events } = run(engine, squats(2, squat.primary.target * 0.5));
    expect(events.filter((e) => e.type === "rep")).toHaveLength(0);
    expect(events.some((e) => e.type === "say" && /further/.test(e.text))).toBe(true);
  });

  it("asks you to slow down when rushing", () => {
    const engine = new CoachEngine(squat, { rangeGoal: 0.8, reps: 10 });
    const { events } = run(engine, squats(2, squat.primary.target, { repMs: 700 }));
    const reps = events.flatMap((e) => (e.type === "rep" ? [e.rep] : []));
    expect(reps.length).toBeGreaterThan(0);
    expect(reps.every((r) => r.faults.includes("tempo"))).toBe(true);
  });

  it("cues hips back when the knees drive forward", () => {
    const engine = new CoachEngine(squat, { rangeGoal: 0.8, reps: 10 });
    // knee-dominant: thigh only 0.45 × knee flexion → steep shin, upright trunk
    const { events } = run(engine, squats(3, squat.primary.target, { thighRatio: 0.45, trunk: 15 }));
    const reps = events.flatMap((e) => (e.type === "rep" ? [e.rep] : []));
    expect(reps).toHaveLength(3);
    expect(reps.every((r) => r.faults.includes("hips"))).toBe(true);
    expect(events.some((e) => e.type === "say" && /hips back/.test(e.text))).toBe(true);
  });

  it("flags dropping into the squat, but not a controlled descent", () => {
    const drop = run(new CoachEngine(squat, { rangeGoal: 0.8, reps: 10 }), squats(2, squat.primary.target, { repMs: 3000, downMs: 150 }));
    const dropReps = drop.events.flatMap((e) => (e.type === "rep" ? [e.rep] : []));
    expect(dropReps.length).toBeGreaterThan(0);
    expect(dropReps.every((r) => r.faults.includes("lowering") && !r.faults.includes("tempo"))).toBe(true);
    expect(drop.events.some((e) => e.type === "say" && e.text === faultInfo(squat, "lowering").cue)).toBe(true);

    const ctrl = run(new CoachEngine(squat, { rangeGoal: 0.8, reps: 10 }), squats(2, squat.primary.target, { repMs: 3000, downMs: 1800 }));
    expect(ctrl.events.flatMap((e) => (e.type === "rep" ? e.rep.faults : []))).not.toContain("lowering");
  });

  it("asks you to turn sideways when facing the camera", () => {
    const engine = new CoachEngine(squat, { rangeGoal: 0.8 });
    let st = engine.update(sidePose(0, { frontal: true }));
    for (let i = 1; i < 30; i++) st = engine.update(sidePose(i * 33, { frontal: true }));
    expect(st.status).toBe("orient");
  });

  it("reports missing joints", () => {
    const engine = new CoachEngine(squat, { rangeGoal: 0.8 });
    let st = engine.update(null);
    expect(st.status).toBe("searching");
    for (let i = 0; i < 30; i++) {
      const f = sidePose(i * 33);
      for (const j of [LM.leftAnkle, LM.rightAnkle, LM.leftHeel, LM.rightHeel, LM.leftFootIndex, LM.rightFootIndex]) f.vis[j] = 0.1;
      st = engine.update(f);
    }
    expect(st.status).toBe("framing");
    expect(st.missing).toContain("feet");
  });

  it("says you're good to go once everything is in frame", () => {
    const engine = new CoachEngine(squat, { rangeGoal: 0.8 });
    const feet = [LM.leftAnkle, LM.rightAnkle, LM.leftHeel, LM.rightHeel, LM.leftFootIndex, LM.rightFootIndex];
    const events: CoachEvent[] = [];
    let st = engine.update(null);
    let t = 0;
    for (let i = 0; i < 20; i++) {
      const f = sidePose((t += 33));
      for (const j of feet) f.vis[j] = 0.1;
      st = engine.update(f);
      events.push(...st.events);
    }
    expect(st.inFrame).toBe(false);
    expect(events.some((e) => e.type === "say" && /good to go/.test(e.text))).toBe(false);
    for (let i = 0; i < 30; i++) {
      st = engine.update(sidePose((t += 33)));
      events.push(...st.events);
      if (i === 20) expect(st.goodToGo).toBe(true);
    }
    const said = events.flatMap((e) => (e.type === "say" ? [e.text] : []));
    expect(said.filter((x) => /good to go/.test(x))).toHaveLength(1);
    expect(said).not.toContain("Ready when you are");
    expect(st.inFrame).toBe(true);
    expect(st.status).toBe("ready");
  });
});

describe("repPhases", () => {
  it("times the way out and the way back from the top of the rep", () => {
    const trace = [0.3, 0.6, 1, 0.98, 1.02, 0.95, 0.5, 0.15].map((p, i) => ({ t: i * 100, p }));
    expect(repPhases(trace)).toEqual({ outMs: 200, returnMs: 200 });
  });
});

describe("CoachEngine · holds", () => {
  it("calls out bouncing in a stretch, but not a slow ease deeper", () => {
    const ex = getExercise("hamstring-stretch");
    const holdIn = (bounce: (i: number) => number) => {
      const engine = new CoachEngine(ex, { rangeGoal: 1, holdSeconds: 60 });
      let t = 0;
      const events: CoachEvent[] = [];
      let st = engine.update(sidePose(t));
      for (let i = 0; i < 20; i++) st = engine.update(sidePose((t += 33.3)));
      for (let i = 0; i < 150; i++) {
        st = engine.update(sidePose((t += 33.3), { trunk: ex.primary.target + 2 + bounce(i) }));
        events.push(...st.events);
      }
      return { st, events };
    };
    // ±6° at ~2 Hz
    const bouncy = holdIn((i) => 6 * Math.sin((2 * Math.PI * i) / 15));
    expect(bouncy.st.faults.map((f) => f.id)).toContain("bounce");
    expect(bouncy.events.some((e) => e.type === "say" && /bouncing/.test(e.text))).toBe(true);
    // 12° deeper over 5 s, monotonic
    const easing = holdIn((i) => (12 * i) / 150);
    expect(easing.st.faults.map((f) => f.id)).not.toContain("bounce");
  });

  it("times a wall sit only while in position", () => {
    const ex = getExercise("wall-sit");
    const engine = new CoachEngine(ex, { rangeGoal: 1, holdSeconds: 5 });
    let t = 0;
    let st = engine.update(sidePose(t, { knee: 2 }));
    for (let i = 0; i < 30; i++) st = engine.update(sidePose((t += 33.3), { knee: 2 }));
    expect(st.hold!.elapsed).toBe(0);
    for (let i = 0; i < 90; i++) st = engine.update(sidePose((t += 33.3), { knee: 80, thigh: 80 }));
    expect(st.hold!.elapsed).toBeGreaterThan(2.5);
    expect(st.hold!.elapsed).toBeLessThan(3.2);
    for (let i = 0; i < 100; i++) st = engine.update(sidePose((t += 33.3), { knee: 80, thigh: 80 }));
    expect(st.status).toBe("done");
  });
});

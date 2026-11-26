import { describe, expect, it } from "vitest";
import { CoachEngine, type CoachEvent } from "../coach/engine.ts";
import { getExercise } from "../coach/exercises.ts";
import { sidePose, squats } from "../coach/test-poses.ts";
import { LM, type PoseFrame } from "../pose/landmarks.ts";
import { LOCALES } from "../i18n/index.ts";
import type { Locale } from "../i18n/types.ts";
import { allPhrases, sessionPhrases } from "./phrases.ts";
import { clipId, voiceKey } from "./hash.ts";

/** everything the engine said while playing these frames */
function said(engine: CoachEngine, frames: PoseFrame[]): string[] {
  const out: string[] = [];
  for (const f of frames) out.push(...engine.update(f).events.flatMap((e: CoachEvent) => (e.type === "say" ? [e.text] : [])));
  return out;
}

const FEET = [LM.leftAnkle, LM.rightAnkle, LM.leftHeel, LM.rightHeel, LM.leftFootIndex, LM.rightFootIndex];

/** realistic sessions covering framing, every rep outcome, side switches and holds */
function sessions(l: Locale): string[] {
  const out: string[] = [];
  // squat: feet out of frame, back in, then good / leaning / knee-dominant / dropping / rushed / shallow reps to the end
  {
    const e = new CoachEngine(getExercise("squat"), { rangeGoal: 0.8, reps: 12, locale: l });
    const hidden = Array.from({ length: 20 }, (_, i) => {
      const f = sidePose(i * 33);
      for (const j of FEET) f.vis[j] = 0.1;
      return f;
    });
    out.push(...said(e, hidden));
    const shift = (fs: PoseFrame[], dt: number) => fs.map((f) => ({ ...f, t: f.t + dt }));
    let t = 700;
    const T = getExercise("squat").primary.target;
    for (const fs of [
      squats(3, T),
      squats(2, T, { trunk: 60 }),
      squats(2, T, { thighRatio: 0.45, trunk: 15 }),
      squats(2, T, { repMs: 3000, downMs: 150 }),
      squats(1, T, { repMs: 700 }),
      squats(1, T * 0.5),
      squats(2, T),
    ]) {
      out.push(...said(e, shift(fs, t)));
      t += fs[fs.length - 1].t + 100;
    }
    // turned to face the camera
    out.push(...said(e, Array.from({ length: 30 }, (_, i) => sidePose(t + i * 33, { frontal: true }))));
  }
  // straight-leg raise on both sides: side switch
  {
    const e = new CoachEngine(getExercise("slr"), { rangeGoal: 0.8, reps: 2, locale: l, startSide: "right" });
    const frames: PoseFrame[] = [];
    let t = 0;
    const push = (thigh: number) => frames.push(sidePose((t += 33), { thigh, knee: 0 }));
    for (let side = 0; side < 2; side++) {
      for (let i = 0; i < 90; i++) push(0);
      for (let r = 0; r < 2; r++) {
        for (let i = 0; i <= 45; i++) push(80 * Math.sin((Math.PI * i) / 45));
        for (let i = 0; i < 20; i++) push(0);
      }
    }
    out.push(...said(e, frames));
  }
  // holds: a wall sit to completion, and a bouncy hamstring stretch
  {
    const e = new CoachEngine(getExercise("wall-sit"), { rangeGoal: 1, holdSeconds: 25, locale: l });
    const frames: PoseFrame[] = [];
    let t = 0;
    for (let i = 0; i < 30; i++) frames.push(sidePose((t += 33), { knee: 2 }));
    for (let i = 0; i < 30 * 27; i++) frames.push(sidePose((t += 33), { knee: 80, thigh: 80 }));
    out.push(...said(e, frames));
    const ham = getExercise("hamstring-stretch");
    const h = new CoachEngine(ham, { rangeGoal: 1, holdSeconds: 60, locale: l });
    const hf: PoseFrame[] = [];
    t = 0;
    for (let i = 0; i < 20; i++) hf.push(sidePose((t += 33)));
    for (let i = 0; i < 150; i++) hf.push(sidePose((t += 33), { trunk: ham.primary.target + 2 + 6 * Math.sin((2 * Math.PI * i) / 15) }));
    for (let i = 0; i < 40; i++) hf.push(sidePose((t += 33), { trunk: 10 })); // drops out of the stretch
    out.push(...said(h, hf));
  }
  return out;
}

describe.each(LOCALES.map((l) => [l.id, l] as const))("phrase list (%s)", (_id, l) => {
  const all = new Set(allPhrases(l));

  it("covers everything the coach says in realistic sessions", () => {
    const heard = sessions(l);
    expect(heard.length).toBeGreaterThan(20);
    expect([...new Set(heard)].filter((p) => !all.has(p))).toEqual([]);
  });

  it("session preload lists are a subset of the full list", () => {
    for (const id of ["squat", "slr", "wall-sit", "neck-tilt"]) {
      expect(sessionPhrases(l, getExercise(id), 10).filter((p) => !all.has(p))).toEqual([]);
    }
  });
});

describe("clip ids", () => {
  it("are stable and depend on voice and text", () => {
    expect(clipId("af_heart", "Keep your chest up")).toBe(clipId("af_heart", "Keep your chest up"));
    expect(clipId("af_heart", "Keep your chest up")).not.toBe(clipId("am_michael", "Keep your chest up"));
    expect(clipId("af_heart", "1")).not.toBe(clipId("af_heart", "2"));
  });

  it("don't collide across every phrase and voice", () => {
    const ids = new Set<string>();
    let n = 0;
    for (const l of LOCALES)
      for (const v of Object.values(l.tts ?? {}).map(voiceKey))
        for (const p of allPhrases(l)) {
          ids.add(clipId(v, p));
          n++;
        }
    expect(ids.size).toBe(n);
  });
});

import { describe, expect, it } from "vitest";
import { EXERCISES, getExercise } from "../coach/exercises.ts";
import { METRICS } from "../coach/metrics.ts";
import { CoachEngine, faultInfo, type CoachEvent } from "../coach/engine.ts";
import { LM, NUM_LANDMARKS, type PoseFrame, type Vec2 } from "../pose/landmarks.ts";
import { LOCALES, exerciseText, getLocale, matchLocale } from "./index.ts";
import { clipVoice } from "../ui/voice.ts";

/** every string a catalog can produce: call functions with representative arguments */
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (typeof v === "function") {
    for (const args of [[3, "reps"], [1, "hold"], ["X", 2, 2], [21]]) {
      try {
        strings(v(...args), out);
      } catch {
        /* argument shape didn't fit this function */
      }
    }
  } else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === "object" && !(v instanceof RegExp)) Object.values(v).forEach((x) => strings(x, out));
  return out;
}

describe.each(LOCALES.filter((l) => l.id !== "en").map((l) => [l.id, l] as const))("locale %s", (_id, l) => {
  it("translates every exercise, step and check", () => {
    for (const ex of EXERCISES) {
      const t = l.exercises[ex.id];
      expect(t, ex.id).toBeDefined();
      expect(t.name && t.tagline && t.camera, ex.id).toBeTruthy();
      expect(t.steps.length, `${ex.id} steps`).toBe(ex.steps.length);
      for (const c of ex.checks) {
        const tc = t.checks[c.id];
        expect(tc?.label && tc.cue, `${ex.id}.${c.id}`).toBeTruthy();
        if (c.short) expect(tc.short, `${ex.id}.${c.id}.short`).toBeTruthy();
        if (c.fixed) expect(tc.fixed, `${ex.id}.${c.id}.fixed`).toBeTruthy();
      }
    }
  });

  it("names every metric", () => {
    for (const id of Object.keys(METRICS)) expect(l.metrics[id as keyof typeof METRICS], id).toBeTruthy();
  });

  it("produces no empty strings", () => {
    const all = strings({ m: l.messages, ui: l.ui });
    expect(all.length).toBeGreaterThan(150);
    expect(all.filter((s) => s.trim() === "")).toEqual(l.ui.setup.technicalInEnglish ? [] : [""]);
  });
});

describe("gender-neutral address", () => {
  // words that would assume the user's gender (the coach's voice gender is a separate setting)
  const GENDERED: Record<string, RegExp> = {
    es: /\b(listo|lista|cansado|cansada|preparado|preparada)\b/i,
    pt: /\b(pronto|pronta|cansado|cansada|preparado|preparada)\b/i,
    fr: /\b(prêt|prête|fatigué|fatiguée)\b/i,
    ru: /(готов|готова|сделал|сделала|встал|встала|увидел|увидела)(?![а-яё])/i,
  };
  for (const l of LOCALES) {
    const re = GENDERED[l.id];
    if (!re) continue;
    it(l.id, () => {
      const all = strings({ m: l.messages, ui: l.ui });
      expect(all.filter((s) => re.test(s))).toEqual([]);
    });
  }
});

describe("natural voices", () => {
  it("gives every language and gender one: Kokoro where it has the language, Piper otherwise", () => {
    const v = (id: string, g: "female" | "male") => clipVoice(getLocale(id), g);
    expect([v("en", "female"), v("en", "male")]).toEqual(["af_heart", "am_michael"]);
    expect([v("es", "female"), v("es", "male")]).toEqual(["ef_dora", "em_alex"]);
    expect([v("fr", "female"), v("fr", "male")]).toEqual(["ff_siwis", "fr_FR-upmc-medium-pierre"]); // no male French Kokoro
    expect([v("pt", "female"), v("pt", "male")]).toEqual(["pf_dora", "pm_alex"]);
    expect([v("de", "female"), v("de", "male")]).toEqual(["de_DE-kerstin-medium", "de_DE-thorsten-high"]);
    expect([v("ru", "female"), v("ru", "male")]).toEqual(["ru_RU-irina-medium", "ru_RU-dmitri-medium"]);
    const en = getLocale("en").tts!.female!;
    expect(en.engine === "kokoro" && en.espeak).toBeFalsy(); // English uses kokoro-js's own phonemizer
  });
});

describe("lookups", () => {
  it("matches browser languages to a locale, falling back to English", () => {
    expect(matchLocale(["de-AT", "en"])).toBe("de");
    expect(matchLocale(["ja-JP"])).toBe("en");
    expect(getLocale("zz").id).toBe("en");
  });

  it("English exercise text is the exercise data", () => {
    const ex = getExercise("squat");
    expect(exerciseText(getLocale("en"), ex).name).toBe(ex.name);
    expect(faultInfo(ex, "trunk").cue).toBe("Keep your chest up");
  });
});

/** standing side-view pose (person facing +x); optionally with the feet out of view */
function standing(t: number, hideFeet: boolean): PoseFrame {
  const pts: Vec2[] = new Array(NUM_LANDMARKS).fill(null).map(() => ({ x: 0.9, y: 0.2 }));
  const put = (l: number, r: number, p: Vec2) => {
    pts[l] = { x: p.x - 0.01, y: p.y };
    pts[r] = { x: p.x + 0.01, y: p.y };
  };
  put(LM.leftShoulder, LM.rightShoulder, { x: 0.9, y: 0.3 });
  put(LM.leftElbow, LM.rightElbow, { x: 0.9, y: 0.45 });
  put(LM.leftWrist, LM.rightWrist, { x: 0.9, y: 0.59 });
  put(LM.leftHip, LM.rightHip, { x: 0.9, y: 0.58 });
  put(LM.leftKnee, LM.rightKnee, { x: 0.9, y: 0.75 });
  put(LM.leftAnkle, LM.rightAnkle, { x: 0.9, y: 0.9 });
  put(LM.leftHeel, LM.rightHeel, { x: 0.87, y: 0.92 });
  put(LM.leftFootIndex, LM.rightFootIndex, { x: 0.97, y: 0.925 });
  put(LM.leftEar, LM.rightEar, { x: 0.9, y: 0.21 });
  pts[LM.nose] = { x: 0.94, y: 0.21 };
  const vis = new Array(NUM_LANDMARKS).fill(0.95);
  if (hideFeet) for (const j of [LM.leftAnkle, LM.rightAnkle, LM.leftHeel, LM.rightHeel, LM.leftFootIndex, LM.rightFootIndex]) vis[j] = 0.1;
  return { t, pts, vis };
}

describe.each(LOCALES.map((l) => [l.id, l] as const))("engine speaks %s", (_id, l) => {
  it("asks to step back, then says you're good to go, in that language", () => {
    const engine = new CoachEngine(getExercise("squat"), { rangeGoal: 0.8, locale: l });
    const said: string[] = [];
    let headline = "";
    for (let i = 0; i < 50; i++) {
      const st = engine.update(standing(i * 33, i < 20));
      said.push(...st.events.flatMap((e: CoachEvent) => (e.type === "say" ? [e.text] : [])));
      if (i === 10) headline = st.headline;
    }
    expect(said).toContain(l.messages.say.stepBack(l.messages.joint.feet));
    expect(headline).toBe(l.messages.status.framing(l.messages.joint.feet)[0]);
    expect(said).toContain(l.messages.say.goodToGo("reps"));
  });
});

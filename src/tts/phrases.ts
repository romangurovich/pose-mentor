/**
 * Everything the coach can say, per language. The Kokoro voices are pre-generated from this list at build time
 * (scripts/build-voices.ts), so it must cover every `say` the engine makes — src/tts/phrases.test.ts drives the
 * engine to check that.
 */
import type { ExerciseDef } from "../coach/types.ts";
import type { Joint } from "../pose/landmarks.ts";
import { EXERCISES } from "../coach/exercises.ts";
import { JOINT_WORDS, faultInfo } from "../coach/engine.ts";
import type { JointWord, Locale } from "../i18n/types.ts";

/** most reps a set can be configured for (SetupSheet stepper) */
export const MAX_REPS = 30;

/** the body-part words an exercise can report missing, in the order the engine lists them */
function missingWords(ex: ExerciseDef): JointWord[] {
  const words: JointWord[] = [];
  for (const r of ex.required) {
    const w = JOINT_WORDS[r.replace("*", "") as Joint];
    if (!words.includes(w)) words.push(w);
  }
  return words;
}

/** every non-empty, order-preserving subset */
function subsets<T>(xs: T[]): T[][] {
  const out: T[][] = [];
  for (let mask = 1; mask < 1 << xs.length; mask++) out.push(xs.filter((_, i) => mask & (1 << i)));
  return out;
}

/** what the coach can say during one exercise */
function exercisePhrases(l: Locale, ex: ExerciseDef): string[] {
  const s = l.messages.say;
  const out: string[] = [];
  for (const parts of subsets(missingWords(ex))) out.push(s.stepBack(l.messages.list(parts.map((w) => l.messages.joint[w]))));
  out.push(ex.view === "side" ? s.turnSideways : s.faceCamera, s.goodToGo(ex.kind));
  const faults = [...ex.checks.map((c) => c.id), ...(ex.kind === "reps" ? ["tempo", "lowering"] : ["bounce"])];
  for (const id of faults) {
    const f = faultInfo(ex, id, l);
    out.push(id === "tempo" ? s.slowDown : f.cue, s.better(f.fixed ?? s.fixedFallback));
    if (f.short) out.push(f.short);
  }
  return out;
}

/** every phrase the coach can say in this language */
export function allPhrases(l: Locale): string[] {
  const s = l.messages.say;
  const out: string[] = [l.messages.sample, s.readyFirst, s.readyAgain, s.slowDown, s.almost, s.shallow, s.littleFurther, s.fixedFallback, ...s.praise];
  out.push(s.setComplete, s.allDone, s.holdIn, s.backInPosition, s.halfway, s.fiveMore, s.easeBack);
  out.push(s.switchSides(l.messages.side.left), s.switchSides(l.messages.side.right), s.better(s.fixedFallback));
  for (let n = 1; n <= MAX_REPS; n++) out.push(s.count(n));
  for (const ex of EXERCISES) out.push(...exercisePhrases(l, ex));
  return [...new Set(out)];
}

/** the phrases one session is most likely to need, roughly in the order they're first said (for preloading) */
export function sessionPhrases(l: Locale, ex: ExerciseDef, reps: number): string[] {
  const s = l.messages.say;
  const first = [s.goodToGo(ex.kind), s.readyFirst, s.readyAgain, ...(ex.kind === "reps" ? [1, 2, 3].map(s.count) : [s.holdIn])];
  const rest = exercisePhrases(l, ex).filter((p) => p !== s.goodToGo(ex.kind));
  const tail = ex.kind === "reps" ? [...Array.from({ length: Math.max(0, Math.min(reps, MAX_REPS) - 3) }, (_, i) => s.count(i + 4)), s.almost, s.shallow, ...s.praise, s.setComplete] : [s.halfway, s.fiveMore, s.easeBack, s.littleFurther, s.backInPosition, s.allDone];
  const sides = ex.bothSides ? [s.switchSides(l.messages.side.left), s.switchSides(l.messages.side.right)] : [];
  return [...new Set([...first, ...rest, ...tail, ...sides])];
}


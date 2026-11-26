/**
 * Prosody we control rather than leave to each model: speaking pace per language, and the pauses inside a phrase.
 *
 * Phrases are split at clause punctuation and each clause is synthesized on its own, then joined with silences of
 * a fixed length, so "Better — keep your chest up" has the same deliberate beat in every voice and language. Each
 * voice's pace is calibrated against a per-language target, because languages differ in natural syllable rate
 * (Spanish is faster than German in syllables per second at the same perceived speed).
 */
import type { LocaleId } from "../../src/i18n/types.ts";

/** silence after a clause, by the punctuation that ended it */
export const PAUSE_MS = { comma: 240, dash: 360, sentence: 520 } as const;

/**
 * Target articulation rate (syllables per second of speech, pauses excluded): about 80% of each language's
 * conversational rate (Pellegrino, Coupé & Marsico 2011; pt and ru estimated) — unhurried but brisk, clear instruction.
 */
export const TARGET_RATE: Record<LocaleId, number> = { en: 5.0, es: 6.2, fr: 5.7, de: 4.8, pt: 5.7, ru: 4.9 };

/** a voice is slowed to the target but never sped up, and never slowed below this */
export const MIN_SPEED = 0.7;

export interface Clause {
  /** text to synthesize, ending in "," for a continuation or its sentence punctuation */
  text: string;
  /** silence to insert after it */
  pauseMs: number;
}

const BREAK = /\s+[—–]\s+|[,;:](?=\s)|\s?[.!?…]+(?=\s)/g;

/** "Better — keep your chest up" → ["Better,", 360 ms] ["keep your chest up", 0] */
export function clauses(text: string): Clause[] {
  const out: Clause[] = [];
  let last = 0;
  for (const m of text.matchAll(BREAK)) {
    const body = text.slice(last, m.index).trim();
    const mark = m[0].trim();
    last = m.index + m[0].length;
    if (!body) continue;
    if (mark === "—" || mark === "–") out.push({ text: `${body},`, pauseMs: PAUSE_MS.dash });
    else if (/^[,;:]$/.test(mark)) out.push({ text: `${body},`, pauseMs: PAUSE_MS.comma });
    else out.push({ text: `${body}${mark}`, pauseMs: PAUSE_MS.sentence });
  }
  const rest = text.slice(last).trim();
  if (rest) out.push({ text: rest, pauseMs: 0 });
  else if (out.length) out[out.length - 1].pauseMs = 0;
  return out;
}

/** approximate syllables: vowel groups (Latin and Cyrillic) */
export function syllables(text: string): number {
  return (text.match(/[aeiouyàâäéèêëïîôöùûüÿæœáíóúãõåаеёиоуыэюя]+/giu) ?? []).length;
}

/** speed factor that brings a measured rate to the target: ≤ 1 (slower only) */
export function speedFor(measuredRate: number, target: number): number {
  return Math.round(Math.min(1, Math.max(MIN_SPEED, target / measuredRate)) * 100) / 100;
}


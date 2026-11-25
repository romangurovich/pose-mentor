/** Locale registry and lookups. English exercise text is the exercise data; other locales translate it. */
import type { ExerciseDef } from "../coach/types.ts";
import type { MetricId } from "../coach/metrics.ts";
import { en } from "./locales/en.ts";
import { es } from "./locales/es.ts";
import { fr } from "./locales/fr.ts";
import { de } from "./locales/de.ts";
import { pt } from "./locales/pt.ts";
import { ru } from "./locales/ru.ts";
import type { CheckText, ExerciseText, Locale, LocaleId } from "./types.ts";

export const LOCALES: Locale[] = [en, es, fr, de, pt, ru];
export const DEFAULT_LOCALE = en;

export function getLocale(id: string | null | undefined): Locale {
  return LOCALES.find((l) => l.id === id) ?? DEFAULT_LOCALE;
}

/** best supported locale for a list of browser language tags ("pt-BR" → pt) */
export function matchLocale(tags: readonly string[]): LocaleId {
  for (const tag of tags) {
    const base = tag.toLowerCase().split("-")[0];
    const hit = LOCALES.find((l) => l.id === base);
    if (hit) return hit.id;
  }
  return DEFAULT_LOCALE.id;
}

function englishText(ex: ExerciseDef): ExerciseText {
  return {
    name: ex.name,
    tagline: ex.tagline,
    steps: ex.steps,
    camera: ex.camera,
    checks: Object.fromEntries(ex.checks.map((c) => [c.id, { label: c.label, cue: c.cue, short: c.short, fixed: c.fixed }])),
  };
}

/** an exercise's text in this locale (any missing piece falls back to English) */
export function exerciseText(l: Locale, ex: ExerciseDef): ExerciseText {
  const base = englishText(ex);
  const t = l.exercises[ex.id];
  if (!t) return base;
  return {
    name: t.name || base.name,
    tagline: t.tagline || base.tagline,
    steps: t.steps?.length === base.steps.length ? t.steps : base.steps,
    camera: t.camera || base.camera,
    checks: Object.fromEntries(Object.entries(base.checks).map(([id, c]) => [id, { ...c, ...t.checks?.[id] }])),
  };
}

export function checkText(l: Locale, ex: ExerciseDef, checkId: string, field: keyof CheckText): string | undefined {
  const own = l.exercises[ex.id]?.checks?.[checkId]?.[field];
  if (own) return own;
  return ex.checks.find((c) => c.id === checkId)?.[field];
}

export function metricLabel(l: Locale, id: MetricId): string {
  return l.metrics[id] ?? en.metrics[id];
}

/** locale-aware number formatting with a unit ("104°", "12 %") */
export function fmtValue(l: Locale, v: number, unit: string): string {
  const n = Math.round(v).toLocaleString(l.tag);
  return unit === "%" && l.id !== "en" ? `${n} %` : `${n}${unit}`;
}

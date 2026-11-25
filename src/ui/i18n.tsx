/**
 * App settings (language, coach voice, theme) and the React context that hands the active locale to every
 * component. Stored in localStorage; `?lang=de&voice=male&theme=light` overrides for deep links and demos.
 * The default language follows the browser.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { LOCALES, getLocale, matchLocale } from "../i18n/index.ts";
import type { Locale, LocaleId, VoiceGender } from "../i18n/types.ts";

export type ThemeChoice = "system" | "light" | "dark";

export interface Settings {
  lang: LocaleId;
  voice: VoiceGender;
  theme: ThemeChoice;
}

const KEY = "pose-mentor.settings.v1";
const THEMES: ThemeChoice[] = ["system", "light", "dark"];

export function loadSettings(): Settings {
  let saved: Partial<Settings> = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    /* storage unavailable */
  }
  const q = typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams();
  const lang = q.get("lang") ?? saved.lang;
  const voice = q.get("voice") ?? saved.voice;
  const theme = (q.get("theme") ?? saved.theme) as ThemeChoice | undefined;
  return {
    lang: LOCALES.some((l) => l.id === lang) ? (lang as LocaleId) : matchLocale(typeof navigator !== "undefined" ? navigator.languages ?? [] : []),
    voice: voice === "male" ? "male" : "female",
    theme: theme && THEMES.includes(theme) ? theme : "system",
  };
}

function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
}

/** "system" leaves the attribute off so the CSS follows prefers-color-scheme */
export function applyDocument(s: Settings) {
  const root = document.documentElement;
  if (s.theme === "system") delete root.dataset.theme;
  else root.dataset.theme = s.theme;
  root.lang = getLocale(s.lang).tag;
}

interface I18n {
  locale: Locale;
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
}

const Ctx = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  useEffect(() => applyDocument(settings), [settings]);
  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((s) => {
      const next = { ...s, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);
  const value = useMemo(() => ({ locale: getLocale(settings.lang), settings, update }), [settings, update]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error("useI18n outside I18nProvider");
  return v;
}

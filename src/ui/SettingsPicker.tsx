import { useEffect, useRef, useState } from "react";
import { LOCALES } from "../i18n/index.ts";
import type { VoiceGender } from "../i18n/types.ts";
import { Icon } from "./icons.tsx";
import { useI18n, type ThemeChoice } from "./i18n.tsx";
import { kokoroVoiceId, previewVoice } from "./voice.ts";
import { hasVoice, loadManifest } from "../tts/clips.ts";

/** Nav control: language, coach voice (female / male) and theme (system / light / dark). */
export function SettingsPicker() {
  const { locale, settings, update } = useI18n();
  const t = locale.ui.settings;
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  // natural (Kokoro) voice when this language/gender has one and its clips are installed
  const kv = kokoroVoiceId(locale, settings.voice);
  const [clipsReady, setClipsReady] = useState(false);
  useEffect(() => {
    let live = true;
    void loadManifest().then(() => live && setClipsReady(true));
    return () => {
      live = false;
    };
  }, []);
  const natural = kv !== null && (!clipsReady || hasVoice(kv));

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const voices: Array<[VoiceGender, string]> = [
    ["female", t.female],
    ["male", t.male],
  ];
  const themes: Array<[ThemeChoice, string]> = [
    ["system", t.system],
    ["light", t.light],
    ["dark", t.dark],
  ];

  return (
    <div className="settings" ref={root}>
      <button className="settings-trigger" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="dialog">
        <Icon.Globe size={16} />
        {locale.id.toUpperCase()}
        <span className="settings-sep" aria-hidden />
        {settings.voice === "female" ? t.female : t.male}
      </button>
      {open && (
        <div className="settings-pop glass" role="dialog" aria-label={locale.ui.nav.settings}>
          <label className="settings-row">
            <span className="settings-label">{t.language}</span>
            <select value={settings.lang} onChange={(e) => update({ lang: e.target.value as typeof settings.lang })}>
              {LOCALES.map((l) => (
                <option key={l.id} value={l.id} lang={l.tag}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <div className="settings-row">
            <span className="settings-label">{t.voice}</span>
            <div className="settings-inline">
              <div className="seg seg-sm">
                {voices.map(([g, name]) => (
                  <button key={g} className={settings.voice === g ? "on" : ""} aria-pressed={settings.voice === g} onClick={() => update({ voice: g })}>
                    {name}
                  </button>
                ))}
              </div>
              <button className="icon-btn" onClick={() => previewVoice(locale, settings.voice)} aria-label={t.preview} title={t.preview}>
                <Icon.Volume size={16} />
              </button>
            </div>
          </div>
          <div className="settings-row">
            <span className="settings-label">{t.theme}</span>
            <div className="seg seg-sm">
              {themes.map(([id, name]) => (
                <button key={id} className={settings.theme === id ? "on" : ""} aria-pressed={settings.theme === id} onClick={() => update({ theme: id })}>
                  {name}
                </button>
              ))}
            </div>
          </div>
          {!natural && <p className="settings-note">{t.voiceSystem}</p>}
        </div>
      )}
    </div>
  );
}

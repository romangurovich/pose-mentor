/** Spoken coaching via the Web Speech API, plus subtle audio ticks via WebAudio. */
import { DEFAULT_LOCALE } from "../i18n/index.ts";
import type { Locale, VoiceGender } from "../i18n/types.ts";

type Kind = "cue" | "count" | "praise" | "info";
const PRIORITY: Record<Kind, number> = { cue: 3, info: 2, count: 1, praise: 0 };

/**
 * Best system voice for a language and gender. The Web Speech API exposes voice names, not genders, so each
 * locale lists known female / male voice names. If none is installed we fall back to any voice in the
 * language (and nudge the pitch toward the requested gender).
 */
export function pickVoice(l: Locale, gender: VoiceGender): { voice: SpeechSynthesisVoice | null; matched: boolean } {
  if (typeof speechSynthesis === "undefined") return { voice: null, matched: false };
  const lang = l.tag.slice(0, 2).toLowerCase();
  const inLang = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith(lang));
  // prefer the exact regional variant (pt-BR over pt-PT) when both exist
  const ranked = [...inLang].sort((a, b) => Number(b.lang.toLowerCase() === l.tag.toLowerCase()) - Number(a.lang.toLowerCase() === l.tag.toLowerCase()));
  for (const re of l.voices[gender]) {
    const v = ranked.find((x) => re.test(x.name));
    if (v) return { voice: v, matched: true };
  }
  return { voice: ranked[0] ?? null, matched: false };
}

export class VoiceCoach {
  enabled = true;
  private voice: SpeechSynthesisVoice | null = null;
  private matched = false;
  private readonly locale: Locale;
  private readonly gender: VoiceGender;
  private current: { kind: Kind } | null = null;
  private queue: Array<{ text: string; kind: Kind }> = [];
  private audio: AudioContext | null = null;

  constructor(locale: Locale = DEFAULT_LOCALE, gender: VoiceGender = "female") {
    this.locale = locale;
    this.gender = gender;
    if (typeof speechSynthesis === "undefined") return;
    const pick = () => ({ voice: this.voice, matched: this.matched } = pickVoice(this.locale, this.gender));
    pick();
    speechSynthesis.addEventListener?.("voiceschanged", pick);
  }

  say(text: string, kind: Kind) {
    if (!this.enabled || typeof speechSynthesis === "undefined") return;
    // a form cue interrupts a count/praise; otherwise queue (bounded, low priority dropped first)
    if (this.current && PRIORITY[kind] > PRIORITY[this.current.kind] && kind === "cue") {
      this.queue = [];
      speechSynthesis.cancel();
      this.current = null;
    }
    this.queue.push({ text, kind });
    this.queue.sort((a, b) => PRIORITY[b.kind] - PRIORITY[a.kind]);
    if (this.queue.length > 2) this.queue.length = 2;
    this.pump();
  }

  private pump() {
    if (this.current || !this.queue.length) return;
    const next = this.queue.shift()!;
    const u = new SpeechSynthesisUtterance(next.text);
    if (this.voice) u.voice = this.voice;
    u.lang = this.voice?.lang ?? this.locale.tag;
    u.rate = next.kind === "count" ? 1.15 : 1.04;
    u.pitch = fallbackPitch(this.gender, this.matched);
    u.volume = 1;
    this.current = { kind: next.kind };
    const done = () => {
      this.current = null;
      this.pump();
    };
    u.onend = done;
    u.onerror = done;
    speechSynthesis.speak(u);
  }

  stop() {
    this.queue = [];
    this.current = null;
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
  }

  /** very soft single blip: "I saw that" when a fault is flagged but the spoken cue is held back */
  tick() {
    if (!this.enabled) return;
    try {
      this.audio ??= new AudioContext();
      const ctx = this.audio;
      const s = ctx.currentTime;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = 440;
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(0.06, s + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.12);
      o.connect(g).connect(ctx.destination);
      o.start(s);
      o.stop(s + 0.15);
    } catch {
      /* audio unavailable */
    }
  }

  /** soft two-tone chime for a counted rep (higher when the rep was clean) */
  chime(clean: boolean) {
    if (!this.enabled) return;
    try {
      this.audio ??= new AudioContext();
      const ctx = this.audio;
      const t0 = ctx.currentTime;
      const notes = clean ? [660, 990] : [520, 620];
      notes.forEach((f, i) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = "sine";
        o.frequency.value = f;
        const s = t0 + i * 0.08;
        g.gain.setValueAtTime(0, s);
        g.gain.linearRampToValueAtTime(0.12, s + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, s + 0.25);
        o.connect(g).connect(ctx.destination);
        o.start(s);
        o.stop(s + 0.3);
      });
    } catch {
      /* audio unavailable */
    }
  }
}

/** without a named voice of the requested gender, nudge the default voice's pitch toward it */
function fallbackPitch(gender: VoiceGender, matched: boolean): number {
  if (matched) return 1;
  return gender === "male" ? 0.85 : 1.1;
}

/** speak the locale's sample line in the chosen voice (settings preview) */
export function previewVoice(l: Locale, gender: VoiceGender) {
  if (typeof speechSynthesis === "undefined") return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(l.messages.sample);
  const { voice, matched } = pickVoice(l, gender);
  if (voice) u.voice = voice;
  u.lang = voice?.lang ?? l.tag;
  u.pitch = fallbackPitch(gender, matched);
  u.rate = 1.04;
  speechSynthesis.speak(u);
}

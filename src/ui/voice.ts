/**
 * Spoken coaching, plus subtle audio ticks via Web Audio.
 *
 * Speech plays pre-generated Kokoro-82M clips (src/tts/clips.ts) when the language/gender has a Kokoro voice
 * and the phrase has a clip, and the device's Web Speech voices otherwise.
 */
import { DEFAULT_LOCALE } from "../i18n/index.ts";
import type { Locale, VoiceGender } from "../i18n/types.ts";
import { clipBuffer, hasClip, loadManifest, preload } from "../tts/clips.ts";

type Kind = "cue" | "count" | "praise" | "info";
const PRIORITY: Record<Kind, number> = { cue: 3, info: 2, count: 1, praise: 0 };

/**
 * Chrome fills the voice list asynchronously: getVoices() is [] until "voiceschanged" fires. Resolve once
 * voices exist (or after a short timeout, so speech still works with the default voice).
 */
export function voicesReady(timeoutMs = 1500): Promise<SpeechSynthesisVoice[]> {
  if (typeof speechSynthesis === "undefined") return Promise.resolve([]);
  const now = speechSynthesis.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => {
      speechSynthesis.removeEventListener?.("voiceschanged", done);
      clearTimeout(timer);
      resolve(speechSynthesis.getVoices());
    };
    const timer = setTimeout(done, timeoutMs);
    speechSynthesis.addEventListener?.("voiceschanged", done);
  });
}

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

/** without a named voice of the requested gender, nudge the default voice's pitch toward it */
function fallbackPitch(gender: VoiceGender, matched: boolean): number {
  if (matched) return 1;
  return gender === "male" ? 0.85 : 1.1;
}

/** the Kokoro voice id for a language + gender, if Kokoro has one */
export function kokoroVoiceId(l: Locale, gender: VoiceGender): string | null {
  return l.kokoro?.[gender] ?? null;
}

let sharedCtx: AudioContext | null = null;
/** one AudioContext for speech, chimes and previews, resumed in case the browser started it suspended */
function audioCtx(): AudioContext {
  sharedCtx ??= new AudioContext();
  if (sharedCtx.state === "suspended") void sharedCtx.resume();
  return sharedCtx;
}

export class VoiceCoach {
  enabled = true;
  private voice: SpeechSynthesisVoice | null = null;
  private matched = false;
  private readonly locale: Locale;
  private readonly gender: VoiceGender;
  private readonly kokoro: string | null;
  private current: { kind: Kind } | null = null;
  private queue: Array<{ text: string; kind: Kind }> = [];
  /** the clip currently playing */
  private source: AudioBufferSourceNode | null = null;
  /** bumped on every interruption, so a clip that finishes loading after one is dropped */
  private generation = 0;

  constructor(locale: Locale = DEFAULT_LOCALE, gender: VoiceGender = "female") {
    this.locale = locale;
    this.gender = gender;
    this.kokoro = kokoroVoiceId(locale, gender);
    if (this.kokoro) void loadManifest();
    if (typeof speechSynthesis === "undefined") return;
    const pick = () => ({ voice: this.voice, matched: this.matched } = pickVoice(this.locale, this.gender));
    pick();
    speechSynthesis.addEventListener?.("voiceschanged", pick);
  }

  /** decode this session's likely phrases in the background so the first cues play instantly */
  prepare(texts: Iterable<string>) {
    if (this.kokoro) void preload(audioCtx(), this.kokoro, texts);
  }

  say(text: string, kind: Kind) {
    if (!this.enabled) return;
    // a form cue interrupts a count/praise; otherwise queue (bounded, low priority dropped first)
    if (this.current && PRIORITY[kind] > PRIORITY[this.current.kind] && kind === "cue") {
      this.queue = [];
      this.silence();
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
    this.current = { kind: next.kind };
    const done = () => {
      this.current = null;
      this.pump();
    };
    if (this.kokoro && hasClip(this.kokoro, next.text)) this.playClip(this.kokoro, next.text, next.kind, done);
    else this.speakSystem(next.text, next.kind, done);
  }

  private playClip(voice: string, text: string, kind: Kind, done: () => void) {
    const gen = this.generation;
    const ctx = audioCtx();
    clipBuffer(ctx, voice, text).then(
      (buf) => {
        if (gen !== this.generation) return; // interrupted while loading
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(ctx.destination);
        src.onended = () => {
          if (this.source === src) this.source = null;
          done();
        };
        this.source = src;
        src.start();
      },
      () => {
        if (gen === this.generation) this.speakSystem(text, kind, done);
      },
    );
  }

  private speakSystem(text: string, kind: Kind, done: () => void) {
    if (typeof speechSynthesis === "undefined") return done();
    // the voice list may not have been loaded when this coach was created
    if (!this.voice) ({ voice: this.voice, matched: this.matched } = pickVoice(this.locale, this.gender));
    const u = new SpeechSynthesisUtterance(text);
    if (this.voice) u.voice = this.voice;
    u.lang = this.voice?.lang ?? this.locale.tag;
    u.rate = kind === "count" ? 1.15 : 1.04;
    u.pitch = fallbackPitch(this.gender, this.matched);
    u.volume = 1;
    u.onend = done;
    u.onerror = done;
    speechSynthesis.speak(u);
  }

  /** stop whatever is being said right now (clip or device voice) */
  private silence() {
    this.generation++;
    if (this.source) {
      const src = this.source;
      this.source = null;
      src.onended = null;
      try {
        src.stop();
      } catch {
        /* already stopped */
      }
    }
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
  }

  stop() {
    this.queue = [];
    this.current = null;
    this.silence();
  }

  /** very soft single blip: "I saw that" when a fault is flagged but the spoken cue is held back */
  tick() {
    if (!this.enabled) return;
    try {
      const ctx = audioCtx();
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
      const ctx = audioCtx();
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

let previewSrc: AudioBufferSourceNode | null = null;

/** speak the locale's sample line in the chosen voice (settings preview): the Kokoro clip if there is one */
export async function previewVoice(l: Locale, gender: VoiceGender) {
  if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
  try {
    previewSrc?.stop();
  } catch {
    /* not playing */
  }
  const kv = kokoroVoiceId(l, gender);
  // create/resume the audio context inside the click, before awaiting anything
  const ctx = audioCtx();
  if (kv) {
    await loadManifest();
    if (hasClip(kv, l.messages.sample)) {
      try {
        const buf = await clipBuffer(ctx, kv, l.messages.sample);
        previewSrc = ctx.createBufferSource();
        previewSrc.buffer = buf;
        previewSrc.connect(ctx.destination);
        previewSrc.start();
        return;
      } catch {
        /* fall back to the device voice */
      }
    }
  }
  if (typeof speechSynthesis === "undefined") return;
  await voicesReady();
  const u = new SpeechSynthesisUtterance(l.messages.sample);
  const { voice, matched } = pickVoice(l, gender);
  if (voice) u.voice = voice;
  u.lang = voice?.lang ?? l.tag;
  u.pitch = fallbackPitch(gender, matched);
  u.rate = 1.04;
  speechSynthesis.speak(u);
}

/** Spoken coaching via the Web Speech API, plus subtle audio ticks via WebAudio. */

type Kind = "cue" | "count" | "praise" | "info";
const PRIORITY: Record<Kind, number> = { cue: 3, info: 2, count: 1, praise: 0 };

export class VoiceCoach {
  enabled = true;
  private voice: SpeechSynthesisVoice | null = null;
  private current: { kind: Kind } | null = null;
  private queue: Array<{ text: string; kind: Kind }> = [];
  private audio: AudioContext | null = null;

  constructor() {
    if (typeof speechSynthesis === "undefined") return;
    const pick = () => {
      const vs = speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en"));
      const prefs = [/natural/i, /aria|jenny|guy|libby|sonia/i, /google us english/i, /samantha|ava|allison/i, /en-us/i];
      for (const re of prefs) {
        const v = vs.find((x) => re.test(x.name) || re.test(x.lang));
        if (v) return (this.voice = v);
      }
      this.voice = vs[0] ?? null;
    };
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
    u.rate = next.kind === "count" ? 1.15 : 1.04;
    u.pitch = 1;
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

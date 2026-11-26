import { afterEach, describe, expect, it, vi } from "vitest";
import { getLocale } from "../i18n/index.ts";
import { VoiceCoach } from "./voice.ts";

/** a fake device voice whose utterances take `ms` each */
function fakeSpeech(ms: number) {
  const spoken: string[] = [];
  vi.stubGlobal("SpeechSynthesisUtterance", class {
    text: string;
    onend: (() => void) | null = null;
    constructor(text: string) {
      this.text = text;
    }
  });
  vi.stubGlobal("speechSynthesis", {
    getVoices: () => [],
    addEventListener: () => {},
    cancel: () => {},
    speak: (u: { text: string; onend: () => void }) => {
      spoken.push(u.text);
      setTimeout(() => u.onend(), ms);
    },
  });
  return spoken;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("VoiceCoach", () => {
  it("leaves a pause between phrases and reports when it has finished speaking", async () => {
    vi.useFakeTimers();
    const spoken = fakeSpeech(1000);
    const coach = new VoiceCoach(getLocale("de"), "female"); // no clips loaded in tests → device voice
    coach.say("Satz beendet.", "info");
    coach.say("Gut gemacht!", "praise");
    let idle = false;
    void coach.whenIdle().then(() => (idle = true));
    expect(spoken).toEqual(["Satz beendet."]);
    await vi.advanceTimersByTimeAsync(1000); // first phrase ends: now the gap
    expect(spoken).toEqual(["Satz beendet."]);
    await vi.advanceTimersByTimeAsync(500);
    expect(spoken).toEqual(["Satz beendet.", "Gut gemacht!"]);
    expect(idle).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(idle).toBe(true);
  });

  it("is idle at once when there is nothing to say", async () => {
    fakeSpeech(1000);
    await expect(new VoiceCoach(getLocale("en"), "male").whenIdle()).resolves.toBeUndefined();
  });
});

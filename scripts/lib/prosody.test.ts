import { describe, expect, it } from "vitest";
import { PAUSE_MS, clauses, speedFor, syllables } from "./prosody.ts";

describe("clauses", () => {
  it("splits at dashes, commas and sentence ends, with continuation commas", () => {
    expect(clauses("Better — keep your chest up")).toEqual([
      { text: "Better,", pauseMs: PAUSE_MS.dash },
      { text: "keep your chest up", pauseMs: 0 },
    ]);
    expect(clauses("Set complete. Nice work!")).toEqual([
      { text: "Set complete.", pauseMs: PAUSE_MS.sentence },
      { text: "Nice work!", pauseMs: 0 },
    ]);
    expect(clauses("Step back so I can see your shoulders, hips and knees").map((c) => c.text)).toEqual(["Step back so I can see your shoulders,", "hips and knees"]);
  });

  it("leaves hyphens, Spanish ¡¿ and French spaced punctuation alone", () => {
    expect(clauses("Soft-straight knees")).toEqual([{ text: "Soft-straight knees", pauseMs: 0 }]);
    expect(clauses("¡Hola! Voy a contar")[0].text).toBe("¡Hola!");
    expect(clauses("Prêt ? Allez")[0].text).toBe("Prêt?");
    expect(clauses("C'est mieux — bon rythme !").map((c) => c.text)).toEqual(["C'est mieux,", "bon rythme !"]);
    expect(clauses("Mejor: así se hace").map((c) => c.text)).toEqual(["Mejor,", "así se hace"]);
  });

  it("drops the pause after a final sentence mark", () => {
    expect(clauses("All done.")).toEqual([{ text: "All done.", pauseMs: 0 }]);
  });
});

describe("pace", () => {
  it("counts syllables in Latin and Cyrillic text", () => {
    expect(syllables("Keep your chest up")).toBe(4);
    expect(syllables("Держите грудь выше")).toBe(6); // дер-жи-те грудь вы-ше
  });

  it("only ever slows a voice down", () => {
    expect(speedFor(6, 5.4)).toBe(0.9);
    expect(speedFor(3.7, 4.3)).toBe(1);
    expect(speedFor(10, 4)).toBe(0.7);
  });
});


import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { espeakToKokoro, espeakToPiper, phonemizeWithPunctuation, respell } from "./phonemes.ts";
import { loadEspeak } from "./espeak.ts";
import { LOCALES } from "../../src/i18n/index.ts";

describe("eSpeak → Kokoro phonemes", () => {
  it("joins phonemes, keeps stress, drops eSpeak's hyphens", () => {
    expect(espeakToKokoro("m_a_n_t_ˈe_n e_l k_ˈo_ð_o")).toBe("mantˈen el kˈoðo");
    expect(espeakToKokoro("ɡ_a_ʁ_d_ˈe l_ə- k_ˈu_d")).toBe("ɡaʁdˈe lə kˈud");
  });

  it("maps tied units to Kokoro's single symbols, but not separate phonemes", () => {
    expect(espeakToKokoro("ˈo_tʃ_o")).toBe("ˈoʧo"); // Spanish "ocho": tʃ is one unit
    expect(espeakToKokoro("ˌe_s_t_eɪ_ŋ_dʒ_ˈi_d_ʊ")).toBe("ˌestAŋʤˈidʊ");
    expect(espeakToKokoro("t_ʃ_ˈaʊ")).toBe("tʃˈW"); // two phonemes t + ʃ stay as they are
  });

  it("keeps punctuation for pauses", () => {
    const fake = (chunk: string) => chunk.trim().toLowerCase().split(" ").map((w) => w.split("").join("_")).join(" ");
    expect(phonemizeWithPunctuation("Siete, ocho.", fake)).toBe("siete, ocho.");
    expect(phonemizeWithPunctuation("Mejor — codo estirado", fake)).toBe("mejor — codo estirado");
  });
});

describe("eSpeak → Piper phonemes", () => {
  it("drops separators and decomposes (Piper reads one code point at a time)", () => {
    expect(espeakToPiper("b_ɾ_ˈʊ_s_t h_ˈoː_x\n")).toBe("bɾˈʊst hˈoːx");
    expect(espeakToPiper("ɡ_ʁ_ˈɛ̃")).toBe("ɡʁˈɛ̃".normalize("NFD"));
  });

  it("respells words eSpeak would read as another language", () => {
    expect(respell("Plaquez bien le dos contre le mur", "roa/fr")).toBe("Plaquez bien le dau contre le mur");
    expect(respell("bon rythme", "fr")).toBe("bon ritme");
    expect(respell("dos", "roa/es")).toBe("dos"); // Spanish "dos" is fine
  });

  it("refuses eSpeak output that switched language", () => {
    expect(() => phonemizeWithPunctuation("x", () => "(en)_d_ˈɒ_s_(fr)")).toThrow(/switched language/);
  });
});

describe("eSpeak-NG for Kokoro's and Piper's languages", async () => {
  const dir = join(import.meta.dirname, "..", "..", "node_modules", "@echogarden", "espeak-ng-emscripten");
  const ipa = await loadEspeak(async () => {
    const b = await readFile(join(dir, "espeak-ng.data"));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  });
  const sample: Record<string, [string, RegExp]> = {
    "roa/es": ["Mantén el codo estirado.", /mantˈen el kˈoðo/],
    "roa/fr": ["Gardez le coude tendu.", /ɡaʁdˈe .*kˈud/],
    "roa/pt-BR": ["Mantenha o cotovelo estendido.", /kˌotovˈe/],
    de: ["Brust hoch.", /bɾˈʊst hˈoːx/],
    ru: ["Держите грудь выше.", /ɡrˈutʲ/],
    fr: ["Dos au mur.", /dˈo o mˈyʁ/],
  };
  // Piper voices use their config's eSpeak voice: plain language codes
  const piperEspeak: Record<string, string> = { de_DE: "de", ru_RU: "ru", fr_FR: "fr" };
  const ids = new Set(
    LOCALES.flatMap((l) =>
      Object.values(l.tts ?? {}).flatMap((v) => (v.engine === "kokoro" ? (v.espeak ? [v.espeak] : []) : [piperEspeak[v.model.split("-")[0]]])),
    ),
  );
  for (const id of ids) {
    it(`voice ${id} exists and phonemizes the language`, () => {
      const [text, expected] = sample[id];
      expect(phonemizeWithPunctuation(text, (chunk) => ipa(chunk, id))).toMatch(expected);
    });
  }
});

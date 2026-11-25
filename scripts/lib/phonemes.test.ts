import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { espeakToKokoro, phonemizeWithPunctuation } from "./phonemes.ts";
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

describe("eSpeak-NG for Kokoro's languages", async () => {
  const dir = join(import.meta.dirname, "..", "..", "node_modules", "@echogarden", "espeak-ng-emscripten");
  const ipa = await loadEspeak(async () => {
    const b = await readFile(join(dir, "espeak-ng.data"));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  });
  const sample: Record<string, [string, RegExp]> = {
    "roa/es": ["Mantén el codo estirado.", /mantˈen el kˈoðo/],
    "roa/fr": ["Gardez le coude tendu.", /ɡaʁdˈe .*kˈud/],
    "roa/pt-BR": ["Mantenha o cotovelo estendido.", /kˌotovˈe/],
  };
  for (const l of LOCALES) {
    const id = l.kokoro?.espeak;
    if (!id) continue;
    it(`${l.id}: voice ${id} exists and phonemizes the language`, () => {
      const [text, expected] = sample[id];
      expect(phonemizeWithPunctuation(text, (chunk) => ipa(chunk, id))).toMatch(expected);
    });
  }
});

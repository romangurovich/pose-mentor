/**
 * Phonemes for Kokoro's non-English voices, from eSpeak-NG (GPL-3.0, @echogarden/espeak-ng-emscripten).
 *
 * eSpeak's IPA output separates phonemes with "_", words with spaces and clauses with newlines, and drops
 * punctuation. Kokoro was trained on phonemes from its reference G2P (misaki), which runs eSpeak with tied
 * multi-character phonemes and then maps each tied unit to a single symbol. We do the same mapping per unit
 * and keep the text's punctuation, which Kokoro uses for pauses and intonation.
 */

/** misaki's eSpeak → Kokoro mapping for tied units (affricates and diphthongs) */
const UNIT: Record<string, string> = {
  aɪ: "I",
  aʊ: "W",
  dz: "ʣ",
  dʒ: "ʤ",
  eɪ: "A",
  oʊ: "O",
  əʊ: "Q",
  ss: "S",
  ts: "ʦ",
  tʃ: "ʧ",
  ɔɪ: "Y",
};

const STRESS = /^[ˈˌ]+/;

/** eSpeak IPA ("m_a_n_t_ˈe_n e_l …") → Kokoro phonemes ("mantˈen el …") */
export function espeakToKokoro(ipa: string): string {
  return ipa
    .split(/\s+/)
    .filter(Boolean)
    .map((word) =>
      word
        .split("_")
        .map((unit) => {
          const stress = STRESS.exec(unit)?.[0] ?? "";
          const core = unit.slice(stress.length).replace(/-/g, "");
          return stress + (UNIT[core] ?? core);
        })
        .join(""),
    )
    .join(" ");
}

/** sentence punctuation Kokoro's vocabulary understands */
const PUNCT = /([.,!?;:…—–"“”«»()]+)/;

/**
 * Phonemize text with punctuation kept between chunks: "Siete, ocho." → "sjˈete, ˈoʧo."
 * `ipa` turns a punctuation-free chunk into eSpeak IPA.
 */
export function phonemizeWithPunctuation(text: string, ipa: (chunk: string) => string): string {
  const out: string[] = [];
  for (const part of text.split(PUNCT)) {
    if (!part.trim()) continue;
    if (PUNCT.test(part)) out.push(part.replace(/[«»“”]/g, '"'));
    else out.push(espeakToKokoro(ipa(part)));
  }
  return out.join(" ").replace(/\s+([.,!?;:…])/g, "$1").trim();
}

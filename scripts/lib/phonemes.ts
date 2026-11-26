/**
 * Phonemes for Kokoro's non-English voices and for Piper voices, from eSpeak-NG (GPL-3.0,
 * @echogarden/espeak-ng-emscripten).
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

/**
 * Words eSpeak mistakes for another language (it then switches to e.g. English mid-sentence: French "dos" is
 * read as DOS). Respelled so they're phonemized in the right language.
 */
const RESPELL: Record<string, Array<[RegExp, string]>> = {
  fr: [
    [/\bdos\b/gi, "dau"],
    [/\brythme\b/gi, "ritme"],
  ],
};

/** fix up text before eSpeak sees it; `voice` is the eSpeak identifier ("roa/fr", "fr") */
export function respell(text: string, voice: string): string {
  for (const [re, to] of RESPELL[voice.split("/").pop()!.split("-")[0]] ?? []) text = text.replace(re, to);
  return text;
}

/** eSpeak IPA for one chunk; refuses output where eSpeak switched language ("(en)…(fr)") */
function checked(ipa: string): string {
  if (/\([a-z-]+\)/.test(ipa)) throw new Error(`eSpeak switched language: ${JSON.stringify(ipa)} — add a respelling in scripts/lib/phonemes.ts`);
  return ipa;
}

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

/**
 * eSpeak IPA → Piper phonemes: Piper runs eSpeak without separators and feeds the model one code point at a
 * time (after Unicode NFD), so this just drops the separators.
 */
export function espeakToPiper(ipa: string): string {
  return ipa
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.replace(/_/g, ""))
    .join(" ")
    .normalize("NFD");
}

/** sentence punctuation the models' vocabularies understand */
const PUNCT = /([.,!?;:…—–"“”«»()]+)/;

/**
 * Phonemize text with punctuation kept between chunks: "Siete, ocho." → "sjˈete, ˈoʧo."
 * `ipa` turns a punctuation-free chunk into eSpeak IPA; `map` converts that to the model's phonemes.
 */
export function phonemizeWithPunctuation(text: string, ipa: (chunk: string) => string, map: (ipa: string) => string = espeakToKokoro): string {
  const out: string[] = [];
  for (const part of text.split(PUNCT)) {
    if (!part.trim()) continue;
    if (PUNCT.test(part)) out.push(part.replace(/[«»“”]/g, '"'));
    else out.push(map(checked(ipa(part))));
  }
  return out.join(" ").replace(/\s+([.,!?;:…])/g, "$1").trim();
}

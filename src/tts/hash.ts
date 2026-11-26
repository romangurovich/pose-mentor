import type { TtsVoice } from "../i18n/types.ts";

/** Stable 53-bit string hash (cyrb53) → base-36 id; names pre-generated voice clips identically in Node and the browser. */
export function clipId(voice: string, text: string): string {
  const s = `${voice}\u0000${text}`;
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** a voice's clip folder in public/voice ("af_heart", "de_DE-thorsten-high", "fr_FR-upmc-medium-pierre") */
export function voiceKey(v: TtsVoice): string {
  return v.engine === "kokoro" ? v.voice : v.speaker ? `${v.model}-${v.speaker}` : v.model;
}

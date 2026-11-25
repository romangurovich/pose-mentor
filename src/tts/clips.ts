/**
 * Pre-generated Kokoro voice clips (scripts/build-voices.ts → public/voice). The manifest lists which clips exist
 * per voice; a phrase without a clip is spoken by the device voice instead.
 */
import { clipId } from "./hash.ts";

export interface VoiceManifest {
  /** voice id → clip ids */
  voices: Record<string, string[]>;
}

const BASE = `${import.meta.env.BASE_URL}voice/`;

let manifest: Promise<Map<string, Set<string>>> | null = null;
let loaded: Map<string, Set<string>> | null = null;

/** fetch the manifest once; a missing or invalid one means "no clips" (device voice everywhere) */
export function loadManifest(): Promise<Map<string, Set<string>>> {
  manifest ??= fetch(`${BASE}manifest.json`)
    .then((r) => (r.ok && (r.headers.get("content-type") ?? "").includes("json") ? (r.json() as Promise<VoiceManifest>) : { voices: {} }))
    .catch(() => ({ voices: {} }) as VoiceManifest)
    .then((m) => (loaded = new Map(Object.entries(m.voices).map(([v, ids]) => [v, new Set(ids)]))));
  return manifest;
}

/** whether a clip exists (false until the manifest has loaded) */
export function hasClip(voice: string, text: string): boolean {
  return loaded?.get(voice)?.has(clipId(voice, text)) ?? false;
}

/** whether any clips exist for this voice */
export function hasVoice(voice: string): boolean {
  return (loaded?.get(voice)?.size ?? 0) > 0;
}

const buffers = new Map<string, Promise<AudioBuffer>>();

/** fetch + decode a clip (cached) */
export function clipBuffer(ctx: AudioContext, voice: string, text: string): Promise<AudioBuffer> {
  const id = clipId(voice, text);
  let p = buffers.get(id);
  if (!p) {
    p = fetch(`${BASE}${voice}/${id}.mp3`)
      .then((r) => {
        if (!r.ok || !(r.headers.get("content-type") ?? "").startsWith("audio/")) throw new Error(`no clip for "${text}"`);
        return r.arrayBuffer();
      })
      .then((b) => ctx.decodeAudioData(b));
    p.catch(() => buffers.delete(id));
    buffers.set(id, p);
  }
  return p;
}

/** decode the given phrases in the background so they play instantly */
export async function preload(ctx: AudioContext, voice: string, texts: Iterable<string>) {
  await loadManifest();
  for (const t of texts) if (hasClip(voice, t)) await clipBuffer(ctx, voice, t).catch(() => {});
}

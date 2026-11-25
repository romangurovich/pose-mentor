/**
 * Pre-generate the coach's voice: every phrase the coach can say (src/tts/phrases.ts), in every Kokoro voice the
 * locales use, as small MP3s in public/voice plus a manifest. The app plays these instead of running a TTS model
 * in the browser (see README → src/tts).
 *
 *   npm run voices            # incremental: only new or changed phrases are generated; stale clips are removed
 *
 * Kokoro-82M (Apache-2.0) runs here on native ONNX Runtime. English is phonemized by kokoro-js; Spanish, French and
 * Portuguese by eSpeak-NG (GPL-3.0) — a build-time tool only, not shipped with the app.
 */
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { KokoroTTS } from "kokoro-js";
import { env } from "@huggingface/transformers";
import { createMp3Encoder } from "wasm-media-encoders";
import { LOCALES } from "../src/i18n/index.ts";
import { allPhrases } from "../src/tts/phrases.ts";
import { clipId } from "../src/tts/hash.ts";
import type { VoiceManifest } from "../src/tts/clips.ts";
import { loadEspeak } from "./lib/espeak.ts";
import { phonemizeWithPunctuation } from "./lib/phonemes.ts";

const ROOT = join(import.meta.dirname, "..");
const OUT = join(ROOT, "public", "voice");
const MODEL_DIR = join(ROOT, "data", "kokoro");
const HF = "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main";

// ── model (fp32: best quality; this runs once, offline) ──
for (const f of ["config.json", "tokenizer.json", "tokenizer_config.json", "onnx/model.onnx"]) {
  const dst = join(MODEL_DIR, f);
  if (existsSync(dst) && statSync(dst).size > 0) continue;
  mkdirSync(dirname(dst), { recursive: true });
  process.stdout.write(`downloading kokoro/${f}… `);
  const res = await fetch(`${HF}/${f}`);
  if (!res.ok) throw new Error(`${f}: HTTP ${res.status}`);
  writeFileSync(dst, Buffer.from(await res.arrayBuffer()));
  console.log(`${(statSync(dst).size / 1e6).toFixed(1)} MB`);
}
env.allowRemoteModels = false;
env.localModelPath = join(ROOT, "data") + "/";
const tts = await KokoroTTS.from_pretrained("kokoro", { dtype: "fp32", device: "cpu" });

const espeakData = join(ROOT, "node_modules", "@echogarden", "espeak-ng-emscripten", "espeak-ng.data");
const ipa = await loadEspeak(async () => {
  const b = await readFile(espeakData);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
});

/** trim leading/trailing silence (keep a short pad) and normalise to a consistent peak level */
function tidy(samples: Float32Array, rate: number): Float32Array {
  const thr = 0.008;
  let a = 0, b = samples.length - 1;
  while (a < b && Math.abs(samples[a]) < thr) a++;
  while (b > a && Math.abs(samples[b]) < thr) b--;
  const pad = Math.round(0.06 * rate);
  const out = samples.slice(Math.max(0, a - pad), Math.min(samples.length, b + pad));
  let peak = 0;
  for (const x of out) peak = Math.max(peak, Math.abs(x));
  const gain = peak > 0 ? 0.89 / peak : 1;
  for (let i = 0; i < out.length; i++) out[i] *= gain;
  return out;
}

async function encodeMp3(samples: Float32Array, rate: number): Promise<Uint8Array> {
  const enc = await createMp3Encoder();
  // 48 kbps mono is transparent for 24 kHz speech and keeps all ~1,400 clips around 16 MB
  enc.configure({ sampleRate: rate, channels: 1, bitrate: 48 });
  const parts: Uint8Array[] = [new Uint8Array(enc.encode([samples])), new Uint8Array(enc.finalize())];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

async function synth(text: string, voice: string, espeak?: string): Promise<{ samples: Float32Array; rate: number }> {
  if (!espeak) {
    const a = await tts.generate(text, { voice: voice as never });
    return { samples: a.audio as Float32Array, rate: a.sampling_rate };
  }
  const phonemes = phonemizeWithPunctuation(text, (chunk) => ipa(chunk, espeak));
  const { input_ids } = tts.tokenizer(phonemes, { truncation: true });
  const a = await tts.generate_from_ids(input_ids, { voice: voice as never });
  return { samples: a.audio as Float32Array, rate: a.sampling_rate };
}

const manifest: VoiceManifest = { voices: {} };
let made = 0, kept = 0;
const t0 = Date.now();
for (const l of LOCALES) {
  for (const voice of [l.kokoro?.female, l.kokoro?.male]) {
    if (!voice) continue;
    const dir = join(OUT, voice);
    mkdirSync(dir, { recursive: true });
    const ids: string[] = [];
    const phrases = allPhrases(l);
    for (const [i, text] of phrases.entries()) {
      const id = clipId(voice, text);
      ids.push(id);
      const file = join(dir, `${id}.mp3`);
      if (existsSync(file)) {
        kept++;
        continue;
      }
      const { samples, rate } = await synth(text, voice, l.kokoro?.espeak);
      writeFileSync(file, await encodeMp3(tidy(samples, rate), rate));
      made++;
      if (made % 25 === 0) console.log(`  ${voice} ${i + 1}/${phrases.length} · ${made} generated in ${Math.round((Date.now() - t0) / 1000)} s`);
    }
    // drop clips for phrases that no longer exist
    const keep = new Set(ids.map((id) => `${id}.mp3`));
    for (const f of readdirSync(dir)) if (!keep.has(f)) rmSync(join(dir, f));
    manifest.voices[voice] = [...new Set(ids)].sort();
    console.log(`${voice}: ${ids.length} clips`);
  }
}
// voices no longer used by any locale
for (const d of readdirSync(OUT)) if (d !== "manifest.json" && !(d in manifest.voices)) rmSync(join(OUT, d), { recursive: true });
writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest) + "\n");
console.log(`done: ${made} generated, ${kept} unchanged, in ${Math.round((Date.now() - t0) / 1000)} s`);

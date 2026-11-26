/**
 * Pre-generate the coach's voice: every phrase the coach can say (src/tts/phrases.ts), in every voice the locales
 * use (Locale.tts), as small MP3s in public/voice plus a manifest. The app plays these instead of running a TTS model
 * in the browser (see README → src/tts).
 *
 *   npm run voices            # incremental: only new or changed phrases are generated; stale clips are removed
 *
 * Kokoro-82M (Apache-2.0) and Piper voices (licences per voice, see README) run here on native ONNX Runtime. English
 * is phonemized by kokoro-js; everything else by eSpeak-NG (GPL-3.0) — a build-time tool only, not shipped with the app.
 *
 * Prosody is deliberate (scripts/lib/prosody.ts): each voice is calibrated to a calm per-language pace, and phrases
 * are built clause by clause with fixed pauses. A voice's settings are stored with its clips; when they change, the
 * voice is regenerated. Bump REV after changing phonemization or synthesis.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { KokoroTTS } from "kokoro-js";
import { env } from "@huggingface/transformers";
import { createMp3Encoder } from "wasm-media-encoders";
import { LOCALES } from "../src/i18n/index.ts";
import { allPhrases } from "../src/tts/phrases.ts";
import { clipId, voiceKey } from "../src/tts/hash.ts";
import type { Locale, TtsVoice } from "../src/i18n/types.ts";
import type { VoiceManifest } from "../src/tts/clips.ts";
import { loadEspeak } from "./lib/espeak.ts";
import { phonemizeWithPunctuation } from "./lib/phonemes.ts";
import { loadPiper, type PiperVoice } from "./lib/piper.ts";
import { PAUSE_MS, TARGET_RATE, clauses, speedFor, syllables } from "./lib/prosody.ts";

const ROOT = join(import.meta.dirname, "..");
const OUT = join(ROOT, "public", "voice");
const MODEL_DIR = join(ROOT, "data", "kokoro");
const PIPER_DIR = join(ROOT, "data", "piper");
const HF = "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main";

const espeakData = join(ROOT, "node_modules", "@echogarden", "espeak-ng-emscripten", "espeak-ng.data");
const ipa = await loadEspeak(async () => {
  const b = await readFile(espeakData);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
});

/** Kokoro, loaded on first use (fp32: best quality; this runs offline) */
let kokoro: Promise<KokoroTTS> | null = null;
function loadKokoro(): Promise<KokoroTTS> {
  return (kokoro ??= (async () => {
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
    return KokoroTTS.from_pretrained("kokoro", { dtype: "fp32", device: "cpu" });
  })());
}

const piper = new Map<string, Promise<PiperVoice>>();

/** cut leading/trailing silence, keeping a short margin so soft onsets and endings aren't clipped */
function trim(samples: Float32Array, rate: number, marginMs = 25): Float32Array {
  const thr = 0.008;
  let a = 0, b = samples.length - 1;
  while (a < b && Math.abs(samples[a]) < thr) a++;
  while (b > a && Math.abs(samples[b]) < thr) b--;
  const m = Math.round((marginMs / 1000) * rate);
  return samples.slice(Math.max(0, a - m), Math.min(samples.length, b + m + 1));
}

/** join clauses with their pauses, pad both ends and normalise to a consistent peak level */
function assemble(parts: Array<{ samples: Float32Array; pauseMs: number }>, rate: number): Float32Array {
  const pad = Math.round(0.06 * rate);
  const len = parts.reduce((n, p) => n + p.samples.length + Math.round((p.pauseMs / 1000) * rate), 2 * pad);
  const out = new Float32Array(len);
  let o = pad;
  for (const p of parts) {
    out.set(p.samples, o);
    o += p.samples.length + Math.round((p.pauseMs / 1000) * rate);
  }
  let peak = 0;
  for (const x of out) peak = Math.max(peak, Math.abs(x));
  const gain = peak > 0 ? 0.89 / peak : 1;
  for (let i = 0; i < out.length; i++) out[i] *= gain;
  return out;
}

async function encodeMp3(samples: Float32Array, rate: number): Promise<Uint8Array> {
  const enc = await createMp3Encoder();
  // 48 kbps mono is transparent for 22–24 kHz speech and keeps each voice's ~200 clips around 2.5 MB
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

/** one clause, trimmed */
async function synth(text: string, v: TtsVoice, speed: number): Promise<{ samples: Float32Array; rate: number }> {
  const r = await synthRaw(text, v, speed);
  return { samples: trim(r.samples, r.rate), rate: r.rate };
}

async function synthRaw(text: string, v: TtsVoice, speed: number): Promise<{ samples: Float32Array; rate: number }> {
  if (v.engine === "piper") {
    const key = voiceKey(v);
    if (!piper.has(key)) piper.set(key, loadPiper(PIPER_DIR, v.model, v.speaker, ipa));
    return (await piper.get(key)!).synth(text, speed);
  }
  const tts = await loadKokoro();
  const espeak = v.espeak;
  if (!espeak) {
    const a = await tts.generate(text, { voice: v.voice as never, speed });
    return { samples: a.audio as Float32Array, rate: a.sampling_rate };
  }
  const phonemes = phonemizeWithPunctuation(text, (chunk) => ipa(chunk, espeak));
  const { input_ids } = tts.tokenizer(phonemes, { truncation: true });
  const a = await tts.generate_from_ids(input_ids, { voice: v.voice as never, speed });
  return { samples: a.audio as Float32Array, rate: a.sampling_rate };
}

/** a whole phrase: clauses synthesized separately and joined with deliberate pauses */
async function render(text: string, v: TtsVoice, speed: number): Promise<{ samples: Float32Array; rate: number }> {
  const parts: Array<{ samples: Float32Array; pauseMs: number }> = [];
  let rate = 0;
  for (const c of clauses(text)) {
    const r = await synth(c.text, v, speed);
    rate = r.rate;
    parts.push({ samples: r.samples, pauseMs: c.pauseMs });
  }
  return { samples: assemble(parts, rate), rate };
}

/** measure a voice's natural articulation rate on a spread of phrases and pick the speed that meets the target */
async function calibrate(l: Locale, v: TtsVoice): Promise<{ measured: number; speed: number }> {
  const long = allPhrases(l).filter((p) => p.length >= 20);
  const sample = Array.from({ length: 12 }, (_, i) => long[Math.floor((i * long.length) / 12)]);
  let syl = 0, sec = 0;
  for (const p of sample)
    for (const c of clauses(p)) {
      const r = await synth(c.text, v, 1);
      syl += syllables(c.text);
      sec += r.samples.length / r.rate;
    }
  const measured = syl / sec;
  return { measured: Math.round(measured * 100) / 100, speed: speedFor(measured, TARGET_RATE[l.id]) };
}

/**
 * Settings a voice's clips were made with (public/voice/<voice>/settings.json). If anything here changes, the
 * voice is recalibrated and all its clips are regenerated. Bump `rev` after changing phonemization or synthesis.
 */
interface VoiceSettings {
  rev: number;
  voice: TtsVoice;
  target: number;
  pauses: typeof PAUSE_MS;
  /** calibrated; kept so a rebuild doesn't re-measure (Piper's timing is slightly random) */
  speed: number;
  measured: number;
}
const REV = 2;

const manifest: VoiceManifest = { voices: {} };
let made = 0, kept = 0;
const t0 = Date.now();
for (const l of LOCALES) {
  for (const v of Object.values(l.tts ?? {})) {
    const voice = voiceKey(v);
    const dir = join(OUT, voice);
    const settingsFile = join(dir, "settings.json");
    const want = { rev: REV, voice: v, target: TARGET_RATE[l.id], pauses: PAUSE_MS };
    let settings: VoiceSettings | null = existsSync(settingsFile) ? JSON.parse(readFileSync(settingsFile, "utf8")) : null;
    if (!settings || JSON.stringify({ rev: settings.rev, voice: settings.voice, target: settings.target, pauses: settings.pauses }) !== JSON.stringify(want)) {
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
      const c = await calibrate(l, v);
      settings = { ...want, ...c };
      writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + "\n");
      console.log(`${voice}: ${c.measured} syllables/s natural → speed ${c.speed} (target ${want.target})`);
    }
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
      const { samples, rate } = await render(text, v, settings.speed);
      writeFileSync(file, await encodeMp3(samples, rate));
      made++;
      if (made % 25 === 0) console.log(`  ${voice} ${i + 1}/${phrases.length} · ${made} generated in ${Math.round((Date.now() - t0) / 1000)} s`);
    }
    // drop clips for phrases that no longer exist
    const keep = new Set([...ids.map((id) => `${id}.mp3`), "settings.json"]);
    for (const f of readdirSync(dir)) if (!keep.has(f)) rmSync(join(dir, f));
    manifest.voices[voice] = [...new Set(ids)].sort();
    console.log(`${voice}: ${ids.length} clips`);
  }
}
// voices no longer used by any locale
for (const d of readdirSync(OUT)) if (d !== "manifest.json" && !(d in manifest.voices)) rmSync(join(OUT, d), { recursive: true });
writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest) + "\n");
console.log(`done: ${made} generated, ${kept} unchanged, in ${Math.round((Date.now() - t0) / 1000)} s`);

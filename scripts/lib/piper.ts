/**
 * Piper (VITS) voices on native ONNX Runtime, for languages and genders Kokoro doesn't cover. Models come from
 * https://huggingface.co/rhasspy/piper-voices (each voice's MODEL_CARD has its dataset licence). Text is
 * phonemized with eSpeak-NG exactly as Piper's own phonemizer does it, then mapped to the model's phoneme ids.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as ort from "onnxruntime-node";
import type { Ipa } from "./espeak.ts";
import { espeakToPiper, phonemizeWithPunctuation } from "./phonemes.ts";

/** punctuation some Piper vocabularies lack → the nearest pause they have ("" = drop) */
const PUNCT_FALLBACK: Record<string, string> = { "—": ",", "–": ",", "…": ".", ";": ",", ":": ",", '"': "", "(": "", ")": "" };

const HF = "https://huggingface.co/rhasspy/piper-voices/resolve/main";

interface PiperConfig {
  audio: { sample_rate: number };
  espeak: { voice: string };
  inference: { noise_scale: number; length_scale: number; noise_w: number };
  num_speakers: number;
  speaker_id_map: Record<string, number>;
  phoneme_id_map: Record<string, number[]>;
}

export interface PiperVoice {
  /** synthesize text → mono float samples; `speed` < 1 speaks slower */
  synth(text: string, speed?: number): Promise<{ samples: Float32Array; rate: number }>;
}

/** "de_DE-thorsten-high" → "de/de_DE/thorsten/high/de_DE-thorsten-high" */
function hfPath(model: string): string {
  const [lang, name, quality] = model.split("-");
  return `${lang.split("_")[0]}/${lang}/${name}/${quality}/${model}`;
}

async function download(url: string, dst: string) {
  if (existsSync(dst) && statSync(dst).size > 0) return;
  process.stdout.write(`downloading ${url.split("/").pop()}… `);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  writeFileSync(dst, Buffer.from(await res.arrayBuffer()));
  console.log(`${(statSync(dst).size / 1e6).toFixed(1)} MB`);
}

export async function loadPiper(dir: string, model: string, speaker: string | undefined, ipa: Ipa): Promise<PiperVoice> {
  mkdirSync(dir, { recursive: true });
  const onnx = join(dir, `${model}.onnx`);
  await download(`${HF}/${hfPath(model)}.onnx.json`, `${onnx}.json`);
  await download(`${HF}/${hfPath(model)}.onnx`, onnx);
  const cfg = JSON.parse(readFileSync(`${onnx}.json`, "utf8")) as PiperConfig;
  const sid = speaker === undefined ? undefined : cfg.speaker_id_map[speaker];
  if (speaker !== undefined && sid === undefined) throw new Error(`${model}: no speaker "${speaker}"`);
  const session = await ort.InferenceSession.create(onnx);
  const id = (p: string) => cfg.phoneme_id_map[p]?.[0];
  const [PAD, BOS, EOS] = [id("_"), id("^"), id("$")];

  return {
    async synth(text, speed = 1) {
      const phonemes = phonemizeWithPunctuation(text, (chunk) => ipa(chunk, cfg.espeak.voice), espeakToPiper);
      // Piper's layout: BOS, then each phoneme followed by a pad, then EOS
      const ids = [BOS, PAD];
      for (const ch of phonemes) {
        const p = id(ch) === undefined ? (PUNCT_FALLBACK[ch] ?? ch) : ch;
        if (p === "") continue;
        const i = id(p);
        if (i === undefined) throw new Error(`${model}: phoneme "${p}" (U+${p.codePointAt(0)!.toString(16)}) not in the model, in "${text}"`);
        ids.push(i, PAD);
      }
      ids.push(EOS);
      const { noise_scale, length_scale, noise_w } = cfg.inference;
      const feeds: Record<string, ort.Tensor> = {
        input: new ort.Tensor("int64", BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
        input_lengths: new ort.Tensor("int64", BigInt64Array.from([BigInt(ids.length)]), [1]),
        scales: new ort.Tensor("float32", Float32Array.from([noise_scale, length_scale / speed, noise_w]), [3]),
      };
      if (cfg.num_speakers > 1) feeds.sid = new ort.Tensor("int64", BigInt64Array.from([BigInt(sid ?? 0)]), [1]);
      const out = await session.run(feeds);
      return { samples: out.output.data as Float32Array, rate: cfg.audio.sample_rate };
    },
  };
}

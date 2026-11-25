#!/usr/bin/env node
/**
 * Make the app fully self-hosted: copy MediaPipe's WASM runtime out of node_modules and download
 * the BlazePose landmarker models (Apache-2.0, published by Google) into /public.
 * Idempotent — runs automatically before `npm run dev` / `npm run build`.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const wasmSrc = join(root, "node_modules", "@mediapipe", "tasks-vision", "wasm");
const wasmDst = join(root, "public", "wasm");
const modelDst = join(root, "public", "models");

mkdirSync(wasmDst, { recursive: true });
for (const f of readdirSync(wasmSrc)) {
  const src = join(wasmSrc, f), dst = join(wasmDst, f);
  if (!existsSync(dst) || statSync(dst).size !== statSync(src).size) copyFileSync(src, dst);
}

const MODELS = {
  lite: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
  full: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task",
  heavy: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task",
};

mkdirSync(modelDst, { recursive: true });
for (const [name, url] of Object.entries(MODELS)) {
  const dst = join(modelDst, `pose_landmarker_${name}.task`);
  if (existsSync(dst) && statSync(dst).size > 1e6) continue;
  process.stdout.write(`downloading ${name} pose model… `);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  writeFileSync(dst, Buffer.from(await res.arrayBuffer()));
  console.log(`${(statSync(dst).size / 1e6).toFixed(1)} MB`);
}
console.log("assets ready (public/wasm, public/models)");

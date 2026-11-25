#!/usr/bin/env node
/**
 * End-to-end smoke test in a real (headless) Chromium against the running dev server:
 *   1. library + setup sheet render
 *   2. a session on a real exercise video: MediaPipe loads, poses are detected, the coach counts reps
 *
 *   npm run dev &              # in another terminal
 *   node scripts/e2e-smoke.mjs [--video /test-videos/squat-side.webm] [--exercise squat] [--seconds 40]
 *
 * Screenshots land in ./e2e-shots.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const BASE = arg("base", "http://localhost:5173");
const VIDEO = arg("video", "/test-videos/squat-side.webm");
const EXERCISE = arg("exercise", "squat");
const SECONDS = Number(arg("seconds", "40"));
const GOAL = arg("goal", "0.8");
const OUT = arg("out", "e2e-shots");
const DELEGATE = arg("delegate", "CPU"); // headless Chromium only has software WebGL; WASM CPU is faster there
const MODEL = arg("model", "full");
const REPS = arg("reps", "10");
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));

// 1 · library
await page.goto(BASE + "/", { waitUntil: "networkidle" });
await page.screenshot({ path: `${OUT}/01-library.png` });
await page.screenshot({ path: `${OUT}/01b-library-full.png`, fullPage: true });
await page.getByRole("button", { name: /Squat Sit back/ }).click();
await page.waitForSelector(".sheet");
await page.getByRole("button", { name: /What I check/ }).click();
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/02-setup.png` });

// 2 · live session on a real video
await page.goto(`${BASE}/?exercise=${EXERCISE}&video=${encodeURIComponent(VIDEO)}&voice=0&goal=${GOAL}&delegate=${DELEGATE}&model=${MODEL}&reps=${REPS}`, { waitUntil: "load" });
await page.waitForFunction(() => window.__poseMentor !== undefined, null, { timeout: 60000 });
const t0 = Date.now();
let shot = 0;
const statuses = {};
let detected = 0, samples = 0;
while (Date.now() - t0 < SECONDS * 1000) {
  await page.waitForTimeout(1000);
  const s = await page.evaluate(() => {
    const p = window.__poseMentor;
    return p ? { status: p.state.status, reps: p.state.reps.length, value: p.state.value, faults: p.state.faults.map((f) => f.id), hasFrame: !!p.frame, headline: p.state.headline } : null;
  });
  if (!s) continue;
  samples++;
  if (s.hasFrame) detected++;
  statuses[s.status] = (statuses[s.status] ?? 0) + 1;
  process.stdout.write(`\r t=${Math.round((Date.now() - t0) / 1000)}s status=${s.status.padEnd(9)} reps=${s.reps} value=${Math.round(s.value)} faults=[${s.faults}]   `);
  if (s.faults.length && shot < 6) await page.screenshot({ path: `${OUT}/03-session-fault-${shot++}.png` });
  if ((Date.now() - t0) % 7000 < 1000) await page.screenshot({ path: `${OUT}/03-session-${Math.round((Date.now() - t0) / 1000)}s.png` });
  if (s.status === "done") break;
}
console.log();
const final = await page.evaluate(() => {
  const p = window.__poseMentor;
  return { reps: p.state.reps.map((r) => ({ i: r.index, peak: Math.round(r.peak), reach: +r.reach.toFixed(2), score: r.score, faults: r.faults, ms: Math.round(r.durationMs) })), live: document.querySelector(".live")?.textContent };
});
await page.screenshot({ path: `${OUT}/04-session-final.png` });
try {
  await page.waitForSelector(".summary", { timeout: 8000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/05-summary.png`, fullPage: true });
  await page.hover(".chart .bar >> nth=1");
  await page.screenshot({ path: `${OUT}/05b-summary-hover.png` });
  console.log("summary rendered");
} catch {
  console.log("summary not reached (set not finished)");
}
console.log("pose detected in", `${detected}/${samples}`, "samples; statuses", statuses);
console.log("reps:", JSON.stringify(final.reps, null, 0));
console.log("perf:", final.live);
const errs = logs.filter((l) => /error|pageerror/i.test(l) && !/favicon/.test(l));
console.log(errs.length ? `console errors:\n${errs.join("\n")}` : "no console errors");
await browser.close();

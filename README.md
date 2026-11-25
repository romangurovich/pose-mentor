# Pose Mentor: a real-time rehab form coach

Pose Mentor watches you through your webcam while you do physical-therapy exercises. It measures your joint angles the way
a goniometer would, counts reps and holds, and tells you (out loud and on screen) what to adjust: *"Keep your chest
up"*, *"Keep that knee straight"*, *"Let your shoulders drop"*.

Everything runs in the browser. Video never leaves the device.

```bash
npm install
npm run dev          # copies the MediaPipe WASM + downloads the pose models on first run, then serves http://localhost:5173
```

Open the URL in Chrome, Edge or Safari, pick an exercise, set up the camera as the card describes, and press **Start session**.

| | |
|---|---|
| **Exercises** | 15 rehab staples: squat, sit-to-stand, straight-leg raise, hurdle step, inline lunge, hip abduction, wall sit, quad/hamstring stretches, shoulder abduction/scaption/flexion/extension, side bend, neck side-stretch |
| **Coaching** | rep counting and hold timer, range-of-motion goal, 2–4 form checks per exercise, tempo and lower-slowly (eccentric control) cues, bounce detection in stretches, auto side-detection and side switching, framing and orientation guidance, voice and chime |
| **Model** | MediaPipe Pose Landmarker (BlazePose GHUM, 33 landmarks), pretrained and used as-is. Lite, full and heavy variants; GPU with CPU fallback |
| **Public data** | [UI-PRMD](https://doi.org/10.3390/data3010002) rehab-movement recordings for range calibration and evaluation; [Rehab-Pile](https://msd-irimas.github.io/pages/DeepRehabPile/) (IntelliRehabDS, KIMORE, KERAAL) to cross-check shoulder flexion, hip abduction, side bend, and patients' squats; AAOS normative joint ranges for the rest |

## How it works

```
webcam ─► MediaPipe Pose (WASM/WebGL) ─► 33 landmarks ─► One Euro filter ─► CoachEngine ─► HUD + canvas overlay + voice
                                                                                 ▲
                         exercise definitions (metrics, ranges, checks) ─────────┘
                                         ▲
             scripts/calibrate.ts ◄── UI-PRMD Kinect skeletons through a virtual webcam
```

- **`src/coach/metrics.ts`**: clinical 2D angle measurements (knee flexion, hip flexion, trunk lean, arm elevation,
  head tilt, shrug, pelvic/shoulder tilt …). Each one is defined for a camera view, the way video goniometry is done in clinic.
- **`src/coach/exercises.ts`**: the library. Each exercise is data: a primary motion (metric, start, target), form
  checks (metric, threshold, phase, severity, cue, and the *basis* for the number), camera view, side handling and a demo pose.
- **`src/coach/engine.ts`**: a pure TypeScript state machine. It is identical in the browser and in Node:
  - framing and orientation gates ("I can't see your feet", "Turn sideways")
  - side selection (visible side, the moving limb, or the front foot)
  - a hysteresis rep machine that arms only after it sees the start position, counts reps that reach ≥ 70% of the goal, and
    nudges shallower attempts
  - hold timer that pauses on major faults, plus a zig-zag detector that calls out bouncing in a stretch
  - per-rep timing: "slow down" when the whole rep is rushed, "lower slowly" when the lowering half is a drop (the
    descent for squats and lunges, the way back down for raises and sit-to-stand)
  - debounced checks, some evaluated relative to a baseline captured in the start position
  - tapered speech: a repeating fault gets its full cue on the first two reps, then a short reminder every other rep and a
    soft tick in between (major faults are cued every rep); fixing a cued fault earns a "Better — …"
- **`src/i18n/`**: every user-facing string comes from a typed `Locale`: the coach's catalog (spoken cues and live
  coaching text), app chrome, metric names, and per-exercise text (name, steps, camera tip, check labels and cues).
  English exercise text is the exercise data itself; `locales/{es,fr,de,pt,ru}.ts` translate it. The engine takes the locale
  as an option, so it stays pure. All text addressed to the user is gender-neutral, because the app doesn't know the user's gender.
  The female/male setting picks the coach's *voice* from each locale's list of known system voices (browsers expose voice
  names, not genders). The clinical provenance notes ("why these numbers") stay in English on purpose, and the app says so.
  Settings (language, voice, theme: system/light/dark) live in the nav. Deep link: `?lang=de&voice=male&theme=light`.
- **`src/ui/`**: React UI. `overlay.ts` draws the skeleton, fault highlights and live angle arc on a canvas. `demo/figure.ts`
  is a small forward-kinematics stick figure that animates every exercise demo from two joint-angle poses.

## Public data: what it was used for, and how

**UI-PRMD** (Vakanski et al., *Data* 2018; ODC public domain): 10 healthy adults × 10 repetitions of 10 rehab movements,
each performed correctly and in a deliberately "non-optimal" way, recorded with Vicon and Kinect v2.

1. `python3 scripts/fetch_uiprmd.py` downloads the Kinect skeletons. The original university host is gone, so it uses the
   Internet Archive copy.
2. The Kinect files store *relative* joint offsets plus Euler angles, so they need forward kinematics. The dataset's own
   MATLAB viewer uses `Rz·Ry·Rx`, and its readme admits the legs "look unnatural". I tested all 36 axis and order combinations.
   Only `Rz·Rx·Ry` keeps the feet planted during squats (1.8 cm of foot drift versus 5–28 cm for the others). See
   `scripts/explore-euler.ts` and `scripts/lib/uiprmd.ts`.
3. `scripts/lib/project.ts` renders each 3D skeleton through a **virtual webcam** (side or front, using the subject's own body
   axes) into the same 33-landmark 2D format MediaPipe produces. The app's own metric code then measures it.
4. `node scripts/calibrate.ts` sets each exercise's reference range to the median start and end-range over the 100 correct
   reps. It also reports how every form check behaves on correct versus incorrect reps, in
   **[docs/calibration.md](docs/calibration.md)**. Three thresholds changed because of this data:
   - The paper's "trunk flexion > 30°" squat criterion would flag the median *correct* rep (32° in 2D), so the limit is 45°.
   - Shoulder shrug detection flagged 70% of correct abductions. Some shoulder elevation is normal near the top of the
     raise, so the check now runs only during the first 55% of the lift (2% of correct reps flagged).
   - Sit-to-stand recordings run stand→sit→stand, so this exercise is coached in reverse, starting seated.
   - The straight-leg-raise standing-knee check flagged 21% of correct reps at 22° (the same Kinect knee artifact), so its
     limit is 28°; the lunge's front-knee-over-ankle check is weak on this data and set to 40° to keep false alarms low.
   - "Lower slowly" fires below 0.8 × the fastest-10% lowering phase of the healthy reps, so it catches drops, not brisk reps.
5. `node scripts/evaluate.ts` stitches each subject's reps into a continuous stream, adds MediaPipe-like jitter, and runs the
   **full browser engine** (smoother, gates, side detection, rep machine, checks). Results are in
   **[docs/evaluation.md](docs/evaluation.md)**:

| Exercise | Reps counted (correct) | Correct reps flagged | Incorrect reps flagged or not counted |
|---|---|---|---|
| Squat | 98/100 | 11% | 68% |
| Hurdle step | 100/100 | 5% | 68% |
| Inline lunge | 96/100 | 13% | 56% |
| Shoulder abduction | 99/100 | 0% | 50% |
| Shoulder scaption | 100/100 | 2% | 70% |
| Sit to stand | 87/90 | 8% | 7% |
| Shoulder extension | 61/100 | 16% | 84% |
| Straight-leg raise | 100/100 | 59% ⚠ | 88% |

Overall rep-count recall on correct reps is **94%**. Known weak spots, kept visible on purpose:

- **Straight-leg raise:** Kinect v2 loses the knee when the leg points at the sensor (p90 "knee flexion" of 109° on correct
  reps), so its knee check can't be validated on this data.
- **Shoulder extension:** several subjects switched arms between reps, and the coach locks onto one arm per set.
- **Sit-to-stand:** the incorrect reps (balance and weight-shift issues) aren't visible to these 2D checks.

**Rehab-Pile** (Ismail-Fawaz et al., FG 2026) bundles several public rehab-skeleton datasets with therapist labels or
clinical scores, including patients rather than only healthy adults. `scripts/fetch_rehabpile.py` downloads only the parts
that match an exercise here. It reads the NumPy files without running pickled code. `scripts/lib/rehabpile.ts` converts each
skeleton to the UI-PRMD joint layout, so the same virtual webcam and metric code measure it.
`node scripts/calibrate-rehabpile.ts` writes **[docs/calibration-rehabpile.md](docs/calibration-rehabpile.md)**, which compares
good and poor recordings. What it changed:

- **Shoulder flexion** (IntelliRehabDS, correct vs. incorrect): the 160° reference is confirmed (correct reps reach a median of 166°), and
  the arch check separates well (4% of correct vs. 26% of incorrect flagged). It also exposed a bug: the flexion angle wrapped
  from +180° to −180° once the arm passed vertical, which would have cut overhead reps short. The elbow check can't be validated
  here (Kinect loses elbows when the arm swings toward a front-facing sensor), so its limit is a loose 45°.
- **Shoulder abduction** (IntelliRehabDS): the elbow limit is now 35° (8% of correct vs. 38% of incorrect flagged) and the shrug limit is −30%, so patients'
  correct reps aren't flagged.
- **Hip abduction** (IntelliRehabDS side taps): sway, knee and stance checks stay quiet on correct reps; hip-hike limit −10°.
- **Side bend** (KIMORE clinical scores, KERAAL error classes): reference range 20° (good bends: median 20.5°). The
  "trunk rotating" check was **removed**: it fired on almost every good bend, because raising the arms overhead pulls the shoulder points
  inward. It's replaced by a forward-fold check (trunk looks ≥ 15% shorter from the front). Hip-shift limit raised to 75% of hip width, because good
  benders shift more than poor ones.
- **Squat** (KIMORE patients): "sit your hips back" limit raised to 40° (7% of good vs. 20% of poor squats flagged). This costs
  some sensitivity on UI-PRMD's acted-out bad squats (73% → 68% caught).

Rehab-Pile resamples recordings to a fixed length, so it says nothing about timing. The Elderly Home Exercise set in it was dropped:
its score scale isn't documented, and its best-scored bends moved the least.

No public data was found for the wall sit, quad, hamstring and neck stretches. Their thresholds, and the new checks on hip abduction and side bend, still come from
AAOS normative ranges and standard clinical cues. Each check's `basis` is shown in the app under *"What I check, and why these numbers"*.

## Scripts

| | |
|---|---|
| `npm run dev` / `build` / `preview` | app (asset setup runs automatically) |
| `npm test` | unit tests for geometry and the engine (reps, faults, shallow reps, tempo, lowering speed, gates, holds, bouncing) |
| `npm run data:fetch` | download UI-PRMD Kinect data into `data/uiprmd` (≈200 MB) |
| `npm run data:calibrate` | regenerate `src/data/calibration.json` + `docs/calibration.md` |
| `npm run data:evaluate` | regenerate `docs/evaluation.md` |
| `npm run data:fetch-rehabpile` | download the matching Rehab-Pile subsets into `data/rehabpile` (≈130 MB, needs numpy) |
| `npm run data:calibrate-rehabpile` | regenerate `docs/calibration-rehabpile.md` |
| `node scripts/e2e-smoke.mjs` | headless Chromium end-to-end: library → setup → live session on a real exercise video → summary (needs `npm run dev`, `npx playwright install chromium`, and a clip in `public/test-videos/`) |

**Deep link for demos and tests:** `/?exercise=squat&video=/clip.webm&goal=0.8&reps=5&voice=0&delegate=CPU` starts a session
directly, using a video file instead of the webcam. The same "analyse a video file" option appears if camera access fails.

The e2e run was verified against two CC-licensed Wikimedia Commons clips: *Kettlebell Racked Squats (side view)* by Taco
Fleur (CC BY-SA 4.0) and *Squat – exercise demonstration video* (CC BY 3.0). They aren't committed. Download them into
`public/test-videos/` to reproduce.

## Limits of this proof of concept

- 2D, single camera: rotation and out-of-plane motion (e.g. knee valgus in a side view) aren't measured. Each exercise
  insists on the view where its key angles are in-plane.
- No fine-tuning: the pose model is used as published. Thresholds are rule-based, set from UI-PRMD where available and
  from clinical norms otherwise.
- UI-PRMD subjects are healthy adults acting out errors, and there are no per-rep fault labels. The evaluation is a smoke test of
  the whole pipeline, not clinical validation. **Not medical advice.**

Natural next steps: per-patient range goals prescribed by a therapist, a 3D path using `worldLandmarks`, a learned
quality score (UI-PRMD supports this), session export for the clinician, and an LLM-written session debrief.

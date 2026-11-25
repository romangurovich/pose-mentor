/**
 * Localisation contract. Everything the app says or shows goes through a `Locale`:
 *   messages   what the coach says and the live coaching text (engine + cue bar)
 *   ui         app chrome (library, setup sheet, session HUD, summary)
 *   metrics    names of the measured angles
 *   exercises  per-exercise text (name, steps, camera tip, check labels and cues)
 *
 * The English exercise text lives with the exercise data (src/coach/exercises.ts); other locales translate it here.
 * Clinical provenance notes ("why these numbers": data sources, thresholds) stay in English on purpose.
 *
 * Grammar rule for every locale: the app doesn't know the user's gender, so text addressed to the user must be
 * gender-neutral (imperatives, or phrasings without gendered adjectives/participles). The voice gender setting
 * only chooses the speaking voice.
 */
import type { Side } from "../pose/landmarks.ts";
import type { MetricId } from "../coach/metrics.ts";

export type LocaleId = "en" | "es" | "fr" | "de" | "pt" | "ru";
export type VoiceGender = "female" | "male";
export type JointWord = "shoulders" | "elbows" | "hands" | "hips" | "knees" | "feet" | "head";
export type Pair = readonly [headline: string, detail: string];
export type ExerciseKind = "reps" | "hold";
export type Region = "knee-hip" | "shoulder" | "spine-neck";

/** What the coach says, and the live coaching text on screen. */
export interface Messages {
  /** body parts named in "I can't see your …" */
  joint: Record<JointWord, string>;
  side: Record<Side, string>;
  sideCap: Record<Side, string>;
  /** "feet and hands" */
  list: (items: string[]) => string;

  say: {
    stepBack: (parts: string) => string;
    turnSideways: string;
    faceCamera: string;
    goodToGo: (kind: ExerciseKind) => string;
    readyFirst: string;
    readyAgain: string;
    count: (n: number) => string;
    slowDown: string;
    almost: string;
    shallow: string;
    littleFurther: string;
    better: (fixed: string) => string;
    /** fallback when a fault has no "fixed" phrase */
    fixedFallback: string;
    praise: readonly string[];
    switchSides: (side: string) => string;
    setComplete: string;
    allDone: string;
    holdIn: string;
    backInPosition: string;
    halfway: string;
    fiveMore: string;
    easeBack: string;
  };

  status: {
    /** suffix after a headline for unilateral exercises, e.g. " · Left side" */
    sideSuffix: (side: Side) => string;
    searching: Pair;
    framing: (missing: string) => Pair;
    orientSide: Pair;
    orientFront: Pair;
    returnToStart: (suffix: string) => Pair;
    readyReps: (suffix: string) => Pair;
    readyHold: (suffix: string) => Pair;
    goodToGo: (suffix: string, kind: ExerciseKind) => Pair;
    rep: (n: number, suffix: string) => string;
    hold: (suffix: string) => Pair;
    switchTo: (side: string) => Pair;
    done: Pair;
  };

  /** the engine's own timing faults */
  builtin: Record<"tempo" | "lowering" | "bounce", { label: string; cue: string; short?: string; fixed?: string }>;

  ui: {
    greatRep: (n: number) => string;
    repCounted: (n: number) => string;
    goalReached: string;
    aimFor: (goal: number) => string;
    tooFast: string;
    shortOfGoal: string;
    finishing: string;
    verdict: { none: string; excellent: string; good: string; work: string };
    noFaults: string;
  };

  /** spoken by the voice preview in settings */
  sample: string;
}

/** App chrome. Functions take already-formatted numbers unless noted. */
export interface UiStrings {
  nav: { runsOnDevice: string; settings: string };
  settings: {
    language: string;
    voice: string;
    /** shown when this language/gender has no Kokoro voice and the device voice is used */
    voiceSystem: string;
    female: string;
    male: string;
    preview: string;
    theme: string;
    system: string;
    light: string;
    dark: string;
    note: string;
  };
  library: {
    eyebrow: string;
    titleLine1: string;
    titleLine2: string;
    lede: string;
    factExercises: string;
    factCalibrated: string;
    factOnDevice: string;
    heroRepChip: string;
    recent: string;
    repsCount: (n: number) => string;
    holdsCount: (n: number) => string;
    title: string;
    regions: Record<Region | "all", string>;
    kinds: { all: string; reps: string; hold: string };
    ariaRegion: string;
    ariaType: string;
    sideView: string;
    faceCamera: string;
    calibratedFrom: (movement: string) => string;
    cardReps: (n: number) => string;
    cardHold: (seconds: number) => string;
    eachSide: string;
    start: string;
    footer: string;
  };
  setup: {
    cameraSetup: string;
    region: Record<Region, string>;
    kindExercise: string;
    kindHold: string;
    rangeGoal: string;
    goalHint: (reference: string) => string;
    reps: string;
    repsPerSide: string;
    hold: string;
    holdPerSide: string;
    startWith: string;
    auto: string;
    left: string;
    right: string;
    voiceCoaching: string;
    poseModel: string;
    modelFast: string;
    modelBalanced: string;
    modelPrecise: string;
    why: string;
    whyRange: (metric: string, range: string) => string;
    change: string;
    data: string;
    technicalInEnglish: string;
    start: string;
    privacy: string;
    close: string;
    decrease: string;
    increase: string;
  };
  session: {
    startingCamera: string;
    loadingModel: (model: string) => string;
    openingVideo: string;
    onDevice: string;
    cameraUnavailable: string;
    retry: string;
    analyseVideo: string;
    errDenied: string;
    errNotFound: string;
    errGeneric: (msg: string) => string;
    endSession: string;
    sideChip: (side: string, i: number, total: number) => string;
    pause: string;
    resume: string;
    pauseHint: string;
    mirror: string;
    voice: string;
    form: string;
    best: string;
    repDot: (n: number, score: number) => string;
    ofReps: (n: number) => string;
    holdPaused: string;
    secLeft: string;
    getInPosition: string;
    goal: (v: string) => string;
    ref: (v: string) => string;
    sideView: string;
    frontView: string;
    paused: string;
    faultDetail: (label: string, value: string, limit: string) => string;
    cleanRepDetail: (score: number, peak: string) => string;
    score: (score: number) => string;
  };
  summary: {
    library: string;
    setComplete: string;
    sessionSummary: string;
    repsCounted: string;
    leftRight: (left: number, right: number) => string;
    reachedGoal: string;
    goalSub: (v: string) => string;
    best: (metric: string) => string;
    referenceSub: (v: string) => string;
    avgRepTime: string;
    movementPhase: string;
    timeHeld: string;
    sidesCount: (n: number) => string;
    deepest: (metric: string) => string;
    cleanHoldTime: string;
    withoutFaults: string;
    rangePerRep: string;
    rangePerRepSub: (goal: string) => string;
    formFeedback: string;
    noFaults: string;
    priority: string;
    tidyUp: string;
    faultCount: (n: number, kind: ExerciseKind) => string;
    coachNotes: string;
    noteMostCommon: (label: string, cue: string) => string;
    noteAllGoal: (pct: number) => string;
    noteFewerThanHalf: (goal: string) => string;
    noteEndedEarly: string;
    again: string;
    backToLibrary: string;
    chartAria: string;
    chartGoal: string;
    sideInitial: Record<Side, string>;
    tipTitle: (rep: number, side: string | null, score: number) => string;
    tipPeak: (peak: string, pct: number, goal: string) => string;
    tipMovement: (seconds: string) => string;
  };
}

export interface CheckText {
  label: string;
  cue: string;
  short?: string;
  fixed?: string;
}

export interface ExerciseText {
  name: string;
  tagline: string;
  steps: string[];
  camera: string;
  checks: Record<string, CheckText>;
}

export interface Locale {
  id: LocaleId;
  /** native name for the picker ("Español") */
  name: string;
  /** BCP 47 tag for speech and number/date formatting */
  tag: string;
  messages: Messages;
  ui: UiStrings;
  metrics: Record<MetricId, string>;
  /** translations of the exercise text, by exercise id; English comes from the exercise data */
  exercises: Record<string, ExerciseText>;
  /** system voices to prefer for each gender, tried in order (Web Speech API exposes names, not genders) */
  voices: Record<VoiceGender, RegExp[]>;
  /**
   * Kokoro-82M voices for this language. Their audio is pre-generated at build time (scripts/build-voices.ts); a
   * language or gender without one uses the device voice. `espeak` = eSpeak-NG voice used at build time to
   * phonemize non-English text (English uses kokoro-js's own phonemizer).
   */
  kokoro?: { female?: string; male?: string; espeak?: string };
}

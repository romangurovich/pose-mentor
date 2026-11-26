import { useCallback, useEffect, useRef, useState } from "react";
import type { ExerciseDef } from "../coach/types.ts";
import { CoachEngine, faultInfo, type CoachState, type RepRecord } from "../coach/engine.ts";
import { METRICS } from "../coach/metrics.ts";
import { PoseDetector } from "../pose/detector.ts";
import { PoseSmoother } from "../pose/filter.ts";
import type { PoseFrame } from "../pose/landmarks.ts";
import { computeLayout, drawOverlay } from "./overlay.ts";
import { VoiceCoach } from "./voice.ts";
import { DemoFigure } from "./demo/DemoFigure.tsx";
import { Icon } from "./icons.tsx";
import type { SessionConfig } from "./SetupSheet.tsx";
import type { SessionResult } from "./history.ts";
import { useI18n } from "./i18n.tsx";
import { exerciseText, fmtValue, metricLabel } from "../i18n/index.ts";
import { sessionPhrases } from "../tts/phrases.ts";
import type { Locale } from "../i18n/types.ts";

interface Props {
  ex: ExerciseDef;
  cfg: SessionConfig;
  onExit: (result: SessionResult | null) => void;
}

type Phase = { kind: "loading"; msg: string } | { kind: "error"; msg: string } | { kind: "running" };

const videoParam = () => new URLSearchParams(location.search).get("video");

/** the end card stays at least this long, and the summary follows this beat after the coach's last word */
const END_CARD_MIN_MS = 1800;
const END_BEAT_MS = 600;
/** never hold the summary longer than this for speech (a device voice can fail to report that it finished) */
const END_SPEECH_MAX_MS = 12000;

export function Session({ ex, cfg, onExit }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const backdropRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const { locale: currentLocale, settings } = useI18n();
  // the language is fixed for the length of a session (the engine and voice are built once)
  const locale = useRef<Locale>(currentLocale).current;
  const gender = useRef(settings.voice).current;
  const m = locale.messages;
  const t = locale.ui.session;
  const exName = exerciseText(locale, ex).name;
  const [phase, setPhase] = useState<Phase>({ kind: "loading", msg: t.startingCamera });
  const [hud, setHud] = useState<CoachState | null>(null);
  const [fps, setFps] = useState(0);
  const [voiceOn, setVoiceOn] = useState(cfg.voice);
  const [mirror, setMirror] = useState(!videoParam());
  const [paused, setPaused] = useState(false);
  const [flash, setFlash] = useState<RepRecord | null>(null);
  const [delegate, setDelegate] = useState<string>("");
  const [fileSrc, setFileSrc] = useState<string | null>(videoParam());

  const engineRef = useRef<CoachEngine>(new CoachEngine(ex, { rangeGoal: cfg.rangeGoal, reps: cfg.reps, holdSeconds: cfg.holdSeconds, startSide: cfg.startSide, locale }));
  const voiceRef = useRef<VoiceCoach>(null!);
  voiceRef.current ??= new VoiceCoach(locale, gender);
  const startedAt = useRef(Date.now());
  const mirrorRef = useRef(mirror);
  const pausedRef = useRef(paused);
  const doneRef = useRef(false);
  const stRef = useRef<CoachState | null>(null);
  mirrorRef.current = mirror;
  pausedRef.current = paused;

  // decode this session's likely voice clips in the background so cues play without delay
  useEffect(() => {
    if (cfg.voice) voiceRef.current.prepare(sessionPhrases(locale, ex, cfg.reps));
  }, [locale, ex, cfg.voice, cfg.reps]);

  useEffect(() => {
    voiceRef.current.enabled = voiceOn;
    if (!voiceOn) voiceRef.current.stop();
  }, [voiceOn]);

  const buildResult = useCallback((): SessionResult => {
    const st = engineRef.current.update(null);
    const tally: Record<string, number> = {};
    for (const r of st.reps) for (const f of r.faults) tally[f] = (tally[f] ?? 0) + 1;
    for (const h of st.holds) for (const [k, v] of Object.entries(h.faultSeconds)) tally[k] = (tally[k] ?? 0) + Math.round(v);
    return {
      id: `${Date.now()}`,
      exerciseId: ex.id,
      startedAt: startedAt.current,
      durationMs: Date.now() - startedAt.current,
      rangeGoal: cfg.rangeGoal,
      goalValue: st.goalValue,
      refValue: st.refValue,
      unit: st.unit,
      reps: st.reps,
      holds: st.holds,
      faultTally: tally,
      formScore: st.formScore,
      completed: st.status === "done",
    };
  }, [ex.id, cfg.rangeGoal]);

  // ───────────────────────── camera / video + detector + loop ─────────────────────────
  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    let detector: PoseDetector | null = null;
    let rafId = 0;
    const video = videoRef.current!;
    const smoother = new PoseSmoother();
    let lastHud = 0;
    let frames = 0;
    let fpsT = performance.now();
    let lastFrame: PoseFrame | null = null;
    let lastVideoTime = -1;

    async function start() {
      try {
        if (fileSrc) {
          video.src = fileSrc;
          video.loop = true;
          video.muted = true;
          video.crossOrigin = "anonymous";
        } else {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
            audio: false,
          });
          if (cancelled) return stream.getTracks().forEach((t) => t.stop());
          video.srcObject = stream;
          if (backdropRef.current) backdropRef.current.srcObject = stream;
        }
        await video.play();
        if (fileSrc && backdropRef.current) {
          backdropRef.current.src = fileSrc;
          backdropRef.current.loop = true;
          backdropRef.current.muted = true;
          void backdropRef.current.play();
        }
        setPhase({ kind: "loading", msg: t.loadingModel(cfg.model) });
        detector = await PoseDetector.create(cfg.model, new URLSearchParams(location.search).get("delegate") === "CPU" ? "CPU" : "GPU");
        if (cancelled) return detector.close();
        setDelegate(detector.info?.delegate ?? "");
        setPhase({ kind: "running" });
        loop();
      } catch (e) {
        const err = e as DOMException;
        const msg = err?.name === "NotAllowedError" ? t.errDenied : err?.name === "NotFoundError" ? t.errNotFound : t.errGeneric(err?.message ?? String(e));
        if (!cancelled) setPhase({ kind: "error", msg });
      }
    }

    function step(now: number) {
      const canvas = canvasRef.current, stage = stageRef.current;
      if (!detector || cancelled || !canvas || !stage) return;
      if (video.currentTime !== lastVideoTime && !pausedRef.current) {
        lastVideoTime = video.currentTime;
        const raw = detector.detect(video, now);
        lastFrame = raw ? smoother.apply(raw) : null;
        if (!raw) smoother.reset();
        const st = doneRef.current ? null : engineRef.current.update(lastFrame);
        if (st) {
          for (const ev of st.events) {
            if (ev.type === "say") voiceRef.current.say(ev.text, ev.kind);
            if (ev.type === "flag") voiceRef.current.tick();
            if (ev.type === "rep") {
              voiceRef.current.chime(ev.rep.faults.length === 0 && ev.rep.full);
              setFlash(ev.rep);
            }
            if (ev.type === "done") {
              doneRef.current = true;
              setHud(st);
            }
          }
          // after this frame's lines are queued: let the coach finish ("Set complete. Nice work!") before the summary
          if (doneRef.current && st.events.some((e) => e.type === "done")) {
            const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
            const spoken = voiceRef.current.whenIdle().then(() => wait(END_BEAT_MS));
            void Promise.all([wait(END_CARD_MIN_MS), Promise.race([spoken, wait(END_SPEECH_MAX_MS)])]).then(() => !cancelled && onExit(buildResult()));
          }
          if (now - lastHud > 70 || st.events.length) {
            lastHud = now;
            setHud(st);
          }
          stRef.current = st;
          if (import.meta.env.DEV) (window as unknown as { __poseMentor: unknown }).__poseMentor = { state: st, frame: lastFrame, fps: frames };
        }
        frames++;
        if (now - fpsT > 1000) {
          setFps(Math.round((frames * 1000) / (now - fpsT)));
          frames = 0;
          fpsT = now;
        }
      }
      // draw every display frame
      const rect = stage.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) {
        canvas.width = Math.round(rect.width * dpr);
        canvas.height = Math.round(rect.height * dpr);
      }
      const ctx = canvas.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const L = computeLayout(rect.width, rect.height, video.videoWidth || 16, video.videoHeight || 9, mirrorRef.current);
      drawOverlay(ctx, lastFrame, stRef.current, ex, L, now);
    }

    function loop() {
      const tick = (now: number) => {
        if (cancelled) return;
        step(now);
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    }

    void start();
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      stream?.getTracks().forEach((t) => t.stop());
      detector?.close();
      voiceRef.current.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileSrc]);

  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(null), 1600);
    return () => clearTimeout(id);
  }, [flash]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === " ") {
        e.preventDefault();
        setPaused((p) => !p);
      }
      if (e.key === "Escape") onExit(buildResult());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onExit, buildResult]);

  const st = hud;
  const metric = METRICS[ex.primary.metric];
  const showCard = phase.kind !== "running" || (st && (st.status === "searching" || st.status === "framing" || st.status === "orient" || st.status === "switch"));

  return (
    <div className="session">
      <div className="stage" ref={stageRef}>
        <video ref={backdropRef} className={`backdrop ${mirror ? "mirror" : ""}`} playsInline muted aria-hidden />
        <video ref={videoRef} className={`feed ${mirror ? "mirror" : ""}`} playsInline muted />
        <canvas ref={canvasRef} className="overlay" />
        <div className="vignette" />
      </div>

      {/* top bar */}
      <header className="topbar glass">
        <button className="icon-btn" onClick={() => onExit(buildResult())} aria-label={t.endSession}>
          <Icon.Back />
        </button>
        <div className="topbar-title">
          <strong>{exName}</strong>
          {st && ex.bothSides && <span className="chip">{t.sideChip(m.sideCap[st.side], st.sideIndex + 1, 2)}</span>}
        </div>
        <div className="topbar-right">
          {phase.kind === "running" && (
            <span className="live">
              <span className="live-dot" /> {fps} fps{delegate ? ` · ${delegate}` : ""}
            </span>
          )}
          <button className={`icon-btn ${paused ? "on" : ""}`} onClick={() => setPaused((p) => !p)} aria-label={paused ? t.resume : t.pause} title={t.pauseHint}>
            {paused ? <Icon.Play size={18} /> : <Icon.Pause size={18} />}
          </button>
          <button className={`icon-btn ${mirror ? "on" : ""}`} onClick={() => setMirror((m) => !m)} aria-label={t.mirror} title={t.mirror}>
            <Icon.Mirror size={18} />
          </button>
          <button className={`icon-btn ${voiceOn ? "on" : ""}`} onClick={() => setVoiceOn((v) => !v)} aria-label={t.voice} title={t.voice}>
            {voiceOn ? <Icon.Volume size={18} /> : <Icon.Mute size={18} />}
          </button>
        </div>
      </header>

      {phase.kind === "running" && st && (
        <>
          <aside className="hud-left glass">
            {ex.kind === "reps" ? <RepRing done={st.repsThisSide} target={st.repTarget} label={t.ofReps(st.repTarget)} /> : <HoldRing st={st} locale={locale} />}
            <div className="hud-stats">
              <div>
                <span className="k">{t.form}</span>
                <span className="v">{st.formScore ?? "–"}</span>
              </div>
              {ex.kind === "reps" && (
                <div>
                  <span className="k">{t.best}</span>
                  <span className="v">
                    {st.reps.length ? Math.round(Math.max(...st.reps.filter((r) => r.side === st.side).map((r) => Math.abs(r.peak)), 0)) : "–"}
                    <small>{metric.unit}</small>
                  </span>
                </div>
              )}
            </div>
            {ex.kind === "reps" && st.reps.length > 0 && (
              <div className="rep-dots" aria-label="Rep quality">
                {st.reps
                  .filter((r) => !ex.bothSides || r.side === st.side)
                  .slice(-12)
                  .map((r) => (
                    <span key={r.index} className={`rep-dot ${r.score >= 85 ? "good" : r.score >= 65 ? "ok" : "low"}`} title={t.repDot(r.index, r.score)} />
                  ))}
              </div>
            )}
          </aside>

          <aside className="hud-right glass">
            <RangeMeter st={st} label={metricLabel(locale, ex.primary.metric)} locale={locale} />
          </aside>

          <CueBar st={st} flash={flash} ex={ex} locale={locale} />
        </>
      )}

      {showCard && (
        <div className="center-card glass">
          {phase.kind === "loading" && (
            <>
              <div className="spinner" />
              <h3>{phase.msg}</h3>
              <p>{t.onDevice}</p>
            </>
          )}
          {phase.kind === "error" && (
            <>
              <div className="card-icon bad">
                <Icon.Camera size={26} />
              </div>
              <h3>{t.cameraUnavailable}</h3>
              <p>{phase.msg}</p>
              <div className="card-actions">
                <button className="btn" onClick={() => location.reload()}>
                  {t.retry}
                </button>
                <label className="btn btn-primary">
                  {t.analyseVideo}
                  <input
                    type="file"
                    accept="video/*"
                    hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) {
                        setMirror(false);
                        setPhase({ kind: "loading", msg: t.openingVideo });
                        setFileSrc(URL.createObjectURL(f));
                      }
                    }}
                  />
                </label>
              </div>
            </>
          )}
          {phase.kind === "running" && st && st.status !== "switch" && (
            <>
              <div className="card-demo">
                <DemoFigure spec={ex.demo} period={3.6} highlight />
              </div>
              <h3>{st.headline}</h3>
              <p>{st.status === "framing" || st.status === "searching" ? `${st.detail} ${exerciseText(locale, ex).camera}` : st.detail}</p>
              {st.status === "orient" && (
                <span className="chip">
                  {ex.view === "side" ? <Icon.Side size={14} /> : <Icon.Front size={14} />} {ex.view === "side" ? t.sideView : t.frontView}
                </span>
              )}
            </>
          )}
          {phase.kind === "running" && st && st.status === "switch" && (
            <>
              <div className="card-icon good">
                <Icon.Repeat size={26} />
              </div>
              <h3>{st.headline}</h3>
              <p>{st.detail}</p>
            </>
          )}
        </div>
      )}

      {st?.status === "done" && (
        <div className="center-card glass done-card">
          <div className="card-icon good big">
            <Icon.Check size={34} />
          </div>
          <h3>{m.status.done[0]}</h3>
          <p>{m.ui.finishing}</p>
        </div>
      )}

      {paused && phase.kind === "running" && (
        <div className="paused-pill glass">
          <Icon.Pause size={16} /> {t.paused}
        </div>
      )}
    </div>
  );
}

// ───────────────────────────────────────────── HUD pieces ─────────────────────────────────────────────

function Ring({ value, children, tone = "accent" }: { value: number; children: React.ReactNode; tone?: string }) {
  const r = 52, c = 2 * Math.PI * r;
  return (
    <div className={`ring ring-${tone}`}>
      <svg viewBox="0 0 120 120">
        <circle cx="60" cy="60" r={r} className="ring-track" />
        {value > 0.001 && <circle cx="60" cy="60" r={r} className="ring-value" strokeDasharray={`${c * Math.min(1, value)} ${c}`} transform="rotate(-90 60 60)" />}
      </svg>
      <div className="ring-center">{children}</div>
    </div>
  );
}

function RepRing({ done, target, label }: { done: number; target: number; label: string }) {
  return (
    <Ring value={done / target}>
      <span className="ring-big" key={done}>
        {done}
      </span>
      <span className="ring-small">{label}</span>
    </Ring>
  );
}

function HoldRing({ st, locale }: { st: CoachState; locale: Locale }) {
  const t = locale.ui.session;
  const h = st.hold!;
  const left = Math.max(0, Math.ceil(h.target - h.elapsed));
  return (
    <Ring value={h.elapsed / h.target} tone={h.paused ? "minor" : h.inPosition ? "good" : "accent"}>
      <span className="ring-big">{left}</span>
      <span className="ring-small">{h.paused ? t.holdPaused : h.inPosition ? t.secLeft : t.getInPosition}</span>
    </Ring>
  );
}

function RangeMeter({ st, label, locale }: { st: CoachState; label: string; locale: Locale }) {
  const t = locale.ui.session;
  const refP = (st.refValue - st.startValue) / (st.goalValue - st.startValue || 1);
  const max = Math.max(1.2, refP * 1.05);
  const toPct = (p: number) => `${Math.min(100, Math.max(0, (p / max) * 100))}%`;
  const peakRef = useRef(0);
  if (!st.inPeak && st.progress < 0.25) peakRef.current = 0;
  peakRef.current = Math.max(peakRef.current, st.progress);
  const reached = st.progress >= 0.95;
  return (
    <div className="meter">
      <div className="meter-value">
        <span className="v">{Math.round(st.value)}</span>
        <span className="u">{st.unit}</span>
      </div>
      <div className="meter-label">{label}</div>
      <div className="meter-track">
        <div className={`meter-fill ${reached ? "reached" : ""}`} style={{ height: toPct(st.progress) }} />
        {peakRef.current > 0.3 && <div className="meter-peak" style={{ bottom: toPct(peakRef.current) }} />}
        <div className="meter-goal" style={{ bottom: toPct(1) }}>
          <span>{t.goal(fmtValue(locale, st.goalValue, "°"))}</span>
        </div>
        {refP > 1.02 && (
          <div className="meter-ref" style={{ bottom: toPct(refP) }}>
            <span>{t.ref(fmtValue(locale, st.refValue, "°"))}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function CueBar({ st, flash, ex, locale }: { st: CoachState; flash: RepRecord | null; ex: ExerciseDef; locale: Locale }) {
  const m = locale.messages;
  const t = locale.ui.session;
  let tone = "neutral", icon = <Icon.Info size={20} />, title = st.headline, sub = st.detail;
  const fault = st.faults[0];
  if (fault && (st.status === "active" || st.status === "ready")) {
    tone = fault.severity === "major" ? "major" : "minor";
    icon = <Icon.Alert size={20} />;
    title = fault.cue;
    sub = t.faultDetail(fault.label, fmtValue(locale, fault.value, fault.unit), fmtValue(locale, fault.threshold, fault.unit));
  } else if (flash) {
    const clean = flash.faults.length === 0 && flash.full;
    tone = clean ? "good" : "minor";
    icon = clean ? <Icon.Check size={20} /> : <Icon.Alert size={20} />;
    const n = ex.bothSides ? st.repsThisSide : flash.index;
    title = clean ? m.ui.greatRep(n) : m.ui.repCounted(n);
    const fl = flash.faults.map((id) => (id === "tempo" ? m.ui.tooFast : faultInfo(ex, id, locale).label));
    sub = clean ? t.cleanRepDetail(flash.score, fmtValue(locale, Math.abs(flash.peak), st.unit)) : [...fl, ...(flash.full ? [] : [m.ui.shortOfGoal])].join(" · ") + ` · ${t.score(flash.score)}`;
  } else if (st.goodToGo) {
    tone = "good";
    icon = <Icon.Check size={20} />;
  } else if (st.status === "active" && ex.kind === "reps") {
    sub = st.progress >= 0.95 ? m.ui.goalReached : m.ui.aimFor(Math.round(st.goalValue));
  } else if (st.status === "active" && ex.kind === "hold" && st.hold?.inPosition) {
    tone = "good";
    icon = <Icon.Check size={20} />;
  }
  if (st.status === "searching" || st.status === "framing" || st.status === "orient" || st.status === "switch" || st.status === "done") return null;
  return (
    <div className={`cuebar glass tone-${tone}`} key={title} role="status" aria-live="polite">
      <span className="cue-icon">{icon}</span>
      <div>
        <div className="cue-title">{title}</div>
        {sub && <div className="cue-sub">{sub}</div>}
      </div>
    </div>
  );
}

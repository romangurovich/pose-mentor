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

interface Props {
  ex: ExerciseDef;
  cfg: SessionConfig;
  onExit: (result: SessionResult | null) => void;
}

type Phase = { kind: "loading"; msg: string } | { kind: "error"; msg: string } | { kind: "running" };

const videoParam = () => new URLSearchParams(location.search).get("video");

export function Session({ ex, cfg, onExit }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const backdropRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "loading", msg: "Starting camera…" });
  const [hud, setHud] = useState<CoachState | null>(null);
  const [fps, setFps] = useState(0);
  const [voiceOn, setVoiceOn] = useState(cfg.voice);
  const [mirror, setMirror] = useState(!videoParam());
  const [paused, setPaused] = useState(false);
  const [flash, setFlash] = useState<RepRecord | null>(null);
  const [delegate, setDelegate] = useState<string>("");
  const [fileSrc, setFileSrc] = useState<string | null>(videoParam());

  const engineRef = useRef<CoachEngine>(new CoachEngine(ex, { rangeGoal: cfg.rangeGoal, reps: cfg.reps, holdSeconds: cfg.holdSeconds, startSide: cfg.startSide }));
  const voiceRef = useRef(new VoiceCoach());
  const startedAt = useRef(Date.now());
  const mirrorRef = useRef(mirror);
  const pausedRef = useRef(paused);
  const doneRef = useRef(false);
  const stRef = useRef<CoachState | null>(null);
  mirrorRef.current = mirror;
  pausedRef.current = paused;

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
        setPhase({ kind: "loading", msg: `Loading pose model (${cfg.model})…` });
        detector = await PoseDetector.create(cfg.model, new URLSearchParams(location.search).get("delegate") === "CPU" ? "CPU" : "GPU");
        if (cancelled) return detector.close();
        setDelegate(detector.info?.delegate ?? "");
        setPhase({ kind: "running" });
        loop();
      } catch (e) {
        const err = e as DOMException;
        const msg =
          err?.name === "NotAllowedError"
            ? "Camera permission was denied. Allow camera access in your browser's site settings, then retry."
            : err?.name === "NotFoundError"
              ? "No camera was found. Connect a webcam, or analyse a recorded video instead."
              : `Couldn't start: ${err?.message ?? String(e)}`;
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
            if (ev.type === "rep") {
              voiceRef.current.chime(ev.rep.faults.length === 0 && ev.rep.full);
              setFlash(ev.rep);
            }
            if (ev.type === "done") {
              doneRef.current = true;
              setHud(st);
              setTimeout(() => onExit(buildResult()), 2600);
            }
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
        <button className="icon-btn" onClick={() => onExit(buildResult())} aria-label="End session">
          <Icon.Back />
        </button>
        <div className="topbar-title">
          <strong>{ex.name}</strong>
          {st && ex.bothSides && <span className="chip">{st.side === "left" ? "Left" : "Right"} side · {st.sideIndex + 1}/2</span>}
        </div>
        <div className="topbar-right">
          {phase.kind === "running" && (
            <span className="live">
              <span className="live-dot" /> {fps} fps{delegate ? ` · ${delegate}` : ""}
            </span>
          )}
          <button className={`icon-btn ${paused ? "on" : ""}`} onClick={() => setPaused((p) => !p)} aria-label={paused ? "Resume" : "Pause"} title="Pause (space)">
            {paused ? <Icon.Play size={18} /> : <Icon.Pause size={18} />}
          </button>
          <button className={`icon-btn ${mirror ? "on" : ""}`} onClick={() => setMirror((m) => !m)} aria-label="Mirror video" title="Mirror">
            <Icon.Mirror size={18} />
          </button>
          <button className={`icon-btn ${voiceOn ? "on" : ""}`} onClick={() => setVoiceOn((v) => !v)} aria-label="Voice coaching" title="Voice">
            {voiceOn ? <Icon.Volume size={18} /> : <Icon.Mute size={18} />}
          </button>
        </div>
      </header>

      {phase.kind === "running" && st && (
        <>
          <aside className="hud-left glass">
            {ex.kind === "reps" ? <RepRing done={st.repsThisSide} target={st.repTarget} /> : <HoldRing st={st} />}
            <div className="hud-stats">
              <div>
                <span className="k">Form</span>
                <span className="v">{st.formScore ?? "–"}</span>
              </div>
              {ex.kind === "reps" && (
                <div>
                  <span className="k">Best</span>
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
                    <span key={r.index} className={`rep-dot ${r.score >= 85 ? "good" : r.score >= 65 ? "ok" : "low"}`} title={`Rep ${r.index}: ${r.score}`} />
                  ))}
              </div>
            )}
          </aside>

          <aside className="hud-right glass">
            <RangeMeter st={st} label={metric.label} />
          </aside>

          <CueBar st={st} flash={flash} ex={ex} />
        </>
      )}

      {showCard && (
        <div className="center-card glass">
          {phase.kind === "loading" && (
            <>
              <div className="spinner" />
              <h3>{phase.msg}</h3>
              <p>The model runs entirely on your device.</p>
            </>
          )}
          {phase.kind === "error" && (
            <>
              <div className="card-icon bad">
                <Icon.Camera size={26} />
              </div>
              <h3>Camera unavailable</h3>
              <p>{phase.msg}</p>
              <div className="card-actions">
                <button className="btn" onClick={() => location.reload()}>
                  Retry
                </button>
                <label className="btn btn-primary">
                  Analyse a video file
                  <input
                    type="file"
                    accept="video/*"
                    hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) {
                        setMirror(false);
                        setPhase({ kind: "loading", msg: "Opening video…" });
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
              <p>{st.status === "framing" || st.status === "searching" ? `${st.detail} ${ex.camera}` : st.detail}</p>
              {st.status === "orient" && (
                <span className="chip">
                  {ex.view === "side" ? <Icon.Side size={14} /> : <Icon.Front size={14} />} {ex.view === "side" ? "Side view" : "Front view"}
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
          <h3>Set complete</h3>
          <p>Putting your summary together…</p>
        </div>
      )}

      {paused && phase.kind === "running" && (
        <div className="paused-pill glass">
          <Icon.Pause size={16} /> Paused · press space to resume
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

function RepRing({ done, target }: { done: number; target: number }) {
  return (
    <Ring value={done / target}>
      <span className="ring-big" key={done}>
        {done}
      </span>
      <span className="ring-small">of {target} reps</span>
    </Ring>
  );
}

function HoldRing({ st }: { st: CoachState }) {
  const h = st.hold!;
  const left = Math.max(0, Math.ceil(h.target - h.elapsed));
  return (
    <Ring value={h.elapsed / h.target} tone={h.paused ? "minor" : h.inPosition ? "good" : "accent"}>
      <span className="ring-big">{left}</span>
      <span className="ring-small">{h.paused ? "paused" : h.inPosition ? "sec left" : "get in position"}</span>
    </Ring>
  );
}

function RangeMeter({ st, label }: { st: CoachState; label: string }) {
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
          <span>Goal {Math.round(st.goalValue)}°</span>
        </div>
        {refP > 1.02 && (
          <div className="meter-ref" style={{ bottom: toPct(refP) }}>
            <span>Ref {Math.round(st.refValue)}°</span>
          </div>
        )}
      </div>
    </div>
  );
}

function CueBar({ st, flash, ex }: { st: CoachState; flash: RepRecord | null; ex: ExerciseDef }) {
  let tone = "neutral", icon = <Icon.Info size={20} />, title = st.headline, sub = st.detail;
  const fault = st.faults[0];
  if (fault && (st.status === "active" || st.status === "ready")) {
    tone = fault.severity === "major" ? "major" : "minor";
    icon = <Icon.Alert size={20} />;
    title = fault.cue;
    sub = `${fault.label} · ${Math.round(fault.value)}${fault.unit} (limit ${fault.threshold}${fault.unit})`;
  } else if (flash) {
    const clean = flash.faults.length === 0 && flash.full;
    tone = clean ? "good" : "minor";
    icon = clean ? <Icon.Check size={20} /> : <Icon.Alert size={20} />;
    title = clean ? `Rep ${ex.bothSides ? st.repsThisSide : flash.index}: great rep` : `Rep ${ex.bothSides ? st.repsThisSide : flash.index} counted`;
    const fl = flash.faults.map((id) => (id === "tempo" ? "Too fast" : faultInfo(ex, id).label));
    sub = clean ? `Score ${flash.score} · ${Math.round(Math.abs(flash.peak))}° peak` : [...fl, ...(flash.full ? [] : ["Short of goal"])].join(" · ") + ` · score ${flash.score}`;
  } else if (st.goodToGo) {
    tone = "good";
    icon = <Icon.Check size={20} />;
  } else if (st.status === "active" && ex.kind === "reps") {
    sub = st.progress >= 0.95 ? "Goal reached — return with control" : `Aim for the goal line (${Math.round(st.goalValue)}°)`;
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

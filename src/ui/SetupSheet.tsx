import { useEffect, useState } from "react";
import type { ExerciseDef } from "../coach/types.ts";
import { METRICS } from "../coach/metrics.ts";
import type { ModelVariant } from "../pose/detector.ts";
import { DemoFigure } from "./demo/DemoFigure.tsx";
import { Icon } from "./icons.tsx";

export interface SessionConfig {
  rangeGoal: number;
  reps: number;
  holdSeconds: number;
  startSide: "auto" | "left" | "right";
  voice: boolean;
  model: ModelVariant;
}

const PREF_KEY = "pose-mentor.prefs.v1";
export function loadPrefs(): Partial<SessionConfig> {
  try {
    return JSON.parse(localStorage.getItem(PREF_KEY) ?? "{}");
  } catch {
    return {};
  }
}
function savePrefs(c: SessionConfig) {
  localStorage.setItem(PREF_KEY, JSON.stringify({ rangeGoal: c.rangeGoal, voice: c.voice, model: c.model }));
}

interface Props {
  ex: ExerciseDef;
  onClose: () => void;
  onStart: (cfg: SessionConfig) => void;
}

export function SetupSheet({ ex, onClose, onStart }: Props) {
  const prefs = loadPrefs();
  const [cfg, setCfg] = useState<SessionConfig>({
    rangeGoal: prefs.rangeGoal ?? 0.8,
    reps: ex.reps ?? 10,
    holdSeconds: ex.holdSeconds ?? 30,
    startSide: "auto",
    voice: prefs.voice ?? true,
    model: prefs.model ?? "full",
  });
  const [why, setWhy] = useState(false);
  const set = <K extends keyof SessionConfig>(k: K, v: SessionConfig[K]) => setCfg((c) => ({ ...c, [k]: v }));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const { start, target } = ex.primary;
  const goal = Math.round(start + (target - start) * cfg.rangeGoal);
  const metric = METRICS[ex.primary.metric];

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal aria-labelledby="sheet-title" onClick={(e) => e.stopPropagation()}>
        <button className="icon-btn sheet-close" onClick={onClose} aria-label="Close">
          <Icon.Close />
        </button>
        <div className="sheet-visual">
          <DemoFigure spec={ex.demo} period={ex.kind === "hold" ? 5 : 3.6} className="sheet-figure" highlight />
          <div className="camera-tip">
            <Icon.Camera size={18} />
            <div>
              <strong>Camera setup</strong>
              <span>{ex.camera}</span>
            </div>
          </div>
        </div>

        <div className="sheet-body">
          <span className="eyebrow">
            {ex.view === "side" ? <Icon.Side size={14} /> : <Icon.Front size={14} />}
            {ex.region === "knee-hip" ? "Knee & hip" : ex.region === "shoulder" ? "Shoulder" : "Spine & neck"} ·{" "}
            {ex.kind === "reps" ? "Exercise" : "Hold"}
          </span>
          <h2 id="sheet-title">{ex.name}</h2>
          <p className="sheet-tagline">{ex.tagline}</p>

          <ol className="steps">
            {ex.steps.map((s, i) => (
              <li key={i}>
                <span>{i + 1}</span>
                {s}
              </li>
            ))}
          </ol>

          <div className="options">
            <div className="opt">
              <div className="opt-head">
                <label htmlFor="goal">Range goal</label>
                <span className="opt-value">
                  {Math.round(cfg.rangeGoal * 100)}% · {goal}
                  {metric.unit} {metric.label.toLowerCase()}
                </span>
              </div>
              <input id="goal" type="range" min={0.4} max={1} step={0.05} value={cfg.rangeGoal} onChange={(e) => set("rangeGoal", Number(e.target.value))} style={{ ["--p" as string]: `${((cfg.rangeGoal - 0.4) / 0.6) * 100}%` }} />
              <p className="opt-hint">
                Of the healthy reference ({target}
                {metric.unit}). Early in rehab, start lower and progress as your therapist advises.
              </p>
            </div>

            <div className="opt-row">
              {ex.kind === "reps" ? (
                <Stepper label={ex.bothSides ? "Reps per side" : "Reps"} value={cfg.reps} min={1} max={30} onChange={(v) => set("reps", v)} />
              ) : (
                <Stepper label={ex.bothSides ? "Hold per side" : "Hold"} value={cfg.holdSeconds} min={5} max={120} step={5} suffix="s" onChange={(v) => set("holdSeconds", v)} />
              )}
              {ex.bothSides && (
                <div className="opt">
                  <div className="opt-head">
                    <label>Start with</label>
                  </div>
                  <div className="seg seg-sm">
                    {(["auto", "left", "right"] as const).map((s) => (
                      <button key={s} className={cfg.startSide === s ? "on" : ""} onClick={() => set("startSide", s)}>
                        {s === "auto" ? "Auto" : s === "left" ? "Left" : "Right"}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="opt-row">
              <label className="toggle">
                <input type="checkbox" checked={cfg.voice} onChange={(e) => set("voice", e.target.checked)} />
                <span className="toggle-ui" />
                <span>Voice coaching</span>
              </label>
              <div className="opt">
                <div className="seg seg-sm" title="Pose model">
                  {(["lite", "full", "heavy"] as const).map((m) => (
                    <button key={m} className={cfg.model === m ? "on" : ""} onClick={() => set("model", m)}>
                      {m === "lite" ? "Fast" : m === "full" ? "Balanced" : "Precise"}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <button className="why" onClick={() => setWhy((w) => !w)} aria-expanded={why}>
            <Icon.Info size={16} /> What I check, and why these numbers
          </button>
          {why && (
            <div className="why-body">
              <div className="why-item">
                <strong>
                  Range: {metric.label} {start}
                  {metric.unit} → {target}
                  {metric.unit}
                </strong>
                <span>{ex.primary.basis}</span>
              </div>
              {ex.checks.map((c) => (
                <div className="why-item" key={c.id}>
                  <strong>
                    {c.label}: “{c.cue}”
                  </strong>
                  <span>
                    {METRICS[c.metric].label} {c.relative ? "change " : ""}
                    {c.op} {c.threshold}
                    {METRICS[c.metric].unit}. {c.basis}
                  </span>
                </div>
              ))}
              {ex.source.dataset && (
                <div className="why-item">
                  <strong>Data</strong>
                  <span>
                    {ex.source.dataset}, {ex.source.movement}. {ex.source.notes}
                  </span>
                </div>
              )}
            </div>
          )}

          <button
            className="cta"
            onClick={() => {
              savePrefs(cfg);
              onStart(cfg);
            }}
          >
            <Icon.Camera size={18} /> Start session
          </button>
          <p className="fine">Camera access is needed. Video is processed on this device and never uploaded.</p>
        </div>
      </div>
    </div>
  );
}

function Stepper({ label, value, min, max, step = 1, suffix = "", onChange }: { label: string; value: number; min: number; max: number; step?: number; suffix?: string; onChange: (v: number) => void }) {
  return (
    <div className="opt">
      <div className="opt-head">
        <label>{label}</label>
      </div>
      <div className="stepper">
        <button onClick={() => onChange(Math.max(min, value - step))} aria-label="Decrease">
          −
        </button>
        <span>
          {value}
          {suffix}
        </span>
        <button onClick={() => onChange(Math.min(max, value + step))} aria-label="Increase">
          +
        </button>
      </div>
    </div>
  );
}

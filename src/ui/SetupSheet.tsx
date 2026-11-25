import { useEffect, useState } from "react";
import type { ExerciseDef } from "../coach/types.ts";
import { METRICS } from "../coach/metrics.ts";
import type { ModelVariant } from "../pose/detector.ts";
import { DemoFigure } from "./demo/DemoFigure.tsx";
import { Icon } from "./icons.tsx";
import { useI18n } from "./i18n.tsx";
import { exerciseText, fmtValue, metricLabel } from "../i18n/index.ts";

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
  const { locale } = useI18n();
  const t = locale.ui.setup;
  const text = exerciseText(locale, ex);
  const set = <K extends keyof SessionConfig>(k: K, v: SessionConfig[K]) => setCfg((c) => ({ ...c, [k]: v }));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const { start, target } = ex.primary;
  const goal = Math.round(start + (target - start) * cfg.rangeGoal);
  const metric = METRICS[ex.primary.metric];
  const metricName = metricLabel(locale, ex.primary.metric);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal aria-labelledby="sheet-title" onClick={(e) => e.stopPropagation()}>
        <button className="icon-btn sheet-close" onClick={onClose} aria-label={t.close}>
          <Icon.Close />
        </button>
        <div className="sheet-visual">
          <DemoFigure spec={ex.demo} period={ex.kind === "hold" ? 5 : 3.6} className="sheet-figure" highlight />
          <div className="camera-tip">
            <Icon.Camera size={18} />
            <div>
              <strong>{t.cameraSetup}</strong>
              <span>{text.camera}</span>
            </div>
          </div>
        </div>

        <div className="sheet-body">
          <span className="eyebrow">
            {ex.view === "side" ? <Icon.Side size={14} /> : <Icon.Front size={14} />}
            {t.region[ex.region]} · {ex.kind === "reps" ? t.kindExercise : t.kindHold}
          </span>
          <h2 id="sheet-title">{text.name}</h2>
          <p className="sheet-tagline">{text.tagline}</p>

          <ol className="steps">
            {text.steps.map((s, i) => (
              <li key={i}>
                <span>{i + 1}</span>
                {s}
              </li>
            ))}
          </ol>

          <div className="options">
            <div className="opt">
              <div className="opt-head">
                <label htmlFor="goal">{t.rangeGoal}</label>
                <span className="opt-value">
                  {fmtValue(locale, cfg.rangeGoal * 100, "%")} · {fmtValue(locale, goal, metric.unit)} {locale.id === "de" ? metricName : metricName.toLowerCase()}
                </span>
              </div>
              <input id="goal" type="range" min={0.4} max={1} step={0.05} value={cfg.rangeGoal} onChange={(e) => set("rangeGoal", Number(e.target.value))} style={{ ["--p" as string]: `${((cfg.rangeGoal - 0.4) / 0.6) * 100}%` }} />
              <p className="opt-hint">{t.goalHint(fmtValue(locale, target, metric.unit))}</p>
            </div>

            <div className="opt-row">
              {ex.kind === "reps" ? (
                <Stepper label={ex.bothSides ? t.repsPerSide : t.reps} value={cfg.reps} min={1} max={30} onChange={(v) => set("reps", v)} dec={t.decrease} inc={t.increase} />
              ) : (
                <Stepper label={ex.bothSides ? t.holdPerSide : t.hold} value={cfg.holdSeconds} min={5} max={120} step={5} suffix=" s" onChange={(v) => set("holdSeconds", v)} dec={t.decrease} inc={t.increase} />
              )}
              {ex.bothSides && (
                <div className="opt">
                  <div className="opt-head">
                    <label>{t.startWith}</label>
                  </div>
                  <div className="seg seg-sm">
                    {(["auto", "left", "right"] as const).map((s) => (
                      <button key={s} className={cfg.startSide === s ? "on" : ""} onClick={() => set("startSide", s)}>
                        {t[s]}
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
                <span>{t.voiceCoaching}</span>
              </label>
              <div className="opt">
                <div className="seg seg-sm" title={t.poseModel}>
                  {(["lite", "full", "heavy"] as const).map((m) => (
                    <button key={m} className={cfg.model === m ? "on" : ""} onClick={() => set("model", m)}>
                      {m === "lite" ? t.modelFast : m === "full" ? t.modelBalanced : t.modelPrecise}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <button className="why" onClick={() => setWhy((w) => !w)} aria-expanded={why}>
            <Icon.Info size={16} /> {t.why}
          </button>
          {why && (
            <div className="why-body">
              {t.technicalInEnglish && <p className="why-lang">{t.technicalInEnglish}</p>}
              <div className="why-item">
                <strong>{t.whyRange(metricName, `${fmtValue(locale, start, metric.unit)} → ${fmtValue(locale, target, metric.unit)}`)}</strong>
                <span>{ex.primary.basis}</span>
              </div>
              {ex.checks.map((c) => (
                <div className="why-item" key={c.id}>
                  <strong>
                    {text.checks[c.id].label}: “{text.checks[c.id].cue}”
                  </strong>
                  <span>
                    {metricLabel(locale, c.metric)} {c.relative ? `${t.change} ` : ""}
                    {c.op} {c.threshold}
                    {c.relative === "percent" ? "%" : METRICS[c.metric].unit}. {c.basis}
                  </span>
                </div>
              ))}
              {ex.source.dataset && (
                <div className="why-item">
                  <strong>{t.data}</strong>
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
            <Icon.Camera size={18} /> {t.start}
          </button>
          <p className="fine">{t.privacy}</p>
        </div>
      </div>
    </div>
  );
}

function Stepper({ label, value, min, max, step = 1, suffix = "", onChange, dec, inc }: { label: string; value: number; min: number; max: number; step?: number; suffix?: string; onChange: (v: number) => void; dec: string; inc: string }) {
  return (
    <div className="opt">
      <div className="opt-head">
        <label>{label}</label>
      </div>
      <div className="stepper">
        <button onClick={() => onChange(Math.max(min, value - step))} aria-label={dec}>
          −
        </button>
        <span>
          {value}
          {suffix}
        </span>
        <button onClick={() => onChange(Math.min(max, value + step))} aria-label={inc}>
          +
        </button>
      </div>
    </div>
  );
}

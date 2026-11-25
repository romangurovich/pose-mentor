import { useMemo, useState } from "react";
import { EXERCISES, UIPRMD_MAP } from "../coach/exercises.ts";
import type { ExerciseDef, Region } from "../coach/types.ts";
import { DemoFigure } from "./demo/DemoFigure.tsx";
import { Icon } from "./icons.tsx";
import { loadHistory, type SessionResult } from "./history.ts";
import { useI18n } from "./i18n.tsx";
import { exerciseText, metricLabel } from "../i18n/index.ts";

const REGIONS: Array<Region | "all"> = ["all", "knee-hip", "shoulder", "spine-neck"];

interface Props {
  onPick: (ex: ExerciseDef) => void;
  onOpenResult: (r: SessionResult) => void;
}

export function Library({ onPick, onOpenResult }: Props) {
  const [region, setRegion] = useState<Region | "all">("all");
  const [kind, setKind] = useState<"all" | "reps" | "hold">("all");
  const [hover, setHover] = useState<string | null>(null);
  const history = useMemo(() => loadHistory().slice(0, 6), []);
  const { locale } = useI18n();
  const t = locale.ui.library;

  const list = EXERCISES.filter((e) => (region === "all" || e.region === region) && (kind === "all" || e.kind === kind));
  const calibratedCount = Object.keys(UIPRMD_MAP).length;

  return (
    <div className="library">
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">
            <Icon.Spark size={14} /> {t.eyebrow}
          </span>
          <h1>
            {t.titleLine1}
            <br />
            <em>{t.titleLine2}</em>
          </h1>
          <p className="lede">{t.lede}</p>
          <div className="hero-facts">
            <div>
              <strong>{EXERCISES.length}</strong>
              <span>{t.factExercises}</span>
            </div>
            <div>
              <strong>{calibratedCount}</strong>
              <span>{t.factCalibrated}</span>
            </div>
            <div>
              <strong>
                <Icon.Lock size={18} />
              </strong>
              <span>{t.factOnDevice}</span>
            </div>
          </div>
        </div>
        <div className="hero-visual" aria-hidden>
          <div className="hero-ring" />
          <DemoFigure spec={EXERCISES[0].demo} period={4} className="hero-figure" highlight />
          <div className="hero-chip hero-chip-a">
            <span className="dot good" /> {metricLabel(locale, "kneeFlexion")} 104°
          </div>
          <div className="hero-chip hero-chip-b">
            <Icon.Check size={14} /> {t.heroRepChip}
          </div>
        </div>
      </section>

      {history.length > 0 && (
        <section className="recent">
          <h2 className="section-title">{t.recent}</h2>
          <div className="recent-row">
            {history.map((h) => {
              const ex = EXERCISES.find((e) => e.id === h.exerciseId);
              if (!ex) return null;
              return (
                <button key={h.id} className="recent-card" onClick={() => onOpenResult(h)}>
                  <ScoreBadge score={h.formScore} />
                  <div>
                    <div className="recent-name">{exerciseText(locale, ex).name}</div>
                    <div className="recent-meta">
                      {ex.kind === "reps" ? t.repsCount(h.reps.length) : t.holdsCount(h.holds.length)} ·{" "}
                      {new Date(h.startedAt).toLocaleDateString(locale.tag, { month: "short", day: "numeric" })}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}

      <section>
        <div className="toolbar">
          <h2 className="section-title">{t.title}</h2>
          <div className="filters">
            <div className="seg" role="tablist" aria-label={t.ariaRegion}>
              {REGIONS.map((r) => (
                <button key={r} role="tab" aria-selected={region === r} className={region === r ? "on" : ""} onClick={() => setRegion(r)}>
                  {t.regions[r]}
                </button>
              ))}
            </div>
            <div className="seg" role="tablist" aria-label={t.ariaType}>
              {(["all", "reps", "hold"] as const).map((k) => (
                <button key={k} role="tab" aria-selected={kind === k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>
                  {t.kinds[k]}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="grid">
          {list.map((ex) => {
            const text = exerciseText(locale, ex);
            return (
            <button
              key={ex.id}
              className="card"
              onClick={() => onPick(ex)}
              onMouseEnter={() => setHover(ex.id)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(ex.id)}
              onBlur={() => setHover(null)}
            >
              <div className="card-stage">
                <DemoFigure spec={ex.demo} animate={hover === ex.id} className="card-figure" highlight={hover === ex.id} />
                <div className="card-badges">
                  <span className="badge">
                    {ex.view === "side" ? <Icon.Side size={13} /> : <Icon.Front size={13} />}
                    {ex.view === "side" ? t.sideView : t.faceCamera}
                  </span>
                  {ex.source.dataset && (
                    <span className="badge badge-data" title={t.calibratedFrom(ex.source.movement ?? "")}>
                      <Icon.Data size={13} /> UI-PRMD
                    </span>
                  )}
                </div>
              </div>
              <div className="card-body">
                <div className="card-title">{text.name}</div>
                <div className="card-tagline">{text.tagline}</div>
                <div className="card-meta">
                  <span>
                    {ex.kind === "reps" ? <Icon.Repeat size={14} /> : <Icon.Timer size={14} />}
                    {ex.kind === "reps" ? t.cardReps(ex.reps ?? 10) : t.cardHold(ex.holdSeconds ?? 30)}
                    {ex.bothSides ? t.eachSide : ""}
                  </span>
                  <span className="card-go">
                    {t.start} <Icon.Arrow size={14} />
                  </span>
                </div>
              </div>
            </button>
            );
          })}
        </div>
      </section>

      <footer className="foot">
        <Icon.Shield size={16} />
        <p>{t.footer}</p>
      </footer>
    </div>
  );
}

export function ScoreBadge({ score, size = 44 }: { score: number | null; size?: number }) {
  const s = score ?? 0;
  const r = size / 2 - 4;
  const c = 2 * Math.PI * r;
  const tone = score === null ? "muted" : s >= 85 ? "good" : s >= 65 ? "ok" : "low";
  return (
    <div className={`score-badge ${tone}`} style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} className="track" />
        <circle cx={size / 2} cy={size / 2} r={r} className="value" strokeDasharray={`${(c * s) / 100} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <span>{score === null ? "–" : s}</span>
    </div>
  );
}

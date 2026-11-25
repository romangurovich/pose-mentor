import { useMemo, useState } from "react";
import { EXERCISES, UIPRMD_MAP } from "../coach/exercises.ts";
import type { ExerciseDef, Region } from "../coach/types.ts";
import { DemoFigure } from "./demo/DemoFigure.tsx";
import { Icon } from "./icons.tsx";
import { loadHistory, type SessionResult } from "./history.ts";

const REGIONS: Array<{ id: Region | "all"; label: string }> = [
  { id: "all", label: "All" },
  { id: "knee-hip", label: "Knee & Hip" },
  { id: "shoulder", label: "Shoulder" },
  { id: "spine-neck", label: "Spine & Neck" },
];

interface Props {
  onPick: (ex: ExerciseDef) => void;
  onOpenResult: (r: SessionResult) => void;
}

export function Library({ onPick, onOpenResult }: Props) {
  const [region, setRegion] = useState<Region | "all">("all");
  const [kind, setKind] = useState<"all" | "reps" | "hold">("all");
  const [hover, setHover] = useState<string | null>(null);
  const history = useMemo(() => loadHistory().slice(0, 6), []);

  const list = EXERCISES.filter((e) => (region === "all" || e.region === region) && (kind === "all" || e.kind === kind));
  const calibratedCount = Object.keys(UIPRMD_MAP).length;

  return (
    <div className="library">
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">
            <Icon.Spark size={14} /> Real-time form coaching for physical rehab
          </span>
          <h1>
            Your rehab exercises,
            <br />
            <em>with a coach watching your form.</em>
          </h1>
          <p className="lede">
            Pose Mentor tracks 33 body landmarks from your webcam, measures joint angles like a clinician's goniometer, counts
            your reps and tells you what to adjust, out loud and as you move.
          </p>
          <div className="hero-facts">
            <div>
              <strong>{EXERCISES.length}</strong>
              <span>rehab exercises & stretches</span>
            </div>
            <div>
              <strong>{calibratedCount}</strong>
              <span>calibrated on the public UI-PRMD rehab-movement dataset</span>
            </div>
            <div>
              <strong>
                <Icon.Lock size={18} />
              </strong>
              <span>on-device: video never leaves your browser</span>
            </div>
          </div>
        </div>
        <div className="hero-visual" aria-hidden>
          <div className="hero-ring" />
          <DemoFigure spec={EXERCISES[0].demo} period={4} className="hero-figure" highlight />
          <div className="hero-chip hero-chip-a">
            <span className="dot good" /> Knee flexion 104°
          </div>
          <div className="hero-chip hero-chip-b">
            <Icon.Check size={14} /> Rep 6 · great depth
          </div>
        </div>
      </section>

      {history.length > 0 && (
        <section className="recent">
          <h2 className="section-title">Recent sessions</h2>
          <div className="recent-row">
            {history.map((h) => {
              const ex = EXERCISES.find((e) => e.id === h.exerciseId);
              if (!ex) return null;
              return (
                <button key={h.id} className="recent-card" onClick={() => onOpenResult(h)}>
                  <ScoreBadge score={h.formScore} />
                  <div>
                    <div className="recent-name">{ex.name}</div>
                    <div className="recent-meta">
                      {ex.kind === "reps" ? `${h.reps.length} reps` : `${h.holds.length} hold${h.holds.length === 1 ? "" : "s"}`} ·{" "}
                      {new Date(h.startedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
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
          <h2 className="section-title">Exercise library</h2>
          <div className="filters">
            <div className="seg" role="tablist" aria-label="Body region">
              {REGIONS.map((r) => (
                <button key={r.id} role="tab" aria-selected={region === r.id} className={region === r.id ? "on" : ""} onClick={() => setRegion(r.id)}>
                  {r.label}
                </button>
              ))}
            </div>
            <div className="seg" role="tablist" aria-label="Type">
              {(["all", "reps", "hold"] as const).map((k) => (
                <button key={k} role="tab" aria-selected={kind === k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>
                  {k === "all" ? "All" : k === "reps" ? "Exercises" : "Stretches & holds"}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="grid">
          {list.map((ex) => (
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
                    {ex.view === "side" ? "Side view" : "Face camera"}
                  </span>
                  {ex.source.dataset && (
                    <span className="badge badge-data" title={`Range calibrated from ${ex.source.movement}`}>
                      <Icon.Data size={13} /> UI-PRMD
                    </span>
                  )}
                </div>
              </div>
              <div className="card-body">
                <div className="card-title">{ex.name}</div>
                <div className="card-tagline">{ex.tagline}</div>
                <div className="card-meta">
                  <span>
                    {ex.kind === "reps" ? <Icon.Repeat size={14} /> : <Icon.Timer size={14} />}
                    {ex.kind === "reps" ? `${ex.reps} reps` : `${ex.holdSeconds}s hold`}
                    {ex.bothSides ? " · each side" : ""}
                  </span>
                  <span className="card-go">
                    Start <Icon.Arrow size={14} />
                  </span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </section>

      <footer className="foot">
        <Icon.Shield size={16} />
        <p>
          Pose Mentor is a proof of concept, not medical advice. Follow the plan your physical therapist gave you, and stop if
          anything hurts. Pose model: MediaPipe BlazePose (Apache-2.0). Reference ranges: UI-PRMD (Vakanski et al., 2018, public domain)
          and AAOS normative joint ranges.
        </p>
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

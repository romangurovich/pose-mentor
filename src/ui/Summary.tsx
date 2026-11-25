import { useEffect, useRef, useState } from "react";
import type { ExerciseDef } from "../coach/types.ts";
import type { RepRecord } from "../coach/engine.ts";
import { METRICS } from "../coach/metrics.ts";
import type { SessionResult } from "./history.ts";
import { ScoreBadge } from "./Library.tsx";
import { Icon } from "./icons.tsx";

interface Props {
  ex: ExerciseDef;
  result: SessionResult;
  onAgain: () => void;
  onLibrary: () => void;
}

const fmtDur = (ms: number) => {
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`;
};

export function Summary({ ex, result, onAgain, onLibrary }: Props) {
  const reps = result.reps;
  const metric = METRICS[ex.primary.metric];
  const score = result.formScore;
  const verdict =
    score === null ? "No reps recorded" : score >= 85 ? "Excellent form" : score >= 65 ? "Good — a couple of things to tidy up" : "Let's work on technique";
  const checkLabel = (id: string) => (id === "tempo" ? "Rushing the rep" : ex.checks.find((c) => c.id === id)?.label ?? id);
  const checkCue = (id: string) => (id === "tempo" ? "Take about 2 seconds each way" : ex.checks.find((c) => c.id === id)?.cue ?? "");
  const checkSeverity = (id: string) => (id === "tempo" ? "minor" : ex.checks.find((c) => c.id === id)?.severity ?? "minor");
  const tally = Object.entries(result.faultTally).sort((a, b) => b[1] - a[1]);

  const full = reps.filter((r) => r.full).length;
  const best = reps.length ? Math.max(...reps.map((r) => Math.abs(r.peak))) : null;
  const avgTempo = reps.length ? reps.reduce((a, r) => a + r.durationMs, 0) / reps.length / 1000 : null;
  const holdTotal = result.holds.reduce((a, h) => a + h.seconds, 0);

  const notes: string[] = [];
  if (tally[0]) notes.push(`Most common issue: ${checkLabel(tally[0][0]).toLowerCase()}. Focus cue: “${checkCue(tally[0][0])}”.`);
  if (ex.kind === "reps" && reps.length) {
    if (full === reps.length && result.rangeGoal < 1) notes.push(`You reached your range goal on every rep. If it felt comfortable, consider raising it from ${Math.round(result.rangeGoal * 100)}% next time (check with your therapist).`);
    else if (full < reps.length / 2) notes.push(`Fewer than half the reps reached the goal of ${Math.round(result.goalValue)}°. That's fine early in rehab; a slightly lower range goal keeps every rep controlled.`);
  }
  if (!tally.length && reps.length) notes.push("No form faults detected. Keep it up!");
  if (!result.completed) notes.push("Session ended before the planned set finished.");

  return (
    <div className="summary">
      <header className="summary-head">
        <button className="btn ghost" onClick={onLibrary}>
          <Icon.Back size={18} /> Library
        </button>
        <div className="summary-meta">
          {new Date(result.startedAt).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })} · {fmtDur(result.durationMs)}
        </div>
      </header>

      <section className="summary-hero">
        <ScoreBadge score={score} size={132} />
        <div>
          <span className="eyebrow">{result.completed ? "Set complete" : "Session summary"}</span>
          <h1>{ex.name}</h1>
          <p className="lede">{verdict}</p>
        </div>
      </section>

      <section className="tiles">
        {ex.kind === "reps" ? (
          <>
            <Tile label="Reps counted" value={String(reps.length)} sub={ex.bothSides ? `${reps.filter((r) => r.side === "left").length} left · ${reps.filter((r) => r.side === "right").length} right` : undefined} />
            <Tile label="Reached goal" value={reps.length ? `${Math.round((100 * full) / reps.length)}%` : "–"} sub={`goal ${Math.round(result.goalValue)}${result.unit}`} />
            <Tile label={`Best ${metric.label.toLowerCase()}`} value={best !== null ? `${Math.round(best)}${result.unit}` : "–"} sub={`reference ${Math.round(result.refValue)}${result.unit}`} />
            <Tile label="Avg. rep time" value={avgTempo !== null ? `${avgTempo.toFixed(1)}s` : "–"} sub="movement phase" />
          </>
        ) : (
          <>
            <Tile label="Time held" value={`${Math.round(holdTotal)}s`} sub={`${result.holds.length} side${result.holds.length === 1 ? "" : "s"}`} />
            <Tile label={`Deepest ${metric.label.toLowerCase()}`} value={result.holds.length ? `${Math.round(Math.max(...result.holds.map((h) => Math.abs(h.bestValue))))}${result.unit}` : "–"} sub={`goal ${Math.round(result.goalValue)}${result.unit}`} />
            <Tile label="Clean hold time" value={score !== null ? `${score}%` : "–"} sub="without form faults" />
          </>
        )}
      </section>

      {ex.kind === "reps" && reps.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h2>Range per rep</h2>
            <span className="panel-sub">% of your goal ({Math.round(result.goalValue)}{result.unit}) · ⚠ marks a form cue</span>
          </div>
          <RepChart reps={reps} goal={result.goalValue} unit={result.unit} bothSides={ex.bothSides} label={checkLabel} />
        </section>
      )}

      <div className="two-col">
        <section className="panel">
          <div className="panel-head">
            <h2>Form feedback</h2>
          </div>
          {tally.length === 0 ? (
            <div className="empty-good">
              <span className="card-icon good">
                <Icon.Check size={22} />
              </span>
              No form faults detected.
            </div>
          ) : (
            <ul className="faults">
              {tally.map(([id, n]) => (
                <li key={id}>
                  <span className={`status-chip ${checkSeverity(id)}`}>
                    <Icon.Alert size={14} /> {checkSeverity(id) === "major" ? "Priority" : "Tidy up"}
                  </span>
                  <div>
                    <strong>{checkLabel(id)}</strong>
                    <span>“{checkCue(id)}”</span>
                  </div>
                  <span className="fault-n">
                    {n}
                    {ex.kind === "reps" ? ` rep${n === 1 ? "" : "s"}` : "s"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>Coach's notes</h2>
          </div>
          <ul className="notes">
            {notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </section>
      </div>

      <div className="summary-actions">
        <button className="cta" onClick={onAgain}>
          <Icon.Repeat size={18} /> Do another set
        </button>
        <button className="btn" onClick={onLibrary}>
          Back to library
        </button>
      </div>
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="tile">
      <span className="tile-label">{label}</span>
      <span className="tile-value">{value}</span>
      {sub && <span className="tile-sub">{sub}</span>}
    </div>
  );
}

/** Single-series bar chart: reach (% of goal) per rep, goal line at 100%, hover tooltip. */
function RepChart({ reps, goal, unit, bothSides, label }: { reps: RepRecord[]; goal: number; unit: string; bothSides: boolean; label: (id: string) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(720);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = 240, padL = 44, padR = 12, padT = 16, padB = 46;
  const maxReach = Math.max(1.2, ...reps.map((r) => r.reach));
  const yMax = Math.ceil(maxReach * 5) / 5;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const slot = plotW / reps.length;
  const bw = Math.min(24, slot * 0.6);
  const y = (v: number) => padT + plotH * (1 - v / yMax);
  const ticks = [0, 0.5, 1, ...(yMax > 1.4 ? [1.5] : [])].filter((t) => t <= yMax);
  const hr = hover !== null ? reps[hover] : null;
  return (
    <div className="chart" ref={box} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="Range reached on each rep as a percentage of the goal">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} className={t === 0 ? "axis" : "grid"} />
            <text x={padL - 8} y={y(t)} className="tick" textAnchor="end" dominantBaseline="middle">
              {Math.round(t * 100)}%
            </text>
          </g>
        ))}
        <line x1={padL} x2={W - padR} y1={y(1)} y2={y(1)} className="goal-line" />
        <text x={W - padR} y={y(1) - 6} className="goal-label" textAnchor="end">
          Goal
        </text>
        {reps.map((r, i) => {
          const cx = padL + slot * (i + 0.5);
          const top = y(Math.max(0, r.reach));
          const h = Math.max(2, y(0) - top);
          const rr = Math.min(4, h / 2);
          const x0 = cx - bw / 2;
          const d = `M${x0} ${y(0)} V${top + rr} Q${x0} ${top} ${x0 + rr} ${top} H${x0 + bw - rr} Q${x0 + bw} ${top} ${x0 + bw} ${top + rr} V${y(0)} Z`;
          const faulty = r.faults.length > 0;
          return (
            <g key={r.index} onMouseEnter={() => setHover(i)} className={hover === i ? "bar hover" : "bar"}>
              <rect x={cx - slot / 2} y={padT} width={slot} height={plotH + padB} fill="transparent" />
              <path d={d} className="bar-fill" />
              <text x={cx} y={y(0) + 16} className="tick" textAnchor="middle">
                {bothSides ? `${r.side[0].toUpperCase()}${reps.filter((x, j) => j <= i && x.side === r.side).length}` : r.index}
              </text>
              {faulty && (
                <text x={cx} y={y(0) + 33} className="fault-mark" textAnchor="middle">
                  ⚠
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hr && hover !== null && (
        <div className="tooltip" style={{ left: `${((padL + slot * (hover + 0.5)) / W) * 100}%` }}>
          <strong>
            Rep {hr.index}
            {bothSides ? ` · ${hr.side}` : ""} · score {hr.score}
          </strong>
          <span>
            Peak {Math.round(Math.abs(hr.peak))}
            {unit} · {Math.round(hr.reach * 100)}% of goal ({Math.round(goal)}
            {unit})
          </span>
          <span>{(hr.durationMs / 1000).toFixed(1)}s movement</span>
          {hr.faults.length > 0 && <span className="tt-fault">⚠ {hr.faults.map(label).join(", ")}</span>}
        </div>
      )}
    </div>
  );
}

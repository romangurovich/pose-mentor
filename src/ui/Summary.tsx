import { useEffect, useRef, useState } from "react";
import type { ExerciseDef } from "../coach/types.ts";
import { faultInfo, type RepRecord } from "../coach/engine.ts";
import type { SessionResult } from "./history.ts";
import { ScoreBadge } from "./Library.tsx";
import { Icon } from "./icons.tsx";
import { useI18n } from "./i18n.tsx";
import { exerciseText, fmtValue, metricLabel } from "../i18n/index.ts";
import type { Locale } from "../i18n/types.ts";

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
  const score = result.formScore;
  const { locale } = useI18n();
  const t = locale.ui.summary;
  const metricName = metricLabel(locale, ex.primary.metric);
  const v = (x: number) => fmtValue(locale, x, result.unit);
  const V = locale.messages.ui.verdict;
  const verdict = score === null ? V.none : score >= 85 ? V.excellent : score >= 65 ? V.good : V.work;
  const checkLabel = (id: string) => faultInfo(ex, id, locale).label;
  const checkCue = (id: string) => faultInfo(ex, id, locale).cue;
  const checkSeverity = (id: string) => faultInfo(ex, id).severity;
  const tally = Object.entries(result.faultTally).sort((a, b) => b[1] - a[1]);

  const full = reps.filter((r) => r.full).length;
  const best = reps.length ? Math.max(...reps.map((r) => Math.abs(r.peak))) : null;
  const avgTempo = reps.length ? reps.reduce((a, r) => a + r.durationMs, 0) / reps.length / 1000 : null;
  const holdTotal = result.holds.reduce((a, h) => a + h.seconds, 0);

  const notes: string[] = [];
  if (tally[0]) notes.push(t.noteMostCommon(checkLabel(tally[0][0]), checkCue(tally[0][0])));
  if (ex.kind === "reps" && reps.length) {
    if (full === reps.length && result.rangeGoal < 1) notes.push(t.noteAllGoal(Math.round(result.rangeGoal * 100)));
    else if (full < reps.length / 2) notes.push(t.noteFewerThanHalf(v(result.goalValue)));
  }
  if (!tally.length && reps.length) notes.push(locale.messages.ui.noFaults);
  if (!result.completed) notes.push(t.noteEndedEarly);

  return (
    <div className="summary">
      <header className="summary-head">
        <button className="btn ghost" onClick={onLibrary}>
          <Icon.Back size={18} /> {t.library}
        </button>
        <div className="summary-meta">
          {new Date(result.startedAt).toLocaleString(locale.tag, { weekday: "short", hour: "numeric", minute: "2-digit" })} · {fmtDur(result.durationMs)}
        </div>
      </header>

      <section className="summary-hero">
        <ScoreBadge score={score} size={132} />
        <div>
          <span className="eyebrow">{result.completed ? t.setComplete : t.sessionSummary}</span>
          <h1>{exerciseText(locale, ex).name}</h1>
          <p className="lede">{verdict}</p>
        </div>
      </section>

      <section className="tiles">
        {ex.kind === "reps" ? (
          <>
            <Tile label={t.repsCounted} value={String(reps.length)} sub={ex.bothSides ? t.leftRight(reps.filter((r) => r.side === "left").length, reps.filter((r) => r.side === "right").length) : undefined} />
            <Tile label={t.reachedGoal} value={reps.length ? fmtValue(locale, (100 * full) / reps.length, "%") : "–"} sub={t.goalSub(v(result.goalValue))} />
            <Tile label={t.best(metricName)} value={best !== null ? v(best) : "–"} sub={t.referenceSub(v(result.refValue))} />
            <Tile label={t.avgRepTime} value={avgTempo !== null ? `${avgTempo.toLocaleString(locale.tag, { maximumFractionDigits: 1, minimumFractionDigits: 1 })} s` : "–"} sub={t.movementPhase} />
          </>
        ) : (
          <>
            <Tile label={t.timeHeld} value={`${Math.round(holdTotal)} s`} sub={t.sidesCount(result.holds.length)} />
            <Tile label={t.deepest(metricName)} value={result.holds.length ? v(Math.max(...result.holds.map((h) => Math.abs(h.bestValue)))) : "–"} sub={t.goalSub(v(result.goalValue))} />
            <Tile label={t.cleanHoldTime} value={score !== null ? fmtValue(locale, score, "%") : "–"} sub={t.withoutFaults} />
          </>
        )}
      </section>

      {ex.kind === "reps" && reps.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h2>{t.rangePerRep}</h2>
            <span className="panel-sub">{t.rangePerRepSub(v(result.goalValue))}</span>
          </div>
          <RepChart reps={reps} goal={result.goalValue} unit={result.unit} bothSides={ex.bothSides} label={checkLabel} locale={locale} />
        </section>
      )}

      <div className="two-col">
        <section className="panel">
          <div className="panel-head">
            <h2>{t.formFeedback}</h2>
          </div>
          {tally.length === 0 ? (
            <div className="empty-good">
              <span className="card-icon good">
                <Icon.Check size={22} />
              </span>
              {t.noFaults}
            </div>
          ) : (
            <ul className="faults">
              {tally.map(([id, n]) => (
                <li key={id}>
                  <span className={`status-chip ${checkSeverity(id)}`}>
                    <Icon.Alert size={14} /> {checkSeverity(id) === "major" ? t.priority : t.tidyUp}
                  </span>
                  <div>
                    <strong>{checkLabel(id)}</strong>
                    <span>“{checkCue(id)}”</span>
                  </div>
                  <span className="fault-n">{t.faultCount(n, ex.kind)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>{t.coachNotes}</h2>
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
          <Icon.Repeat size={18} /> {t.again}
        </button>
        <button className="btn" onClick={onLibrary}>
          {t.backToLibrary}
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
function RepChart({ reps, goal, unit, bothSides, label, locale }: { reps: RepRecord[]; goal: number; unit: string; bothSides: boolean; label: (id: string) => string; locale: Locale }) {
  const t = locale.ui.summary;
  const v = (x: number) => fmtValue(locale, x, unit);
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
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={t.chartAria}>
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={padL} x2={W - padR} y1={y(tick)} y2={y(tick)} className={tick === 0 ? "axis" : "grid"} />
            <text x={padL - 8} y={y(tick)} className="tick" textAnchor="end" dominantBaseline="middle">
              {fmtValue(locale, tick * 100, "%")}
            </text>
          </g>
        ))}
        <line x1={padL} x2={W - padR} y1={y(1)} y2={y(1)} className="goal-line" />
        <text x={W - padR} y={y(1) - 6} className="goal-label" textAnchor="end">
          {t.chartGoal}
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
                {bothSides ? `${t.sideInitial[r.side]}${reps.filter((x, j) => j <= i && x.side === r.side).length}` : r.index}
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
          <strong>{t.tipTitle(hr.index, bothSides ? locale.messages.side[hr.side] : null, hr.score)}</strong>
          <span>{t.tipPeak(v(Math.abs(hr.peak)), Math.round(hr.reach * 100), v(goal))}</span>
          <span>{t.tipMovement((hr.durationMs / 1000).toLocaleString(locale.tag, { maximumFractionDigits: 1, minimumFractionDigits: 1 }))}</span>
          {hr.faults.length > 0 && <span className="tt-fault">⚠ {hr.faults.map(label).join(", ")}</span>}
        </div>
      )}
    </div>
  );
}

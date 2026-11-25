import { useEffect, useRef, useState } from "react";
import { demoFrame, GROUND_Y, type DemoSpec, type FigureGeometry } from "./figure.ts";

// one shared animation clock for every figure on the page
const subscribers = new Set<(t: number) => void>();
let raf = 0;
function tick(now: number) {
  for (const s of subscribers) s(now);
  raf = subscribers.size ? requestAnimationFrame(tick) : 0;
}
function useClock(active: boolean): number {
  const [t, setT] = useState(0);
  useEffect(() => {
    if (!active) return;
    const fn = (now: number) => setT(now);
    subscribers.add(fn);
    if (!raf) raf = requestAnimationFrame(tick);
    return () => {
      subscribers.delete(fn);
    };
  }, [active]);
  return t;
}

const reduceMotion = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

interface Props {
  spec: DemoSpec;
  /** seconds per loop */
  period?: number;
  animate?: boolean;
  className?: string;
  highlight?: boolean;
}

const path = (pts: { x: number; y: number }[]) => pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");

export function DemoFigure({ spec, period = 3.6, animate = true, className, highlight }: Props) {
  const run = animate && !reduceMotion;
  const now = useClock(run);
  const offset = useRef(Math.random() * 1000);
  const phase = run ? (((now / 1000 + offset.current) % period) / period) : spec.mode === "hold" ? 0.8 : 0.5;
  const g: FigureGeometry = demoFrame(spec, phase);
  const props = (spec.props ?? []) as string[];
  const stroke = highlight ? "var(--accent)" : "var(--figure)";

  return (
    <svg className={className} viewBox="-110 -24 220 224" role="img" aria-label="Exercise demonstration" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="floor" x1="0" x2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0" />
          <stop offset="0.5" stopColor="currentColor" stopOpacity="0.35" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="shadow">
          <stop offset="0" stopColor="#000" stopOpacity="0.45" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx={0} cy={GROUND_Y + 4} rx={46} ry={5} fill="url(#shadow)" />
      <line x1={-105} x2={105} y1={GROUND_Y + 4} y2={GROUND_Y + 4} stroke="url(#floor)" strokeWidth={1.5} className="demo-floor" />
      {props.includes("chair") && (
        <g className="demo-prop">
          <path d={`M-38 ${GROUND_Y - 90} h32 M-38 ${GROUND_Y - 90} v-44 M-36 ${GROUND_Y - 90} v94 M-8 ${GROUND_Y - 90} v94`} />
        </g>
      )}
      {props.includes("wall") && (
        <g className="demo-prop">
          <path d={`M-30 -6 V${GROUND_Y + 4}`} />
        </g>
      )}
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        {g.limbs.map((l, i) => (
          <path key={i} d={path(l.pts)} stroke={stroke} strokeOpacity={l.far ? 0.35 : 1} strokeWidth={l.far ? 5.5 : 6.5} />
        ))}
        <path d={path(g.torso)} stroke={stroke} strokeWidth={8} />
      </g>
      <circle cx={g.head.x} cy={g.head.y} r={g.headR} fill={stroke} />
      {g.joints.map((j, i) => (
        <circle key={i} cx={j.x} cy={j.y} r={j.far ? 2.2 : 2.8} fill="var(--figure-joint)" opacity={j.far ? 0.5 : 1} />
      ))}
    </svg>
  );
}

/** Canvas renderer for the live skeleton, fault highlights and the primary-angle arc. */
import { BONES, BODY_POINTS, idx, type PoseFrame, type Side, type Vec2 } from "../pose/landmarks.ts";
import { angleAt } from "../pose/geometry.ts";
import type { CoachState } from "../coach/engine.ts";
import type { ExerciseDef } from "../coach/types.ts";

export interface Layout {
  /** CSS px of the canvas */
  width: number;
  height: number;
  /** where the video content sits inside the canvas (object-fit: contain) */
  offX: number;
  offY: number;
  /** px per frame-height */
  scale: number;
  mirror: boolean;
}

export const COLORS = {
  accent: "#5eead4",
  accentDeep: "#14b8a6",
  good: "#4ade80",
  minor: "#fbbf24",
  major: "#fb7185",
  bone: "rgba(226,232,240,0.55)",
  boneDim: "rgba(226,232,240,0.28)",
};

const SIDE_JOINTS = (side: Side) => new Set(["shoulder", "elbow", "wrist", "hip", "knee", "ankle", "heel", "toe"].map((j) => idx(j as never, side)));

export function computeLayout(cw: number, ch: number, vw: number, vh: number, mirror: boolean): Layout {
  const s = Math.min(cw / vw, ch / vh);
  const w = vw * s, h = vh * s;
  return { width: cw, height: ch, offX: (cw - w) / 2, offY: (ch - h) / 2, scale: h, mirror };
}

function toPx(p: Vec2, L: Layout): Vec2 {
  const x = L.offX + p.x * L.scale;
  return { x: L.mirror ? L.width - x : x, y: L.offY + p.y * L.scale };
}

export function drawOverlay(ctx: CanvasRenderingContext2D, frame: PoseFrame | null, st: CoachState | null, ex: ExerciseDef, L: Layout, now: number) {
  ctx.clearRect(0, 0, L.width, L.height);
  if (!frame) return;
  const P = frame.pts.map((p) => toPx(p, L));
  const vis = frame.vis;
  const lw = Math.max(3, L.scale * 0.0075);
  const tracked = st && (st.status === "ready" || st.status === "active" || st.status === "switch" || st.status === "done");
  const assessed = st ? SIDE_JOINTS(st.side) : new Set<number>();
  const hl = st?.highlight ?? new Map<number, "major" | "minor">();
  const sevColor = (s: "major" | "minor") => (s === "major" ? COLORS.major : COLORS.minor);

  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // bones
  for (const [a, b] of BONES) {
    if (vis[a] < 0.35 || vis[b] < 0.35) continue;
    const ha = hl.get(a), hb = hl.get(b);
    const sev = ha === "major" || hb === "major" ? "major" : ha || hb ? "minor" : null;
    let color = tracked ? COLORS.bone : COLORS.boneDim;
    let width = lw;
    if (tracked && assessed.has(a) && assessed.has(b)) {
      color = COLORS.accent;
      width = lw * 1.25;
    }
    if (sev) {
      color = sevColor(sev);
      width = lw * 1.4;
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.shadowColor = color;
    ctx.shadowBlur = sev ? 18 : tracked ? 10 : 0;
    ctx.globalAlpha = Math.min(1, (vis[a] + vis[b]) / 1.4);
    ctx.beginPath();
    ctx.moveTo(P[a].x, P[a].y);
    ctx.lineTo(P[b].x, P[b].y);
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;

  // joints
  for (const i of BODY_POINTS) {
    if (vis[i] < 0.35) continue;
    const sev = hl.get(i);
    const r = lw * (sev ? 1.6 : 1.15);
    if (sev) {
      const pulse = 0.5 + 0.5 * Math.sin(now / 160);
      ctx.beginPath();
      ctx.arc(P[i].x, P[i].y, r * (2.2 + pulse * 1.4), 0, Math.PI * 2);
      ctx.fillStyle = sev === "major" ? "rgba(251,113,133,0.18)" : "rgba(251,191,36,0.18)";
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(P[i].x, P[i].y, r, 0, Math.PI * 2);
    ctx.fillStyle = "#0b1016";
    ctx.fill();
    ctx.lineWidth = Math.max(2, lw * 0.6);
    ctx.strokeStyle = sev ? sevColor(sev) : tracked && assessed.has(i) ? COLORS.accent : "rgba(226,232,240,0.8)";
    ctx.stroke();
  }

  if (tracked && st && ex.primary.arc) drawArc(ctx, P, vis, st, ex, lw);
}

function drawArc(ctx: CanvasRenderingContext2D, P: Vec2[], vis: number[], st: CoachState, ex: ExerciseDef, lw: number) {
  const [ja, jb, jc] = ex.primary.arc!;
  const a = P[idx(ja, st.side)], b = P[idx(jb, st.side)], c = P[idx(jc, st.side)];
  if ([idx(ja, st.side), idx(jb, st.side), idx(jc, st.side)].some((i) => vis[i] < 0.4)) return;
  if (Math.abs(st.value) < 8) return; // nothing meaningful to show near the start position
  const interior = angleAt(a, b, c);
  // draw either the interior angle or its deviation from straight, whichever the metric reports
  const value = Math.abs(st.value);
  const deviation = Math.abs(180 - interior - value) < Math.abs(interior - value);
  const ref = deviation ? { x: 2 * b.x - a.x, y: 2 * b.y - a.y } : a;
  let a0 = Math.atan2(ref.y - b.y, ref.x - b.x);
  let a1 = Math.atan2(c.y - b.y, c.x - b.x);
  let d = a1 - a0;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  if (d < 0) [a0, a1] = [a1, a0];
  const r = Math.max(28, lw * 9);
  const reached = st.progress >= 0.95;
  const col = reached ? COLORS.good : COLORS.accent;

  ctx.beginPath();
  ctx.moveTo(b.x, b.y);
  ctx.arc(b.x, b.y, r, a0, a0 + Math.abs(d));
  ctx.closePath();
  ctx.fillStyle = reached ? "rgba(74,222,128,0.2)" : "rgba(94,234,212,0.16)";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(b.x, b.y, r, a0, a0 + Math.abs(d));
  ctx.strokeStyle = col;
  ctx.lineWidth = Math.max(2, lw * 0.6);
  ctx.stroke();

  // value pill on the bisector
  const mid = a0 + Math.abs(d) / 2;
  const lx = b.x + Math.cos(mid) * (r + 30), ly = b.y + Math.sin(mid) * (r + 30);
  const text = `${Math.round(st.value)}°`;
  ctx.font = `600 ${Math.max(14, Math.round(lw * 4.2))}px "Inter Variable", system-ui, sans-serif`;
  const tw = ctx.measureText(text).width;
  const ph = Math.max(24, lw * 7), pw = tw + ph * 0.8;
  ctx.fillStyle = "rgba(11,16,22,0.82)";
  roundRect(ctx, lx - pw / 2, ly - ph / 2, pw, ph, ph / 2);
  ctx.fill();
  ctx.strokeStyle = col;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = "#f1f5f9";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, lx, ly + 1);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

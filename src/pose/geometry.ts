import type { Vec2 } from "./landmarks.ts";

export const RAD2DEG = 180 / Math.PI;

export function mid(a: Vec2, b: Vec2): Vec2 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Interior angle ABC at vertex B, degrees in [0, 180]. */
export function angleAt(a: Vec2, b: Vec2, c: Vec2): number {
  const ux = a.x - b.x, uy = a.y - b.y;
  const vx = c.x - b.x, vy = c.y - b.y;
  const n = Math.hypot(ux, uy) * Math.hypot(vx, vy);
  if (n < 1e-9) return 0;
  return Math.acos(clamp((ux * vx + uy * vy) / n, -1, 1)) * RAD2DEG;
}

/**
 * Angle of the segment from→to measured from straight DOWN (image y grows downward), in degrees.
 * Positive when `to` lies on the +x side of `from` multiplied by `sign` (use the facing direction to
 * make "forward" positive). Range (-180, 180].
 */
export function signedFromDown(from: Vec2, to: Vec2, sign: number): number {
  const dx = (to.x - from.x) * sign;
  const dy = to.y - from.y;
  return Math.atan2(dx, dy) * RAD2DEG;
}

/** Angle of from→to measured from straight UP, signed like {@link signedFromDown}. */
export function signedFromUp(from: Vec2, to: Vec2, sign: number): number {
  const dx = (to.x - from.x) * sign;
  const dy = from.y - to.y;
  return Math.atan2(dx, dy) * RAD2DEG;
}

/**
 * Tilt of the line a→b away from horizontal, in degrees, positive when `a` sits LOWER than `b`
 * on screen. Independent of left/right ordering. Range [-90, 90].
 */
export function tiltDown(a: Vec2, b: Vec2): number {
  return Math.atan2(a.y - b.y, Math.abs(a.x - b.x)) * RAD2DEG;
}

/**
 * One Euro filter (Casiez et al., CHI 2012): an adaptive low-pass filter that removes jitter when
 * a landmark is still but keeps lag low when it moves fast. Units here are frame-heights and
 * seconds.
 */
import type { PoseFrame, Vec2 } from "./landmarks.ts";

class LowPass {
  private y: number | null = null;
  filter(x: number, alpha: number): number {
    this.y = this.y === null ? x : this.y + alpha * (x - this.y);
    return this.y;
  }
  get last() {
    return this.y;
  }
  reset() {
    this.y = null;
  }
}

const alpha = (cutoff: number, dt: number) => {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
};

export class OneEuro {
  private x = new LowPass();
  private dx = new LowPass();
  private minCutoff: number;
  private beta: number;
  private dCutoff: number;
  constructor(minCutoff = 1.4, beta = 3.0, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }
  filter(value: number, dt: number): number {
    const prev = this.x.last;
    const d = prev === null || dt <= 0 ? 0 : (value - prev) / dt;
    const edx = this.dx.filter(d, alpha(this.dCutoff, Math.max(dt, 1e-3)));
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    return this.x.filter(value, alpha(cutoff, Math.max(dt, 1e-3)));
  }
  reset() {
    this.x.reset();
    this.dx.reset();
  }
}

/** Filters every landmark of a pose stream; resets itself after tracking gaps. */
export class PoseSmoother {
  private fx: OneEuro[] = [];
  private fy: OneEuro[] = [];
  private fv: OneEuro[] = [];
  private lastT: number | null = null;
  private minCutoff: number;
  private beta: number;

  constructor(minCutoff = 1.4, beta = 3.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
  }

  reset() {
    this.fx = [];
    this.fy = [];
    this.fv = [];
    this.lastT = null;
  }

  apply(frame: PoseFrame): PoseFrame {
    if (this.lastT !== null && frame.t - this.lastT > 500) this.reset();
    const dt = this.lastT === null ? 1 / 30 : Math.max(1e-3, (frame.t - this.lastT) / 1000);
    this.lastT = frame.t;
    const pts: Vec2[] = new Array(frame.pts.length);
    const vis: number[] = new Array(frame.pts.length);
    for (let i = 0; i < frame.pts.length; i++) {
      if (!this.fx[i]) {
        this.fx[i] = new OneEuro(this.minCutoff, this.beta);
        this.fy[i] = new OneEuro(this.minCutoff, this.beta);
        this.fv[i] = new OneEuro(2, 0);
      }
      pts[i] = { x: this.fx[i].filter(frame.pts[i].x, dt), y: this.fy[i].filter(frame.pts[i].y, dt) };
      vis[i] = this.fv[i].filter(frame.vis[i], dt);
    }
    return { t: frame.t, pts, vis };
  }
}

/** Shared helpers: which camera/side to use when replaying a UI-PRMD episode for an exercise. */
import type { ExerciseDef } from "../../src/coach/types.ts";
import type { PoseFrame, Side } from "../../src/pose/landmarks.ts";
import { METRICS, detectFacing } from "../../src/coach/metrics.ts";
import { movingSide, projectEpisode } from "./project.ts";
import type { Episode } from "./uiprmd.ts";

export interface Replay {
  frames: PoseFrame[];
  side: Side;
  facing: number;
}

export function replay(ex: ExerciseDef, ep: Episode, noise = 0): Replay {
  const limb = ex.region === "shoulder" ? "arm" : "leg";
  let side: Side;
  let cameraSide: Side | undefined;
  if (ex.sidePick === "active") {
    // same rule as the engine: the limb that travels furthest through the exercise's range
    const dir = Math.sign(ex.primary.target - ex.primary.start) || 1;
    const view = ex.view;
    const excursion = (s: Side) => {
      const fr = projectEpisode(ep, { view, cameraSide: view === "side" ? s : undefined });
      const fc = view === "side" ? detectFacing(fr[0]) || 1 : 1;
      const v = fr.map((f) => METRICS[ex.primary.metric].fn({ pts: f.pts, vis: f.vis, side: s, facing: fc }) * dir);
      return Math.max(...v) - v[0];
    };
    side = excursion("left") > excursion("right") ? "left" : excursion("left") < excursion("right") ? "right" : movingSide(ep, limb);
    cameraSide = side;
  } else {
    cameraSide = ep.subject % 2 ? "right" : "left"; // alternate to exercise both facings
    side = cameraSide;
  }
  const frames = projectEpisode(ep, { view: ex.view, cameraSide: ex.view === "side" ? cameraSide : undefined, noise, seed: ep.subject * 100 + ep.episode });
  const facing = ex.view === "side" ? (detectFacing(frames[0]) || 1) : 1;
  if (ex.sidePick === "front-foot") {
    // the front leg at the deepest point of the lunge
    const knee = (f: PoseFrame, s: Side) => METRICS.kneeFlexion.fn({ pts: f.pts, vis: f.vis, side: s, facing });
    let deepest = frames[0];
    for (const f of frames) if (knee(f, "left") + knee(f, "right") > knee(deepest, "left") + knee(deepest, "right")) deepest = f;
    const ax = (s: Side) => deepest.pts[s === "left" ? 27 : 28].x * facing;
    side = ax("left") > ax("right") ? "left" : "right";
  }
  return { frames, side, facing };
}

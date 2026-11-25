import type { HoldRecord, RepRecord } from "../coach/engine.ts";

export interface SessionResult {
  id: string;
  exerciseId: string;
  startedAt: number;
  durationMs: number;
  rangeGoal: number;
  goalValue: number;
  refValue: number;
  unit: string;
  reps: RepRecord[];
  holds: HoldRecord[];
  /** check id → number of reps (or seconds for holds) it fired */
  faultTally: Record<string, number>;
  formScore: number | null;
  completed: boolean;
}

const KEY = "pose-mentor.history.v1";

export function loadHistory(): SessionResult[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as SessionResult[];
  } catch {
    return [];
  }
}

export function saveSession(s: SessionResult) {
  const all = [s, ...loadHistory().filter((x) => x.id !== s.id)].slice(0, 50);
  localStorage.setItem(KEY, JSON.stringify(all));
}

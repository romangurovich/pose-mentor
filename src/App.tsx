import { useCallback, useState } from "react";
import { EXERCISES, getExercise } from "./coach/exercises.ts";
import type { ExerciseDef } from "./coach/types.ts";
import { Library } from "./ui/Library.tsx";
import { SetupSheet, loadPrefs, type SessionConfig } from "./ui/SetupSheet.tsx";
import { Session } from "./ui/Session.tsx";
import { Summary } from "./ui/Summary.tsx";
import { saveSession, type SessionResult } from "./ui/history.ts";
import { Icon } from "./ui/icons.tsx";
import { SettingsPicker } from "./ui/SettingsPicker.tsx";
import { useI18n } from "./ui/i18n.tsx";

type View =
  | { name: "library"; setup?: ExerciseDef }
  | { name: "session"; ex: ExerciseDef; cfg: SessionConfig; key: number }
  | { name: "summary"; ex: ExerciseDef; result: SessionResult; cfg?: SessionConfig };

/** Deep link: ?exercise=squat[&video=/clip.webm][&goal=0.8] starts a session directly (handy for demos and e2e tests). */
function initialView(): View {
  const q = new URLSearchParams(location.search);
  const id = q.get("exercise");
  const ex = id ? EXERCISES.find((e) => e.id === id) : undefined;
  if (!ex) return { name: "library" };
  const prefs = loadPrefs();
  const cfg: SessionConfig = {
    rangeGoal: Number(q.get("goal") ?? prefs.rangeGoal ?? 0.8),
    reps: Number(q.get("reps") ?? ex.reps ?? 10),
    holdSeconds: ex.holdSeconds ?? 30,
    startSide: "auto",
    voice: q.get("voice") !== "0" && (prefs.voice ?? true),
    model: (q.get("model") as SessionConfig["model"]) ?? prefs.model ?? "full",
  };
  return { name: "session", ex, cfg, key: 0 };
}

export function App() {
  const [view, setView] = useState<View>(initialView);
  const { locale } = useI18n();

  const finish = useCallback((ex: ExerciseDef, cfg: SessionConfig, result: SessionResult | null) => {
    if (result && (result.reps.length || result.holds.length)) {
      saveSession(result);
      setView({ name: "summary", ex, result, cfg });
    } else setView({ name: "library" });
  }, []);

  if (view.name === "session") {
    return <Session key={view.key} ex={view.ex} cfg={view.cfg} onExit={(r) => finish(view.ex, view.cfg, r)} />;
  }

  return (
    <div className="app">
      <nav className="nav">
        <button className="brand" onClick={() => setView({ name: "library" })}>
          <span className="brand-mark">
            <Icon.Logo size={18} />
          </span>
          Pose Mentor
        </button>
        <div className="nav-right">
          <SettingsPicker />
          <span className="nav-note">
            <Icon.Lock size={14} /> {locale.ui.nav.runsOnDevice}
          </span>
        </div>
      </nav>
      <main>
        {view.name === "library" && (
          <>
            <Library onPick={(ex) => setView({ name: "library", setup: ex })} onOpenResult={(r) => setView({ name: "summary", ex: getExercise(r.exerciseId), result: r })} />
            {view.setup && (
              <SetupSheet
                ex={view.setup}
                onClose={() => setView({ name: "library" })}
                onStart={(cfg) => setView({ name: "session", ex: view.setup!, cfg, key: Date.now() })}
              />
            )}
          </>
        )}
        {view.name === "summary" && (
          <Summary
            ex={view.ex}
            result={view.result}
            onLibrary={() => setView({ name: "library" })}
            onAgain={() => (view.cfg ? setView({ name: "session", ex: view.ex, cfg: view.cfg, key: Date.now() }) : setView({ name: "library", setup: view.ex }))}
          />
        )}
      </main>
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import type { PlannerKind, Project, VideoSettings } from "../shared/schema";
import { api, type RenderFile, type Status } from "./api";
import { t } from "./i18n";
import { StoryStep } from "./components/StoryStep";
import { StoryboardStep } from "./components/StoryboardStep";
import { RenderStep } from "./components/RenderStep";

type Step = 0 | 1 | 2;
type SaveState = "saved" | "saving" | "dirty" | "error";

export function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [projects, setProjects] = useState<{ id: string; title: string; updatedAt: string }[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [renders, setRenders] = useState<RenderFile[]>([]);
  const [step, setStep] = useState<Step>(0);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ kind: "info" | "warn" | "error"; text: string } | null>(null);
  const [save, setSave] = useState<SaveState>("saved");
  const [menu, setMenu] = useState(false);
  const saveTimer = useRef<number>(0);
  const latest = useRef<Project | null>(null);

  const refreshList = () => api.list().then((r) => setProjects(r.projects)).catch(() => {});

  useEffect(() => {
    // API may still be starting when the page loads (npm run dev starts both at once): retry briefly.
    let cancelled = false;
    const loadStatus = async () => {
      for (let attempt = 0; ; attempt++) {
        try {
          const s = await api.status();
          if (cancelled) return;
          setStatus(s);
          setToast(null);
          refreshList();
          return;
        } catch (e) {
          if (cancelled) return;
          if (attempt >= 10) {
            setToast({ kind: "error", text: `Sunucuya ulaşılamadı: ${(e as Error).message}` });
            return;
          }
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    };
    loadStatus();
    const id = new URLSearchParams(location.search).get("p");
    if (id) open(id);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flush = useCallback(async () => {
    window.clearTimeout(saveTimer.current);
    const p = latest.current;
    if (!p) return;
    setSave("saving");
    try {
      await api.save(p);
      setSave("saved");
    } catch (e) {
      setSave("error");
      setToast({ kind: "error", text: (e as Error).message });
      throw e;
    }
  }, []);

  const update = (p: Project) => {
    setProject(p);
    latest.current = p;
    setSave("dirty");
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => flush().catch(() => {}), 700);
  };

  async function open(id: string) {
    try {
      const r = await api.get(id);
      setProject(r.project);
      latest.current = r.project;
      setRenders(r.renders);
      setSave("saved");
      setStep(r.renders.length ? 2 : 1);
      history.replaceState(null, "", `?p=${id}`);
    } catch (e) {
      setToast({ kind: "error", text: (e as Error).message });
    }
  }

  const create = async (story: string, settings: VideoSettings, planner: PlannerKind) => {
    setBusy(true);
    setToast(null);
    try {
      const r = await api.create(story, settings, planner);
      setProject(r.project);
      latest.current = r.project;
      setRenders([]);
      setStep(1);
      history.replaceState(null, "", `?p=${r.project.id}`);
      if (r.warning) setToast({ kind: "warn", text: r.warning });
      else if (r.notice) setToast({ kind: "info", text: r.notice });
      refreshList();
    } catch (e) {
      setToast({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const regenerate = async (index: number, instruction: string) => {
    if (!project) return;
    try {
      await flush();
      const planner = project.planner !== "offline" && status?.planners[project.planner] ? project.planner : "offline";
      const r = await api.regenerate(project.id, index, instruction, planner);
      const cur = latest.current ?? project;
      update({ ...cur, scenes: cur.scenes.map((s, i) => (i === index ? r.scene : s)) });
      if (r.warning) setToast({ kind: "warn", text: r.warning });
    } catch (e) {
      setToast({ kind: "error", text: (e as Error).message });
    }
  };

  // Going to the video step approves every scene: the storyboard is reviewed by moving on.
  const goToVideo = () => {
    const cur = latest.current ?? project;
    if (cur && cur.scenes.some((s) => !s.approved)) update({ ...cur, scenes: cur.scenes.map((s) => ({ ...s, approved: true })) });
    flush().then(() => setStep(2)).catch(() => {});
  };

  // Generated backgrounds are saved by the server; only the scene's `background` is merged into
  // the page's copy, so edits made while the image was generating are kept.
  const setBackground = (sceneId: string, background: Project["scenes"][number]["background"]) => {
    const cur = latest.current ?? project;
    if (!cur) return;
    const next = { ...cur, scenes: cur.scenes.map((s) => (s.id === sceneId ? { ...s, background } : s)) };
    setProject(next);
    latest.current = next;
  };

  const generateBackground = async (index: number, prompt: string) => {
    if (!project) return;
    try {
      await flush();
      const r = await api.generateBackground(project.id, index, prompt);
      setBackground(r.scene.id, r.scene.background);
      setToast({ kind: "info", text: r.reused ? t.bgReused : t.bgDone });
    } catch (e) {
      setToast({ kind: "error", text: (e as Error).message });
    }
  };

  const removeBackground = async (index: number) => {
    if (!project) return;
    try {
      const r = await api.removeBackground(project.id, index);
      setBackground(r.scene.id, undefined);
    } catch (e) {
      setToast({ kind: "error", text: (e as Error).message });
    }
  };

  const reset = () => {
    setProject(null);
    latest.current = null;
    setStep(0);
    history.replaceState(null, "", location.pathname);
  };

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={reset} title={t.newProject}>
          <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden>
            <circle cx="16" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="2.4" />
            <path d="M16 11.5v10M16 14l-6 5M16 14l6-3M16 21.5l-5 8M16 21.5l5 8" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" fill="none" />
          </svg>
          <span>{t.appName}</span>
        </button>

        <nav aria-label="Adımlar">
          <ol className="stepper">
            {t.steps.map((label, i) => {
              const current = project ? step : 0;
              return (
                <li key={label}>
                  <button
                    className={current === i ? "on" : current > i ? "done" : ""}
                    disabled={!project || i === 0}
                    aria-current={current === i ? "step" : undefined}
                    onClick={() => (i === 2 ? goToVideo() : setStep(i as Step))}
                  >
                    <span className="num">{i + 1}</span>
                    {label}
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <div className="top-actions">
          {project && (
            <span className={`save ${save}`}>
              {save === "saved" ? t.saved : save === "saving" || save === "dirty" ? t.saving : t.unsaved}
            </span>
          )}
          {project && (
            <span className="chip">{t.plannerBadge[project.planner]}</span>
          )}
          <div className="menu-wrap">
            <button className="outline" aria-expanded={menu} onClick={() => setMenu(!menu)}>{t.myProjects} ▾</button>
            {menu && (
              <div className="menu" onMouseLeave={() => setMenu(false)} onKeyDown={(e) => e.key === "Escape" && setMenu(false)}>
                <button className="menu-new" onClick={() => { setMenu(false); reset(); }}>+ {t.newProject}</button>
                {projects.length === 0 && <span className="muted small pad">{t.noProjects}</span>}
                {projects.map((p) => (
                  <button key={p.id} onClick={() => { setMenu(false); open(p.id); }}>
                    {p.title}
                    <span className="muted small">{new Date(p.updatedAt).toLocaleString("tr")}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>

      {toast && (
        <button className={`toast ${toast.kind}`} onClick={() => setToast(null)} role={toast.kind === "error" ? "alert" : "status"}>
          {toast.text}
          <span className="close" aria-label="Kapat">×</span>
        </button>
      )}

      <div className="content">
        {!project && <StoryStep status={status} busy={busy} onCreate={create} />}
        {project && step === 1 && (
          <StoryboardStep
            project={project}
            onChange={update}
            onRegenerate={regenerate}
            onNext={goToVideo}
            imageService={status?.assets?.provider ?? null}
            onBackground={generateBackground}
            onRemoveBackground={removeBackground}
          />
        )}
        {project && step === 2 && (
          <RenderStep
            project={project}
            renders={renders}
            beforeRender={flush}
            onBack={() => setStep(1)}
            onRendered={() => api.get(project.id).then((r) => setRenders(r.renders))}
          />
        )}
      </div>
    </div>
  );
}

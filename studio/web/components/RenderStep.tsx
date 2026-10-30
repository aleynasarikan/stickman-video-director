import { useEffect, useRef, useState } from "react";
import type { Project } from "../../shared/schema";
import { api, type Job, type RenderFile } from "../api";
import { t } from "../i18n";

interface Props {
  project: Project;
  renders: RenderFile[];
  onRendered: () => void;
  onBack: () => void;
  /** Flushes unsaved storyboard edits before rendering. */
  beforeRender: () => Promise<void>;
}

export function RenderStep({ project, renders, onRendered, onBack, beforeRender }: Props) {
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number>(0);
  const pending = project.scenes.filter((s) => !s.approved).length;
  const latest = job?.result?.url ?? renders[0]?.url;
  const latestSrt = job?.result?.srtUrl ?? renders[0]?.srtUrl;

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const poll = (id: string) => {
    timer.current = window.setTimeout(async () => {
      try {
        const j = await api.job(id);
        setJob(j);
        if (j.status === "running") poll(id);
        else if (j.status === "done") onRendered();
        else setError(j.error ?? t.error);
      } catch (e) {
        setError((e as Error).message);
      }
    }, 600);
  };

  const start = async (preview = false) => {
    setError(null);
    try {
      await beforeRender();
      const { jobId } = await api.render(project.id, preview);
      setJob({ id: jobId, status: "running", phase: "queued", progress: 0 });
      poll(jobId);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const running = job?.status === "running";

  return (
    <div className="render-step">
      <section className="panel render-panel">
        <div className="panel-head">
          <h2>{project.title}</h2>
          <button className="ghost" onClick={onBack}>← {t.back}</button>
        </div>
        <p className="muted">
          {project.scenes.length} sahne · {project.settings.aspect} · {project.settings.voiceover ? t.voiceover : "Sessiz"}
          {project.settings.subtitles ? ` · ${t.subtitles}` : ""}
        </p>

        {pending > 0 && <div className="alert warn">{t.approvalNeeded(pending)}</div>}

        {running && job && (
          <div className="progress">
            <div className="progress-label">
              <span>{t.phases[job.phase] ?? t.rendering}</span>
              <span>{Math.round(job.progress * 100)}%</span>
            </div>
            <div className="bar"><div style={{ width: `${Math.round(job.progress * 100)}%` }} /></div>
          </div>
        )}
        {error && <div className="alert error">{error}</div>}

        <div className="btn-row">
          <button className="ghost big" disabled={pending > 0 || running} onClick={() => start(true)}>
            {t.preview}
          </button>
          <button className="primary big" disabled={pending > 0 || running} onClick={() => start(false)}>
            {running ? t.rendering : latest ? t.rerender : t.render}
          </button>
        </div>

        {latest && !running && (
          <div className="result">
            <video
              key={latest}
              src={latest}
              controls
              className={project.settings.aspect === "9:16" ? "portrait" : ""}
            />
            <div className="btn-row">
              <a className="button primary" href={`${latest}?download=1`}>⬇ {t.downloadMp4}</a>
              {latestSrt && <a className="button ghost" href={`${latestSrt}?download=1`}>{t.downloadSrt}</a>}
            </div>
            {job?.result?.preview && <div className="alert info">{t.previewNote}</div>}
            {job?.result?.notes.map((n) => <div className="alert warn" key={n}>{n}</div>)}
            <p className="muted small">{t.localEngineNote}</p>
          </div>
        )}
      </section>

      {renders.length > 1 && (
        <section className="panel">
          <h3>{t.previousRenders}</h3>
          <ul className="renders">
            {renders.map((r) => (
              <li key={r.file}>
                <a href={r.url} target="_blank" rel="noreferrer">{r.file}</a>
                <a href={`${r.url}?download=1`} className="muted small">indir</a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { canvasSize, type Project } from "../../shared/schema";
import { renderFrame } from "../../shared/render/frame";
import { buildCues, buildTimeline, estimateSpeechSec } from "../../shared/timeline";

interface Props {
  project: Project;
  /** Render a single scene (looping) instead of the whole video. */
  sceneIndex?: number;
  /** Pixel width the canvas is displayed at. */
  displayWidth: number;
  controls?: boolean;
  playing?: boolean;
  /** Static frame position (0..1) when not playing. */
  still?: number;
  onSeekScene?: (index: number) => void;
}

type Backdrop = HTMLImageElement & { width: number; height: number };

// Decoded images shared by every player on the page (thumbnails and the main preview).
const imageCache = new Map<string, Promise<Backdrop | null>>();

function loadBackdrop(url: string): Promise<Backdrop | null> {
  let p = imageCache.get(url);
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img as Backdrop);
      img.onerror = () => resolve(null); // missing file: the scene is drawn as before
      img.src = url;
    });
    imageCache.set(url, p);
  }
  return p;
}

/** The project's generated scene backgrounds that have loaded, by scene id (same as the exporter uses). */
function useBackdrops(project: Project): ReadonlyMap<string, Backdrop> {
  const key = project.scenes.map((s) => (s.background ? `${s.id}:${s.background.file}` : "")).join("|");
  const [map, setMap] = useState<ReadonlyMap<string, Backdrop>>(new Map());
  useEffect(() => {
    let live = true;
    const wanted = project.scenes.filter((s) => s.background);
    if (!wanted.length) {
      setMap(new Map());
      return;
    }
    Promise.all(wanted.map(async (s) => [s.id, await loadBackdrop(`/media/${project.id}/assets/${s.background!.file}`)] as const)).then((pairs) => {
      if (live) setMap(new Map(pairs.filter((p): p is [string, Backdrop] => p[1] !== null)));
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, key]);
  return map;
}

function fmt(t: number) {
  const s = Math.max(0, Math.floor(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function Player({ project, sceneIndex, displayWidth, controls, playing: playingProp, still = 0.5, onSeekScene }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [playing, setPlaying] = useState(Boolean(playingProp));
  const [time, setTime] = useState(0.6);
  // Start slightly in, past the opening fade-from-black.
  const timeRef = useRef(0.6);

  useEffect(() => setPlaying(Boolean(playingProp)), [playingProp]);

  const view = useMemo<Project>(() => {
    if (sceneIndex === undefined) return project;
    const s = project.scenes[sceneIndex];
    return { ...project, scenes: s ? [{ ...s, transition: "cut" }] : project.scenes.slice(0, 1) };
  }, [project, sceneIndex]);

  const { spans, total } = useMemo(() => buildTimeline(view.scenes), [view]);
  const cues = useMemo(
    () => buildCues(spans, (s) => estimateSpeechSec(s.scene.narration, view.settings.language)),
    [spans, view.settings.language],
  );
  const backgrounds = useBackdrops(project);
  const logical = canvasSize(view.settings.aspect);
  const displayHeight = Math.round((displayWidth * logical.height) / logical.width);

  const draw = (t: number) => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const pw = Math.round(displayWidth * dpr);
    const ph = Math.round(displayHeight * dpr);
    if (c.width !== pw || c.height !== ph) {
      c.width = pw;
      c.height = ph;
    }
    ctx.setTransform(pw / logical.width, 0, 0, ph / logical.height, 0, 0);
    renderFrame(ctx, view, t, { ...logical, cues, subtitles: view.settings.subtitles && sceneIndex === undefined, backgrounds });
  };

  // Clamp the playhead when the edited project gets shorter.
  useEffect(() => {
    if (timeRef.current > total) {
      timeRef.current = 0;
      setTime(0);
    }
  }, [total]);

  useEffect(() => {
    if (!playing) {
      const t = controls ? timeRef.current : total * still;
      draw(Math.min(t, total - 0.001));
      return;
    }
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      let t = timeRef.current + dt;
      if (t >= total) {
        if (controls) {
          t = total - 0.001;
          setPlaying(false);
        } else t = 0;
      }
      timeRef.current = t;
      draw(t);
      if (controls) setTime(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, view, displayWidth, total, still, cues, backgrounds]);

  const seek = (t: number) => {
    timeRef.current = t;
    setTime(t);
    draw(Math.min(t, total - 0.001));
  };

  return (
    <div className="player" style={{ width: displayWidth }}>
      <canvas ref={canvas} style={{ width: displayWidth, height: displayHeight }} className="player-canvas" />
      {controls && (
        <div className="player-controls">
          <button
            className="icon-btn"
            onClick={() => {
              if (!playing && timeRef.current >= total - 0.01) seek(0);
              setPlaying(!playing);
            }}
            aria-label={playing ? "Duraklat" : "Oynat"}
          >
            {playing ? "❚❚" : "▶"}
          </button>
          <div className="timeline">
            {spans.map((s) => (
              <button
                key={s.scene.id}
                className="timeline-seg"
                style={{ flexGrow: s.end - s.start }}
                title={`${s.index + 1}. ${s.scene.title}`}
                onClick={() => {
                  seek(s.start);
                  onSeekScene?.(s.index);
                }}
              />
            ))}
            <input
              type="range"
              min={0}
              max={total}
              step={0.01}
              value={Math.min(time, total)}
              onChange={(e) => seek(Number(e.target.value))}
              aria-label="Zaman"
            />
          </div>
          <span className="time">
            {fmt(time)} / {fmt(total)}
          </span>
        </div>
      )}
    </div>
  );
}

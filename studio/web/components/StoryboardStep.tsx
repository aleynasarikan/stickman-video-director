import { useState } from "react";
import {
  ACTIONS, CAMERAS, CHARACTER_COLORS, EMOTIONS, HAIRS, HATS, OUTFITS, MAX_SCENE_SEC, MIN_SCENE_SEC, PROPS, SETTINGS, TIMES_OF_DAY, TRANSITIONS, VOICES,
  type Actor, type Character, type Project, type Scene,
} from "../../shared/schema";
import { newId } from "../../shared/draft";
import {
  ACTION_LABELS, CAMERA_LABELS, EMOTION_LABELS, HAIR_LABELS, HAT_LABELS, OUTFIT_LABELS, PROP_LABELS, SETTING_LABELS, TIME_LABELS, TRANSITION_LABELS, VOICE_LABELS, t,
} from "../i18n";
import { Player } from "./Player";

interface Props {
  project: Project;
  onChange: (p: Project) => void;
  onRegenerate: (index: number, instruction: string) => Promise<void>;
  onNext: () => void;
}

function Select<T extends string>({ value, options, labels, onChange, label }: {
  value: T; options: readonly T[]; labels: Record<T, string>; onChange: (v: T) => void; label?: string;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as T)} aria-label={label}>
      {options.map((o) => (
        <option key={o} value={o}>{labels[o]}</option>
      ))}
    </select>
  );
}

export function StoryboardStep({ project, onChange, onRegenerate, onNext }: Props) {
  const [selected, setSelected] = useState(0);
  const pending = project.scenes.filter((s) => !s.approved).length;

  const setScenes = (scenes: Scene[]) => onChange({ ...project, scenes });
  const updateScene = (i: number, patch: Partial<Scene>) =>
    setScenes(project.scenes.map((s, j) => (j === i ? { ...s, ...patch, approved: patch.approved ?? false } : s)));
  const setCharacters = (characters: Character[]) => onChange({ ...project, characters });

  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= project.scenes.length) return;
    const scenes = [...project.scenes];
    [scenes[i], scenes[j]] = [scenes[j], scenes[i]];
    setScenes(scenes);
    setSelected(j);
  };

  const addScene = () => {
    const prev = project.scenes[selected] ?? project.scenes[project.scenes.length - 1];
    const scene: Scene = {
      ...prev,
      id: newId("scn"),
      title: `${t.scene} ${project.scenes.length + 1}`,
      narration: "",
      visualNote: "",
      approved: false,
      actors: prev.actors.map((a) => ({ ...a, actions: ["idle"], fromX: a.toX, toX: a.toX })),
    };
    const scenes = [...project.scenes];
    scenes.splice(selected + 1, 0, scene);
    setScenes(scenes);
    setSelected(selected + 1);
  };

  return (
    <div className="board">
      <aside className="board-side">
        <section className="panel">
          <div className="panel-head">
            <h3>{t.scenes} <span className="muted">({project.scenes.length})</span></h3>
            <button className="ghost small" onClick={() => setScenes(project.scenes.map((s) => ({ ...s, approved: true })))}>
              {t.approveAll}
            </button>
          </div>
          <ol className="scene-list">
            {project.scenes.map((s, i) => (
              <li key={s.id} className={i === selected ? "on" : ""} onClick={() => setSelected(i)}>
                <Player project={project} sceneIndex={i} displayWidth={104} still={0.5} />
                <div className="scene-li-text">
                  <span className="scene-li-title">{i + 1}. {s.title || t.scene}</span>
                  <span className="muted small">{s.durationSec.toFixed(1)} {t.seconds} · {SETTING_LABELS[s.setting]}</span>
                </div>
                <span className={`dot ${s.approved ? "ok" : ""}`} title={s.approved ? t.approved : ""} />
              </li>
            ))}
          </ol>
          <button className="ghost full" onClick={addScene}>+ {t.addScene}</button>
        </section>
        <CharacterPanel project={project} onChange={setCharacters} />
      </aside>

      <main className="board-main">
        <section className="panel preview-panel">
          <Player project={project} displayWidth={project.settings.aspect === "16:9" ? 640 : 300} controls onSeekScene={setSelected} />
          <p className="muted small">{t.previewSilent}</p>
        </section>

        {project.scenes[selected] && (
          <SceneEditor
            key={project.scenes[selected].id}
            project={project}
            index={selected}
            onPatch={(p) => updateScene(selected, p)}
            onRemove={() => {
              if (project.scenes.length <= 1) return;
              setScenes(project.scenes.filter((_, j) => j !== selected));
              setSelected(Math.max(0, selected - 1));
            }}
            onMove={(d) => move(selected, d)}
            onRegenerate={(instr) => onRegenerate(selected, instr)}
          />
        )}

        <div className="board-footer">
          {pending > 0 ? <span className="muted">{t.approvalNeeded(pending)}</span> : <span className="chip ok">✓ {t.approved}</span>}
          <button className="primary" disabled={pending > 0} onClick={onNext}>{t.toVideo} →</button>
        </div>
      </main>
    </div>
  );
}

function SceneEditor({ project, index, onPatch, onRemove, onMove, onRegenerate }: {
  project: Project;
  index: number;
  onPatch: (p: Partial<Scene>) => void;
  onRemove: () => void;
  onMove: (d: -1 | 1) => void;
  onRegenerate: (instruction: string) => Promise<void>;
}) {
  const scene = project.scenes[index];
  const [instruction, setInstruction] = useState("");
  const [regenBusy, setRegenBusy] = useState(false);
  const used = new Set(scene.actors.map((a) => a.characterId));
  const free = project.characters.filter((c) => !used.has(c.id));

  const setActor = (i: number, patch: Partial<Actor>) =>
    onPatch({ actors: scene.actors.map((a, j) => (j === i ? { ...a, ...patch } : a)) });

  return (
    <section className="panel scene-editor">
      <div className="panel-head">
        <h3>{t.scene} {index + 1}</h3>
        <div className="btn-row">
          <button className="ghost small" onClick={() => onMove(-1)} title="Yukarı">↑</button>
          <button className="ghost small" onClick={() => onMove(1)} title="Aşağı">↓</button>
          <button className="ghost small danger" onClick={onRemove} disabled={project.scenes.length <= 1}>{t.remove}</button>
          <button
            className={scene.approved ? "approved small" : "primary small"}
            onClick={() => onPatch({ approved: !scene.approved })}
          >
            {scene.approved ? `✓ ${t.approved}` : t.approve}
          </button>
        </div>
      </div>

      <div className="grid2">
        <div className="field">
          <label>{t.sceneTitle}</label>
          <input value={scene.title} maxLength={80} onChange={(e) => onPatch({ title: e.target.value })} />
        </div>
        <div className="field">
          <label>{t.visualNote}</label>
          <input value={scene.visualNote} maxLength={400} onChange={(e) => onPatch({ visualNote: e.target.value })} />
        </div>
      </div>
      <div className="field">
        <label>{t.narration}</label>
        <textarea rows={3} value={scene.narration} maxLength={600} onChange={(e) => onPatch({ narration: e.target.value })} />
      </div>
      <div className="field">
        <label>{t.headline}</label>
        <input
          value={scene.headline ?? ""}
          maxLength={48}
          placeholder={t.headlinePlaceholder}
          onChange={(e) => onPatch({ headline: e.target.value || undefined })}
        />
      </div>

      <div className="grid5">
        <div className="field">
          <label>Süre ({t.seconds})</label>
          <input
            type="number" min={MIN_SCENE_SEC} max={MAX_SCENE_SEC} step={0.5} value={scene.durationSec}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) onPatch({ durationSec: Math.min(MAX_SCENE_SEC, Math.max(MIN_SCENE_SEC, v)) });
            }}
          />
        </div>
        <div className="field"><label>{t.setting}</label><Select value={scene.setting} options={SETTINGS} labels={SETTING_LABELS} onChange={(v) => onPatch({ setting: v })} /></div>
        <div className="field"><label>{t.timeOfDay}</label><Select value={scene.timeOfDay} options={TIMES_OF_DAY} labels={TIME_LABELS} onChange={(v) => onPatch({ timeOfDay: v })} /></div>
        <div className="field"><label>{t.camera}</label><Select value={scene.camera} options={CAMERAS} labels={CAMERA_LABELS} onChange={(v) => onPatch({ camera: v })} /></div>
        <div className="field"><label>{t.transition}</label><Select value={scene.transition} options={TRANSITIONS} labels={TRANSITION_LABELS} onChange={(v) => onPatch({ transition: v })} /></div>
        {project.settings.voiceover && project.settings.language === "tr" && (
          <div className="field">
            <label>{t.sceneVoice}</label>
            <select value={scene.voice ?? ""} onChange={(e) => onPatch({ voice: (e.target.value || undefined) as Scene["voice"] })}>
              <option value="">{t.sceneVoiceDefault} ({VOICE_LABELS[project.settings.voice ?? "kadin"]})</option>
              {VOICES.map((v) => (
                <option key={v} value={v}>{VOICE_LABELS[v]}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="actors">
        {scene.actors.map((a, i) => {
          const c = project.characters.find((x) => x.id === a.characterId);
          return (
            <div className="actor" key={a.characterId}>
              <div className="actor-head">
                <span className="swatch" style={{ background: c?.color }} />
                <strong>{c?.name ?? a.characterId}</strong>
                <button className="ghost small danger" onClick={() => onPatch({ actors: scene.actors.filter((_, j) => j !== i) })}>{t.remove}</button>
              </div>
              <div className="field">
                <label>{t.actions}</label>
                <div className="action-chain">
                  {a.actions.map((act, k) => (
                    <span key={k} className="action-pill">
                      <Select value={act} options={ACTIONS} labels={ACTION_LABELS} onChange={(v) => setActor(i, { actions: a.actions.map((x, m) => (m === k ? v : x)) })} />
                      {a.actions.length > 1 && (
                        <button className="x" onClick={() => setActor(i, { actions: a.actions.filter((_, m) => m !== k) })} aria-label="Kaldır">×</button>
                      )}
                    </span>
                  ))}
                  {a.actions.length < 4 && (
                    <button className="ghost small" onClick={() => setActor(i, { actions: [...a.actions, "idle"] })}>+</button>
                  )}
                </div>
              </div>
              <div className="grid4">
                <div className="field"><label>{t.emotion}</label><Select value={a.emotion} options={EMOTIONS} labels={EMOTION_LABELS} onChange={(v) => setActor(i, { emotion: v })} /></div>
                <div className="field"><label>{t.prop}</label><Select value={a.prop} options={PROPS} labels={PROP_LABELS} onChange={(v) => setActor(i, { prop: v })} /></div>
                <div className="field">
                  <label>{t.from} → {t.to}</label>
                  <div className="range-pair">
                    <input type="range" min={0} max={1} step={0.01} value={a.fromX} onChange={(e) => setActor(i, { fromX: Number(e.target.value) })} />
                    <input type="range" min={0} max={1} step={0.01} value={a.toX} onChange={(e) => setActor(i, { toX: Number(e.target.value) })} />
                  </div>
                </div>
                <div className="field">
                  <label>{t.facing}</label>
                  <Select value={a.facing} options={["left", "right"] as const} labels={{ left: t.left, right: t.right }} onChange={(v) => setActor(i, { facing: v })} />
                </div>
              </div>
            </div>
          );
        })}
        {free.length > 0 && scene.actors.length < 4 && (
          <select
            className="add-actor"
            value=""
            onChange={(e) =>
              onPatch({
                actors: [...scene.actors, { characterId: e.target.value, actions: ["idle"], fromX: 0.7, toX: 0.7, facing: "left", emotion: "neutral", prop: "none" }],
              })
            }
          >
            <option value="">+ {t.addActor}</option>
            {free.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
      </div>

      <div className="regen">
        <input value={instruction} maxLength={500} placeholder={t.regenerateHint} onChange={(e) => setInstruction(e.target.value)} />
        <button
          className="ghost"
          disabled={regenBusy}
          onClick={async () => {
            setRegenBusy(true);
            try {
              await onRegenerate(instruction);
              setInstruction("");
            } finally {
              setRegenBusy(false);
            }
          }}
        >
          {regenBusy ? "…" : `↻ ${t.regenerate}`}
        </button>
      </div>
    </section>
  );
}

function CharacterPanel({ project, onChange }: { project: Project; onChange: (c: Character[]) => void }) {
  const set = (i: number, patch: Partial<Character>) => onChange(project.characters.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>{t.characters}</h3>
        {project.characters.length < 6 && (
          <button
            className="ghost small"
            onClick={() => {
              const n = project.characters.length;
              onChange([...project.characters, { id: `kisi-${Date.now().toString(36)}`, name: `Karakter ${n + 1}`, color: CHARACTER_COLORS[n % CHARACTER_COLORS.length], hat: "none", scale: 1, hair: "short", outfit: "casual" }]);
            }}
          >
            +
          </button>
        )}
      </div>
      {project.characters.map((c, i) => (
        <div className="char-row" key={c.id}>
          <input type="color" value={c.color} onChange={(e) => set(i, { color: e.target.value })} aria-label={t.color} />
          <input value={c.name} maxLength={40} onChange={(e) => set(i, { name: e.target.value || c.name })} aria-label={t.name} />
          <Select value={c.hair} options={HAIRS} labels={HAIR_LABELS} onChange={(v) => set(i, { hair: v })} label={t.hair} />
          <Select value={c.outfit} options={OUTFITS} labels={OUTFIT_LABELS} onChange={(v) => set(i, { outfit: v })} label={t.outfit} />
          <Select value={c.hat} options={HATS} labels={HAT_LABELS} onChange={(v) => set(i, { hat: v })} label={t.hat} />
        </div>
      ))}
    </section>
  );
}

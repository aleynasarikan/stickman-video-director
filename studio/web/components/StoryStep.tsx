import { useMemo, useState } from "react";
import { AI_PLANNERS, STYLES, VOICES, type PlannerKind, type Project, type StyleId, type VideoSettings } from "../../shared/schema";
import { STYLE_LABELS, VOICE_LABELS, t } from "../i18n";
import type { Status } from "../api";
import { Player } from "./Player";
import { NewsPanel } from "./NewsPanel";

interface Props {
  status: Status | null;
  busy: boolean;
  onCreate: (story: string, settings: VideoSettings, planner: PlannerKind) => void;
}

const SAMPLE_PREVIEW: Omit<Project, "settings"> = {
  id: "preview",
  title: "",
  story: "",
  planner: "offline",
  createdAt: "",
  updatedAt: "",
  characters: [
    { id: "a", name: "A", color: "#e63946", hat: "none", scale: 1, hair: "short", outfit: "casual" },
    { id: "b", name: "B", color: "#1d4ed8", hat: "none", scale: 0.95, hair: "ponytail", outfit: "dress" },
  ],
  scenes: [
    {
      id: "s", title: "", narration: "", visualNote: "", durationSec: 4, setting: "park", timeOfDay: "day",
      camera: "wide", transition: "cut", approved: true,
      actors: [
        { characterId: "a", actions: ["wave"], fromX: 0.3, toX: 0.3, facing: "right", emotion: "happy", prop: "none" },
        { characterId: "b", actions: ["walk"], fromX: 0.95, toX: 0.65, facing: "left", emotion: "neutral", prop: "cup" },
      ],
    },
  ],
};

// Keys and values may be Turkish or English; free text ("samuray evi") is mapped to the nearest option.
const JSON_TEMPLATE = `{
  "baslik": "Samurayın Sözü",
  "stil": "cinematic",
  "format": "16:9",
  "sure": 30,
  "karakterler": [
    { "isim": "Hiro", "kiyafet": "kimono", "sac": "topknot" },
    { "isim": "Yuki", "aciklama": "kimonolu, topuz saçlı genç kadın" }
  ],
  "sahneler": [
    {
      "anlatim": "Edo döneminde genç samuray Hiro, gece evinde kılıcına bakıp düşünüyordu.",
      "mekan": "japanese-room",
      "zaman": "gece",
      "kamera": "geniş",
      "karakterler": [{ "isim": "Hiro", "eylem": ["sit", "think"], "duygu": "üzgün", "nesne": "kılıç" }]
    },
    {
      "anlatim": "Sabah Yuki köyün yolunda ona koşup bir mektup verdi.",
      "mekan": "köy yolu",
      "kamera": "pan",
      "karakterler": [
        { "isim": "Yuki", "eylem": "koşar, konuşur", "nesne": "mektup" },
        { "isim": "Hiro", "eylem": "dinler", "duygu": "şaşkın" }
      ]
    }
  ]
}`;

function jsonState(text: string): "json" | "invalid" | null {
  const t = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  if (!/^[[{]/.test(t)) return null;
  try {
    JSON.parse(t);
    return "json";
  } catch {
    return "invalid";
  }
}

export function StoryStep({ status, busy, onCreate }: Props) {
  const [story, setStory] = useState("");
  const [settings, setSettings] = useState<VideoSettings>({
    durationSec: 30,
    aspect: "16:9",
    style: "cinematic",
    language: "tr",
    voiceover: true,
    subtitles: true,
    voice: "kadin",
    sfx: true,
  });
  const [planner, setPlanner] = useState<PlannerKind | null>(null);
  const [hover, setHover] = useState<StyleId | null>(null);
  const set = <K extends keyof VideoSettings>(k: K, v: VideoSettings[K]) => setSettings((s) => ({ ...s, [k]: v }));

  const previews = useMemo(
    () =>
      Object.fromEntries(
        STYLES.map((style) => [style, { ...SAMPLE_PREVIEW, settings: { ...settings, aspect: "16:9", subtitles: false, style } } as Project]),
      ) as Record<StyleId, Project>,
    // Only the style matters for thumbnails.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Default to the first configured LLM (status loads after first render).
  const available = AI_PLANNERS.filter((k) => status?.planners[k]);
  const effectivePlanner: PlannerKind =
    planner && (planner === "offline" || available.includes(planner)) ? planner : (available[0] ?? "offline");
  const voiceOk = status?.tts[settings.language] ?? false;
  const canSubmit = story.trim().length >= 10 && !busy;
  const isJson = useMemo(() => jsonState(story), [story]);

  return (
    <div className="story-step">
      <div className="story-col">
      <section className="panel story-panel">
        <h2>{t.storyTitle}</h2>
        <p className="muted">{t.storyHint}</p>
        <textarea
          value={story}
          onChange={(e) => setStory(e.target.value)}
          placeholder={t.storyPlaceholder}
          rows={14}
          maxLength={20000}
        />
        <div className="story-meta">
          <button className="link" onClick={() => setStory(JSON_TEMPLATE)} disabled={busy}>
            {t.jsonTemplate}
          </button>
          {isJson && <span className={`chip ${isJson === "json" ? "ok" : "warn"}`}>{isJson === "json" ? t.jsonDetected : t.jsonInvalid}</span>}
          <span className="muted small">{story.length.toLocaleString("tr")} / 20.000</span>
        </div>
      </section>
      <NewsPanel
        settings={settings}
        busy={busy}
        planner={effectivePlanner}
        onBrief={(brief, s) => {
          setStory(brief);
          setSettings((cur) => ({ ...cur, ...s }));
        }}
      />
      </div>

      <section className="panel settings-panel">
        <div className="field">
          <label>
            {t.duration}: <strong>{settings.durationSec} {t.seconds}</strong>
          </label>
          <input type="range" min={10} max={180} step={10} value={settings.durationSec} onChange={(e) => set("durationSec", Number(e.target.value))} />
        </div>

        <div className="field">
          <label>{t.aspect}</label>
          <div className="seg">
            {(["16:9", "9:16"] as const).map((a) => (
              <button key={a} className={settings.aspect === a ? "on" : ""} onClick={() => set("aspect", a)}>
                <span className={`ratio-icon r${a.replace(":", "-")}`} />
                {a === "16:9" ? t.landscape : t.portrait}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label>{t.style}</label>
          <div className="style-grid">
            {STYLES.map((s) => (
              <button
                key={s}
                className={`style-card ${settings.style === s ? "on" : ""}`}
                onClick={() => set("style", s)}
                onMouseEnter={() => setHover(s)}
                onMouseLeave={() => setHover(null)}
              >
                <Player project={previews[s]} sceneIndex={0} displayWidth={150} playing={hover === s} still={0.35} />
                <span className="style-name">{STYLE_LABELS[s].name}</span>
                <span className="style-note">{STYLE_LABELS[s].note}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="row">
          <div className="field">
            <label>{t.language}</label>
            <select value={settings.language} onChange={(e) => set("language", e.target.value as VideoSettings["language"])}>
              <option value="tr">Türkçe</option>
              <option value="en">English</option>
            </select>
          </div>
          <label className="toggle">
            <input type="checkbox" checked={settings.voiceover} onChange={(e) => set("voiceover", e.target.checked)} />
            {t.voiceover}
            {settings.voiceover && <span className={`chip ${voiceOk ? "ok" : "warn"}`}>{voiceOk ? `${t.voiceAvailable}${settings.language === "tr" && status?.tts.engine ? ` · ${t.engineLabels[status.tts.engine] ?? status.tts.engine}` : ""}` : t.voiceMissing}</span>}
          </label>
          {settings.voiceover && settings.language === "tr" && (
            <div className="field">
              <label>{t.narratorVoice}</label>
              <select
                value={settings.voice ?? "kadin"}
                onChange={(e) => set("voice", e.target.value as (typeof VOICES)[number])}
                disabled={!status?.tts.voices}
                title={status?.tts.voices ? undefined : t.voicesNeedEma}
              >
                {VOICES.map((v) => (
                  <option key={v} value={v}>{VOICE_LABELS[v]}</option>
                ))}
              </select>
            </div>
          )}
          <label className="toggle">
            <input type="checkbox" checked={settings.subtitles} onChange={(e) => set("subtitles", e.target.checked)} />
            {t.subtitles}
          </label>
          <label className="toggle">
            <input type="checkbox" checked={settings.sfx ?? true} onChange={(e) => set("sfx", e.target.checked)} />
            {t.sfx}
          </label>
        </div>

        <div className="field">
          <label>{t.planner}</label>
          <div className="planner-options">
            {AI_PLANNERS.map((k) => {
              const info = status?.planners[k];
              const paid = info?.paid ?? true;
              return (
                <label key={k} className={`planner-opt ${effectivePlanner === k ? "on" : ""} ${info ? "" : "disabled"}`}>
                  <input type="radio" disabled={!info} checked={effectivePlanner === k} onChange={() => setPlanner(k)} />
                  <div>
                    <strong>{t.plannerAi[k]}</strong> {paid && <span className="chip cost">{t.paid}</span>}
                    {info && <span className="chip">{info.model}</span>}
                    <p>{!info ? t.plannerAiMissing[k] : paid ? t.plannerAiNote : t.plannerAiFreeNote}</p>
                  </div>
                </label>
              );
            })}
            <label className={`planner-opt ${effectivePlanner === "offline" ? "on" : ""}`}>
              <input type="radio" checked={effectivePlanner === "offline"} onChange={() => setPlanner("offline")} />
              <div>
                <strong>{t.plannerOffline}</strong>
                <p>{t.plannerOfflineNote}</p>
              </div>
            </label>
          </div>
        </div>

        <button className="primary big" disabled={!canSubmit} onClick={() => onCreate(story, settings, effectivePlanner)}>
          {busy ? t.planning : t.createStoryboard}
        </button>
      </section>
    </div>
  );
}

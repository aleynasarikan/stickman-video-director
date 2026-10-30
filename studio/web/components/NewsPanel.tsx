import { useState } from "react";
import { PLANNER_LABEL, type PlannerKind, type VideoSettings } from "../../shared/schema";
import type { NewsItem } from "../../shared/news-brief";
import { api } from "../api";
import { t } from "../i18n";

const MAX_ITEMS = 8;

// Feeds the publishers offer for this purpose; any other RSS/Atom or article address works too.
const PRESETS = [
  { label: "AA Güncel", url: "https://www.aa.com.tr/tr/rss/default?cat=guncel" },
  { label: "TRT Haber Manşet", url: "https://www.trthaber.com/manset_articles.rss" },
  { label: "AA Spor", url: "https://www.aa.com.tr/tr/rss/default?cat=spor" },
  { label: "TRT Haber Spor", url: "https://www.trthaber.com/spor_articles.rss" },
];

type Mode = "classic" | "comic" | "interview" | "meme";
type Topic = "auto" | "general" | "football";

interface Props {
  settings: VideoSettings;
  busy: boolean;
  /** The planner chosen in the settings; an LLM one writes the comic bulletin's jokes. */
  planner: PlannerKind;
  /** Puts the bulletin's JSON brief in the story box and switches to the news look. */
  onBrief: (brief: string, settings: Partial<VideoSettings>) => void;
}

export function NewsPanel({ settings, busy, planner, onBrief }: Props) {
  const [url, setUrl] = useState(PRESETS[0].url);
  const [items, setItems] = useState<NewsItem[]>([]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState(() => `Gündem Bülteni · ${new Date().toLocaleDateString("tr", { day: "numeric", month: "long" })}`);
  const [anchor, setAnchor] = useState("Deniz");
  const [presenter, setPresenter] = useState<"kadin" | "erkek">("kadin");
  const [mode, setMode] = useState<Mode>("meme");
  const [topic, setTopic] = useState<Topic>("auto");
  const [subject, setSubject] = useState("");
  const [building, setBuilding] = useState(false);
  const [notes, setNotes] = useState<string[]>([]);

  const load = async (target = url) => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.news(target);
      setItems(r.items);
      setPicked(new Set(r.items.slice(0, 5).map((_, i) => i)));
    } catch (e) {
      setError((e as Error).message);
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  // An interview segment is long (several Q&A scenes), so a bulletin holds at most 3.
  const max = mode === "interview" ? 3 : MAX_ITEMS;
  const toggle = (i: number) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(i)) n.delete(i);
      else if (n.size < max) n.add(i);
      return n;
    });
  const chosen = items.filter((_, i) => picked.has(i)).slice(0, max);
  const canBuild = chosen.length > 0 || (mode === "interview" && subject.trim().length >= 3);

  // `as` lets the interview-only button build before the mode state has updated.
  const build = async (as: Mode = mode) => {
    setBuilding(true);
    setError(null);
    setNotes([]);
    try {
      const r = await api.bulletin({
        items: as === "interview" ? chosen.slice(0, 3) : chosen,
        topic,
        subject: as === "interview" ? subject.trim() || undefined : undefined,
        title: title.trim() || "Gündem",
        anchor: anchor.trim() || "Deniz",
        presenter,
        aspect: settings.aspect,
        language: "tr",
        mode: as,
        planner,
      });
      setNotes(r.notes);
      const sure = (r.brief as { sure?: number }).sure ?? settings.durationSec;
      onBrief(JSON.stringify(r.brief, null, 2), { style: "news", voice: presenter, voiceover: true, language: "tr", durationSec: Math.min(180, sure) });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBuilding(false);
    }
  };

  return (
    <section className="panel news-panel">
      <h2>{t.newsTitle}</h2>
      <p className="muted">{t.newsHint}</p>
      <div className="news-fetch">
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t.newsUrl} aria-label={t.newsUrl} />
        <button className="primary" disabled={loading || busy || url.trim().length < 8} onClick={() => load()}>
          {loading ? t.newsFetching : t.newsFetch}
        </button>
      </div>
      <div className="story-meta">
        {PRESETS.map((p) => (
          <button key={p.url} className="link" disabled={loading} onClick={() => { setUrl(p.url); load(p.url); }}>
            {p.label}
          </button>
        ))}
      </div>
      {error && <div className="alert error">{error}</div>}
      {items.length === 0 && (
        <div className="field">
          <label>{t.newsSubject}</label>
          <div className="news-fetch">
            <input value={subject} maxLength={200} placeholder={t.newsSubjectPlaceholder} onChange={(e) => setSubject(e.target.value)} />
            <button className="primary" disabled={subject.trim().length < 3 || busy || building} onClick={() => { setMode("interview"); build("interview"); }}>
              {building ? t.newsBuilding : t.newsInterviewOnly}
            </button>
          </div>
        </div>
      )}
      {items.length > 0 && (
        <>
          <ul className="news-list">
            {items.map((it, i) => (
              <li key={`${it.link}-${i}`} className={picked.has(i) ? "on" : ""}>
                <label>
                  <input type="checkbox" checked={picked.has(i)} onChange={() => toggle(i)} />
                  <span>
                    <strong>{it.title}</strong>
                    {it.summary && <span className="muted small">{it.summary.slice(0, 160)}{it.summary.length > 160 ? "…" : ""}</span>}
                    <a className="muted small" href={it.link} target="_blank" rel="noreferrer noopener">{it.source}</a>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className="row">
            <div className="field">
              <label>{t.newsBulletinTitle}</label>
              <input value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="field">
              <label>{t.newsAnchor}</label>
              <input value={anchor} maxLength={30} onChange={(e) => setAnchor(e.target.value)} />
            </div>
            <div className="field">
              <label>{t.newsMode}</label>
              <select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
                <option value="meme">{t.newsMeme}</option>
                <option value="comic">{t.newsComic}</option>
                <option value="interview">{t.newsInterview}</option>
                <option value="classic">{t.newsClassic}</option>
              </select>
            </div>
            {mode !== "classic" && (
              <div className="field">
                <label>{t.newsTopic}</label>
                <select value={topic} onChange={(e) => setTopic(e.target.value as Topic)}>
                  <option value="auto">{t.newsTopicAuto}</option>
                  <option value="general">{t.newsTopicGeneral}</option>
                  <option value="football">{t.newsTopicFootball}</option>
                </select>
              </div>
            )}
            <div className="field">
              <label>{t.newsPresenter}</label>
              <select value={presenter} onChange={(e) => setPresenter(e.target.value as "kadin" | "erkek")}>
                <option value="kadin">{t.newsFemale}</option>
                <option value="erkek">{t.newsMale}</option>
              </select>
            </div>
          </div>
          {mode !== "classic" && <p className="muted small">{t.newsComicNote(mode, planner === "offline" ? null : PLANNER_LABEL[planner])}</p>}
          <div className="story-meta">
            <button className="primary" disabled={!canBuild || busy || building} onClick={() => build()}>{building ? t.newsBuilding : t.newsBuild}</button>
            <span className="muted small">{t.newsSelected(chosen.length, max)}</span>
          </div>
          {mode === "interview" && (
            <div className="field">
              <label>{t.newsSubject}</label>
              <input value={subject} maxLength={200} placeholder={t.newsSubjectPlaceholder} onChange={(e) => setSubject(e.target.value)} />
            </div>
          )}
          <p className="muted small">{t.newsTerms}</p>
        </>
      )}
      {notes.map((n) => <div className="alert info" key={n}>{n}</div>)}
    </section>
  );
}

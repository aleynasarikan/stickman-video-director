import type { NewsItem } from "../shared/news-brief";
import type { AiPlannerKind, PlannerKind, Project, Scene, VideoSettings } from "../shared/schema";

export interface Status {
  /** Model and cost per LLM planner, or null when its API key is missing. */
  planners: Record<AiPlannerKind, { model: string; paid: boolean } | null>;
  tts: { tr: boolean; en: boolean; voices?: boolean; engine?: string; installed?: Record<string, boolean> };
  /** Optional local image service; provider null = drawn backgrounds only. */
  assets?: { provider: string | null; problem?: string };
}

export interface RenderFile {
  file: string;
  url: string;
  srtUrl: string;
}

export interface Job {
  id: string;
  status: "running" | "done" | "error";
  phase: string;
  progress: number;
  error?: string;
  result?: { url: string; srtUrl: string; durationSec: number; voice: boolean; notes: string[]; preview?: boolean };
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { "content-type": "application/json" } : undefined,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const details = Array.isArray(body.details) ? ` (${body.details.join("; ")})` : "";
    // The HTTP status rides along so callers can tell "not found" from a failed request.
    throw Object.assign(new Error((body.error ?? `İstek başarısız: ${res.status}`) + details), { status: res.status });
  }
  return body as T;
}

export const api = {
  status: () => call<Status>("/api/status"),
  list: () => call<{ projects: { id: string; title: string; updatedAt: string }[] }>("/api/projects"),
  get: (id: string) => call<{ project: Project; renders: RenderFile[] }>(`/api/projects/${id}`),
  create: (story: string, settings: VideoSettings, planner: PlannerKind) =>
    call<{ project: Project; warning?: string; notice?: string }>("/api/projects", { method: "POST", body: JSON.stringify({ story, settings, planner }) }),
  save: (project: Project) => call<{ project: Project }>(`/api/projects/${project.id}`, { method: "PUT", body: JSON.stringify({ project }) }),
  regenerate: (id: string, index: number, instruction: string, planner: PlannerKind) =>
    call<{ scene: Scene; warning?: string }>(`/api/projects/${id}/scenes/${index}/regenerate`, {
      method: "POST",
      body: JSON.stringify({ instruction, planner }),
    }),
  generateBackground: (id: string, index: number, prompt?: string) =>
    call<{ scene: Scene; reused: boolean }>(`/api/projects/${id}/scenes/${index}/background`, { method: "POST", body: JSON.stringify({ prompt }) }),
  removeBackground: (id: string, index: number) =>
    call<{ scene: Scene }>(`/api/projects/${id}/scenes/${index}/background`, { method: "DELETE" }),
  render: (id: string, preview = false) => call<{ jobId: string }>(`/api/projects/${id}/render`, { method: "POST", body: JSON.stringify({ preview }) }),
  bulletin: (body: {
    items: NewsItem[]; title: string; anchor: string; presenter: "kadin" | "erkek"; aspect: VideoSettings["aspect"];
    language: VideoSettings["language"]; mode: "classic" | "comic" | "interview" | "meme"; planner: PlannerKind;
    topic?: "auto" | "general" | "football"; subject?: string;
  }) => call<{ brief: object; notes: string[] }>("/api/news/bulletin", { method: "POST", body: JSON.stringify(body) }),
  news: (url: string) => call<{ source: string; items: NewsItem[] }>("/api/news/fetch", { method: "POST", body: JSON.stringify({ url }) }),
  job: (id: string) => call<Job>(`/api/jobs/${id}`),
};

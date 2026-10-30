import type { PlannerKind, Project, VideoSettings } from "../../shared/schema";
import type { DraftPlan, DraftScene } from "../../shared/draft";

export interface PlanInput {
  story: string;
  settings: VideoSettings;
  /** Replaces the "Story:" block, e.g. with a JSON brief and how to honour it. */
  brief?: string;
}

export interface SceneRegenInput {
  project: Project;
  index: number;
  instruction?: string;
}

export interface Planner {
  readonly kind: PlannerKind;
  plan(input: PlanInput): Promise<DraftPlan>;
  regenerateScene(input: SceneRegenInput): Promise<DraftScene>;
  /** Free-form JSON answer for side tasks (e.g. writing a bulletin's jokes); LLM planners only. */
  writeJson?(system: string, user: string, temperature?: number): Promise<unknown>;
}

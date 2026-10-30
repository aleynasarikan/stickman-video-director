import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { Project } from "../shared/schema";

const ID_RE = /^[a-z0-9_-]{1,64}$/i;

export class ProjectStore {
  constructor(readonly root: string) {}

  dir(id: string): string {
    if (!ID_RE.test(id)) throw new Error("Geçersiz proje kimliği.");
    return path.join(this.root, id);
  }

  rendersDir(id: string): string {
    return path.join(this.dir(id), "renders");
  }

  async save(project: Project): Promise<Project> {
    const parsed = Project.parse(project);
    const dir = this.dir(parsed.id);
    await mkdir(dir, { recursive: true });
    const tmp = path.join(dir, "project.json.tmp");
    await writeFile(tmp, JSON.stringify(parsed, null, 2));
    await rename(tmp, path.join(dir, "project.json"));
    return parsed;
  }

  async get(id: string): Promise<Project | null> {
    try {
      const raw = await readFile(path.join(this.dir(id), "project.json"), "utf8");
      return Project.parse(JSON.parse(raw));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }

  async list(): Promise<Pick<Project, "id" | "title" | "updatedAt">[]> {
    await mkdir(this.root, { recursive: true });
    const out: Pick<Project, "id" | "title" | "updatedAt">[] = [];
    for (const id of await readdir(this.root)) {
      if (!ID_RE.test(id)) continue;
      const p = await this.get(id).catch(() => null);
      if (p) out.push({ id: p.id, title: p.title, updatedAt: p.updatedAt });
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async renders(id: string): Promise<string[]> {
    try {
      const files = await readdir(this.rendersDir(id));
      // Previews are throwaway checks; only full renders are listed.
      return files.filter((f) => f.startsWith("video-") && f.endsWith(".mp4")).sort().reverse();
    } catch {
      return [];
    }
  }
}

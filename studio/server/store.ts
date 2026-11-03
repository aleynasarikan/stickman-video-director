import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Project } from "../shared/schema";

const ID_RE = /^[a-z0-9_-]{1,64}$/i;

/** Whether a render scratch folder still belongs to a live render. */
async function inUse(dir: string): Promise<boolean> {
  let pid: number;
  try {
    pid = Number(await readFile(path.join(dir, "owner.pid"), "utf8"));
  } catch {
    try {
      return Date.now() - (await stat(dir)).mtimeMs < 3_600_000;
    } catch {
      return false;
    }
  }
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0); // signal 0: only checks that the process exists
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM"; // exists, owned by someone else
  }
}

export class ProjectStore {
  constructor(readonly root: string) {}

  dir(id: string): string {
    if (!ID_RE.test(id)) throw new Error("Geçersiz proje kimliği.");
    return path.join(this.root, id);
  }

  rendersDir(id: string): string {
    return path.join(this.dir(id), "renders");
  }

  /** Generated images (optional scene backgrounds). Never needed to render a project. */
  assetsDir(id: string): string {
    return path.join(this.dir(id), "assets");
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

  /**
   * Removes render scratch folders (renders/.work-*) left behind by a render that never finished
   * (server killed mid-render). Only those folders, which hold the render's own intermediate
   * audio, are touched, and only when no running process owns them: each render writes its PID
   * to owner.pid, so another server instance on the same data folder keeps its render. A folder
   * without that file (older versions) is removed only when untouched for an hour.
   */
  async cleanupStaleWork(): Promise<number> {
    let removed = 0;
    let ids: string[] = [];
    try {
      ids = await readdir(this.root);
    } catch {
      return 0;
    }
    for (const id of ids) {
      if (!ID_RE.test(id)) continue;
      let entries: string[] = [];
      try {
        entries = await readdir(this.rendersDir(id));
      } catch {
        continue;
      }
      for (const e of entries) {
        if (!/^\.work-[\w-]+$/.test(e)) continue;
        const dir = path.join(this.rendersDir(id), e);
        if (await inUse(dir)) continue;
        await rm(dir, { recursive: true, force: true });
        removed++;
      }
    }
    return removed;
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

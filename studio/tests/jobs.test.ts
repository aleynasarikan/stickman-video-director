import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { ProjectStore } from "../server/store";
import { createApp } from "../server/app";

describe("render scratch cleanup and lost jobs", () => {
  it("removes only stale renders/.work-* folders (owner gone), never live ones, videos or other files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "jobs-"));
    try {
      const store = new ProjectStore(root);
      const r = store.rendersDir("prj_a");
      // A render killed mid-way: its owner process no longer exists.
      await mkdir(path.join(r, ".work-2026-11-02T08-00-00-000Z"), { recursive: true });
      await writeFile(path.join(r, ".work-2026-11-02T08-00-00-000Z", "voice-0.wav"), "x");
      await writeFile(path.join(r, ".work-2026-11-02T08-00-00-000Z", "owner.pid"), "999999");
      // A render still running in this (or another live) process: kept.
      await mkdir(path.join(r, ".work-2026-11-02T09-00-00-000Z"), { recursive: true });
      await writeFile(path.join(r, ".work-2026-11-02T09-00-00-000Z", "owner.pid"), String(process.pid));
      // An older version's folder without owner.pid, touched just now: kept for the hour.
      await mkdir(path.join(r, ".work-2026-11-02T10-00-00-000Z"), { recursive: true });
      await writeFile(path.join(r, "video-2026-11-02T08-00-00-000Z.mp4"), "video");
      await writeFile(path.join(r, "notlar.txt"), "kullanıcı dosyası");
      await mkdir(path.join(r, "work-kullanici"), { recursive: true });
      expect(await store.cleanupStaleWork()).toBe(1);
      expect((await readdir(r)).sort()).toEqual([
        ".work-2026-11-02T09-00-00-000Z",
        ".work-2026-11-02T10-00-00-000Z",
        "notlar.txt",
        "video-2026-11-02T08-00-00-000Z.mp4",
        "work-kullanici",
      ]);
      expect(await new ProjectStore(path.join(root, "yok")).cleanupStaleWork()).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("an unknown job (server restarted) answers 404 with what to do", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "jobs-api-"));
    const app = createApp({ store: new ProjectStore(root), ai: {}, tts: async () => null });
    const server = await new Promise<import("node:http").Server>((r) => {
      const s = app.listen(0, "127.0.0.1", () => r(s));
    });
    try {
      const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/jobs/job_yok`);
      expect(res.status).toBe(404);
      expect((await res.json()).error).toMatch(/yeniden başlamış olabilir/);
    } finally {
      server.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { createApp } from "../server/app";
import { ProjectStore } from "../server/store";

async function serve(app: ReturnType<typeof createApp>): Promise<{ server: Server; url: string }> {
  return new Promise((r) => {
    const s = app.listen(0, "127.0.0.1", () => r({ server: s, url: `http://127.0.0.1:${(s.address() as AddressInfo).port}` }));
  });
}

describe("one server: API, media and the web app on one port", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "single-"));
    await mkdir(path.join(dir, "dist", "assets"), { recursive: true });
    await writeFile(path.join(dir, "dist", "index.html"), "<!doctype html><title>Stickman</title><div id=root></div>");
    await writeFile(path.join(dir, "dist", "assets", "app.js"), "console.log(1)");
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it("built app: pages fall back to index.html; /api and /media never do", async () => {
    const { server, url } = await serve(createApp({ store: new ProjectStore(path.join(dir, "data")), ai: {}, tts: async () => null, webDist: path.join(dir, "dist") }));
    try {
      for (const p of ["/", "/?p=prj_x", "/herhangi/bir/sayfa"]) {
        const r = await fetch(url + p);
        expect(r.status).toBe(200);
        expect(await r.text()).toContain("<title>Stickman</title>");
      }
      expect(await (await fetch(url + "/assets/app.js")).text()).toBe("console.log(1)");
      expect((await fetch(url + "/api/status")).status).toBe(200);
      expect((await (await fetch(url + "/api/projects")).json()).projects).toEqual([]);
      const unknown = await fetch(url + "/api/yok");
      expect(unknown.status).toBe(404);
      expect((await unknown.json()).error).toMatch(/Bilinmeyen API/);
      const media = await fetch(url + "/media/prj_x/video-yok.mp4");
      expect(media.status).toBe(404);
      expect(media.headers.get("content-type") ?? "").not.toContain("text/html");
    } finally {
      server.close();
    }
  });

  it("dev mode: the frontend middleware gets page requests only, after the API", async () => {
    const seen: string[] = [];
    const { server, url } = await serve(
      createApp({
        store: new ProjectStore(path.join(dir, "data2")),
        ai: {},
        tts: async () => null,
        webDist: path.join(dir, "dist"), // ignored when a frontend middleware is given
        frontend: (req, res, next) => {
          if (/^\/(api|media)\//.test(req.path)) return next();
          seen.push(req.path);
          res.type("html").send("<p>vite</p>");
        },
      }),
    );
    try {
      expect(await (await fetch(url + "/storyboard")).text()).toBe("<p>vite</p>");
      expect((await fetch(url + "/api/status")).status).toBe(200);
      expect((await fetch(url + "/api/yok")).status).toBe(404);
      expect(seen).toEqual(["/storyboard"]);
    } finally {
      server.close();
    }
  });
});

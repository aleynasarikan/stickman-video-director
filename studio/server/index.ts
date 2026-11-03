import "dotenv/config";
import http from "node:http";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp, type AppDeps } from "./app";
import { ProjectStore } from "./store";
import { ClaudePlanner, CLAUDE_MODEL } from "./planner/claude";
import { QwenPlanner, QWEN_MODEL } from "./planner/qwen";
import { DeepSeekPlanner, DEEPSEEK_MODEL } from "./planner/deepseek";
import { GroqPlanner, GROQ_MODEL } from "./planner/groq";
import { closeTtsWorkers, detectTts, ttsInventory } from "./tts";
import { heavyQueueFromEnv } from "./gate";
import { assetProviderFromEnv } from "./assets";
import { loadExtraCaCerts } from "./ca";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
// One server, one port: the API, media files and the web app (built, or Vite middleware with --dev).
const port = Number(process.env.PORT || 5173);
const dev = process.argv.includes("--dev");
// Bind to localhost only: this is a local tool and has no authentication.
const host = process.env.HOST || "127.0.0.1";

const extraCa = loadExtraCaCerts(process.env.EXTRA_CA_CERTS, root);

const ai: AppDeps["ai"] = {};
const qwenKey = process.env.QWEN_API_KEY || process.env.DASHSCOPE_API_KEY;
// Set QWEN_PAID=false for a free (e.g. in-house) gateway so the UI does not label it paid.
if (qwenKey) ai.qwen = { planner: new QwenPlanner(qwenKey), model: QWEN_MODEL, paid: process.env.QWEN_PAID !== "false" };
// Groq's default plan is the free tier, so it is labelled free unless GROQ_PAID=true.
if (process.env.GROQ_API_KEY) ai.groq = { planner: new GroqPlanner(process.env.GROQ_API_KEY), model: GROQ_MODEL, paid: process.env.GROQ_PAID === "true" };
if (process.env.DEEPSEEK_API_KEY)
  ai.deepseek = { planner: new DeepSeekPlanner(process.env.DEEPSEEK_API_KEY), model: DEEPSEEK_MODEL, paid: process.env.DEEPSEEK_PAID !== "false" };
if (process.env.ANTHROPIC_API_KEY) ai.claude = { planner: new ClaudePlanner(process.env.ANTHROPIC_API_KEY), model: CLAUDE_MODEL, paid: true };

const assets = assetProviderFromEnv();
const store = new ProjectStore(path.resolve(root, process.env.DATA_DIR || "data/projects"));
// No render can be running yet: scratch folders from a render that was killed are stale.
store.cleanupStaleWork().then((n) => n && console.log(`Yarıda kalmış ${n} render'ın geçici dosyaları temizlendi.`)).catch(() => {});
const server = http.createServer();

// Development: Vite runs inside this server as middleware (live reload over this same port), so
// there is no second Vite server and no proxy. Production: the built files in dist/ are served.
let vite: import("vite").ViteDevServer | null = null;
if (dev) {
  const { createServer } = await import("vite");
  vite = await createServer({
    configFile: path.join(root, "vite.config.ts"),
    root: path.join(root, "web"),
    appType: "spa",
    server: { middlewareMode: true, hmr: { server } },
  });
}
const viteServer = vite;
const webDist = path.join(root, "dist");
if (!dev && !existsSync(path.join(webDist, "index.html"))) console.warn("Arayüz derlenmemiş: önce `npm run build` çalıştırın (ya da `npm run dev`).");

const app = createApp({
  store,
  ai,
  tts: detectTts,
  webDist: dev ? undefined : webDist,
  // API and media addresses never reach Vite.
  frontend: viteServer ? (req, res, next) => (/^\/(api|media)\//.test(req.path) ? next() : viteServer.middlewares(req, res, next)) : undefined,
  heavy: heavyQueueFromEnv(),
  assets,
  ttsInventory,
});
server.on("request", app);

server.listen(port, host, () => {
  console.log(`Stickman Video Studio: http://${host}:${port} (${dev ? "geliştirme, canlı yenileme" : "derlenmiş arayüz"}; API ve arayüz aynı portta)`);
  if (extraCa.length) console.log(`Ek sertifikalar: ${extraCa.join(", ")}`);
  const names = Object.entries(ai).map(([k, v]) => `${k} (${v.model})`);
  console.log(names.length ? `Yapay zekâ planlayıcı: ${names.join(", ")}` : "Planlayıcı: çevrimdışı (QWEN / GROQ / DEEPSEEK / ANTHROPIC anahtarı tanımlı değil)");
  if (assets.provider) console.log(`Görsel servisi: ${assets.provider.name} (yalnızca yerel)`);
  else if (assets.problem) console.warn(`Görsel servisi kapalı: ${assets.problem}`);
});

// Stop the TTS worker processes (each holds a model in memory) when the server stops.
let stopping = false;
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    if (stopping) return;
    stopping = true;
    closeTtsWorkers();
    void viteServer?.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}

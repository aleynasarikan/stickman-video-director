import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp, type AppDeps } from "./app";
import { ProjectStore } from "./store";
import { ClaudePlanner, CLAUDE_MODEL } from "./planner/claude";
import { QwenPlanner, QWEN_MODEL } from "./planner/qwen";
import { DeepSeekPlanner, DEEPSEEK_MODEL } from "./planner/deepseek";
import { GroqPlanner, GROQ_MODEL } from "./planner/groq";
import { detectTts } from "./tts";
import { loadExtraCaCerts } from "./ca";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const port = Number(process.env.PORT || 5174);
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

const app = createApp({
  store: new ProjectStore(path.resolve(root, process.env.DATA_DIR || "data/projects")),
  ai,
  tts: detectTts,
  webDist: path.join(root, "dist"),
});

app.listen(port, host, () => {
  console.log(`Stickman Video Studio API: http://${host}:${port}`);
  if (extraCa.length) console.log(`Ek sertifikalar: ${extraCa.join(", ")}`);
  const names = Object.entries(ai).map(([k, v]) => `${k} (${v.model})`);
  console.log(names.length ? `Yapay zekâ planlayıcı: ${names.join(", ")}` : "Planlayıcı: çevrimdışı (QWEN / GROQ / DEEPSEEK / ANTHROPIC anahtarı tanımlı değil)");
});

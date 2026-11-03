import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The dev server is not run on its own: `npm run dev` mounts Vite as middleware inside the API
// server (server/index.ts), so the app, the API and live reload share one port.
export default defineConfig({
  root: "web",
  plugins: [react()],
  build: { outDir: "../dist", emptyOutDir: true },
  test: { root: ".", include: ["tests/**/*.test.ts"], testTimeout: 60000 },
});

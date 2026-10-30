import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const api = `http://127.0.0.1:${process.env.PORT || 5174}`;

export default defineConfig({
  root: "web",
  plugins: [react()],
  build: { outDir: "../dist", emptyOutDir: true },
  server: {
    // IPv4 explicitly: "localhost" may resolve to ::1 only, and browsers then fail on 127.0.0.1.
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    open: true,
    // Trailing slashes matter: a bare "/api" prefix would also swallow web/api.ts.
    proxy: { "/api/": api, "/media/": api },
  },
  test: { root: ".", include: ["tests/**/*.test.ts"], testTimeout: 60000 },
});

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "@fontsource-variable/schibsted-grotesk";
import "./styles.css";

// The canvas only uses the handwritten font once it has loaded, so wait for it briefly
// (never more than a second: a missing font just falls back to a system face).
const fontReady = document.fonts?.load(`700 40px "Caveat"`).catch(() => undefined) ?? Promise.resolve();
Promise.race([fontReady, new Promise((r) => setTimeout(r, 1000))]).finally(() =>
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
);

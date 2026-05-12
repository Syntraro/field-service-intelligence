import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// ---------------------------------------------------------------------------
// ChunkLoadError recovery (2026-05-11)
//
// After a deploy, Vite's emptyOutDir deletes all prior-build hashed chunks.
// A long-lived SPA session that hasn't reloaded yet will 404 when it tries
// to lazy-import a route whose chunk filename changed. Catch those failures
// and force a single reload so the user transparently picks up the new bundle.
//
// Guard: sessionStorage timestamp prevents reload loops — if we already
// reloaded for a chunk error within the last 30 seconds, suppress subsequent
// fires (avoids infinite loop if the new build itself has a broken chunk).
// ---------------------------------------------------------------------------
const CHUNK_RELOAD_KEY = "__syntraro_chunk_reload__";

function isChunkError(msg: string, name?: string): boolean {
  return (
    name === "ChunkLoadError" ||
    msg.includes("ChunkLoadError") ||
    msg.includes("Failed to fetch dynamically imported module") ||
    msg.includes("Importing a module script failed") ||
    msg.includes("dynamically imported module")
  );
}

function maybeReloadForChunkError(msg: string, name?: string): void {
  if (!isChunkError(msg, name)) return;
  const lastReload = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) ?? "0");
  if (Date.now() - lastReload < 30_000) return;
  sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
  window.location.reload();
}

window.addEventListener("error", (event) => {
  maybeReloadForChunkError(event.message ?? "", event.error?.name);
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  const msg = String(reason?.message ?? reason ?? "");
  maybeReloadForChunkError(msg, reason?.name);
});

createRoot(document.getElementById("root")!).render(<App />);

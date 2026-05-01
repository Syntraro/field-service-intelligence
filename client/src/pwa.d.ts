/// <reference types="vite-plugin-pwa/react" />
/// <reference types="vite-plugin-pwa/client" />

// 2026-04-30: build-id global, injected into index.html by the
// `syntraro-build-id` Vite plugin (see vite.config.ts). Read by
// `PwaUpdatePrompt.tsx` to make the reload guard build-aware.
interface Window {
  __SYNTRARO_BUILD__?: string;
}

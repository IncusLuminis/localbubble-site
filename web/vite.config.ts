import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Plain Vite + Vitest config (spec Idea.md §31, §38; Story #64). No UI
// framework - vanilla TypeScript + Three.js, per spec §31's preference
// against introducing React unless it materially simplifies the UI (it
// doesn't for this MVP: one canvas, no forms/panels yet).
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        about: fileURLToPath(new URL("./about.html", import.meta.url)),
      },
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});

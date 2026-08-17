import { defineConfig } from "vitest/config";

// Plain Vite + Vitest config (spec Idea.md §31, §38; Story #64). No UI
// framework - vanilla TypeScript + Three.js, per spec §31's preference
// against introducing React unless it materially simplifies the UI (it
// doesn't for this MVP: one canvas, no forms/panels yet).
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});

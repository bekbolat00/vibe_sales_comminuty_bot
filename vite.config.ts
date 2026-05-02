import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
  build: {
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, "lesson-player-entry.tsx"),
      output: {
        format: "iife",
        name: "LessonPlayerMount",
        entryFileNames: "lesson-player.js",
        inlineDynamicImports: true,
      },
    },
    outDir: "dist",
  },
});

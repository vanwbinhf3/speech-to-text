/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const isolationHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig({
  plugins: [react()],
  worker: {
    // Moonshine's Emscripten worker uses top-level await and must remain ESM.
    format: "es",
  },
  server: { headers: isolationHeaders },
  preview: { headers: isolationHeaders },
  test: {
    environment: "node",
  },
});

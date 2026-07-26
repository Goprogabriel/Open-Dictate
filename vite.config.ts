import path from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host ?? false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**", "**/functions/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    // macOS 12 ships WebKit 17612 (Safari 15.2). Keeping the bundle target
    // aligned with the declared native minimum avoids unsupported legacy
    // transforms while preserving the full supported OS range.
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari15.2",
    minify: process.env.TAURI_ENV_DEBUG ? false : "esbuild",
    sourcemap: Boolean(process.env.TAURI_ENV_DEBUG),
    rolldownOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("/node_modules/@firebase/firestore/")) return "firebase-firestore";
          if (id.includes("/node_modules/@firebase/auth/")) return "firebase-auth";
          if (id.includes("/node_modules/@firebase/") || id.includes("/node_modules/firebase/")) {
            return "firebase-core";
          }
          if (
            id.includes("/node_modules/i18next/") ||
            id.includes("/node_modules/react-i18next/")
          ) {
            return "i18n";
          }
          if (id.includes("/node_modules/recharts/") || id.includes("/node_modules/d3-")) {
            return "charts";
          }
          return undefined;
        },
      },
    },
  },
});

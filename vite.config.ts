import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import packageInfo from "./package.json" with { type: "json" };

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  define: {
    __APP_VERSION__: JSON.stringify(packageInfo.version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __GITHUB_URL__: JSON.stringify(packageInfo.repository.url),
  },
  server: {
    port: Number(process.env.CALCBOOK_PORT ?? 1420),
    strictPort: true,
  },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: { target: "es2022" },
});

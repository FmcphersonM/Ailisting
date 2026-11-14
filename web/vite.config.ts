import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  plugins: [react()],
  build: { outDir: path.join(here, "dist"), emptyOutDir: true },
  server: {
    port: 5173,
    fs: { allow: [path.join(here, "..")] }, // the app also uses code in ../shared
    // While developing, API calls go to the server started by "npm run dev".
    proxy: { "/api": "http://localhost:3000" },
  },
});

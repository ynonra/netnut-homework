import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The backend base URL is injected at runtime via VITE_API_URL. In docker-compose
// the dev server proxies /api to the backend service so the browser needs no CORS
// knowledge of container networking.
export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.VITE_API_PROXY_TARGET ?? "http://localhost:4000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});

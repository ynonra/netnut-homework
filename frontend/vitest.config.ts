import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Frontend tests run in jsdom so React components and React Query can mount and
// poll without a browser. Kept separate from the Vite app build config.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
  },
});

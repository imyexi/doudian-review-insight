import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@server": path.resolve(import.meta.dirname, "server"),
    },
  },
  test: {
    root: ".",
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.claude/**",
    ],
  },
});

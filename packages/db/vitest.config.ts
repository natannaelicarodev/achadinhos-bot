import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Cada arquivo sobe seu próprio PGlite; a primeira inicialização é lenta.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});

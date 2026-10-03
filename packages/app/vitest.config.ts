import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    conditions: [
      "inkback-source",
      "module",
      "browser",
      "development|production",
    ],
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  ssr: {
    resolve: {
      conditions: [
        "inkback-source",
        "module",
        "node",
        "development|production",
      ],
    },
  },
  test: {
    // jsdom/editor workers are CPU-heavy; avoid saturating the host machine.
    maxWorkers: 4,
    coverage: {
      provider: "v8",
      reportsDirectory: "../../coverage/app",
      exclude: [
        "dist/**",
        "test/**",
        "src/**/*.test.ts",
        "src/**/*.test.tsx",
        "src/types.d.ts",
      ],
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 50,
        statements: 60,
      },
    },
    environment: "jsdom",
    include: [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "test/**/*.test.ts",
      "test/**/*.test.tsx",
    ],
  },
});

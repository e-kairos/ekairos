import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      { find: "@ekairos/domain/runtime", replacement: resolve(__dirname, "..", "domain", "src", "runtime.ts") },
      { find: "@ekairos/domain", replacement: resolve(__dirname, "..", "domain", "src", "index.ts") },
      { find: "@ekairos/events/schema", replacement: resolve(__dirname, "..", "events", "src", "schema.ts") },
      { find: "@ekairos/events/instant", replacement: resolve(__dirname, "..", "events", "src", "stores", "instant.store.ts") },
      { find: "@ekairos/events", replacement: resolve(__dirname, "..", "events", "src", "index.ts") },
      { find: "@ekairos/reactor/runtime", replacement: resolve(__dirname, "..", "reactor", "src", "runtime.ts") },
      { find: "@ekairos/reactor/context", replacement: resolve(__dirname, "..", "reactor", "src", "context.ts") },
      { find: "@ekairos/reactor", replacement: resolve(__dirname, "..", "reactor", "src", "index.ts") },
      { find: "@ekairos/sandbox/sandbox", replacement: resolve(__dirname, "..", "sandbox", "src", "sandbox.ts") },
      { find: "@ekairos/sandbox/contract", replacement: resolve(__dirname, "..", "sandbox", "src", "contract.ts") },
      { find: "@ekairos/sandbox/schema", replacement: resolve(__dirname, "..", "sandbox", "src", "schema.ts") },
      { find: "@ekairos/sandbox", replacement: resolve(__dirname, "..", "sandbox", "src", "index.ts") },
      { find: "@ekairos/openai-reactor", replacement: resolve(__dirname, "..", "reactors", "openai-reactor", "src", "index.ts") },
    ],
  },
  test: {
    environment: "node",
    include: ["src/tests/**/*.codex.instant.test.ts"],
    exclude: ["**/node_modules/**"],
    testTimeout: 12 * 60 * 1000,
    hookTimeout: 6 * 60 * 1000,
    reporters: ["default"],
  },
});

import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Phase A test setup. Covers the highest-blast-radius mirrored helpers
 * (web `lib/*` ↔ functions `functions/lib/*`) and any pure logic that
 * silently corrupts downstream Firestore docs / Shopify products if it
 * drifts. Keep tests deterministic and free of Firebase / fal.ai I/O.
 *
 * Path aliases mirror tsconfig.json so test files can import via `@/lib/...`
 * the same way the Next.js app does.
 */
export default defineConfig({
  test: {
    /** Discover tests in tests/ + co-located *.test.ts next to source. */
    include: ["tests/**/*.test.{ts,js}", "lib/**/*.test.{ts,js}"],
    /** Don't try to crawl functions/node_modules or .next. */
    exclude: ["node_modules/**", "functions/node_modules/**", ".next/**"],
    /** No DOM needed for these helpers — node env is faster + simpler. */
    environment: "node",
    /** Each test file gets ~5s; bump per-test if any real work creeps in. */
    testTimeout: 5_000,
    /** Useful summary even when all pass. */
    reporters: ["default"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});

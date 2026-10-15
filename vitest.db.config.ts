import { defineConfig, mergeConfig } from "vitest/config";
import base from "./vitest.config";
export default mergeConfig(
  base,
  defineConfig({
    test: {
      include: ["tests/db/**/*.test.ts"],
      fileParallelism: false,
      testTimeout: 20000,
      hookTimeout: 30000,
    },
  }),
);

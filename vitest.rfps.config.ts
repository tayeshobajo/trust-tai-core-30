import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "jsdom",
    include: [
      "src/domain/rfps.test.ts",
      "src/components/tt/rfps/*.test.tsx",
      "src/domain/registry.test.ts",
      "src/domain/app-access.test.ts",
    ],
  },
});

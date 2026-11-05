import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "jsdom",
    include: [
      "src/domain/rfps.test.ts",
      "src/domain/rfp-intake.test.ts",
      "src/lib/rfp-source-url.server.test.ts",
      "src/routes/api/public/rfps.source.test.ts",
      "qa/rfps-staging/guard.test.ts",
      "src/components/tt/rfps/*.test.tsx",
      "src/components/tt/cmd/*.test.tsx",
      "src/domain/registry.test.ts",
      "src/domain/app-access.test.ts",
    ],
  },
});

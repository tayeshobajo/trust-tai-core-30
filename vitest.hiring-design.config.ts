import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "node",
    include: [
      "src/domain/hiring.test.ts",
      "src/lib/hiring-provider.test.ts",
      "src/lib/hiring-intake.test.ts",
      "src/lib/hiring-email-*.test.ts",
      "src/components/tt/hiring/*.test.{ts,tsx}",
    ],
  },
});

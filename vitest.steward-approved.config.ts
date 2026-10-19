import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "jsdom",
    include: [
      "src/domain/steward-completion.test.ts",
      "src/components/tt/steward/approved-meetings.test.tsx",
      "src/data/supabase/steward-updates.test.ts",
    ],
  },
});

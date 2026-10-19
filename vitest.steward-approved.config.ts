import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "jsdom",
    include: [
      "src/components/tt/steward/semantic-review-confirm.test.tsx",
      "src/data/supabase/steward-confirm.test.ts",
      "src/components/tt/steward/meeting-processing-queue.test.tsx",
      "src/domain/steward-completion.test.ts",
      "src/data/steward/board-refresh.test.ts",
      "src/components/tt/steward/approved-meetings.test.tsx",
      "src/data/supabase/steward-updates.test.ts",
    ],
  },
});

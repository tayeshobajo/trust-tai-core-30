import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/** Focused application checks. PostgreSQL policy tests have their own isolated harness. */
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "node",
    include: [
      "src/domain/cmd-tasks.test.ts",
      "src/data/supabase/cmd-tasks.test.ts",
      "src/data/supabase/weekly-goals-confirm.test.ts",
      "src/data/supabase/steward-tasks-classification.test.ts",
      "src/components/tt/steward/business-task-board.test.tsx",
      "src/components/tt/steward/task-context.test.tsx",
      "src/data/steward/accountability.test.ts",
      "src/data/steward/actions.test.ts",
      "src/routes/dashboard-placement.test.ts",
      "src/domain/steward-dashboard-stats.test.ts",
      "src/domain/steward-weekly-goal-proposer.test.ts",
      "src/domain/steward-weekly-goal.test.ts",
      "src/components/tt/steward/dashboard/dashboard-pagination.test.ts",
    ],
  },
});

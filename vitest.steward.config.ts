import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/** Focused Steward workroom checks. PostgreSQL policy tests have their own isolated harness. */
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "node",
    include: [
      "src/lib/steward-full-meeting.server.test.ts",
      "src/lib/steward-retrieval.test.ts",
      "src/domain/steward-display-title.test.ts",
      "src/domain/steward-proposal-groups.test.ts",
      "src/domain/steward-preparation-actions.test.ts",
      "src/domain/steward-workroom.test.ts",
      "src/domain/cmd-tasks.test.ts",
      "src/components/tt/steward/workroom-shell.test.tsx",
      "src/components/tt/steward/meeting-association.test.tsx",
      "src/components/tt/steward/add-required-task.test.tsx",
      "src/components/tt/steward/task-context.test.tsx",
      "src/components/tt/steward/task-history.test.tsx",
      "src/components/tt/steward/business-task-board.test.tsx",
      "src/components/tt/steward/workroom-receipts.test.ts",
      "src/lib/steward-canonical-run.test.ts",
      "src/lib/steward-verification.test.ts",
      "src/lib/steward-coverage.test.ts",
      "src/lib/steward-proposal-link.test.ts",
      "src/lib/steward-supabase-adapters.test.ts",
    ],
  },
});

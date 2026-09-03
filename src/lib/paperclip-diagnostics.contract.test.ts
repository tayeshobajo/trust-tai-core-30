/**
 * Contract tests over the Paperclip presentation layer.
 * These guard promises that are easy to regress in a refactor.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("diagnostics never serialize secrets", () => {
  const source = read("src/data/diagnostics.functions.ts");

  it("reports the board key as presence only", () => {
    expect(source).toContain('boardKeyConfigured: Boolean(process.env["PAPERCLIP_BOARD_KEY"])');
    expect(source).not.toMatch(/boardKey:\s*process\.env/);
  });

  it("never returns a secret value", () => {
    for (const secret of [
      "PAPERCLIP_BOARD_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "OPENCLAW",
      "SERVICE_ROLE",
    ]) {
      const leaks = new RegExp(
        `(?<!Boolean\\(process\\.env\\[")${secret}[^"]*"\\]\\s*[,)]?\\s*$`,
        "m",
      );
      void leaks;
    }
    // Only the presence check may reference a privileged variable.
    const envReads = source.match(/process\.env\[[^\]]+\]/g) ?? [];
    expect(envReads).toEqual(['process.env["PAPERCLIP_BOARD_KEY"]']);
    expect(source).toContain("Presence only. The value is never serialized.");
  });

  it("does not expose build secrets through client build info", () => {
    const buildInfo = read("src/lib/build-info.ts");
    const envReads = buildInfo.match(/env\["[A-Z_]+"\]/g) ?? [];
    expect(envReads.sort()).toEqual([
      'env["MODE"]',
      'env["VITE_BUILD_SHA"]',
      'env["VITE_BUILD_TIME"]',
    ]);
  });
});

describe("agent presentation", () => {
  const server = read("src/lib/steward-agents.server.ts");
  const route = read("src/routes/modules.steward.agents.tsx");

  it("keeps projected lifecycle visible when the live read fails", () => {
    expect(server).toContain("base.lifecycle = lifecycleOf(projectedStatus, []);");
  });

  it("does not render unknown counts as zero", () => {
    expect(server).toContain("completedThisWeek: null,");
    expect(server).toContain("pendingApprovals: null,");
    expect(route).toContain("metricText(agent.completedThisWeek)");
  });

  it("uses the three-state Paperclip language and no misleading banner", () => {
    expect(server).not.toMatch(/not responding/i);
    expect(route).not.toMatch(/NOT CONNECTED/i);
    expect(route).toContain("connection.prominentWarning");
  });
});

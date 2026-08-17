import { describe, expect, it } from "vitest";
import type { PostgrestError } from "@supabase/supabase-js";

import { LEARNING_TABLES, classifyError, healthMessage } from "./conductor-schema";

function err(partial: Partial<PostgrestError>): PostgrestError {
  return {
    message: "",
    details: "",
    hint: "",
    code: "",
    name: "PostgrestError",
    ...partial,
  } as PostgrestError;
}

describe("conductor schema health", () => {
  it("reads no error as reachable", () => {
    expect(classifyError(null)).toBe("ready");
  });

  it("recognises an absent table from the schema cache", () => {
    expect(
      classifyError(
        err({ code: "PGRST205", message: "Could not find the table 'public.business_figures'" }),
      ),
    ).toBe("missing");
  });

  it("recognises undefined_table from Postgres itself", () => {
    expect(classifyError(err({ code: "42P01", message: 'relation "x" does not exist' }))).toBe(
      "missing",
    );
  });

  it("recognises a missing grant or refusing policy", () => {
    expect(
      classifyError(
        err({ code: "42501", message: "permission denied for table business_figures" }),
      ),
    ).toBe("forbidden");
  });

  it("leaves anything else unknown rather than guessing", () => {
    expect(classifyError(err({ code: "08006", message: "connection failure" }))).toBe("unknown");
  });

  it("names the migration when tables are missing", () => {
    const message = healthMessage(["business_figures"], [], []);
    expect(message).toContain("conductor-v1-schema.sql");
    expect(message).toContain("business_figures");
  });

  it("names membership and grants when access is refused", () => {
    const message = healthMessage([], ["conductor_corrections"], []);
    expect(message).toContain("cannot reach it");
    expect(message).toContain("conductor_corrections");
  });

  it("says plainly when everything is reachable", () => {
    expect(healthMessage([], [], [])).toContain("Ledger reachable");
  });
});

describe("the V3 learning ledger check", () => {
  it("names both outcome tables, and only those", () => {
    expect([...LEARNING_TABLES]).toEqual(["conductor_observations", "conductor_learning"]);
  });

  it("distinguishes an absent V3 migration from a refused one", () => {
    /* This is the exact pair the live project returns today: V2 present and
     * anon-denied, V3 not created at all. */
    expect(
      classifyError(
        err({
          code: "PGRST205",
          message: "Could not find the table 'public.conductor_learning' in the schema cache",
        }),
      ),
    ).toBe("missing");
    expect(
      classifyError(
        err({ code: "42501", message: "permission denied for table conductor_observations" }),
      ),
    ).toBe("forbidden");
  });
});

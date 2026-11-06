import { expect, it } from "vitest";
import { ResearchDiagnosticError, researchDiagnostic } from "./studio-research-diagnostics.server";
it("only returns fixed categories and never arbitrary error details", () => {
  for (const error of [
    new Error("Bearer private-token"),
    { category: "binding_missing" },
    "secret",
    null,
  ]) {
    expect(researchDiagnostic(error)).toBe("unexpected_failure");
  }
  const forged = new ResearchDiagnosticError("binding_missing");
  Object.assign(forged, { category: "private-token" });
  expect(researchDiagnostic(forged)).toBe("unexpected_failure");
  expect(researchDiagnostic(new ResearchDiagnosticError("binding_missing"))).toBe(
    "binding_missing",
  );
});

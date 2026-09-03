import { describe, expect, it } from "vitest";

import {
  classifyExecutionOwner,
  correctExecutionBoundary,
  ownedExecutionBoundary,
} from "./execution-ownership";

describe("execution ownership law", () => {
  it("gives dashboards and prototypes to Projects", () => {
    const read = classifyExecutionOwner(
      "Leadership alignment dashboard (executive view)",
      "An interactive dashboard prototype for the leadership team.",
    );
    expect(read.primary).toBe("projects");
  });

  it("never lets Studio own software, websites or integrations", () => {
    for (const subject of [
      "Rebuild the marketing website",
      "Ship the mobile app MVP",
      "CRM integration with the booking system",
      "Interactive ROI calculator prototype",
    ]) {
      expect(classifyExecutionOwner(subject).primary).not.toBe("studio");
    }
  });

  it("gives recurring technical work to Ops", () => {
    expect(
      classifyExecutionOwner("Ongoing hosting, monitoring and security patch retainer").primary,
    ).toBe("ops");
  });

  it("gives content production to Studio", () => {
    expect(
      classifyExecutionOwner("Monthly thought leadership newsletter and LinkedIn content series")
        .primary,
    ).toBe("studio");
  });

  it("keeps the primary owner explicit when work spans rooms", () => {
    const read = classifyExecutionOwner(
      "Launch the client portal app with a supporting blog and newsletter campaign",
    );
    expect(read.primary).toBe("projects");
    expect(read.secondary).toContain("studio");
  });

  it("defaults to Projects rather than Studio", () => {
    expect(classifyExecutionOwner("Something unrecognised").primary).toBe("projects");
  });

  it("rewrites a boundary sentence that names the wrong room", () => {
    expect(
      correctExecutionBoundary(
        "Studio builds an interactive dashboard prototype only.",
        "projects",
      ),
    ).toBe("Projects builds an interactive dashboard prototype only.");
  });

  it("corrects the recorded milestone end to end", () => {
    const result = ownedExecutionBoundary({
      name: "Leadership alignment dashboard (executive view)",
      whatWeBuild: "A read-only executive dashboard.",
      executionBoundary: "Studio builds an interactive dashboard prototype. No data engineering.",
    });
    expect(result.owner.primary).toBe("projects");
    expect(result.boundary).toBe(
      "Projects builds an interactive dashboard prototype. No data engineering.",
    );
  });
});

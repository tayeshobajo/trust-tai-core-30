import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { APP_REGISTRY, deepLinkedApps, PRIMARY_NAVIGATION, primaryNavigation } from "./registry";

const ROUTES_DIR = resolve(__dirname, "../routes");

/** The file that answers a room's canonical route, by the router's naming. */
function routeFileFor(route: string): string {
  const segments = route.split("/").filter(Boolean);
  return resolve(ROUTES_DIR, `${segments.join(".")}.tsx`);
}

describe("the ordinary navigation is the charter's, in the charter's order", () => {
  it("lists exactly Home, Clients, Scout, Comms, Website, Ops, Studio, Pulse, Conductor, Approvals, Steward", () => {
    expect(primaryNavigation().map((app) => app.name)).toEqual([
      "Home",
      "Clients",
      "Scout",
      "Comms",
      "Website",
      "Ops",
      "Studio",
      "Pulse",
      "Conductor",
      "Approvals",
      "Steward",
    ]);
  });

  it("never shows Roadmap or Projects on the rail, even to someone allowed into them", () => {
    const everyone = APP_REGISTRY.map((app) => app.id);
    const rail = primaryNavigation(everyone).map((app) => app.id);
    expect(rail).not.toContain("roadmap");
    expect(rail).not.toContain("projects");
  });

  it("narrows to what the person may see, without reordering", () => {
    const rail = primaryNavigation(["steward", "home", "comms"]).map((app) => app.id);
    expect(rail).toEqual(["home", "comms", "steward"]);
  });

  it("names only rooms that exist, and every primary room is named", () => {
    for (const id of PRIMARY_NAVIGATION) {
      expect(APP_REGISTRY.some((app) => app.id === id)).toBe(true);
    }
    for (const app of APP_REGISTRY) {
      if (app.navigation === "deep_link") continue;
      expect(PRIMARY_NAVIGATION).toContain(app.id);
    }
  });
});

describe("leaving the rail is not a demotion", () => {
  it("keeps Roadmap and Projects registered as business rooms with their routes", () => {
    const deep = deepLinkedApps();
    expect(deep.map((app) => app.id).sort()).toEqual(["projects", "roadmap"]);
    for (const app of deep) {
      expect(app.layer).toBe("business");
      expect(app.status).toBe("live");
      expect(app.route.startsWith("/modules/")).toBe(true);
    }
  });

  it("still has a route file answering each deep-linked room and its detail page", () => {
    expect(existsSync(routeFileFor("/modules/roadmap"))).toBe(true);
    expect(existsSync(resolve(ROUTES_DIR, "modules.roadmap.index.tsx"))).toBe(true);
    expect(existsSync(resolve(ROUTES_DIR, "modules.roadmap.$roadmapId.tsx"))).toBe(true);
    expect(existsSync(routeFileFor("/modules/projects"))).toBe(true);
    expect(existsSync(resolve(ROUTES_DIR, "modules.projects.index.tsx"))).toBe(true);
    expect(existsSync(resolve(ROUTES_DIR, "modules.projects.$projectId.tsx"))).toBe(true);
  });
});

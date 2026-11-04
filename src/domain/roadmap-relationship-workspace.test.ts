import { expect, it } from "vitest";
import { projectEvidence } from "./roadmap-evidence";
import { native } from "./roadmap-evidence.fixtures";
import {
  latestRelationshipActivity,
  relationshipHealth,
  relationshipMetrics,
  outreachBlocked,
} from "./roadmap-relationship-workspace";
const now = new Date("2026-11-04T12:00:00Z");
const r = () => ({
  ...projectEvidence([native], native.organizationId)[0]!,
  owner: "Known reviewer",
  nextAction: "Review sequence",
  followUp: "2026-11-05",
});
it("keeps scheduling distinct from reviewed health", () => {
  expect(relationshipHealth(r(), now)).toMatchObject({
    health: "approaching",
    standing: "unverified",
  });
  expect(relationshipHealth({ ...r(), followUp: "2026-11-18" }, now).health).toBe("not_assessed");
  expect(relationshipHealth({ ...r(), followUp: null }, now).health).toBe("not_assessed");
});
it("counts saved roadmaps separately from publication observations and missing reviews", () => {
  const one = r();
  const { native: _native, ...sourceOnly } = one;
  const summary = relationshipMetrics([one, { ...sourceOnly, key: "source-only" }], now);
  expect(summary).toMatchObject({ total: 1, sourceOnly: 1, onTrack: null });
});
it("preserves suppression and archived states behind composer and health", () => {
  const held = {
    ...r(),
    native: {
      ...native,
      metadata: {
        outreach_holds: [
          { kind: "declined", source: "Synthetic proof", outreach_suppressed: true },
        ],
      },
    },
  };
  expect(relationshipHealth(held, now).health).toBe("attention");
  expect(outreachBlocked(held)).toBe(true);
  const archived = { ...r(), native: { ...native, status: "archived" as const } };
  expect(relationshipHealth(archived, now).health).toBe("inactive");
  expect(outreachBlocked(archived)).toBe(true);
});
it("uses the newest observed activity without assuming email covers LinkedIn", () => {
  const one = {
    ...r(),
    importedActivity: {
      roadmapId: native.id,
      latest: {
        channel: "linkedin_sales_navigator" as const,
        kind: "sent" as const,
        at: "2026-11-03T12:00:00Z",
      },
      hasSent: true,
      hasReceived: false,
      coverage: "partial" as const,
    },
  };
  expect(latestRelationshipActivity(one)).toMatchObject({
    channel: "linkedin_sales_navigator",
    kind: "sent",
  });
});

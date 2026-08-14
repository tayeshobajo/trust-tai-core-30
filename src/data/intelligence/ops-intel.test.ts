/**
 * Acceptance checks for Ops evidence inside the intelligence layer.
 *
 * These run the real reader, the real derivation and the real answer path over
 * activity rows shaped the way Ops writes them.
 */

import { describe, expect, it } from "vitest";

import type { ActivityEvent } from "@/domain/activity";
import { OPS_ORIGIN } from "@/domain/ops";
import { answer, contextBlocks, deriveSignals, emptySnapshot } from "./derive";

const NOW = "2026-08-14T12:00:00.000Z";
const ORG = "org-1";

function opsRow(
  name: string,
  overrides: {
    at?: string;
    metadata?: Record<string, unknown>;
    summary?: string;
    org?: string;
  } = {},
): ActivityEvent {
  const at = overrides.at ?? "2026-08-13T09:00:00.000Z";
  return {
    id: `${name}-${at}`,
    organizationId: overrides.org ?? ORG,
    name: name as ActivityEvent["name"],
    subject: { type: "website", id: "site-1", label: "northbeam.example" },
    summary: overrides.summary ?? `Ops recorded ${name}.`,
    payload: {
      source_app: "ops",
      canonical_project_id: "proj-1",
      destination_route: `/projects/proj-1/runs/run-9`,
      ops_run_id: "run-9",
      label: "northbeam.example",
      ...(overrides.metadata ?? {}),
    },
    provenance: {
      appId: "ops",
      actor: { type: "system", id: "ops" },
      observedAt: at,
      confidence: "observed",
    },
    occurredAt: at,
  };
}

function snapshotWith(rows: ActivityEvent[]) {
  return { ...emptySnapshot(ORG, NOW), opsActivities: rows };
}

describe("Ops evidence", () => {
  it("reads an Ops row with its source, tier and provenance intact", () => {
    const blocks = contextBlocks(snapshotWith([opsRow("ops.issue_detected")]));
    const block = blocks.find((b) => b.appId === "ops");
    expect(block).toBeDefined();
    expect(block!.tier).toBe("observed");
    expect(block!.evidence[0]?.url).toContain(OPS_ORIGIN);
  });

  it("treats an Ops row as decided only when it records a person's decision", () => {
    const blocks = contextBlocks(
      snapshotWith([
        opsRow("ops.fix_applied", { metadata: { source_event_key: "k1", decided_by: "tai" } }),
      ]),
    );
    expect(blocks.find((b) => b.appId === "ops")!.tier).toBe("decided");
  });

  it("does not double count a duplicate Ops row", () => {
    const rows = [
      opsRow("ops.blocked", { metadata: { source_event_key: "evt-1" } }),
      opsRow("ops.blocked", {
        at: "2026-08-13T09:00:05.000Z",
        metadata: { source_event_key: "evt-1" },
      }),
    ];
    const snapshot = snapshotWith(rows);
    expect(contextBlocks(snapshot).filter((b) => b.appId === "ops")).toHaveLength(1);
    expect(deriveSignals(snapshot).filter((s) => s.id.startsWith("ops:"))).toHaveLength(1);
  });

  it("derives an evidence-bound technical blocker from ops.blocked", () => {
    const signals = deriveSignals(snapshotWith([opsRow("ops.blocked")]));
    const signal = signals.find((s) => s.category === "technical_risk");
    expect(signal).toBeDefined();
    expect(signal!.contextRefs.length).toBeGreaterThan(0);
    expect(signal!.destination.route).toBe(`${OPS_ORIGIN}/projects/proj-1/runs/run-9`);
  });

  it("reads the real Ops payload keys for route, run and dedupe", () => {
    const row = opsRow("ops.blocked", { metadata: { source_event_key: "evt-live-1" } });
    const blocks = contextBlocks(snapshotWith([row])).filter((b) => b.appId === "ops");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.evidence[0]?.url).toBe(`${OPS_ORIGIN}/projects/proj-1/runs/run-9`);
  });

  it("de-duplicates on provenance.dedupe_key for rows written before the column", () => {
    const first = opsRow("ops.blocked");
    const second = opsRow("ops.blocked", { at: "2026-08-13T09:00:07.000Z" });
    for (const row of [first, second]) {
      delete (row.payload as Record<string, unknown>)["source_event_key"];
      (row.provenance as unknown as Record<string, unknown>)["dedupe_key"] = "legacy-key-1";
    }
    const snapshot = snapshotWith([first, second]);
    expect(contextBlocks(snapshot).filter((b) => b.appId === "ops")).toHaveLength(1);
  });

  it("routes to Ops home when the row carries no destination", () => {
    const row = opsRow("ops.approval_required");
    row.payload = { source_app: "ops", label: "northbeam.example" };
    const signal = deriveSignals(snapshotWith([row])).find((s) => s.id.startsWith("ops:"));
    expect(signal!.destination.route).toBe(OPS_ORIGIN);
  });

  it("clears the risk when QA passes on the same chain", () => {
    const signals = deriveSignals(
      snapshotWith([
        opsRow("ops.qa_failed", { at: "2026-08-12T09:00:00.000Z" }),
        opsRow("ops.qa_passed", { at: "2026-08-13T09:00:00.000Z" }),
      ]),
    );
    expect(signals.some((s) => s.category === "technical_risk")).toBe(false);
    expect(signals.some((s) => s.id.startsWith("ops:cleared:"))).toBe(true);
  });

  it("does not clear a risk that belongs to a different chain", () => {
    const other = opsRow("ops.qa_passed", {
      at: "2026-08-13T09:00:00.000Z",
      metadata: { canonical_project_id: "proj-2" },
    });
    const signals = deriveSignals(
      snapshotWith([opsRow("ops.qa_failed", { at: "2026-08-12T09:00:00.000Z" }), other]),
    );
    expect(signals.some((s) => s.category === "technical_risk")).toBe(true);
  });

  it("keeps another organization's Ops row invisible", () => {
    const snapshot = snapshotWith([opsRow("ops.blocked", { org: "org-2" })]);
    expect(contextBlocks(snapshot).filter((b) => b.appId === "ops")).toHaveLength(0);
    expect(deriveSignals(snapshot).filter((s) => s.id.startsWith("ops:"))).toHaveLength(0);
  });

  it("answers what needs attention citing Ops and its destination", () => {
    const result = answer(
      snapshotWith([opsRow("ops.blocked")]),
      "What technical risks are affecting active projects?",
    );
    expect(result.sufficient).toBe(true);
    expect(result.contributingApps).toContain("ops");
    expect(result.signals[0]!.destination.route).toContain(OPS_ORIGIN);
  });

  it("answers truthfully when there is no Ops evidence", () => {
    const result = answer(emptySnapshot(ORG, NOW), "Which client websites need attention?");
    expect(result.sufficient).toBe(false);
    expect(result.withheld.some((w) => w.appId === "ops")).toBe(true);
  });
});

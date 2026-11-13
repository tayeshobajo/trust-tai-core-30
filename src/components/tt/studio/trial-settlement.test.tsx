// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ConnectedManualResearch } from "./connected-manual-research";
import { STUDIO_TRIAL_REQUEST_ID } from "@/domain/studio-research-trial";
import type { ManualAction, ManualReply } from "@/domain/studio-manual-wire";
import type { ManualView } from "@/domain/studio-manual-research";
const h = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/data/studio-manual.functions", () => ({ studioManualAction: h.send }));
afterEach(cleanup);
beforeEach(() => { h.send.mockReset(); });
const org = "ee683a64-e045-4226-a8ff-4ae6590d6789";
function setup(status: ManualView["status"], launchAllowed = false) {
  let current = status;
  h.send.mockImplementation(async ({ data }: { data: ManualAction }): Promise<ManualReply> => {
    if (data.operation === "check") return { status: "available", launchAllowed };
    expect(data.requestId).toBe(STUDIO_TRIAL_REQUEST_ID);
    expect(data.organizationId).toBe(org);
    if (data.operation === "queue" || data.operation === "start") throw Error("unexpected_launch");
    if (data.operation === "reconcile") current = "ready";
    if (data.operation === "cancel") current = "stopped";
    if (data.operation === "review") current = "reviewed";
    return { status: "ok", view: {
      requestId: STUDIO_TRIAL_REQUEST_ID, status: current, executionStop: "unverified",
      ...(["ready", "reviewed"].includes(current) ? { brief: { research: { version: 1, requestId: STUDIO_TRIAL_REQUEST_ID, topics: [], limitations: ["Public trial"] }, people: [], draft: null } } : {}),
      ...(data.decision ? { decision: data.decision } : {}),
    } };
  });
}
async function connectAndRecover() {
  fireEvent.click(screen.getByRole("button", { name: "Check manual research connection" }));
  await screen.findByText(/Connected for settlement only/);
  fireEvent.click(screen.getByRole("button", { name: "Recover existing trial" }));
  await waitFor(() => expect(h.send.mock.calls.some(c => c[0].data.operation === "read")).toBe(true));
}
it.each(["ready", "delivery_uncertain"] as const)("fresh post-expiry UI recovers %s and records final review without queue/start", async status => {
  setup(status);
  const first = render(<ConnectedManualResearch organizationId={org} />);
  expect(h.send).not.toHaveBeenCalled();
  await connectAndRecover();
  if (status === "delivery_uncertain") {
    fireEvent.click(await screen.findByRole("button", { name: "Reconcile brief delivery" }));
  }
  await screen.findByRole("button", { name: "Use" });
  first.unmount(); // Simulate a reload after the result was stored, with no command in memory.
  render(<ConnectedManualResearch organizationId={org} />);
  await connectAndRecover();
  fireEvent.click(await screen.findByRole("button", { name: "Use" }));
  await screen.findByText(/Review choice recorded\./);
  expect(screen.queryByRole("button", { name: "Approve sources and queue" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Start approved request" })).toBeNull();
  expect(h.send.mock.calls.map(c => c[0].data.operation)).not.toContain("queue");
  expect(h.send.mock.calls.map(c => c[0].data.operation)).not.toContain("start");
});
it.each(["started", "queued"] as const)("recovered %s request can be stopped but cannot be launched", async status => {
  setup(status);
  render(<ConnectedManualResearch organizationId={org} />);
  await connectAndRecover();
  fireEvent.click(await screen.findByRole("button", { name: "Request stop" }));
  await waitFor(() => expect(h.send.mock.calls.some(c => c[0].data.operation === "cancel")).toBe(true));
  expect(screen.queryByRole("button", { name: "Start approved request" })).toBeNull();
  expect(h.send.mock.calls.map(c => c[0].data.operation)).not.toContain("start");
});

// @vitest-environment jsdom
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
const h = vi.hoisted(() => ({ send: vi.fn(), read: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/data/studio-attempt.functions", () => ({
  studioAttemptAction: h.send,
  studioCurrentAttemptRead: h.read,
}));
import { ApprovedFollowup } from "./approved-followup";
import { STUDIO_APPROVED_FOLLOWUP as ids } from "@/domain/studio-approved-followup";
const base = {
  version: 2,
  requestId: ids.requestId,
  attemptId: ids.attemptId,
  priorRunId: "3bd276dc-0500-40a3-81ea-b903c0c185ca",
  status: "approved",
  callbackStatus: "approved",
  receiptCount: 0,
  phase: null,
  stopEvidence: "not_attempted",
  providerRequests: null,
  duplicateCostPossible: true,
};
const eligibility = {
  eligible: true,
  checkedAt: 1000000,
  expiresAt: 1001000,
  ttlMs: 1000,
  reason: "eligible",
};
afterEach(() => {
  cleanup();
  h.send.mockReset();
  h.read.mockReset();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const startButton = () =>
  screen.getByRole("button", { name: "Run approved follow-up once" }) as HTMLButtonElement;
async function readStatus() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Check follow-up status" }));
  });
}
function mount() {
  render(<ApprovedFollowup organizationId={ids.organizationId} />);
}

it("requires server eligibility, starts only once, and renders the returned persisted brief", async () => {
  h.read.mockResolvedValue({ status: "ok", view: { ...base, launchEligibility: eligibility } });
  h.send.mockResolvedValue({
    status: "ok",
    view: {
      ...base,
      status: "ready",
      callbackStatus: "ready",
      brief: {
        research: {
          version: 1,
          requestId: ids.requestId,
          topics: [],
          limitations: ["Validated IANA test result"],
        },
        people: [],
        draft: null,
      },
    },
  });
  mount();
  expect(startButton().disabled).toBe(true);
  await readStatus();
  expect(startButton().disabled).toBe(false);
  await act(async () => {
    fireEvent.click(startButton());
  });
  expect(screen.getByText("Validated IANA test result")).toBeTruthy();
  expect(startButton().disabled).toBe(true);
  await readStatus();
  expect(startButton().disabled).toBe(true);
  expect(h.send.mock.calls.filter((c) => c[0].data.operation === "start")).toHaveLength(1);
});

it.each([
  ["missing", undefined],
  ["expired", { ...eligibility, eligible: false, reason: "expired", ttlMs: 0 }],
  ["not yet valid", { ...eligibility, eligible: false, reason: "not_yet_valid", ttlMs: 0 }],
  ["consumed", { ...eligibility, eligible: false, reason: "attempt_not_untouched", ttlMs: 0 }],
  ["invalid TTL", { ...eligibility, ttlMs: 1001 }],
])(
  "stays closed for %s eligibility even when both statuses say approved",
  async (_name, launchEligibility) => {
    h.read.mockResolvedValue({
      status: "ok",
      view: { ...base, ...(launchEligibility ? { launchEligibility } : {}) },
    });
    mount();
    await readStatus();
    expect(startButton().disabled).toBe(true);
    fireEvent.click(startButton());
    expect(h.read).toHaveBeenCalledTimes(1);
    expect(h.send).not.toHaveBeenCalled();
  },
);

it("expires while open using elapsed time despite browser wall-clock rollback", async () => {
  vi.useFakeTimers();
  let monotonic = 0;
  vi.spyOn(performance, "now").mockImplementation(() => monotonic);
  h.read.mockResolvedValue({ status: "ok", view: { ...base, launchEligibility: eligibility } });
  mount();
  await readStatus();
  expect(startButton().disabled).toBe(false);
  vi.setSystemTime(new Date("1900-01-01T00:00:00Z"));
  monotonic = 1000;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(startButton().disabled).toBe(true);
  expect(screen.getByRole("status").textContent).toContain("Approval has expired");
  fireEvent.click(startButton());
  expect(h.read).toHaveBeenCalledTimes(1);
  expect(h.send).not.toHaveBeenCalled();
});

it("subtracts request latency and cannot revive a TTL exhausted in transit", async () => {
  let monotonic = 0;
  vi.spyOn(performance, "now").mockImplementation(() => monotonic);
  h.read.mockImplementation(async () => {
    monotonic = 1100;
    return { status: "ok", view: { ...base, launchEligibility: eligibility } };
  });
  mount();
  await readStatus();
  expect(startButton().disabled).toBe(true);
  expect(screen.getByRole("status").textContent).toContain("Approval has expired");
});

it("rechecks the monotonic deadline when a throttled timer has not fired", async () => {
  vi.useFakeTimers();
  let monotonic = 0;
  vi.spyOn(performance, "now").mockImplementation(() => monotonic);
  h.read.mockResolvedValue({ status: "ok", view: { ...base, launchEligibility: eligibility } });
  mount();
  await readStatus();
  expect(startButton().disabled).toBe(false);
  monotonic = 1000;
  await act(async () => {
    fireEvent.click(startButton());
  });
  expect(startButton().disabled).toBe(true);
  expect(h.read).toHaveBeenCalledTimes(1);
  expect(h.send).not.toHaveBeenCalled();
});

it("invalidates eligibility when status refresh fails or the page is hidden", async () => {
  h.read
    .mockResolvedValueOnce({ status: "ok", view: { ...base, launchEligibility: eligibility } })
    .mockResolvedValueOnce({ status: "unavailable", diagnostic: "route_unknown" })
    .mockResolvedValueOnce({ status: "ok", view: { ...base, launchEligibility: eligibility } });
  mount();
  await readStatus();
  expect(startButton().disabled).toBe(false);
  await readStatus();
  expect(startButton().disabled).toBe(true);
  await readStatus();
  expect(startButton().disabled).toBe(false);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  await act(async () => {
    fireEvent(document, new Event("visibilitychange"));
  });
  expect(startButton().disabled).toBe(true);
  expect(h.send).not.toHaveBeenCalled();
  expect(h.read).toHaveBeenCalledWith({
    data: { organizationId: ids.organizationId, requestId: ids.requestId },
  });
});

it("starts only the configured successor returned by the verified current-attempt read", async () => {
  const successorId = "99999999-9999-4999-8999-999999999999";
  h.read.mockResolvedValue({
    status: "ok",
    view: { ...base, attemptId: successorId, launchEligibility: eligibility },
  });
  h.send.mockResolvedValue({
    status: "ok",
    view: { ...base, attemptId: successorId, status: "claimed", callbackStatus: "admitted" },
  });
  mount();
  await readStatus();
  expect(startButton().disabled).toBe(false);
  expect(h.read).toHaveBeenCalledWith({
    data: { organizationId: ids.organizationId, requestId: ids.requestId },
  });
  await act(async () => {
    fireEvent.click(startButton());
  });
  expect(h.send).toHaveBeenCalledExactlyOnceWith({
    data: {
      version: 2,
      operation: "start",
      organizationId: ids.organizationId,
      requestId: ids.requestId,
      attemptId: successorId,
    },
  });
  expect(startButton().disabled).toBe(true);
  expect(screen.getByRole("status").textContent).toContain("Attempt status: claimed");
});

it("rejects a wrong-request read and clears the previous view and eligibility", async () => {
  h.read
    .mockResolvedValueOnce({ status: "ok", view: { ...base, launchEligibility: eligibility } })
    .mockResolvedValueOnce({
      status: "ok",
      view: {
        ...base,
        requestId: "99999999-9999-4999-8999-999999999999",
        launchEligibility: eligibility,
      },
    });
  mount();
  await readStatus();
  expect(startButton().disabled).toBe(false);
  expect(screen.queryByText(/Receipts:/)).not.toBeNull();
  await readStatus();
  expect(startButton().disabled).toBe(true);
  expect(screen.queryByText(/Receipts:/)).toBeNull();
  expect(screen.getByRole("status").textContent).toContain("Status is unconfirmed");
  expect(h.send).not.toHaveBeenCalled();
});

it("rejects a start acknowledgement for a different attempt and never retries", async () => {
  h.read.mockResolvedValue({ status: "ok", view: { ...base, launchEligibility: eligibility } });
  h.send.mockResolvedValue({
    status: "ok",
    view: { ...base, attemptId: "99999999-9999-4999-8999-999999999999", status: "ready" },
  });
  mount();
  await readStatus();
  await act(async () => {
    fireEvent.click(startButton());
  });
  expect(screen.getByRole("status").textContent).toContain("Status is unconfirmed");
  expect(startButton().disabled).toBe(true);
  await readStatus();
  expect(startButton().disabled).toBe(true);
  expect(h.send).toHaveBeenCalledTimes(1);
});

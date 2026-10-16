import { describe, expect, it } from "vitest";
import { PREVIEW_MEETINGS, PREVIEW_WORK } from "@/data/mockups/steward-preview";
import { confirmPreview, meetingProgress, reopenPreview, verifyPreview } from "./steward-preview";

const meeting = PREVIEW_MEETINGS[0];
const open = PREVIEW_WORK[0];
if (!meeting || !open) throw new Error("Missing illustrative fixture");

describe("Steward illustrative completion rules", () => {
  it("reaches 100/100 only when all agreed deliverables have proof", () => {
    const items = PREVIEW_WORK.map((item) => ({
      ...item,
      status: item.status === "proposed" ? ("proposed" as const) : ("verified" as const),
      proof: "Example completion reference",
    }));
    expect(meetingProgress(meeting, items)).toMatchObject({
      score: 100,
      complete: true,
      agreed: 4,
      verified: 4,
    });
    expect(
      meetingProgress(
        meeting,
        items.map((item) => (item.id === open.id ? { ...item, proof: null } : item)),
      ),
    ).toMatchObject({ score: 75, complete: false });
  });
  it("never claims 100 when coverage is incomplete", () => {
    expect(
      meetingProgress({ ...meeting, coverage: "partial" }, [
        { ...open, status: "verified", proof: "Example evidence" },
      ]),
    ).toMatchObject({ score: null, complete: false });
  });
  it("does not claim completion for empty meetings", () => {
    expect(meetingProgress(meeting, [])).toMatchObject({ score: null, complete: false });
  });
  it("keeps proposals outside agreed completion counts", () => {
    expect(meetingProgress(meeting, PREVIEW_WORK)).toMatchObject({
      agreed: 4,
      verified: 1,
      outstanding: 3,
      score: 25,
    });
  });
  it("requires a completion reference", () => {
    expect(verifyPreview(open, "  ")).toEqual(open);
    expect(verifyPreview(open, "Example review")).toMatchObject({
      status: "verified",
      proof: "Example review",
    });
  });
  it("does not turn blocked work or a proposal into verified completion", () => {
    expect(verifyPreview({ ...open, status: "blocked" }, "Example evidence").status).toBe(
      "blocked",
    );
    expect(verifyPreview({ ...open, status: "proposed" }, "Example evidence").status).toBe(
      "proposed",
    );
  });
  it("reopening retains proof and restores outstanding work without counting old proof as complete", () => {
    const reopened = reopenPreview(
      verifyPreview(open, "Example proof"),
      "Copy needs another review",
    );
    expect(reopened).toMatchObject({ status: "open", proof: "Example proof" });
    expect(meetingProgress(meeting, [reopened]).score).toBe(0);
  });
  it("requires a nonblank reopen reason without changing receipts", () => {
    const completed = verifyPreview(open, "Example proof");
    expect(reopenPreview(completed, "  ")).toBe(completed);
  });
  it("appends every completion and reopening with illustrative actor and time across repeated cycles", () => {
    const first = { actor: "Alex (fictional)", at: "2026-10-16T16:00:00Z" };
    const second = { actor: "Morgan (fictional)", at: "2026-10-16T16:01:00Z" };
    const completed = verifyPreview(open, "First proof", first);
    const reopened = reopenPreview(completed, "First reason", second);
    const recompleted = verifyPreview(reopened, "Second proof", {
      ...first,
      at: "2026-10-16T16:02:00Z",
    });
    const again = reopenPreview(recompleted, "Second reason", {
      ...second,
      at: "2026-10-16T16:03:00Z",
    });
    expect(again.history).toEqual([
      { kind: "completed", ...first, illustrative: true, proof: "First proof" },
      {
        kind: "reopened",
        ...second,
        illustrative: true,
        proof: "First proof",
        reason: "First reason",
      },
      {
        kind: "completed",
        actor: first.actor,
        at: "2026-10-16T16:02:00Z",
        illustrative: true,
        proof: "Second proof",
      },
      {
        kind: "reopened",
        actor: second.actor,
        at: "2026-10-16T16:03:00Z",
        illustrative: true,
        proof: "Second proof",
        reason: "Second reason",
      },
    ]);
    expect(completed.history).toHaveLength(1);
    expect(again.status).toBe("open");
  });
  it("preserves the original receipt on initially verified examples", () => {
    const fixture = PREVIEW_WORK.find((item) => item.status === "verified");
    if (!fixture) throw new Error("Expected verified example");
    const reopened = reopenPreview(fixture, "Review again");
    expect(reopened.history?.[0]).toEqual(fixture.history?.[0]);
    expect(reopened.history).toHaveLength(2);
  });
  it("proposals require an explicit owner to become agreed", () => {
    const proposed = { ...open, status: "proposed" as const, owner: null };
    expect(confirmPreview(proposed, "")).toEqual(proposed);
    expect(confirmPreview(proposed, "Morgan")).toMatchObject({ owner: "Morgan", status: "open" });
  });
});

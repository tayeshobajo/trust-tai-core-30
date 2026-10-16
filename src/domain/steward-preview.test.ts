import { describe, expect, it } from "vitest";
import { PREVIEW_MEETINGS, PREVIEW_WORK } from "@/data/mockups/steward-preview";
import { confirmPreview, meetingProgress, reopenPreview, verifyPreview } from "./steward-preview";

const meeting = PREVIEW_MEETINGS[0];
const open = PREVIEW_WORK[0];
if (!meeting || !open) throw new Error("Missing illustrative fixture");

describe("Steward illustrative completion rules", () => {
  it("reaches 100/100 only when all agreed deliverables have proof", () => {
    const items = PREVIEW_WORK.map((item) => ({ ...item, status: item.status === "proposed" ? "proposed" as const : "verified" as const, proof: "Example completion reference" }));
    expect(meetingProgress(meeting, items)).toMatchObject({ score: 100, complete: true, agreed: 4, verified: 4 });
    expect(meetingProgress(meeting, items.map((item) => item.id === open.id ? { ...item, proof: null } : item))).toMatchObject({ score: 75, complete: false });
  });
  it("never claims 100 when coverage is incomplete", () => {
    expect(meetingProgress({ ...meeting, coverage: "partial" }, [{ ...open, status: "verified", proof: "Example evidence" }])).toMatchObject({ score: null, complete: false });
  });
  it("does not claim completion for empty meetings", () => {
    expect(meetingProgress(meeting, [])).toMatchObject({ score: null, complete: false });
  });
  it("keeps proposals outside agreed completion counts", () => {
    expect(meetingProgress(meeting, PREVIEW_WORK)).toMatchObject({ agreed: 4, verified: 1, outstanding: 3, score: 25 });
  });
  it("requires a completion reference", () => {
    expect(verifyPreview(open, "  ")).toEqual(open);
    expect(verifyPreview(open, "Example review")).toMatchObject({ status: "verified", proof: "Example review" });
  });
  it("does not turn blocked work or a proposal into verified completion", () => {
    expect(verifyPreview({ ...open, status: "blocked" }, "Example evidence").status).toBe("blocked");
    expect(verifyPreview({ ...open, status: "proposed" }, "Example evidence").status).toBe("proposed");
  });
  it("reopening removes proof and restores outstanding work", () => {
    const reopened = reopenPreview(verifyPreview(open, "Example proof"));
    expect(reopened).toMatchObject({ status: "open", proof: null });
    expect(meetingProgress(meeting, [reopened]).score).toBe(0);
  });
  it("proposals require an explicit owner to become agreed", () => {
    const proposed = { ...open, status: "proposed" as const, owner: null };
    expect(confirmPreview(proposed, "")).toEqual(proposed);
    expect(confirmPreview(proposed, "Morgan")).toMatchObject({ owner: "Morgan", status: "open" });
  });
});
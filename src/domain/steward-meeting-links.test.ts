import { describe, expect, it } from "vitest";
import { editOf, type BoardTask } from "./cmd-tasks";
import { appendLinkedBusinessWork, MEETING_ASSOCIATION_LABEL, meetingAssociationIds, meetingIdFromUrl, withMeetingAssociation, workroomRowKey } from "./steward-meeting-links";
import { buildWorkroom, receiptKey } from "./steward-workroom";
import type { Commitment } from "./steward";

const id = "00000000-0000-4000-8000-000000000011";
const task: BoardTask = {
  id, organization_id: "fictional-org", task_visibility: "business", title: "Fictional linked task",
  created_by: id, owner_user_id: null, owner_label: null, status: "open", next_action: "Review revised email",
  blocked_because: "", depends_on_task_id: null, parent_task_id: null, completion_evidence: "Email evidence retained", completed_at: null, completed_by: null, archived_at: null, due_at: null, updated_at: "2026-10-18T01:00:00Z", revision: 7,
  acceptance_criteria: ["Review refinements"], context_links: withMeetingAssociation([{ label: "Email refinement", url: "https://example.com/email", kind: "email" }], id), notes: "Original notes", correlation_id: null,
};
const commitment: Commitment = { id, organizationId: "fictional-org", conversationId: id, what: "Confirmed promise", ownerName: "Fictional", status: "kept", sourceKey: "original", evidence: [], createdAt: "", updatedAt: "" };
function meetings() {
  return buildWorkroom([{ id, title: "Fictional call", occurredAt: "2026-10-17", provider: "fathom", sourceUrl: "", participantCount: 2, segmentCount: 3, lastSegmentAt: null, coverageConfirmed: true }], [commitment], new Map([[receiptKey(id), { taskKey: receiptKey(id), completedAt: "2026-10-18T01:00:00Z", completionNote: "Checked fictional result" }]]), new Map([[id, 0]]));
}
describe("explicit no-schema meeting association", () => {
  it("normalizes exact production/current HTTPS origin UUID URLs only", () => {
    expect(meetingIdFromUrl(`https://cmd.trusttai.com/modules/steward/meetings/${id.toUpperCase()}/?view=source#quote`)).toBe(id);
    expect(meetingIdFromUrl(`https://preview.example/modules/steward/meetings/${id}`, "https://preview.example")).toBe(id);
    for (const value of [`https://evil.example/modules/steward/meetings/${id}`, `https://cmd.trusttai.com.evil/modules/steward/meetings/${id}`, `http://cmd.trusttai.com/modules/steward/meetings/${id}`, `https://user@cmd.trusttai.com/modules/steward/meetings/${id}`, "https://cmd.trusttai.com/modules/steward/meetings/", "https://cmd.trusttai.com/modules/steward/meetings/not-a-uuid", `https://fathom.video/calls/${id}`, `/modules/steward/meetings/${id}`]) expect(meetingIdFromUrl(value)).toBeUndefined();
  });
  it("preserves all evidence/kinds and removes only managed associations", () => {
    const evidence = { label: "Email refinement", url: "https://example.com/email", kind: "email" };
    const unrelated = { label: "Meeting source evidence", url: `https://cmd.trusttai.com/modules/steward/meetings/${id}` };
    const links = withMeetingAssociation([evidence, unrelated], id);
    expect(withMeetingAssociation(links, null)).toEqual([evidence, unrelated]);
    expect(editOf(task).context_links).toEqual(task.context_links);
    expect(withMeetingAssociation(links, id)).toHaveLength(3);
    expect(() => withMeetingAssociation(links, "bad")).toThrow();
  });
  it("requires association label and deduplicates exact IDs", () => {
    const links = task.context_links;
    expect(meetingAssociationIds([...links, ...links])).toEqual([id]);
    expect(meetingAssociationIds([{ label: "Source", url: links[1]?.url ?? "" }])).toEqual([]);
    expect(MEETING_ASSOCIATION_LABEL).toBe(links[1]?.label);
    expect(appendLinkedBusinessWork(meetings(), [task, task], "fictional-org")[0]?.linkedWork).toEqual({ total: 1, open: 1 });
  });
  it("never exposes personal, other-org or archived work", () => {
    expect(appendLinkedBusinessWork(meetings(), [{ ...task, task_visibility: "personal" }, { ...task, organization_id: "other" }, { ...task, archived_at: "2026-10-18" }], "fictional-org")[0]?.rows).toHaveLength(1);
  });
  it("preserves score/denominator/proposals/receipts and ID namespaces", () => {
    const original = meetings()[0];
    const linked = appendLinkedBusinessWork(meetings(), [task], "fictional-org")[0];
    expect(linked?.score).toBe(100);
    expect(linked?.agreed).toBe(original?.agreed);
    expect(linked?.done).toBe(original?.done);
    expect(linked?.openProposals).toBe(0);
    expect(linked?.rows.map(workroomRowKey)).toEqual([`commitment:${id}`, `business-task:${id}`]);
    expect(linked?.rows[1]?.verified).toBe(false);
    expect(linked?.rows[1]?.receipt).toBeNull();
    expect(linked?.rows[1]?.boardTask).toBe(task);
    expect(linked?.linkedWork?.open).toBe(1);
  });
});
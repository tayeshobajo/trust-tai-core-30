import type { WorkroomMeeting, WorkroomRow } from "./steward-workroom";
import { workroomRowKey } from "./steward-meeting-links";

export function isWorkComplete(row: WorkroomRow): boolean {
  return row.boardTask ? row.boardTask.status === "complete" : row.kept;
}
export function confirmedRows(meeting: WorkroomMeeting): WorkroomRow[] {
  return [
    ...new Map(
      meeting.rows
        .filter(
          (row) => !row.forwardedFrom && row.kind !== "business-task" && row.status !== "released",
        )
        .map((row) => [workroomRowKey(row), row]),
    ).values(),
  ];
}
export function completionOf(meeting: WorkroomMeeting, now = new Date()) {
  const rows = confirmedRows(meeting);
  const completed = rows.filter(isWorkComplete).length;
  const overdue = rows.filter(
    (row) =>
      !isWorkComplete(row) && row.due.exact && row.due.label < now.toISOString().slice(0, 10),
  ).length;
  const allComplete = rows.length > 0 && completed === rows.length;
  return {
    allComplete,
    total: rows.length,
    completed,
    open: rows.length - completed,
    overdue,
    percentage: rows.length
      ? allComplete
        ? 100
        : Math.min(99, Math.round((completed / rows.length) * 100))
      : null,
  };
}
export function meetingMatches(meeting: WorkroomMeeting, search: string, filter: string) {
  return (
    meeting.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()) &&
    (filter === "open"
      ? completionOf(meeting).open > 0
      : filter === "review"
        ? meeting.openProposals > 0
        : true)
  );
}

/** A carry-forward projects the same row into a later meeting, never another obligation. */
export function withRollForwards(
  meetings: WorkroomMeeting[],
  events: {
    entity_id: string;
    payload: { original_meeting_id?: string; later_meeting_id?: string | null };
  }[],
): WorkroomMeeting[] {
  const copies = meetings.map((meeting) => ({ ...meeting, rows: [...meeting.rows] }));
  const seen = new Set<string>();
  for (const event of events) {
    if (seen.has(event.entity_id)) continue;
    seen.add(event.entity_id);
    const origin = meetings.find((m) => m.id === event.payload.original_meeting_id);
    const row = origin?.rows.find((r) => r.id === event.entity_id);
    const later = copies.find((m) => m.id === event.payload.later_meeting_id);
    if (
      !row ||
      !origin ||
      !later ||
      later.occurredAt <= origin.occurredAt ||
      later.rows.some((r) => workroomRowKey(r) === workroomRowKey(row))
    )
      continue;
    later.rows.push({ ...row, forwardedFrom: origin.id });
  }
  return copies;
}

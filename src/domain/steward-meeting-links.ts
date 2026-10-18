import type { BoardEdit, BoardTask } from "./cmd-tasks";
import { BOARD_STATUS_LABEL } from "./cmd-tasks";
import type { WorkroomMeeting, WorkroomRow } from "./steward-workroom";
import { requiredMeetingId } from "./steward-required-work";

export const MEETING_ASSOCIATION_LABEL = "Steward meeting association";
const PRODUCTION_ORIGIN = "https://cmd.trusttai.com";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Exact internal address only; decorations cannot change the UUID identity. */
export function meetingIdFromUrl(value: string, currentOrigin?: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return undefined;
    const allowed =
      url.origin === PRODUCTION_ORIGIN ||
      (currentOrigin?.startsWith("https://") && url.origin === new URL(currentOrigin).origin);
    if (!allowed) return undefined;
    const match = /^\/modules\/steward\/meetings\/([^/]+)\/?$/.exec(url.pathname);
    const id = match?.[1];
    return id && UUID.test(id) ? id.toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}

export function meetingAssociationIds(
  links: BoardEdit["context_links"],
  currentOrigin?: string,
): string[] {
  return [
    ...new Set(
      links.flatMap((link) => {
        if (link.label !== MEETING_ASSOCIATION_LABEL) return [];
        const id = meetingIdFromUrl(link.url, currentOrigin);
        return id ? [id] : [];
      }),
    ),
  ];
}

/** Only recognized association links are managed; all evidence remains untouched. */
export function withMeetingAssociation(
  links: BoardEdit["context_links"],
  id: string | null,
  currentOrigin?: string,
): BoardEdit["context_links"] {
  if (id !== null && !UUID.test(id)) throw new Error("Choose a stored meeting.");
  const preserved = links.filter(
    (link) =>
      link.label !== MEETING_ASSOCIATION_LABEL || !meetingIdFromUrl(link.url, currentOrigin),
  );
  return id === null
    ? preserved
    : [
        ...preserved,
        {
          label: MEETING_ASSOCIATION_LABEL,
          url: `${PRODUCTION_ORIGIN}/modules/steward/meetings/${id.toLowerCase()}`,
        },
      ];
}

export function workroomRowKey(row: WorkroomRow): string {
  return `${row.kind ?? "commitment"}:${row.id}`;
}

/** No score fields are recomputed from linked work. Defense in depth excludes private/foreign rows. */
export function appendLinkedBusinessWork(
  meetings: WorkroomMeeting[],
  tasks: readonly BoardTask[],
  organizationId: string,
  currentOrigin?: string,
): WorkroomMeeting[] {
  const unique = new Map(
    tasks
      .filter(
        (task) =>
          task.organization_id === organizationId &&
          task.task_visibility === "business" &&
          (!task.archived_at || !!requiredMeetingId(task)),
      )
      .map((task) => [task.id, task]),
  );
  return meetings.map((meeting) => {
    const required = [...unique.values()].filter(
      (task) => requiredMeetingId(task) === meeting.id.toLowerCase(),
    );
    const linked = [...unique.values()].filter(
      (task) =>
        !requiredMeetingId(task) &&
        meetingAssociationIds(task.context_links, currentOrigin).includes(meeting.id.toLowerCase()),
    );
    const rows: WorkroomRow[] = [...linked, ...required].map((task) => ({
      kind: requiredMeetingId(task) ? "required-task" : "business-task",
      id: task.id,
      boardTask: task,
      what: task.title,
      owner: {
        label:
          task.owner_label ||
          (task.owner_user_id ? "Assigned teammate (name unavailable)" : "Unassigned"),
        verified: !!task.owner_user_id,
      },
      due: { label: task.due_at?.slice(0, 10) || "No date", exact: !!task.due_at },
      status: requiredMeetingId(task)
        ? "Verification unavailable"
        : BOARD_STATUS_LABEL[task.status],
      kept: false,
      verified: false,
      receipt: null,
      evidenceCount: task.context_links.length,
      sourceKey: requiredMeetingId(task) ? "manually-required-work" : "linked-business-task",
    }));
    return {
      ...meeting,
      rows: [...meeting.rows.filter((row) => !row.boardTask), ...rows],
      ...(required.length
        ? {
            requiredWork: {
              total: required.length,
              verified: 0 as const,
              denominator: meeting.agreed + required.length,
            },
            score: Math.min(
              99,
              Math.round((meeting.done / (meeting.agreed + required.length)) * 100),
            ),
            remark: `${required.length} manually required tasks await guarded verification. Archived required work remains in scope; recorded delivery does not grant verified credit.`,
          }
        : {}),
      linkedWork: {
        total: linked.length,
        open: linked.filter((task) => task.status !== "complete").length,
      },
    };
  });
}

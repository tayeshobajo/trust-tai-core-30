/** Fictional, in-memory design states. Never canonical task records. */
export type PreviewStatus = "open" | "blocked" | "proposed" | "verified";
export interface PreviewReceipt {
  kind: "completed" | "reopened";
  actor: string;
  at: string;
  illustrative: true;
  proof: string;
  reason?: string;
}
export interface PreviewActorTime {
  actor: string;
  at: string;
}
const EXAMPLE_ACTOR_TIME: PreviewActorTime = {
  actor: "Alex (fictional)",
  at: "2026-10-16T16:00:00Z",
};
export interface PreviewDeliverable {
  id: string;
  meetingId: string;
  title: string;
  owner: string | null;
  due: string | null;
  dueKind: "exact" | "spoken" | "unknown";
  overdue: boolean;
  status: PreviewStatus;
  nextMove: string;
  dependency: string | null;
  at: string;
  quote: string;
  proof: string | null;
  priorStatus?: PreviewStatus;
  history?: readonly PreviewReceipt[];
}
export interface PreviewMeeting {
  id: string;
  title: string;
  date: string;
  time: string;
  duration: string;
  people: string[];
  coverage: "complete" | "partial";
  read: string;
}

export function meetingProgress(meeting: PreviewMeeting, items: PreviewDeliverable[]) {
  const agreed = items.filter(
    (item) => item.meetingId === meeting.id && item.status !== "proposed",
  );
  const verified = agreed.filter(
    (item) => item.status === "verified" && Boolean(item.proof?.trim()),
  ).length;
  const complete =
    meeting.coverage === "complete" && agreed.length > 0 && verified === agreed.length;
  return {
    agreed: agreed.length,
    verified,
    outstanding: agreed.length - verified,
    // Incomplete coverage cannot certify the meeting, even if known work is done.
    score:
      meeting.coverage === "complete" && agreed.length > 0
        ? Math.floor((verified / agreed.length) * 100)
        : null,
    complete,
  };
}

export function verifyPreview(
  item: PreviewDeliverable,
  proof: string,
  metadata: PreviewActorTime = EXAMPLE_ACTOR_TIME,
): PreviewDeliverable {
  if (item.status === "proposed" || item.status === "blocked" || !proof.trim()) return item;
  if (item.status === "verified") return item;
  if (!metadata.actor.trim() || !metadata.at.trim()) return item;
  return {
    ...item, priorStatus: item.status, status: "verified", proof: proof.trim(),
    history: [...(item.history ?? []), {
      kind: "completed", actor: metadata.actor, at: metadata.at,
      illustrative: true, proof: proof.trim(),
    }],
  };
}

export function reopenPreview(
  item: PreviewDeliverable,
  reason: string,
  metadata: PreviewActorTime = EXAMPLE_ACTOR_TIME,
): PreviewDeliverable {
  if (item.status !== "verified" || !reason.trim() || !metadata.actor.trim() || !metadata.at.trim()) return item;
  return {
    ...item, status: item.priorStatus ?? "open",
    history: [...(item.history ?? []), {
      kind: "reopened", actor: metadata.actor, at: metadata.at,
      illustrative: true, proof: item.proof ?? "", reason: reason.trim(),
    }],
  };
}

export function confirmPreview(item: PreviewDeliverable, owner: string): PreviewDeliverable {
  if (item.status !== "proposed" || !owner.trim()) return item;
  return { ...item, owner: owner.trim(), status: "open" };
}

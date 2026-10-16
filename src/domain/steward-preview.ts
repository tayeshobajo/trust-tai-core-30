/** Fictional, in-memory design states. Never canonical task records. */
export type PreviewStatus = "open" | "blocked" | "proposed" | "verified";
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
  const agreed = items.filter((item) => item.meetingId === meeting.id && item.status !== "proposed");
  const verified = agreed.filter((item) => item.status === "verified" && Boolean(item.proof?.trim())).length;
  const complete = meeting.coverage === "complete" && agreed.length > 0 && verified === agreed.length;
  return {
    agreed: agreed.length,
    verified,
    outstanding: agreed.length - verified,
    // Incomplete coverage cannot certify the meeting, even if known work is done.
    score: meeting.coverage === "complete" && agreed.length > 0 ? Math.floor((verified / agreed.length) * 100) : null,
    complete,
  };
}

export function verifyPreview(item: PreviewDeliverable, proof: string): PreviewDeliverable {
  if (item.status === "proposed" || item.status === "blocked" || !proof.trim()) return item;
  if (item.status === "verified") return item;
  return { ...item, priorStatus: item.status, status: "verified", proof: proof.trim() };
}

export function reopenPreview(item: PreviewDeliverable): PreviewDeliverable {
  if (item.status !== "verified") return item;
  return { ...item, status: item.priorStatus ?? "open", proof: null };
}

export function confirmPreview(item: PreviewDeliverable, owner: string): PreviewDeliverable {
  if (item.status !== "proposed" || !owner.trim()) return item;
  return { ...item, owner: owner.trim(), status: "open" };
}
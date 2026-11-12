import { needsAttention, STAGES, type Application, type Snapshot } from "@/domain/hiring";

export const isActive = (a: Application) => !["hired", "declined", "withdrawn"].includes(a.stage);
export const initials = (value: string) =>
  value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
export const ownerName = (id: string | null, people: { id: string; name: string }[]) =>
  people.find((p) => p.id === id)?.name ?? "Unassigned";
export const appliedDate = (value: string) =>
  new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
export function hiringMetrics(data: Snapshot) {
  return {
    total: data.applications.length,
    open: data.jobs.filter((j) => j.status === "open").length,
    active: data.applications.filter(isActive).length,
    hired: data.applications.filter((a) => a.stage === "hired").length,
    interview: data.applications.filter((a) => a.stage === "interview").length,
    offer: data.applications.filter((a) => a.stage === "offer").length,
    inactive: data.applications.filter((a) => !isActive(a)).length,
    pipeline: STAGES.map((stage) => ({
      stage,
      count: data.applications.filter((a) => a.stage === stage).length,
    })),
  };
}
export function applicationsByRole(data: Snapshot) {
  const grouped = new Map<string, { id: string; title: string; count: number }>();
  for (const a of data.applications) {
    const item = grouped.get(a.job_id) ?? {
      id: a.job_id,
      title: data.jobs.find((j) => j.id === a.job_id)?.title ?? a.job_title,
      count: 0,
    };
    item.count += 1;
    grouped.set(a.job_id, item);
  }
  return [...grouped.values()].sort((a, b) => b.count - a.count || a.title.localeCompare(b.title));
}
export type CandidateFilters = {
  search: string;
  role: string;
  stage: string;
  attention: boolean;
  days: string;
  sort: "name" | "date";
  direction: "asc" | "desc";
};
export function candidateRows(
  applications: Application[],
  filters: CandidateFilters,
  today: string,
) {
  const cutoff = filters.days
    ? new Date(`${today}T00:00:00Z`).getTime() - Number(filters.days) * 86400000
    : null;
  return applications
    .filter(
      (a) =>
        (!filters.role || a.job_id === filters.role) &&
        (!filters.stage || a.stage === filters.stage) &&
        (!filters.attention || needsAttention(a, today)) &&
        (cutoff === null || new Date(a.created_at).getTime() >= cutoff) &&
        `${a.full_name} ${a.email}`.toLowerCase().includes(filters.search.trim().toLowerCase()),
    )
    .sort((a, b) => {
      const order =
        filters.sort === "name"
          ? a.full_name.localeCompare(b.full_name)
          : new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      return (filters.direction === "asc" ? order : -order) || a.id.localeCompare(b.id);
    });
}

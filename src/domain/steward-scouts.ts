/**
 * Steward's Scouts view: one card per Scout profile (company), with its saved
 * People, exactly-linked tasks, and the AI teammate's latest run. Counts are
 * only shown when their source was readable; otherwise they are unknown.
 */
import { linkedProspectId } from "@/domain/steward-agent-people";

export interface ScoutCardInput {
  prospects: { id: string; name: string; status: string }[];
  tasks: { id: string; status: string; correlationId?: string; sourceApp?: string; sourceEntityType?: string; sourceEntityId?: string }[];
  runs: { taskId: string; status: string; createdAt: string }[] | null;
  peopleCounts: Map<string, number> | null;
}

export interface ScoutCard {
  prospectId: string;
  name: string;
  stage: string;
  people: number | null;
  open: number;
  done: number;
  needsApproval: number;
  latestRun: { status: string; at: string } | null | "unknown";
}

export function buildScoutCards(input: ScoutCardInput): ScoutCard[] {
  const byProspect = new Map<string, ScoutCardInput["tasks"]>();
  for (const t of input.tasks) {
    const id = linkedProspectId(t);
    if (!id) continue;
    byProspect.set(id, [...(byProspect.get(id) ?? []), t]);
  }
  return input.prospects.map((p) => {
    const tasks = byProspect.get(p.id) ?? [];
    const ids = new Set(tasks.map((t) => t.id));
    let latestRun: ScoutCard["latestRun"] = "unknown";
    if (input.runs) {
      const mine = input.runs.filter((r) => ids.has(r.taskId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      latestRun = mine[0] ? { status: mine[0].status, at: mine[0].createdAt } : null;
    }
    return {
      prospectId: p.id,
      name: p.name,
      stage: p.status,
      people: input.peopleCounts ? input.peopleCounts.get(p.id) ?? 0 : null,
      open: tasks.filter((t) => t.status !== "complete" && t.status !== "needs_approval").length,
      done: tasks.filter((t) => t.status === "complete").length,
      needsApproval: tasks.filter((t) => t.status === "needs_approval").length,
      latestRun,
    };
  });
}

export interface ScoutFilters {
  stage: string | "all";
  openOnly: boolean;
  agent: "all" | "has_run" | "no_run";
}

/** Filters apply to the full list before pagination. */
export function filterScoutCards(cards: ScoutCard[], f: ScoutFilters): ScoutCard[] {
  return cards.filter(
    (c) =>
      (f.stage === "all" || c.stage === f.stage) &&
      (!f.openOnly || c.open > 0) &&
      (f.agent === "all" ||
        (f.agent === "has_run" ? c.latestRun !== null && c.latestRun !== "unknown" : c.latestRun === null)),
  );
}

export const SCOUT_PAGE_SIZE = 12;

export function pageOf<T>(list: T[], page: number, size = SCOUT_PAGE_SIZE): { items: T[]; pages: number } {
  const pages = Math.max(1, Math.ceil(list.length / size));
  const p = Math.min(Math.max(1, page), pages);
  return { items: list.slice((p - 1) * size, p * size), pages };
}

/**
 * The Ops portfolio, projected from evidence Ops already wrote.
 *
 * Trust Tai OS owns no Ops truth. There is exactly one integration path today:
 * rows Ops writes into the shared `activities` table. This module folds those
 * rows into a read-only portfolio view, grouped by the chain Ops itself keys
 * its events on (canonical project, run, or issue).
 *
 * Every field here comes from a real row. A field Ops did not send stays
 * undefined and the surface says so, rather than inventing a value.
 */

import {
  OPS_CLEARS,
  OPS_ORIGIN,
  OPS_RISK_EVENTS,
  type OpsEvent,
  type OpsEventName,
} from "@/domain/ops";
import { opsProjectUrl, type OpsProjectRow } from "@/domain/ops-projection";

export type OpsHealth = "incident" | "attention" | "healthy" | "unknown";

/** One thing Ops is maintaining, as far as Trust Tai OS can honestly see it. */
export interface OpsSystem {
  key: string;
  name: string;
  canonicalProjectId?: string;
  /** Ops' own project id, present only on synchronized projection rows. */
  opsProjectId?: string;
  company?: string;
  environment?: string;
  owner?: string;
  /** Ops' own status word, when Ops reported one. */
  status?: string;
  health: OpsHealth;
  /** Null means Ops did not report it. Never render null as zero. */
  openIssues: number | null;
  openApprovals: number | null;
  /** The latest run or QA row on this chain, when Ops recorded one. */
  latestRun?: { label: string; at: string; passed?: boolean };
  lastActivityAt: string | null;
  lastSyncedAt?: string;
  /** Where this row came from: the pushed projection, or the shared stream. */
  source: "projection" | "activity";
  destinationUrl: string;
}


export interface OpsAttentionItem {
  key: string;
  systemKey: string;
  systemName: string;
  kind: OpsEventName;
  summary: string;
  at: string;
  destinationUrl: string;
}

export interface OpsPortfolio {
  systems: OpsSystem[];
  attention: OpsAttentionItem[];
  recentlyMoved: OpsEvent[];
  /** Newest Ops row we can see, which is the only honest freshness signal. */
  lastEventAt?: string;
  companies: string[];
  environments: string[];
}

const INCIDENT: OpsEventName[] = ["ops.blocked", "ops.qa_failed", "ops.issue_detected"];
const RUN_EVENTS: OpsEventName[] = [
  "ops.run_started",
  "ops.qa_passed",
  "ops.qa_failed",
  "ops.fix_applied",
  "ops.rollback_performed",
  "ops.completed",
];

function cleared(event: OpsEvent, chain: OpsEvent[]): boolean {
  return chain.some(
    (candidate) =>
      candidate.at >= event.at && (OPS_CLEARS[candidate.name] ?? []).includes(event.name),
  );
}

function runLabel(name: OpsEventName): string {
  return name.replace("ops.", "").replace(/_/g, " ");
}

/** Fold Ops events, newest first, into the portfolio the room renders. */
export function opsPortfolio(events: OpsEvent[]): OpsPortfolio {
  const chains = new Map<string, OpsEvent[]>();
  for (const event of events) {
    const list = chains.get(event.chainKey);
    if (list) list.push(event);
    else chains.set(event.chainKey, [event]);
  }

  const systems: OpsSystem[] = [];
  const attention: OpsAttentionItem[] = [];

  for (const [key, unsorted] of chains) {
    const chain = [...unsorted].sort((a, b) => (a.at < b.at ? 1 : -1));
    const newest = chain[0]!;
    const open = chain.filter(
      (event) =>
        (OPS_RISK_EVENTS as OpsEventName[]).includes(event.name) && !cleared(event, chain),
    );
    const openIssues = open.filter((event) => INCIDENT.includes(event.name)).length;
    const openApprovals = open.filter((event) => event.name === "ops.approval_required").length;
    const run = chain.find((event) => RUN_EVENTS.includes(event.name));

    const named = chain.find((event) => event.systemName)?.systemName;
    const name = named ?? newest.subjectLabel;
    const system: OpsSystem = {
      key,
      name,
      health: openIssues > 0 ? "incident" : open.length > 0 ? "attention" : "healthy",
      openIssues,
      openApprovals,
      lastActivityAt: newest.at,
      source: "activity",
      destinationUrl: newest.destinationUrl || OPS_ORIGIN,
    };

    const canonicalProjectId = chain.find((event) => event.canonicalProjectId)?.canonicalProjectId;
    const company = chain.find((event) => event.companyLabel)?.companyLabel;
    const environment = chain.find((event) => event.environment)?.environment;
    const owner = chain.find((event) => event.ownerLabel)?.ownerLabel;
    if (canonicalProjectId) system.canonicalProjectId = canonicalProjectId;
    if (company) system.company = company;
    if (environment) system.environment = environment;
    if (owner) system.owner = owner;
    if (run) {
      system.latestRun = {
        label: runLabel(run.name),
        at: run.at,
        ...(run.name === "ops.qa_passed" || run.name === "ops.qa_failed"
          ? { passed: run.name === "ops.qa_passed" }
          : {}),
      };
    }
    systems.push(system);

    for (const event of open) {
      attention.push({
        key: event.idempotencyKey,
        systemKey: key,
        systemName: name,
        kind: event.name,
        summary: event.summary,
        at: event.at,
        destinationUrl: event.destinationUrl || OPS_ORIGIN,
      });
    }
  }

  const rank: Record<OpsHealth, number> = { incident: 0, attention: 1, unknown: 2, healthy: 3 };
  systems.sort((a, b) => rank[a.health] - rank[b.health] || newestFirst(a, b));
  attention.sort((a, b) => (a.at < b.at ? 1 : -1));


  const recentlyMoved = [...events].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 8);
  const newest = recentlyMoved[0];

  return {
    systems,
    attention,
    recentlyMoved,
    ...(newest ? { lastEventAt: newest.at } : {}),
    companies: [...new Set(systems.map((s) => s.company).filter(Boolean) as string[])].sort(),
    environments: [
      ...new Set(systems.map((s) => s.environment).filter(Boolean) as string[]),
    ].sort(),
  };
}

export interface OpsFilters {
  query: string;
  company: string;
  health: string;
  environment: string;
}

export const EMPTY_OPS_FILTERS: OpsFilters = {
  query: "",
  company: "all",
  health: "all",
  environment: "all",
};

export function filterOpsSystems(systems: OpsSystem[], filters: OpsFilters): OpsSystem[] {
  const query = filters.query.trim().toLowerCase();
  return systems.filter((system) => {
    if (filters.company !== "all" && system.company !== filters.company) return false;
    if (filters.health !== "all" && system.health !== filters.health) return false;
    if (filters.environment !== "all" && system.environment !== filters.environment) return false;
    if (!query) return true;
    return [system.name, system.company, system.owner, system.environment]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query));
  });
}

/** Honest, human freshness for the newest Ops row we can see. */
export function opsFreshness(lastEventAt: string | undefined, now: number): string {
  if (!lastEventAt) return "No Ops activity has reached Trust Tai OS yet";
  const at = new Date(lastEventAt).getTime();
  if (Number.isNaN(at)) return "Ops activity timestamp unreadable";
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 90) return `Ops synced ${seconds} sec ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `Ops synced ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `Ops synced ${hours} hr ago`;
  return `Ops synced ${Math.round(hours / 24)} days ago`;
}

/** How the managed-systems table may be ordered. Every option is deterministic. */
export type OpsSortKey =
  | "attention"
  | "recent"
  | "name"
  | "company"
  | "open_issues"
  | "open_approvals";

export const OPS_SORT_OPTIONS: { value: OpsSortKey; label: string }[] = [
  { value: "attention", label: "Needs attention first" },
  { value: "recent", label: "Most recent activity" },
  { value: "name", label: "System name (A-Z)" },
  { value: "company", label: "Company (A-Z)" },
  { value: "open_issues", label: "Most open incidents" },
  { value: "open_approvals", label: "Most open approvals" },
];

const HEALTH_RANK: Record<OpsHealth, number> = { incident: 0, attention: 1, unknown: 2, healthy: 3 };

/** Newest activity first. A system Ops never dated sorts last, not first. */
function newestFirst(a: OpsSystem, b: OpsSystem): number {
  const left = a.lastActivityAt ?? "";
  const right = b.lastActivityAt ?? "";
  return left < right ? 1 : left > right ? -1 : 0;
}

/** Sum a column across systems, or null when nobody proved a number. */
export function sumKnown(systems: OpsSystem[], pick: (system: OpsSystem) => number | null) {
  let total: number | null = null;
  for (const system of systems) {
    const value = pick(system);
    if (value === null) continue;
    total = (total ?? 0) + value;
  }
  return total;
}


/** Order the portfolio. Ties always fall back to newest activity, then name. */
export function sortOpsSystems(systems: OpsSystem[], key: OpsSortKey): OpsSystem[] {
  const sorted = [...systems];
  sorted.sort((a, b) => {
    switch (key) {
      case "recent":
        return newestFirst(a, b) || a.name.localeCompare(b.name);
      case "name":
        return a.name.localeCompare(b.name) || newestFirst(a, b);
      case "company":
        return (
          (a.company ?? "\uffff").localeCompare(b.company ?? "\uffff") ||
          a.name.localeCompare(b.name)
        );
      case "open_issues":
        return (b.openIssues ?? -1) - (a.openIssues ?? -1) || newestFirst(a, b);
      case "open_approvals":
        return (b.openApprovals ?? -1) - (a.openApprovals ?? -1) || newestFirst(a, b);
      case "attention":
      default:
        return (
          HEALTH_RANK[a.health] - HEALTH_RANK[b.health] ||
          newestFirst(a, b) ||
          a.name.localeCompare(b.name)
        );
    }
  });
  return sorted;
}

export const OPS_PAGE_SIZES = [10, 25, 50] as const;

export interface OpsPage {
  items: OpsSystem[];
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  /** 1-based inclusive range of the rows shown, or zeros when empty. */
  from: number;
  to: number;
}

/** Slice a sorted portfolio into one page, clamping an out-of-range page. */
export function paginateOpsSystems(systems: OpsSystem[], page: number, pageSize: number): OpsPage {
  const size = Math.max(1, Math.floor(pageSize));
  const total = systems.length;
  const pageCount = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  const start = (current - 1) * size;
  const items = systems.slice(start, start + size);
  return {
    items,
    page: current,
    pageCount,
    pageSize: size,
    total,
    from: total === 0 ? 0 : start + 1,
    to: total === 0 ? 0 : start + items.length,
  };
}

/* ------------------------------------------------------------------ */
/* Merging the synchronized projection with the shared stream          */
/* ------------------------------------------------------------------ */

/**
 * Fold the projection Ops pushes together with what the shared activity
 * stream already showed.
 *
 * The projection is canonical for "which projects exist in Ops". Activity
 * rows only ever add detail to a project the projection already names, or
 * stand alone when the projection has never heard of that chain. Nothing is
 * invented: an unreported count stays null and an unreported path opens Ops
 * home rather than a guessed project URL.
 */
export function mergeOpsPortfolio(base: OpsPortfolio, rows: OpsProjectRow[]): OpsPortfolio {
  const live = rows.filter((row) => !row.archived);
  if (live.length === 0) return base;

  const remaining = new Map(base.systems.map((system) => [system.key, system]));

  const systems: OpsSystem[] = live.map((row) => {
    const match = [...remaining.values()].find(
      (system) =>
        system.key === row.opsProjectId ||
        (!!row.canonicalProjectId && system.canonicalProjectId === row.canonicalProjectId) ||
        system.name.toLowerCase() === row.name.toLowerCase(),
    );
    if (match) remaining.delete(match.key);

    const health: OpsHealth = row.health;
    const destination = opsProjectUrl(row);
    const system: OpsSystem = {
      key: `ops:${row.opsProjectId}`,
      name: row.name,
      opsProjectId: row.opsProjectId,
      health,
      openIssues: row.openIssues ?? match?.openIssues ?? null,
      openApprovals: row.openApprovals ?? match?.openApprovals ?? null,
      lastActivityAt: row.lastActivityAt ?? match?.lastActivityAt ?? null,
      lastSyncedAt: row.lastSyncedAt,
      source: "projection",
      destinationUrl: destination !== OPS_ORIGIN ? destination : (match?.destinationUrl ?? OPS_ORIGIN),
    };
    const canonicalProjectId = row.canonicalProjectId ?? match?.canonicalProjectId;
    const company = row.company ?? match?.company;
    const environment = row.environment ?? match?.environment;
    const owner = row.owner ?? match?.owner;
    if (canonicalProjectId) system.canonicalProjectId = canonicalProjectId;
    if (company) system.company = company;
    if (environment) system.environment = environment;
    if (owner) system.owner = owner;
    if (row.status) system.status = row.status;
    if (match?.latestRun) system.latestRun = match.latestRun;
    return system;
  });

  const all = [...systems, ...remaining.values()];
  const rank: Record<OpsHealth, number> = { incident: 0, attention: 1, unknown: 2, healthy: 3 };
  all.sort(
    (a, b) =>
      rank[a.health] - rank[b.health] ||
      ((a.lastActivityAt ?? "") < (b.lastActivityAt ?? "") ? 1 : -1),
  );

  return {
    ...base,
    systems: all,
    companies: [...new Set(all.map((s) => s.company).filter(Boolean) as string[])].sort(),
    environments: [...new Set(all.map((s) => s.environment).filter(Boolean) as string[])].sort(),
  };
}

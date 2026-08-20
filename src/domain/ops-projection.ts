/**
 * The Ops project projection.
 *
 * Ops owns Ops truth. Trust Tai OS keeps a synchronized, read-only copy of the
 * projects Ops manages so the room can list them and open the exact one.
 * Nothing here edits Ops state, and nothing here invents a value: a field Ops
 * did not send stays undefined, and a count Ops did not report stays null so
 * the surface can say "—" rather than "0".
 */

import { OPS_ORIGIN } from "./ops";
import type { ID, ISODateTime } from "./entities";

export type OpsProjectHealth = "healthy" | "attention" | "incident" | "unknown";

export const OPS_PROJECT_HEALTHS: OpsProjectHealth[] = [
  "healthy",
  "attention",
  "incident",
  "unknown",
];

/** One Ops project, exactly as Ops last reported it. */
export interface OpsProjectRow {
  opsProjectId: string;
  organizationId: ID;
  name: string;
  company?: string;
  status?: string;
  /** Ops' own lifecycle word: active, archived, removed, and so on. */
  lifecycleState: string;
  /** Ops said this project needs a human. Never inferred by Core. */
  needsAttention: boolean;
  health: OpsProjectHealth;
  owner?: string;
  environment?: string;
  canonicalProjectId?: ID;
  /** Same-site Ops path for the deep link. Absent means "Ops did not say". */
  opsPath?: string;
  /** Absolute Ops URL, only kept when it really is on the Ops origin. */
  opsUrl?: string;
  /** Null means unreported. Never render null as zero. */
  openIssues: number | null;
  openApprovals: number | null;
  openRecommendations: number | null;
  openRisks: number | null;
  lastActivityAt: ISODateTime | null;
  lastSyncedAt: ISODateTime;
  /** Ops retired this project. It leaves the active portfolio. */
  removed: boolean;
  archived: boolean;
}

/** A same-site Ops path, or undefined when the candidate is not safe. */
export function safeOpsPath(candidate: unknown): string | undefined {
  if (typeof candidate !== "string") return undefined;
  const value = candidate.trim();
  if (!value.startsWith("/")) return undefined;
  if (value.startsWith("//")) return undefined;
  if (value.length > 512) return undefined;
  if (value.includes("..") || value.includes("\\")) return undefined;
  if (/[\u0000-\u001f\u007f\s]/.test(value)) return undefined;
  if (/^\/+\s*[a-z][a-z0-9+.-]*:/i.test(value)) return undefined;
  return value;
}

/** A path taken from an absolute Ops URL, when it truly is on Ops. */
export function opsPathFromUrl(candidate: unknown): string | undefined {
  if (typeof candidate !== "string" || candidate.trim().length === 0) return undefined;
  try {
    const url = new URL(candidate.trim());
    if (url.origin !== OPS_ORIGIN) return undefined;
    const path = `${url.pathname}${url.search}`;
    return path === "/" ? undefined : safeOpsPath(path);
  } catch {
    return undefined;
  }
}

/** The same-site Ops path for a projected project, or undefined. */
export function opsProjectPath(
  row: Pick<OpsProjectRow, "opsPath" | "opsUrl">,
): string | undefined {
  return safeOpsPath(row.opsPath) ?? opsPathFromUrl(row.opsUrl);
}

/** The absolute Ops URL for a projected project, or Ops home when unknown. */
export function opsProjectUrl(row: Pick<OpsProjectRow, "opsPath" | "opsUrl">): string {
  const path = opsProjectPath(row);
  return path ? `${OPS_ORIGIN}${path}` : OPS_ORIGIN;
}

/* ------------------------------------------------------------------ */
/* Connection semantics                                                */
/* ------------------------------------------------------------------ */

export type OpsConnection = "live" | "synchronized" | "delayed" | "interrupted";

/** Fresh enough that the projection is simply the truth, calmly stated. */
export const OPS_SYNC_FRESH_MS = 15 * 60_000;
/**
 * Ops pushes when its projects change, not on a heartbeat, so a quiet night is
 * normal. Only silence longer than a full day is worth calling a break.
 */
export const OPS_SYNC_DELAYED_MS = 24 * 3_600_000;


export interface OpsConnectionInput {
  /** A direct Ops read succeeded just now. Today Core has no such read. */
  live?: boolean;
  /** The newest `last_synced_at` across the projection. */
  lastSyncedAt?: ISODateTime | null | undefined;
  /** False when the last projection read itself failed. */
  projectionReadOk?: boolean;
  now: number;
}

export function opsConnectionState(input: OpsConnectionInput): OpsConnection {
  if (input.live === true) return "live";
  if (input.projectionReadOk === false) return "interrupted";
  const at = input.lastSyncedAt ? new Date(input.lastSyncedAt).getTime() : Number.NaN;
  if (Number.isNaN(at)) return "interrupted";
  const age = input.now - at;
  if (age <= OPS_SYNC_FRESH_MS) return "synchronized";
  if (age <= OPS_SYNC_DELAYED_MS) return "delayed";
  return "interrupted";
}

export const OPS_CONNECTION_LABEL: Record<OpsConnection, string> = {
  live: "Ops · live",
  synchronized: "Ops · synchronized",
  delayed: "Ops · sync delayed",
  interrupted: "Ops · sync interrupted",
};

/* ------------------------------------------------------------------ */
/* Reading rows                                                        */
/* ------------------------------------------------------------------ */

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function count(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.floor(value);
}

const HEALTH_WORDS: Record<string, OpsProjectHealth> = {
  healthy: "healthy",
  stable: "healthy",
  ok: "healthy",
  green: "healthy",
  good: "healthy",
  attention: "attention",
  warning: "attention",
  degraded: "attention",
  amber: "attention",
  at_risk: "attention",
  incident: "incident",
  critical: "incident",
  failing: "incident",
  red: "incident",
  blocked: "incident",
};

/** Ops' health word, or "unknown". A word Core cannot read never means healthy. */
function health(value: unknown): OpsProjectHealth {
  const candidate = text(value)?.toLowerCase();
  if (!candidate) return "unknown";
  if ((OPS_PROJECT_HEALTHS as string[]).includes(candidate)) return candidate as OpsProjectHealth;
  return HEALTH_WORDS[candidate] ?? "unknown";
}

/** Read one database row into the projection shape, or null when unusable. */
export function readOpsProjectRow(raw: Record<string, unknown>): OpsProjectRow | null {
  const opsProjectId = text(raw["ops_project_id"]);
  const organizationId = text(raw["organization_id"]);
  const name = text(raw["project_name"]);
  const lastSyncedAt = text(raw["synced_at"]);
  if (!opsProjectId || !organizationId || !name || !lastSyncedAt) return null;

  const company = text(raw["client_label"]);
  const status = text(raw["status"]);
  const owner = text(raw["owner"]);
  const environment = text(raw["primary_domain"]);
  const canonicalProjectId = text(raw["canonical_project_id"]);
  const opsPath = safeOpsPath(raw["ops_path"]);
  const opsUrl = opsPathFromUrl(raw["ops_url"]) ? String(raw["ops_url"]).trim() : undefined;
  const lifecycleState = (text(raw["lifecycle_state"]) ?? "active").toLowerCase();

  return {
    opsProjectId,
    organizationId,
    name,
    health: health(raw["health"]),
    openIssues: count(raw["open_issues"]),
    openApprovals: count(raw["open_approvals"]),
    openRecommendations: count(raw["open_recommendations"]),
    openRisks: count(raw["open_risks"]),
    lastActivityAt: text(raw["last_activity_at"]) ?? null,
    lastSyncedAt,
    lifecycleState,
    needsAttention: raw["needs_attention"] === true,
    removed: lifecycleState === "removed",
    archived: lifecycleState === "archived",
    ...(company ? { company } : {}),
    ...(status ? { status } : {}),
    ...(owner ? { owner } : {}),
    ...(environment ? { environment } : {}),
    ...(canonicalProjectId ? { canonicalProjectId } : {}),
    ...(opsPath ? { opsPath } : {}),
    ...(opsUrl ? { opsUrl } : {}),
  };
}

/** The newest sync stamp across the projection, or undefined when empty. */
export function newestOpsSync(rows: OpsProjectRow[]): ISODateTime | undefined {
  let newest: string | undefined;
  for (const row of rows) {
    if (!newest || row.lastSyncedAt > newest) newest = row.lastSyncedAt;
  }
  return newest;
}

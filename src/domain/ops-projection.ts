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
  health: OpsProjectHealth;
  owner?: string;
  environment?: string;
  canonicalProjectId?: ID;
  /** Same-site Ops path for the deep link. Absent means "Ops did not say". */
  opsPath?: string;
  /** Null means unreported. Never render null as zero. */
  openIssues: number | null;
  openApprovals: number | null;
  lastActivityAt: ISODateTime | null;
  lastSyncedAt: ISODateTime;
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

/** The absolute Ops URL for a projected project, or Ops home when unknown. */
export function opsProjectUrl(row: Pick<OpsProjectRow, "opsPath">): string {
  const path = safeOpsPath(row.opsPath);
  return path ? `${OPS_ORIGIN}${path}` : OPS_ORIGIN;
}

/* ------------------------------------------------------------------ */
/* Connection semantics                                                */
/* ------------------------------------------------------------------ */

export type OpsConnection = "live" | "synchronized" | "delayed" | "interrupted";

/** Fresh enough that the projection is simply the truth, calmly stated. */
export const OPS_SYNC_FRESH_MS = 15 * 60_000;
/** Beyond this the projection is stale enough to warn prominently. */
export const OPS_SYNC_DELAYED_MS = 60 * 60_000;

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

function health(value: unknown): OpsProjectHealth {
  const candidate = text(value);
  return candidate && (OPS_PROJECT_HEALTHS as string[]).includes(candidate)
    ? (candidate as OpsProjectHealth)
    : "unknown";
}

/** Read one database row into the projection shape, or null when unusable. */
export function readOpsProjectRow(raw: Record<string, unknown>): OpsProjectRow | null {
  const opsProjectId = text(raw["ops_project_id"]);
  const organizationId = text(raw["organization_id"]);
  const name = text(raw["name"]);
  const lastSyncedAt = text(raw["last_synced_at"]);
  if (!opsProjectId || !organizationId || !name || !lastSyncedAt) return null;

  const company = text(raw["company"]);
  const status = text(raw["status"]);
  const owner = text(raw["owner"]);
  const environment = text(raw["environment"]);
  const canonicalProjectId = text(raw["canonical_project_id"]);
  const opsPath = safeOpsPath(raw["ops_path"]);

  return {
    opsProjectId,
    organizationId,
    name,
    health: health(raw["health"]),
    openIssues: count(raw["open_issues"]),
    openApprovals: count(raw["open_approvals"]),
    lastActivityAt: text(raw["last_activity_at"]) ?? null,
    lastSyncedAt,
    archived: raw["archived"] === true,
    ...(company ? { company } : {}),
    ...(status ? { status } : {}),
    ...(owner ? { owner } : {}),
    ...(environment ? { environment } : {}),
    ...(canonicalProjectId ? { canonicalProjectId } : {}),
    ...(opsPath ? { opsPath } : {}),
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

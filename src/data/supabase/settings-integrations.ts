/**
 * Integration health, read from what the workspace actually has.
 *
 * Nothing here is a placeholder tile: an integration appears only when the
 * suite genuinely represents it, and its state is read from live rows. No
 * secret, token or credential is ever returned.
 */

import { supabase } from "@/integrations/trust-tai/supabase";

import { missingRelation } from "./settings-service";

export type IntegrationHealth = "connected" | "needs_attention" | "disconnected";

export interface IntegrationStatus {
  id: string;
  name: string;
  purpose: string;
  /** The room that uses this connection. */
  usedBy: string;
  health: IntegrationHealth;
  lastSyncAt: string | null;
  detail: string;
  /** Where the connection is actually managed. */
  manageTo: string;
}

export async function readIntegrations(organizationId: string): Promise<IntegrationStatus[]> {
  const [comms, agents, conversations] = await Promise.all([
    supabase
      .from("comms_integrations")
      .select("provider, status, account_email, last_sync_at, last_error")
      .eq("organization_id", organizationId),
    supabase
      .from("execution_agents")
      .select("name, enabled, last_known_status, last_synced_at, paused_at")
      .eq("organization_id", organizationId),
    supabase
      .from("conversations")
      .select("source, occurred_at")
      .eq("organization_id", organizationId)
      .order("occurred_at", { ascending: false })
      .limit(50),
  ]);

  const out: IntegrationStatus[] = [];

  /* Gmail, owned by Comms. */
  const gmail = (comms.error ? [] : (comms.data ?? [])).find(
    (row) => String((row as Record<string, unknown>)["provider"]) === "gmail",
  ) as Record<string, unknown> | undefined;
  out.push({
    id: "gmail",
    name: "Gmail",
    purpose: "Reads the mailbox so relationship history stays truthful.",
    usedBy: "Comms",
    health: gmail
      ? gmail["last_error"]
        ? "needs_attention"
        : String(gmail["status"]) === "connected"
          ? "connected"
          : "needs_attention"
      : "disconnected",
    lastSyncAt: (gmail?.["last_sync_at"] as string | null) ?? null,
    detail: gmail
      ? String(gmail["account_email"] ?? "Connected mailbox")
      : "No mailbox is connected.",
    manageTo: "/modules/comms/integrations",
  });

  /* Fathom, read through the conversations Steward already ingested. */
  const fathom = (conversations.error ? [] : (conversations.data ?? [])).filter(
    (row) => String((row as Record<string, unknown>)["source"] ?? "").toLowerCase() === "fathom",
  ) as Record<string, unknown>[];
  const lastMeeting = (fathom[0]?.["occurred_at"] as string | null) ?? null;
  out.push({
    id: "fathom",
    name: "Fathom",
    purpose: "Brings meeting transcripts in so commitments can be kept.",
    usedBy: "Steward",
    health: fathom.length > 0 ? "connected" : "disconnected",
    lastSyncAt: lastMeeting,
    detail:
      fathom.length > 0
        ? `${fathom.length} recent meeting${fathom.length === 1 ? "" : "s"} ingested.`
        : "No meetings have arrived from Fathom.",
    manageTo: "/modules/steward/meetings",
  });

  /* Paperclip, the agent workforce. Agents are not workspace members. */
  const agentRows = (agents.error ? [] : (agents.data ?? [])) as Record<string, unknown>[];
  const active = agentRows.filter((row) => row["enabled"] !== false && !row["paused_at"]);
  out.push({
    id: "paperclip",
    name: "Paperclip",
    purpose: "Runs the agent workforce that prepares bounded work for approval.",
    usedBy: "Steward · Agents",
    health:
      agentRows.length === 0
        ? "disconnected"
        : active.length === 0
          ? "needs_attention"
          : "connected",
    lastSyncAt:
      (agentRows
        .map((row) => (row["last_synced_at"] as string | null) ?? null)
        .filter(Boolean)
        .sort()
        .at(-1) as string | null) ?? null,
    detail:
      agentRows.length === 0
        ? "No agents are registered."
        : `${active.length} of ${agentRows.length} agents running.`,
    manageTo: "/modules/steward/agents",
  });

  /* A missing relation is a deployment fact, not an outage. */
  if (comms.error && !missingRelation(comms.error)) throw new Error(comms.error.message);

  return out;
}

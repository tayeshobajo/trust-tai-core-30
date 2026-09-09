/**
 * ZenMode → Scout lead import client.
 *
 * ZenMode is the approved LinkedIn transport. Lead DISCOVERY happens in the
 * ZenMode desktop app — there is no campaign API, so nothing in this browser
 * can start a scrape or send a single message. This module only pulls leads
 * ZenMode has ALREADY found onto the Scout board, alongside AI discovery.
 *
 * The browser never sees the ZenMode key. It calls Trust Tai's own endpoint
 * with the signed-in user's Supabase token; the server verifies membership and
 * writes through RLS.
 */

import { supabase } from "@/integrations/trust-tai/supabase";
import type { ID } from "@/domain/entities";

const ENDPOINT = "/api/public/zenmode/import";

export interface ZenModeImportStatus {
  /** ZenMode itself: wired up, and with a key present. */
  provider: { configured: boolean; enabled: boolean; baseUrl: string | null };
  /** The import gate. Both must be true before the action means anything. */
  importEnabled: boolean;
}

export interface ZenModeImportOutcome {
  imported: number;
  duplicates: number;
  /** Leads with no LinkedIn route — nothing stable to anchor identity on. */
  skipped: number;
  note: string | null;
  disabled: boolean;
}

const OFF: ZenModeImportStatus = {
  provider: { configured: false, enabled: false, baseUrl: null },
  importEnabled: false,
};

/** Is the ZenMode import available? Cheap, unauthenticated, leaks no secret. */
export async function zenModeImportStatus(): Promise<ZenModeImportStatus> {
  try {
    const response = await fetch(ENDPOINT, { method: "GET" });
    if (!response.ok) return OFF;
    const body = (await response.json()) as Record<string, unknown>;
    const provider = (body["provider"] ?? {}) as Record<string, unknown>;
    return {
      provider: {
        configured: provider["configured"] === true,
        enabled: provider["enabled"] === true,
        baseUrl: typeof provider["baseUrl"] === "string" ? provider["baseUrl"] : null,
      },
      importEnabled: body["import_enabled"] === true,
    };
  } catch {
    return OFF;
  }
}

/**
 * Pull every ZenMode lead onto the board. Safe to press twice: leads already
 * present are counted as duplicates and left exactly as they are, so a human's
 * own edits are never overwritten by a transport pull.
 */
export async function importZenModeLeads(input: {
  organizationId: ID;
  campaignId?: string;
}): Promise<ZenModeImportOutcome> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) {
    throw new Error("Your session has expired. Sign in again to import ZenMode leads.");
  }

  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      organization_id: input.organizationId,
      ...(input.campaignId ? { campaign_id: input.campaignId } : {}),
    }),
  });

  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      response.status === 401
        ? "Your session has expired. Sign in again to import ZenMode leads."
        : typeof body["error"] === "string"
          ? body["error"]
          : "The ZenMode import could not finish. Nothing partial is hidden — check the board.",
    );
  }

  return {
    imported: Number(body["imported"] ?? 0),
    duplicates: Number(body["duplicates"] ?? 0),
    skipped: Number(body["skipped"] ?? 0),
    note: typeof body["note"] === "string" ? body["note"] : null,
    disabled: body["status"] === "disabled",
  };
}

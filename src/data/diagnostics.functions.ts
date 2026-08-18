import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { PaperclipMode } from "@/domain/paperclip-connection";

/**
 * Deployment diagnostics: metadata only.
 *
 * Nothing here may carry a secret value. Configuration is reported as a
 * boolean ("configured") and never as the key itself.
 */
export interface RuntimeDiagnostics {
  supabase: { reachable: boolean; detail: string | null };
  paperclip: {
    mode: PaperclipMode;
    lastSuccessAt: string | null;
    consecutiveFailures: number | null;
    boardKeyConfigured: boolean;
    /** Metadata about the configured host. Never a credential. */
    host: { origin: string; tls: boolean; loopback: boolean; configured: boolean };
  };
  serverTime: string;
}

export const getRuntimeDiagnostics = createServerFn({ method: "GET" })
  .inputValidator((data: { organizationId: string }) => data)
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }): Promise<RuntimeDiagnostics> => {
    const { paperclipConnection } = await import("@/domain/paperclip-connection");

    let supabaseReachable = false;
    let supabaseDetail: string | null = null;
    try {
      const { error } = await (context as { supabase: any }).supabase
        .from("organizations")
        .select("id")
        .eq("id", data.organizationId)
        .maybeSingle();
      if (error) supabaseDetail = error.message;
      supabaseReachable = !error;
    } catch (error) {
      supabaseDetail = error instanceof Error ? error.message : "Unreachable";
    }

    let lastSuccessAt: string | null = null;
    let consecutiveFailures: number | null = null;
    try {
      const { getSyncState } = await import("@/lib/execution-bridge.server");
      const states = await getSyncState(data.organizationId);
      const agentState = states.find((state) => state.resourceType === "agents");
      if (agentState) {
        lastSuccessAt = agentState.lastSuccessAt;
        consecutiveFailures = agentState.consecutiveFailures;
      }
    } catch {
      /* non-fatal: report unknown rather than guess */
    }

    const { paperclipClient, paperclipHostInfo } = await import(
      "@/lib/paperclip-client.server"
    );
    const host = paperclipHostInfo();
    let liveReachable = false;
    try {
      liveReachable = await paperclipClient.ping();
    } catch {
      liveReachable = false;
    }

    return {
      supabase: { reachable: supabaseReachable, detail: supabaseDetail },
      paperclip: {
        mode: paperclipConnection({ liveReachable, lastSuccessAt }).mode,
        lastSuccessAt,
        consecutiveFailures,
        // Presence only. The value is never serialized.
        boardKeyConfigured: Boolean(process.env["PAPERCLIP_BOARD_KEY"]),
        host,
      },
      serverTime: new Date().toISOString(),
    };
  });

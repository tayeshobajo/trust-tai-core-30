import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { trustTaiSupabaseUrl } from "./trust-tai-backend.server";
import {
  runNotificationBatch,
  type NotificationClaim,
  type NotificationOutcome,
  type NotificationStore,
} from "./hiring-email-worker.server";

export async function runScheduledHiringNotifications() {
  // Source-only release gate: no sends until the exact canonical SQL has been independently reviewed.
  // Removing this hold is a separate reviewed source change, not an environment flag.
  return { state: "review_required" as const, claimed: 0, reconciled: 0 };
}

/** Candidate adapter, deliberately not called by any route until reviewed SQL is available. */
export async function candidateNotificationRuntime() {
  const key =
    process.env["TRUST_TAI_SUPABASE_SERVICE_KEY"] || process.env["SUPABASE_SERVICE_ROLE_KEY"];
  const resend = process.env["RESEND_API_KEY"],
    gateway = process.env["LOVABLE_API_KEY"];
  if (!key || !resend || !gateway) return { state: "not_configured" as const };
  const db = createClient(trustTaiSupabaseUrl(), key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        headers.set("apikey", key);
        if (key.startsWith("sb_") && headers.get("authorization") === `Bearer ${key}`)
          headers.delete("authorization");
        return fetch(input, { ...init, headers });
      },
    },
  });
  async function rpc(name: string, args: Record<string, unknown> = {}) {
    const r = await db.rpc(name, args);
    if (r.error) throw new Error("Notification ledger unavailable");
    return r.data;
  }
  const runtime = z
    .object({
      enabled: z.boolean(),
      activated_at: z.string().datetime({ offset: true }).nullable(),
    })
    .parse(await rpc("hiring_notification_runtime"));
  if (!runtime.enabled || !runtime.activated_at) return { state: "disabled" as const };
  const store: NotificationStore = {
    claim: async () => (await rpc("hiring_claim_notification")) as NotificationClaim | null,
    settle: async (claim: NotificationClaim, outcome: NotificationOutcome) => {
      await rpc("hiring_settle_notification", { target: claim.id, lease: claim.lease, outcome });
    },
    reconcileCandidates: async () =>
      (await rpc("hiring_notification_reconcile_candidates")) as Array<{
        id: string;
        providerId: string;
        state: string;
      }>,
    observe: async (id, outcome) => {
      await rpc("hiring_observe_notification", { target: id, outcome });
    },
  };
  return runNotificationBatch(store, {
    base: "https://connector-gateway.lovable.dev/resend",
    headers: {
      Authorization: `Bearer ${gateway}`,
      "X-Connection-Api-Key": resend,
      "Content-Type": "application/json",
    },
  });
}

import { sendHiringQA } from "./hiring-provider.server";
import { createClient } from "@supabase/supabase-js";
import { identifySender } from "./comms-send-authority.server";
import { trustTaiSupabaseUrl } from "./trust-tai-backend.server";
import { HIRING_ORG } from "@/domain/hiring";
const QA = new Set(["delivered@resend.dev", "bounced@resend.dev"]);
export async function hiringDelivery(token: string, outboxId: string, reconcile: boolean) {
  const caller = await identifySender(token, HIRING_ORG);
  const gate = await caller.client.rpc("hiring_allowed", { org: HIRING_ORG });
  if (gate.error || !gate.data) throw new Error("Hiring access required");
  const visible = await caller.client
    .from("career_delivery_outbox")
    .select("*")
    .eq("id", outboxId)
    .single();
  if (visible.error || !visible.data || !QA.has(visible.data.recipient))
    throw new Error("Controlled QA delivery only");
  const key =
    process.env["TRUST_TAI_SUPABASE_SERVICE_KEY"] || process.env["SUPABASE_SERVICE_ROLE_KEY"];
  const apiKey = process.env["RESEND_API_KEY"],
    gateway = process.env["LOVABLE_API_KEY"];
  if (!key || !apiKey)
    return {
      state: visible.data.status,
      configured: false,
      note: "Provider or ledger writer not configured. Nothing sent.",
    };
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
  const base = gateway ? "https://connector-gateway.lovable.dev/resend" : "https://api.resend.com";
  const headers: Record<string, string> = {
    Authorization: `Bearer ${gateway || apiKey}`,
    "Content-Type": "application/json",
    ...(gateway ? { "X-Connection-Api-Key": apiKey } : {}),
  };
  async function settle(
    state: string,
    id: string | null,
    event: string | null,
    code: string | null,
  ) {
    const r = await db.rpc("hiring_settle_delivery", {
      target: outboxId,
      outcome: state,
      provider_id: id,
      provider_event: event,
      error_code: code,
    });
    if (r.error)
      throw new Error(
        "Provider may have accepted; receipt recording interrupted. Reconcile before retry.",
      );
    return { state, providerId: id, event };
  }
  if (reconcile) {
    if (!visible.data.provider_id)
      return {
        state: visible.data.status,
        note: "No provider ID. Do not resend an uncertain attempt; reconcile with provider records.",
      };
    const r = await fetch(`${base}/emails/${encodeURIComponent(visible.data.provider_id)}`, {
      headers,
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok)
      return {
        state: visible.data.status,
        note: "Provider status unavailable; no resend attempted.",
      };
    const data = (await r.json()) as { last_event?: string };
    const event = data.last_event || null;
    const state =
      event === "delivered"
        ? "delivered"
        : ["bounced", "failed", "complained", "suppressed"].includes(event || "")
          ? "failed"
          : "sent";
    return settle(state, visible.data.provider_id, event, null);
  }
  const claim = await db.rpc("hiring_claim_delivery", { target: outboxId });
  if (claim.error) throw new Error("Unable to claim delivery");
  const row = claim.data?.[0];
  if (!row)
    return {
      state: visible.data.status,
      note: "Already claimed or settled. Reconcile rather than sending again.",
    };
  // Only provider-owned test inboxes; real applicant dispatch is not enabled in this release.
  if (!QA.has(row.recipient)) return settle("failed", null, null, "qa_recipient_required");
  const receipt = await sendHiringQA({
    base,
    headers,
    id: row.id,
    revision: row.revision,
    recipient: row.recipient,
    subject: row.subject,
    body: row.body,
  });
  return settle(receipt.state, receipt.id, null, receipt.code);
}

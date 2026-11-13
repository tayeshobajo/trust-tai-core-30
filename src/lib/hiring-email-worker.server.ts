import { z } from "zod";
import {
  prepareHiringEmails,
  type SavedEmailApplication,
  type EmailRole,
  type VerifiedHiringMember,
} from "./hiring-email-templates.server";

const purpose = z.enum(["applicant_receipt", "role_owner_alert", "tai_alert_copy"]);
export type NotificationClaim = {
  id: string;
  lease: string;
  purpose: z.infer<typeof purpose>;
  templateVersion: 1;
  mode: "live" | "qa";
  application: SavedEmailApplication;
  role: EmailRole;
  members: VerifiedHiringMember[];
};
export type NotificationOutcome = {
  state: "sent" | "delivered" | "failed" | "unknown" | "blocked";
  providerId: string | null;
  code: string | null;
};
/** These ports are backed only by reviewed atomic canonical-outbox RPCs, never client payloads. */
export interface NotificationStore {
  claim(): Promise<NotificationClaim | null>;
  settle(claim: NotificationClaim, outcome: NotificationOutcome): Promise<void>;
  reconcileCandidates(): Promise<Array<{ id: string; providerId: string; state: string }>>;
  observe(id: string, outcome: NotificationOutcome): Promise<void>;
}
export function observedOutcome(
  previous: string,
  event: string | undefined,
): NotificationOutcome | null {
  if (previous === "failed" || previous === "bounced") return null;
  if (["bounced", "failed", "complained", "suppressed"].includes(event ?? ""))
    return { state: "failed", providerId: null, code: event ?? null };
  if (event === "delivered") return { state: "delivered", providerId: null, code: null };
  // Accepted is not delivered. Unknown event never erases a stronger observation.
  return null;
}
export async function runNotificationBatch(
  store: NotificationStore,
  provider: { base: string; headers: Record<string, string> },
  transport: typeof fetch = fetch,
) {
  let claimed = 0,
    reconciled = 0;
  // Sequential, bounded calls; interrupted claims must become unknown in the database, never queued.
  for (let i = 0; i < 5; i++) {
    const claim = await store.claim();
    if (!claim) break;
    claimed++;
    let result: NotificationOutcome = {
      state: "blocked",
      providerId: null,
      code: "canonical_snapshot_required",
    };
    try {
      z.string().uuid().parse(claim.id);
      z.string().uuid().parse(claim.lease);
      if (claim.templateVersion !== 1) throw new Error("Unsupported template");
      purpose.parse(claim.purpose);
      const prepared = prepareHiringEmails(claim.application, claim.role, claim.members);
      const message =
        claim.purpose === "applicant_receipt"
          ? prepared.receipt
          : claim.purpose === "role_owner_alert"
            ? prepared.ownerAlert
            : prepared.taiCopy;
      if (message?.state === "prepared" && (claim.mode === "live" || claim.mode === "qa")) {
        // All QA purposes go to a provider-owned test inbox. No recipient parameter exists.
        const recipient = claim.mode === "qa" ? "delivered@resend.dev" : message.to[0];
        result = { state: "unknown", providerId: null, code: "provider_outcome_uncertain" };
        try {
          const r = await transport(`${provider.base}/emails`, {
            method: "POST",
            redirect: "error",
            signal: AbortSignal.timeout(15000),
            headers: {
              ...provider.headers,
              "Idempotency-Key": `${message.idempotencyKey}/${claim.mode}`,
            },
            body: JSON.stringify({
              from: message.from,
              to: [recipient],
              subject: message.subject,
              html: message.html,
              text: message.text,
            }),
          });
          if (!r.ok) {
            result = {
              state:
                r.status >= 400 && r.status < 500 && ![409, 429].includes(r.status)
                  ? "failed"
                  : "unknown",
              providerId: null,
              code: `provider_http_${r.status}`,
            };
          } else {
            const body = z.object({ id: z.string().min(1).max(200) }).safeParse(await r.json());
            if (body.success) result = { state: "sent", providerId: body.data.id, code: null };
          }
        } catch {
          /* Preserve unknown, never automatically resend. */
        }
      }
    } catch {
      /* Invalid or revoked authority stays blocked, not broadcast. */
    }
    // A failed settlement stops this invocation; the durable lease expires to unknown.
    await store.settle(claim, result);
  }
  for (const row of (await store.reconcileCandidates()).slice(0, 5)) {
    if (!row.providerId || ["failed", "bounced", "delivered"].includes(row.state)) continue;
    try {
      const r = await transport(`${provider.base}/emails/${encodeURIComponent(row.providerId)}`, {
        headers: provider.headers,
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) continue;
      const event = z.object({ last_event: z.string().optional() }).safeParse(await r.json());
      if (!event.success) continue;
      const outcome = observedOutcome(row.state, event.data.last_event);
      if (outcome) {
        await store.observe(row.id, { ...outcome, providerId: row.providerId });
        reconciled++;
      }
    } catch {
      /* Status unavailable changes nothing and never resends. */
    }
  }
  return { claimed, reconciled };
}

/**
 * Linki execution transport, server only, and SEND-capable.
 *
 * Unlike `linki-provider.server.ts` (the read-only lookup provider), this
 * adapter performs the actual LinkedIn send THROUGH Linki. That is why it is
 * gated twice: the caller must already hold an `approved` action AND the
 * LINKI_EXECUTION_ENABLED kill switch must be on. The adapter itself never
 * decides anything, it takes the exact approved action, hands it to Linki,
 * and returns the receipt. No draft generation, no retries, no fallbacks.
 *
 * Architecture law:
 *   - Linki is the hand. The message body is Core's (Comms' draft); Linki
 *     types and sends it. Nothing here rewrites a single character.
 *   - Fail closed: transport error → thrown → caller marks the action
 *     `failed` (terminal). No silent retry, no "probably sent".
 */

import type { ApprovedLinkedInAction, LinkiExecutionReceipt } from "@/domain/linki-actions";

type Env = Record<string, string | undefined>;

export interface LinkiSendResult {
  receipt: LinkiExecutionReceipt;
}

/** The narrow transport input: exactly what the approved action carries. */
export interface LinkiSendInput {
  actionType: ApprovedLinkedInAction["actionType"];
  /** LinkedIn profile URL, the confirmed route for this person. */
  linkedinUrl: string;
  draftBody: string;
  /** Transport idempotency: the same action id must never double-send. */
  idempotencyKey: string;
}

export class LinkiTransportError extends Error {
  constructor(
    message: string,
    /** True when Linki answered but the send was refused/unconfirmed. */
    public readonly confirmedFailure = false,
  ) {
    super(message);
    this.name = "LinkiTransportError";
  }
}

function config(env: Env): { baseUrl: string; apiKey: string } {
  const baseUrl = (env["LINKI_BASE_URL"] ?? "http://127.0.0.1:3456").replace(/\/+$/, "");
  const apiKey = env["LINKI_API_KEY"]?.trim();
  if (!apiKey) throw new LinkiTransportError("Linki is not configured (LINKI_API_KEY missing).");
  return { baseUrl, apiKey };
}

/**
 * Send one approved action through Linki. Server-to-server only; the browser
 * never sees this module, the base URL, or the secret.
 *
 * The expected Linki endpoint is its action API (POST /api/actions). If the
 * deployed adapter surface differs, only `pathFor` changes, everything else
 * (idempotency key, receipt shape, fail-closed handling) stays the law.
 */
export async function linkiSendAction(
  input: LinkiSendInput,
  env: Env = process.env,
): Promise<LinkiSendResult> {
  const { baseUrl, apiKey } = config(env);
  const path = "/api/actions";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": apiKey,
        "x-idempotency-key": input.idempotencyKey,
      },
      body: JSON.stringify({
        type: input.actionType === "connection_request" ? "connect": "message",
        profile_url: input.linkedinUrl,
...(input.actionType === "message" ? { message: input.draftBody }: { note: input.draftBody }),
        idempotency_key: input.idempotencyKey,
      }),
      signal: controller.signal,
    });

    if (response.status === 503) {
      throw new LinkiTransportError(
        "Linki reports the LinkedIn session needs re-authentication. Nothing was sent.",
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw new LinkiTransportError("Linki rejected the internal secret.");
    }
    if (response.status === 409) {
      // Linki itself deduplicated on its idempotency key: a send with this
      // key already happened. Core's own state machine already blocks a
      // second submit of the same action, so reaching this branch means a
      // crash landed between Linki's original send and Core's receipt write.
      // Marked as a CONFIRMED failure whose reason tells the human the
      // original send may stand, any retry is a NEW action row Tai chooses
      // deliberately, never an automatic re-send.
      throw new LinkiTransportError(
        "Linki rejected the send as a duplicate (idempotency replay): this action was already sent once. The original send may stand, review before creating any retry.",
        true,
      );
    }
    if (!response.ok) {
      throw new LinkiTransportError(
        `Linki send failed (${response.status}). Nothing was confirmed as sent.`,
        true,
      );
    }

    const payload = (await response.json().catch(() => null)) as {
      run_id?: unknown;
      runId?: unknown;
      id?: unknown;
    } | null;
    const runId =
      typeof payload?.run_id === "string"
        ? payload.run_id
: typeof payload?.runId === "string"
          ? payload.runId
: typeof payload?.id === "string"
            ? payload.id
: `unconfirmed-${input.idempotencyKey}`;

    return {
      receipt: {
        provider: "linki",
        runId,
        sentAt: new Date().toISOString(),
        response: (payload ?? {}) as Record<string, unknown>,
      },
    };
  } catch (error) {
    if (error instanceof LinkiTransportError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new LinkiTransportError("Linki send timed out. Nothing was confirmed as sent.");
    }
    throw new LinkiTransportError(
      error instanceof Error ? error.message: "Linki send failed for an unknown reason.",
    );
  } finally {
    clearTimeout(timer);
  }
}

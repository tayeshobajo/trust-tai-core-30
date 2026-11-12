export type HiringReceipt = {
  state: "sent" | "failed" | "unknown";
  id: string | null;
  code: string | null;
};
export async function sendHiringQA(
  input: {
    base: string;
    headers: Record<string, string>;
    id: string;
    revision: number;
    recipient: string;
    subject: string;
    body: string;
  },
  transport: typeof fetch = fetch,
): Promise<HiringReceipt> {
  if (!["delivered@resend.dev", "bounced@resend.dev"].includes(input.recipient))
    return { state: "failed", id: null, code: "qa_recipient_required" };
  try {
    const r = await transport(`${input.base}/emails`, {
      method: "POST",
      headers: { ...input.headers, "Idempotency-Key": `hiring/${input.id}/${input.revision}` },
      body: JSON.stringify({
        from: "Trust Tai Hiring <hello@trusttai.com>",
        to: [input.recipient],
        subject: input.subject,
        text: input.body,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok)
      return {
        state: r.status >= 400 && r.status < 500 && r.status !== 409 ? "failed" : "unknown",
        id: null,
        code: `provider_http_${r.status}`,
      };
    const data = (await r.json()) as { id?: string };
    return {
      state: data.id ? "sent" : "unknown",
      id: data.id || null,
      code: data.id ? null : "missing_provider_receipt",
    };
  } catch {
    return { state: "unknown", id: null, code: "provider_outcome_uncertain" };
  }
}

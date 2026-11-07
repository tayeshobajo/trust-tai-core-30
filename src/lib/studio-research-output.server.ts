/** Local-only parser for coordinator-captured OpenCode --format json output.
 * This does not fetch runtime logs or grant invocation access. The caller must
 * obtain the receipt from the trusted one-shot coordinator, never a client/model.
 */
import { z } from "zod";
import {
  validateSourceReceipt,
  validateSuppliedResult,
  type ManualResearchTicket,
} from "./studio-research-manual-test.server";
import type { SourceEvidence } from "./studio-research-source-evidence.server";

export const receiptSchema = z
  .object({
    requestId: z.string().uuid(),
    issueId: z.string().uuid(),
    runId: z.string().uuid(),
    agentId: z.literal("5cbc9418-0ff9-4f1c-a807-c0632e26a538"),
    projectId: z.literal("d5160872-5d1c-41fb-b793-9ad7e4469f86"),
    sessionId: z.string().min(1).max(200),
    exitCode: z.literal(0),
    timedOut: z.literal(false),
    attempts: z.literal(1),
    /** Host-created mapping; native event IDs are retained, never rewritten. */
    nativeSession: z
      .object({
        version: z.literal(1),
        id: z.string().min(1).max(200),
        bindingDigest: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict()
      .optional(),
  })
  .strict();
export function readCapturedText(input: {
  ticket: ManualResearchTicket;
  evidence: readonly SourceEvidence[];
  expected: { issueId: string; runId: string; sessionId: string };
  receipt: unknown;
  stdout: string;
}) {
  try {
    const receipt = receiptSchema.parse(input.receipt);
    if (
      receipt.requestId !== input.ticket.request.requestId ||
      receipt.issueId !== input.expected.issueId ||
      receipt.runId !== input.expected.runId ||
      receipt.sessionId !== input.expected.sessionId
    )
      throw Error();
    validateSourceReceipt(input.ticket, input.evidence);
    if (Buffer.byteLength(input.stdout, "utf8") > 100000) throw Error();
    const lines = input.stdout.trim().split("\n");
    if (lines.length > 128 || !input.stdout.trim()) throw Error();
    let text = "",
      finished = false,
      started = false;
    for (const line of lines) {
      const event = JSON.parse(line);
      if (finished || event.sessionID !== (receipt.nativeSession?.id ?? receipt.sessionId))
        throw Error();
      // Installed parser recognizes text.part.text and step_finish. Unknown
      // events (including tools/errors/reasoning) fail closed in this first test.
      if (event.type === "step_start") {
        if (started || text) throw Error();
        started = true;
      } else if (event.type === "text") {
        if (
          !started ||
          typeof event.part?.text !== "string" ||
          !event.part.text.trim() ||
          (!receipt.nativeSession && text)
        )
          throw Error();
        text += event.part.text;
      } else if (event.type === "reasoning" && receipt.nativeSession) {
        if (!started) throw Error();
        // Ignore native reasoning; it is never treated as result text.
      } else if (event.type === "step_finish") {
        if (!text || event.part?.reason !== "stop") throw Error();
        finished = true;
      } else throw Error();
    }
    if (!finished) throw Error();
    return text;
  } catch {
    throw new Error("captured_result_invalid");
  }
}

export function validateCapturedOutput(input: Parameters<typeof readCapturedText>[0]) {
  return validateSuppliedResult(
    readCapturedText(input),
    input.ticket.request.requestId,
    input.evidence,
  );
}

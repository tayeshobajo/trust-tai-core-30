/** Offline-tested direct Coding Plan protocol candidate. NOT a configured executor.
 * The local OpenCode 1.17.13 binary maps zai-coding-plan to openai-compatible /chat/completions.
 * No credential lookup/default fetch, retries, subprocesses, tools, fallback or startup calls.
 * Entitlement, tokenizer, reasoning accounting and provider enforcement remain live gates. */
import { z } from "zod";
import { COORDINATOR } from "./studio-research-coordinator-contracts";
const inputSchema = z
  .object({
    prompt: z.string().min(1),
    maxInputBytes: z.number().int().min(1).max(25000),
    maxOutputTokens: z.number().int().min(1).max(2048),
    timeoutMs: z.number().int().min(1).max(60000),
  })
  .strict();
export async function callCodingPlanProtocol(
  raw: unknown,
  options: { credential: string; transport: typeof fetch; signal?: AbortSignal },
) {
  const i = inputSchema.parse(raw);
  if (
    Buffer.byteLength(i.prompt) > i.maxInputBytes ||
    !options.credential ||
    /[\r\n]/.test(options.credential)
  )
    throw Error("coding_request_invalid");
  if (options.signal?.aborted) throw Error("coding_request_cancelled");
  const controller = new AbortController();
  let rejectAbort: ((reason: Error) => void) | undefined;
  const interrupted = new Promise<never>((_r, reject) => {
    rejectAbort = reject;
  });
  interrupted.catch(() => undefined);
  const abort = () => {
    controller.abort();
    rejectAbort?.(Error("coding_outcome_uncertain"));
  };
  options.signal?.addEventListener("abort", abort, { once: true });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(Error("coding_outcome_uncertain"));
    }, i.timeoutMs);
  });
  const work = (async () => {
    // One invocation only. No response/error path retries or selects another endpoint.
    const response = await options.transport(`${COORDINATOR.endpoint}/chat/completions`, {
      method: "POST",
      redirect: "manual",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${options.credential}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "glm-5.3",
        stream: false,
        max_tokens: i.maxOutputTokens,
        tool_choice: "none",
        messages: [{ role: "user", content: i.prompt }],
      }),
    });
    if (response.status >= 300 && response.status < 400) throw Error("coding_redirect_rejected");
    if (!response.ok) throw Error("coding_response_rejected");
    const reader = response.body?.getReader();
    if (!reader) throw Error("coding_response_rejected");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const r = await reader.read();
        if (r.done) break;
        size += r.value.length;
        if (size > 100000) throw Error();
        chunks.push(r.value);
      }
    } catch {
      await reader.cancel();
      throw Error("coding_response_rejected");
    }
    if (controller.signal.aborted) throw Error("coding_outcome_uncertain");
    const b = new Uint8Array(size);
    let pos = 0;
    for (const chunk of chunks) {
      b.set(chunk, pos);
      pos += chunk.length;
    }
    const result = z
      .object({
        model: z.string(),
        choices: z
          .array(
            z.object({
              finish_reason: z.literal("stop"),
              message: z.object({
                role: z.literal("assistant"),
                content: z.string().min(1),
                tool_calls: z.array(z.never()).optional(),
                refusal: z.null().optional(),
                function_call: z.never().optional(),
              }),
            }),
          )
          .length(1),
        usage: z.object({
          prompt_tokens: z.number().int().nonnegative(),
          completion_tokens: z.number().int().nonnegative(),
          total_tokens: z.number().int().nonnegative(),
        }),
      })
      .parse(JSON.parse(new TextDecoder().decode(b)));
    if (
      result.model !== "glm-5.3" ||
      result.usage.completion_tokens > i.maxOutputTokens ||
      result.usage.total_tokens !== result.usage.prompt_tokens + result.usage.completion_tokens
    )
      throw Error("coding_response_rejected");
    return {
      text: result.choices[0]!.message.content,
      reportedUsage: result.usage,
      observedHttpRequests: 1 as const,
    };
  })();
  work.catch(() => undefined);
  try {
    return await Promise.race([work, deadline, interrupted]);
  } catch {
    throw Error("coding_outcome_uncertain");
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
  }
}

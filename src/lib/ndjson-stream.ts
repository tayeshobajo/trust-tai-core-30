/**
 * Read an NDJSON progress stream from one of the Roadmap or Scout endpoints.
 *
 * These runs take real time, so the server reports what it is doing line by
 * line. The caller sees each stage as it arrives and gets the terminal payload
 * back at the end. An error stage throws, so a failed run never looks like a
 * quiet success.
 */
export interface StreamStage {
  stage: string;
  message: string;
  data?: unknown;
}

export async function readNdjsonStream(
  response: Response,
  onStage: (stage: StreamStage) => void,
): Promise<Record<string, unknown> | null> {
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    throw new Error(text.slice(0, 300) || "The run could not start.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let payload: Record<string, unknown> | null = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const stage = JSON.parse(line) as StreamStage;
      onStage(stage);
      if (stage.stage === "error") throw new Error(stage.message);
      if (stage.stage === "complete")
        payload = (stage.data ?? null) as Record<string, unknown> | null;
    }
  }

  return payload;
}

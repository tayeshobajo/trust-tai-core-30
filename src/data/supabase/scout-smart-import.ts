/**
 * Smart Import, the browser side.
 *
 * Sends a source to Scout's import endpoint and reports each stage as it
 * happens. Nothing durable is written by this call: what comes back is a
 * proposal a person reviews before saving.
 */

import { supabase } from "@/integrations/supabase/client";
import type { ExtractedCompany, SmartImportStage } from "@/domain/scout-smart-import";

const ENDPOINT = "/api/public/scout/import";

export interface ReadSourceInput {
  organizationId: string;
  /** A public link, or nothing when text was pasted or a file was read here. */
  link?: string;
  text?: string;
  onStage?: (stage: SmartImportStage) => void;
}

export interface ReadSourceOutcome {
  companies: ExtractedCompany[];
  deterministic: boolean;
  /** False when no intelligence provider answered and a plain read was used. */
  providerAnswered: boolean;
}

export async function readSource(input: ReadSourceInput): Promise<ReadSourceOutcome> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Your session has expired. Sign in again to import a source.");

  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      organization_id: input.organizationId,
      ...(input.link ? { link: input.link } : {}),
      ...(input.text ? { text: input.text } : {}),
    }),
  });

  if (!response.ok || !response.body) {
    throw new Error(
      response.status === 401
        ? "Your session has expired. Sign in again to import a source."
        : "Scout could not read that source. Nothing was staged.",
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let outcome: ReadSourceOutcome = { companies: [], deterministic: false, providerAnswered: true };
  let failure: string | null = null;

  const handle = (line: string) => {
    if (!line.trim()) return;
    let stage: SmartImportStage;
    try {
      stage = JSON.parse(line) as SmartImportStage;
    } catch {
      return;
    }
    input.onStage?.(stage);
    if (stage.stage === "error") failure = stage.message;
    if (stage.stage === "done") {
      outcome = {
        companies: stage.companies ?? [],
        deterministic: Boolean(stage.deterministic),
        providerAnswered: stage.providerAnswered !== false,
      };
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) handle(line);
  }
  handle(buffer);

  if (failure) throw new Error(failure);
  return outcome;
}

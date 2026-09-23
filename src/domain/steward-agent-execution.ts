import type { ManualTaskRecord, StewardAgentRunStatus } from "./steward-accountability";

const HIGH_RISK = /\b(send|email|publish|post|pay|purchase|approve|sign|commit|promise|price|pricing|scope|deadline|due date|delete|deploy|contact|outreach)\b/i;

export interface AgentRiskDecision {
  risk: "low" | "high";
  executable: boolean;
  because: string;
}

/** Deterministic first gate. The model never gets to expand its own authority. */
export function classifyAgentTask(
  task: Pick<ManualTaskRecord, "title" | "notes" | "contextLinks">,
): AgentRiskDecision {
  const text = `${task.title} ${task.notes ?? ""}`;
  if (HIGH_RISK.test(text)) {
    return {
      risk: "high",
      executable: false,
      because:
        "This task may create an external action or business commitment, so a person must approve it.",
    };
  }
  if (task.contextLinks.length === 0 && !(task.notes ?? "").trim()) {
    return {
      risk: "high",
      executable: false,
      because: "The task has no supplied evidence or context, so the agent will not guess.",
    };
  }
  return {
    risk: "low",
    executable: true,
    because: "This is internal, reversible preparation using supplied context only.",
  };
}

export function terminalAgentStatus(status: StewardAgentRunStatus): boolean {
  return ["needs_approval", "blocked", "completed", "failed", "cancelled"].includes(status);
}

export function safeAgentArtifact(
  value: unknown,
): { artifact: string; evidenceRefs: string[] } | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const artifact = typeof row["artifact"] === "string" ? row["artifact"].trim() : "";
  const evidenceRefs = Array.isArray(row["evidence_refs"])
    ? row["evidence_refs"].filter(
        (item): item is string => typeof item === "string" && item.length > 0,
      )
    : [];
  return artifact && evidenceRefs.length > 0 ? { artifact, evidenceRefs } : null;
}
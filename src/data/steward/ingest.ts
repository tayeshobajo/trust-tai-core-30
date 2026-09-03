/**
 * Browser side of conversation ingestion.
 *
 * Reading a conversation is a server call, because the source key never enters
 * the browser. Reading is not confirming: this returns a proposal set for a
 * person to settle, and writes nothing.
 */

import { supabase } from "@/integrations/trust-tai/supabase";
import type { NormalizedConversation, Proposal, SourceAdapterStatus } from "@/domain/steward";
import type { MemoryConflict, MemoryUsage, StateChangeProposal } from "@/domain/steward-memory";

import type { InterpretationRun } from "@/domain/steward-semantic";

import { extractProposals } from "./extract";
import { rehearsalConversation } from "./fixture";

const ENDPOINT = "/api/public/steward/conversation";

async function token(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const value = data.session?.access_token;
  if (!value) throw new Error("Your session has expired. Sign in again.");
  return value;
}

export interface RecentConversation {
  title: string;
  occurredAt: string;
  url: string;
  externalId: string | null;
  participants: string[];
  hasTranscript: boolean;
}

export interface SourceState {
  status: SourceAdapterStatus;
  recent: RecentConversation[];
}

export async function readSourceState(organizationId: string): Promise<SourceState> {
  const response = await fetch(
    `${ENDPOINT}?organization_id=${encodeURIComponent(organizationId)}`,
    { headers: { Authorization: `Bearer ${await token()}` } },
  );
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(String(body["error"] ?? "Steward could not reach the recording source."));
  }
  const rows = Array.isArray(body["recent"]) ? (body["recent"] as Record<string, unknown>[]) : [];
  return {
    status: body["status"] as SourceAdapterStatus,
    recent: rows.map((row) => ({
      title: String(row["title"] ?? "Untitled call"),
      occurredAt: String(row["occurred_at"] ?? ""),
      url: String(row["url"] ?? ""),
      externalId: (row["external_id"] as string | null) ?? null,
      participants: Array.isArray(row["participants"]) ? (row["participants"] as string[]) : [],
      hasTranscript: row["has_transcript"] === true,
    })),
  };
}

export interface ReadResult {
  conversation: NormalizedConversation;
  proposals: Proposal[];
}

export async function readConversation(input: {
  organizationId: string;
  sourceUrl: string;
}): Promise<ReadResult> {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${await token()}`,
    },
    body: JSON.stringify({
      organization_id: input.organizationId,
      source_url: input.sourceUrl,
    }),
  });
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(String(body["error"] ?? "Steward could not read that conversation."));
  }
  return {
    conversation: body["conversation"] as NormalizedConversation,
    proposals: (body["proposals"] ?? []) as Proposal[],
  };
}

/** The rehearsal walk. Runs entirely in the browser and is never persisted. */
export function readRehearsal(): ReadResult {
  const conversation = rehearsalConversation();
  return { conversation, proposals: extractProposals(conversation) };
}

/** A reading, plus what it implies about work the workspace already carries. */
export interface InterpretationResult {
  run: InterpretationRun;
  /** Suggested continuity of an existing commitment. Never applied. */
  stateChanges: StateChangeProposal[];
  /** Where this reading disagrees with something a person decided. */
  conflicts: MemoryConflict[];
  /** The bounded memory actually handed to the model, and why each part. */
  memoryUsed: MemoryUsage[];
  /** How many beliefs Steward holds in total, so the bound is visible. */
  memoryConsidered: number;
  /** Patterns left out because people keep calling them context. */
  suppressedCount: number;
}

/**
 * Interpret one conversation for meaning.
 *
 * The model runs server-side, as the signed-in member, over the workspace's
 * own canonical memory. Nothing is written: a run is a reading, and only a
 * person turns a reading into a commitment.
 */
export async function interpretConversation(input: {
  organizationId: string;
  conversation: NormalizedConversation;
}): Promise<InterpretationResult> {
  const response = await fetch("/api/public/steward/interpret", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${await token()}`,
    },
    body: JSON.stringify({
      organization_id: input.organizationId,
      conversation: input.conversation,
    }),
  });
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      String(body["error"] ?? "Steward could not interpret this conversation right now."),
    );
  }
  return {
    run: body["run"] as InterpretationRun,
    stateChanges: (body["stateChanges"] ?? []) as StateChangeProposal[],
    conflicts: (body["conflicts"] ?? []) as MemoryConflict[],
    memoryUsed: (body["memoryUsed"] ?? []) as MemoryUsage[],
    memoryConsidered: Number(body["memoryConsidered"] ?? 0),
    suppressedCount: Number(body["suppressedCount"] ?? 0),
  };
}

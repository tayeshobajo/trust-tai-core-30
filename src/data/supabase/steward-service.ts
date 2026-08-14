/**
 * Steward persistence.
 *
 * Steward stores conversations, confirmed commitments, role memory and
 * corrections. It does not copy clients, projects or people: those stay
 * canonical, and Steward only ever holds a reference to them.
 *
 * Every write is an upsert on a stable key, so confirming the same promise
 * twice never creates it twice. If the Steward tables are not provisioned yet
 * the room says so plainly instead of pretending to be empty.
 */

import { supabase } from "@/integrations/trust-tai/supabase";
import type { EvidenceRef } from "@/domain/confidence";
import type { ID } from "@/domain/entities";
import type {
  Belief,
  Commitment,
  CommitmentStatus,
  NormalizedConversation,
  Proposal,
  RoleMemory,
} from "@/domain/steward";
import { personKeyOf } from "@/domain/steward";

import { writeTolerant, type Row } from "./schema";

const NOT_PROVISIONED = /does not exist|schema cache|42P01|PGRST205|PGRST20[0-9]/i;

export class StewardNotProvisionedError extends Error {
  constructor() {
    super(
      "Steward's tables are not in this workspace yet. Apply docs/steward-v1-schema.sql to the Trust Tai Supabase project, then reload.",
    );
  }
}

function guard(error: { code?: string; message?: string } | null): void {
  if (!error) return;
  if (NOT_PROVISIONED.test(`${error.code ?? ""} ${error.message ?? ""}`)) {
    throw new StewardNotProvisionedError();
  }
  throw new Error(error.message ?? "Steward could not reach the workspace.");
}

function evidenceOf(value: unknown): EvidenceRef[] {
  return Array.isArray(value) ? (value as EvidenceRef[]) : [];
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/* ---------------------------------------------------------- conversations */

export interface StoredConversation {
  id: ID;
  organizationId: ID;
  title: string;
  occurredAt: string;
  provider: string;
  sourceUrl: string;
  participants: { name: string; email?: string }[];
  conversation: NormalizedConversation;
}

function toConversation(row: Row): StoredConversation {
  const stored = (row["transcript"] ?? {}) as Record<string, unknown>;
  return {
    id: str(row["id"]),
    organizationId: str(row["organization_id"]),
    title: str(row["title"]),
    occurredAt: str(row["occurred_at"]),
    provider: str(row["source_provider"]),
    sourceUrl: str(row["source_url"]),
    participants: Array.isArray(row["participants"])
      ? (row["participants"] as { name: string; email?: string }[])
      : [],
    conversation: stored as unknown as NormalizedConversation,
  };
}

/* ------------------------------------------------------------ commitments */

function toCommitment(row: Row): Commitment {
  return {
    id: str(row["id"]),
    organizationId: str(row["organization_id"]),
    conversationId: str(row["conversation_id"]),
    ownerName: str(row["owner_name"]),
    ...(row["owner_email"] ? { ownerEmail: str(row["owner_email"]) } : {}),
    ...(row["owner_user_id"] ? { ownerUserId: str(row["owner_user_id"]) } : {}),
    what: str(row["statement"]),
    ...(row["beneficiary"] ? { beneficiary: str(row["beneficiary"]) } : {}),
    ...(row["due_at"] ? { dueAt: str(row["due_at"]) } : {}),
    ...(row["due_text"] ? { dueText: str(row["due_text"]) } : {}),
    status: (str(row["status"]) || "open") as CommitmentStatus,
    ...(row["project_id"] ? { projectId: str(row["project_id"]) } : {}),
    ...(row["decision_id"] ? { decisionId: str(row["decision_id"]) } : {}),
    sourceKey: str(row["source_key"]),
    evidence: evidenceOf(row["evidence"]),
    createdAt: str(row["created_at"]),
    updatedAt: str(row["updated_at"]) || str(row["created_at"]),
  };
}

function toRoleMemory(row: Row): RoleMemory {
  const list = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  return {
    id: str(row["id"]),
    organizationId: str(row["organization_id"]),
    personKey: str(row["person_key"]),
    ...(row["user_id"] ? { userId: str(row["user_id"]) } : {}),
    name: str(row["name"]),
    ...(row["title"] ? { title: str(row["title"]) } : {}),
    ...(row["pod"] ? { pod: str(row["pod"]) } : {}),
    responsibilities: list(row["responsibilities"]),
    cadence: list(row["cadence"]),
    projectIds: list(row["project_ids"]),
    notes: list(row["notes"]),
    updatedAt: str(row["updated_at"]),
  };
}

function toBelief(row: Row): Belief {
  return {
    id: str(row["id"]),
    organizationId: str(row["organization_id"]),
    subjectKey: str(row["subject_key"]),
    subjectLabel: str(row["subject_label"]) || str(row["subject_key"]),
    statement: str(row["statement"]),
    tier: (str(row["tier"]) || "observed") as Belief["tier"],
    authority: (str(row["authority"]) || "source") as Belief["authority"],
    ...(row["supersedes_id"] ? { supersedesId: str(row["supersedes_id"]) } : {}),
    evidence: evidenceOf(row["evidence"]),
    recordedBy: str(row["recorded_by_name"]) || "A person",
    recordedAt: str(row["created_at"]),
  };
}

export const stewardService = {
  /** Whether Steward's own tables exist in this workspace. */
  async provisioned(): Promise<boolean> {
    const { error } = await supabase.from("commitments").select("id").limit(1);
    if (!error) return true;
    if (NOT_PROVISIONED.test(`${error.code} ${error.message}`)) return false;
    return true;
  },

  async conversations(organizationId: ID, limit = 40): Promise<StoredConversation[]> {
    const { data, error } = await supabase
      .from("conversations")
      .select("*")
      .eq("organization_id", organizationId)
      .order("occurred_at", { ascending: false })
      .limit(limit);
    guard(error);
    return (data ?? []).map(toConversation);
  },

  async conversation(id: ID): Promise<StoredConversation | null> {
    const { data, error } = await supabase
      .from("conversations")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    guard(error);
    return data ? toConversation(data as Row) : null;
  },

  /** Store a read conversation. Re-reading the same call updates it in place. */
  async saveConversation(input: {
    organizationId: ID;
    userId: ID;
    conversation: NormalizedConversation;
  }): Promise<StoredConversation> {
    const { conversation } = input;
    const payload: Row = {
      organization_id: input.organizationId,
      source_provider: conversation.sourceRef.provider,
      source_external_id:
        conversation.sourceRef.externalId ?? conversation.sourceRef.shareToken ?? conversation.sourceRef.url,
      source_url: conversation.sourceRef.url,
      title: conversation.title,
      occurred_at: conversation.occurredAt,
      participants: conversation.participants,
      transcript: conversation,
      source_summary: conversation.sourceSummary ?? null,
      created_by: input.userId,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await writeTolerant(
      payload,
      ["organization_id", "source_provider", "source_external_id", "title", "occurred_at"],
      async (body) =>
        await supabase
          .from("conversations")
          .upsert(body, { onConflict: "organization_id,source_provider,source_external_id" })
          .select("*")
          .single(),
    );
    guard(error);
    return toConversation((data ?? {}) as Row);
  },

  async commitments(organizationId: ID): Promise<Commitment[]> {
    const { data, error } = await supabase
      .from("commitments")
      .select("*")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(300);
    guard(error);
    return (data ?? []).map(toCommitment);
  },

  /**
   * Confirm a proposal into a commitment. This is the only path from a read
   * to workspace truth, and it always runs on a person's decision.
   */
  async confirm(input: {
    organizationId: ID;
    userId: ID;
    conversationId: ID;
    proposal: Proposal;
    ownerName: string;
    ownerEmail?: string;
    dueAt?: string | null;
    projectId?: string | null;
  }): Promise<Commitment> {
    const payload: Row = {
      organization_id: input.organizationId,
      conversation_id: input.conversationId,
      source_key: input.proposal.id,
      statement: input.proposal.statement,
      owner_name: input.ownerName,
      owner_email: input.ownerEmail ?? null,
      beneficiary: input.proposal.beneficiary,
      due_at: input.dueAt ?? null,
      due_text: input.proposal.dueText,
      status: "open",
      kind: input.proposal.kind,
      project_id: input.projectId ?? null,
      evidence: input.proposal.evidence,
      confirmed_by: input.userId,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await writeTolerant(
      payload,
      ["organization_id", "conversation_id", "source_key", "statement", "owner_name", "status"],
      async (body) =>
        await supabase
          .from("commitments")
          .upsert(body, { onConflict: "organization_id,source_key" })
          .select("*")
          .single(),
    );
    guard(error);
    return toCommitment((data ?? {}) as Row);
  },

  async setStatus(id: ID, status: CommitmentStatus): Promise<Commitment | null> {
    const { data, error } = await supabase
      .from("commitments")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .maybeSingle();
    guard(error);
    return data ? toCommitment(data as Row) : null;
  },

  async setDue(id: ID, dueAt: string | null): Promise<Commitment | null> {
    const { data, error } = await supabase
      .from("commitments")
      .update({ due_at: dueAt, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .maybeSingle();
    guard(error);
    return data ? toCommitment(data as Row) : null;
  },

  async roleMemory(organizationId: ID): Promise<RoleMemory[]> {
    const { data, error } = await supabase
      .from("steward_role_memory")
      .select("*")
      .eq("organization_id", organizationId)
      .order("name", { ascending: true });
    guard(error);
    return (data ?? []).map(toRoleMemory);
  },

  async saveRoleMemory(input: {
    organizationId: ID;
    userId: ID;
    name: string;
    email?: string;
    title?: string;
    pod?: string;
    responsibilities: string[];
    cadence: string[];
    notes: string[];
  }): Promise<RoleMemory> {
    const payload: Row = {
      organization_id: input.organizationId,
      person_key: personKeyOf({ email: input.email ?? null, name: input.name }),
      name: input.name,
      email: input.email ?? null,
      title: input.title ?? null,
      pod: input.pod ?? null,
      responsibilities: input.responsibilities,
      cadence: input.cadence,
      notes: input.notes,
      updated_by: input.userId,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await writeTolerant(
      payload,
      ["organization_id", "person_key", "name"],
      async (body) =>
        await supabase
          .from("steward_role_memory")
          .upsert(body, { onConflict: "organization_id,person_key" })
          .select("*")
          .single(),
    );
    guard(error);
    return toRoleMemory((data ?? {}) as Row);
  },

  async beliefs(organizationId: ID, limit = 200): Promise<Belief[]> {
    const { data, error } = await supabase
      .from("steward_beliefs")
      .select("*")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(limit);
    guard(error);
    return (data ?? []).map(toBelief);
  },

  /** Record a belief, or a correction of one. Corrections never delete. */
  async recordBelief(input: {
    organizationId: ID;
    userId: ID;
    userName: string;
    subjectKey: string;
    subjectLabel: string;
    statement: string;
    tier: Belief["tier"];
    authority: Belief["authority"];
    supersedesId?: string;
    evidence: EvidenceRef[];
  }): Promise<Belief> {
    const payload: Row = {
      organization_id: input.organizationId,
      subject_key: input.subjectKey,
      subject_label: input.subjectLabel,
      statement: input.statement,
      tier: input.tier,
      authority: input.authority,
      supersedes_id: input.supersedesId ?? null,
      evidence: input.evidence,
      recorded_by: input.userId,
      recorded_by_name: input.userName,
    };
    const { data, error } = await writeTolerant(
      payload,
      ["organization_id", "subject_key", "statement", "tier", "authority"],
      async (body) => await supabase.from("steward_beliefs").insert(body).select("*").single(),
    );
    guard(error);
    return toBelief((data ?? {}) as Row);
  },
};

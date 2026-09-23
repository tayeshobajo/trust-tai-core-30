/**
 * What Home actually reads.
 *
 * Three real sources, each read as the signed-in person under RLS and always
 * filtered to their workspace:
 *
 *   my next actions   commitments     (work somebody said they would do)
 *   prepared for you  preparation_outputs
 *   decisions needed  approval_requests
 *
 * Each source reports its own state. A source that cannot be read says so and
 * is shown as unreadable next to the others, because a failed read and an
 * empty list are different facts and lead to different actions. One source
 * being down never blanks the screen.
 *
 * People and their names come from recorded memberships and profiles, by
 * stable id. Nothing here invents a colleague and nothing writes.
 */

import type { ID } from "@/domain/entities";
import type { MembershipRecord, WorkItemDraft, WorkspaceRole } from "@/domain/daily-workspace";
import { supabase } from "@/integrations/trust-tai/supabase";

type Row = Record<string, unknown>;

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function notProvisioned(message: string): boolean {
  return /does not exist|could not find the table|schema cache/i.test(message);
}

export type SourceState =
  | { state: "read"; count: number }
  | { state: "unreadable"; because: string };

export interface WorkspaceSourceRead {
  id: string;
  label: string;
  result: SourceState;
}

export interface DailyWorkspaceRead {
  items: WorkItemDraft[];
  people: MembershipRecord[];
  sources: WorkspaceSourceRead[];
}

function role(value: unknown): WorkspaceRole {
  return value === "owner" || value === "admin" ? value : "member";
}

/**
 * Active memberships, named from their profiles by stable id.
 *
 * The membership row id is kept alongside the user id, because some records
 * point at a membership rather than at a person. Translating between the two
 * is the only honest way to say who owns a piece of work.
 */
export async function loadWorkspacePeople(
  organizationId: ID,
): Promise<{ people: MembershipRecord[]; userIdByMembershipId: Map<string, ID> }> {
  // The live table has no surrogate `id` column (verified signed-in, 42703),
  // so selecting it failed the whole read and left every people list empty.
  const memberships = await supabase
    .from("organization_memberships")
    .select("*")
    .eq("organization_id", organizationId);
  if (memberships.error) throw new Error(memberships.error.message);

  const rows = (memberships.data ?? []) as Row[];
  const userIdByMembershipId = new Map<string, ID>(
    rows
      .filter((row) => str(row["id"]))
      .map((row) => [str(row["id"]), str(row["user_id"])]),
  );
  const ids = rows.map((row) => str(row["user_id"])).filter(Boolean);
  if (ids.length === 0) return { people: [], userIdByMembershipId };

  const profiles = await supabase.from("profiles").select("id, full_name, email").in("id", ids);
  const byId = new Map<string, Row>(
    ((profiles.data ?? []) as Row[]).map((row) => [str(row["id"]), row]),
  );

  const people = rows.map((row) => {
    const userId = str(row["user_id"]);
    const profile = byId.get(userId) ?? {};
    return {
      userId,
      organizationId,
      role: role(row["role"]),
      active: str(row["status"]) === "active",
      // The name is how they are written today; the id is who they are.
      displayName: str(profile["full_name"]) || str(profile["email"]) || "A colleague",
    };
  });

  return { people, userIdByMembershipId };
}

async function readSource(
  id: string,
  label: string,
  read: () => Promise<WorkItemDraft[]>,
): Promise<{ items: WorkItemDraft[]; source: WorkspaceSourceRead }> {
  try {
    const items = await read();
    return { items, source: { id, label, result: { state: "read", count: items.length } } };
  } catch (error) {
    const message = (error as Error).message;
    return {
      items: [],
      source: {
        id,
        label,
        result: {
          state: "unreadable",
          because: notProvisioned(message)
            ? `${label} is not set up in this workspace yet, so nothing from it is shown.`
            : `${label} could not be read: ${message}`,
        },
      },
    };
  }
}

/** Work somebody said they would do, still open. */
async function commitmentItems(organizationId: ID): Promise<WorkItemDraft[]> {
  const { data, error } = await supabase
    .from("commitments")
    .select("id, organization_id, statement, owner_name, owner_user_id, due_at, status, updated_at, created_at")
    .eq("organization_id", organizationId)
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);

  return ((data ?? []) as Row[]).map((row) => ({
    id: `commitment:${str(row["id"])}`,
    group: "my_next_actions" as const,
    title: str(row["statement"]) || "A commitment with no wording",
    because: "Somebody said this would be done and it is still open.",
    ownerId: str(row["owner_user_id"]),
    ownerName: str(row["owner_name"]),
    verb: { verb: "Open" as const, href: "/modules/steward" },
    source: { owningApp: "steward", href: "/modules/steward", label: "Steward" },
    ...(row["due_at"] ? { dueAt: str(row["due_at"]) } : {}),
    updatedAt: str(row["updated_at"]) || str(row["created_at"]),
  }));
}

/** Work a job prepared, for the person who owns the decision. */
async function preparedItems(
  organizationId: ID,
  userIdByMembershipId: Map<string, ID>,
): Promise<WorkItemDraft[]> {
  const { data, error } = await supabase
    .from("preparation_outputs")
    .select(
      "idempotency_key, job_id, subject_ref, status, summary, because, owner_label, owner_membership_id, finished_at, started_at",
    )
    .eq("organization_id", organizationId)
    .in("status", ["prepared", "needs_decision"])
    .order("finished_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);

  return ((data ?? []) as Row[]).map((row) => ({
    id: `preparation:${str(row["idempotency_key"])}`,
    group: "prepared_for_you" as const,
    title: str(row["summary"]) || "Prepared work",
    because: str(row["because"]) || "This was prepared for you to check.",
    // Prepared work belongs to the person whose decision it is, nobody else.
    // An unrecognised membership leaves the owner empty, which shows the work
    // as needing an owner rather than quietly attaching it to a stranger.
    ownerId: userIdByMembershipId.get(str(row["owner_membership_id"])) ?? "",
    ownerName: str(row["owner_label"]),
    verb: { verb: "Review" as const, href: "/modules/comms" },
    source: { owningApp: "comms", href: "/modules/comms", label: "Where it came from" },
    ...(row["because"] ? { preparedDetail: str(row["because"]) } : {}),
    updatedAt: str(row["finished_at"]) || str(row["started_at"]),
  }));
}

/** Decisions genuinely waiting on a person. */
async function approvalItems(organizationId: ID): Promise<WorkItemDraft[]> {
  const { data, error } = await supabase
    .from("approval_requests")
    .select("id, organization_id, title, why_it_needs_you, summary, status, assigned_to, owner_user_id, due_at, updated_at, created_at")
    .eq("organization_id", organizationId)
    .eq("status", "needs_review")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);

  return ((data ?? []) as Row[]).map((row) => ({
    id: `approval:${str(row["id"])}`,
    group: "decisions_needed" as const,
    title: str(row["title"]) || "A decision with no title",
    because:
      str(row["why_it_needs_you"]) || str(row["summary"]) || "This needs a person to decide.",
    ownerId: str(row["assigned_to"]) || str(row["owner_user_id"]),
    ownerName: "",
    verb: { verb: "Approve" as const, href: "/modules/approvals" },
    source: { owningApp: "approvals", href: "/modules/approvals", label: "Approvals" },
    ...(row["due_at"] ? { dueAt: str(row["due_at"]) } : {}),
    updatedAt: str(row["updated_at"]) || str(row["created_at"]),
  }));
}

/** One read of everything Home shows, with each source's own state kept. */
export async function loadDailyWorkspace(organizationId: ID): Promise<DailyWorkspaceRead> {
  const { people, userIdByMembershipId } = await loadWorkspacePeople(organizationId);

  const reads = await Promise.all([
    readSource("commitments", "Commitments", () => commitmentItems(organizationId)),
    readSource("preparation", "Prepared work", () => preparedItems(organizationId, userIdByMembershipId)),
    readSource("approvals", "Decisions", () => approvalItems(organizationId)),
  ]);

  return {
    people,
    items: reads.flatMap((entry) => entry.items),
    sources: reads.map((entry) => entry.source),
  };
}

/**
 * Subjects a roadmap can be about.
 *
 * Roadmap never invents a company or a person. It can only sequence work for
 * something that already exists in the shared tables: a client, a Scout
 * prospect, or a Comms relationship.
 */

import { supabase } from "@/integrations/trust-tai/supabase";
import type { ID } from "@/domain/entities";
import type { RoadmapSubjectKind } from "@/domain/roadmap";

export interface SubjectOption {
  kind: RoadmapSubjectKind;
  id: ID;
  label: string;
  /** Where this subject came from, shown so the choice is never ambiguous. */
  detail: string;
}

type Row = Record<string, unknown>;

/** Any table may be absent in a given workspace; that is not an error here. */
async function safe<T>(run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run();
  } catch {
    return fallback;
  }
}

export async function listSubjects(organizationId: ID): Promise<SubjectOption[]> {
  const [clients, prospects, relationships] = await Promise.all([
    safe(async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, name, status")
        .eq("organization_id", organizationId)
        .order("name", { ascending: true });
      if (error) throw new Error(error.message);
      return ((data ?? []) as Row[]).map<SubjectOption>((row) => ({
        kind: "client",
        id: String(row["id"]),
        label: String(row["name"] ?? "Client"),
        detail: `Client · ${String(row["status"] ?? "unknown").replace("_", " ")}`,
      }));
    }, [] as SubjectOption[]),
    safe(async () => {
      const { data, error } = await supabase
        .from("prospects")
        .select("id, company_name, status")
        .eq("organization_id", organizationId)
        .order("updated_at", { ascending: false })
        .limit(100);
      if (error) throw new Error(error.message);
      return ((data ?? []) as Row[]).map<SubjectOption>((row) => ({
        kind: "prospect",
        id: String(row["id"]),
        label: String(row["company_name"] ?? "Prospect"),
        detail: `Scout · ${String(row["status"] ?? "discovered").replace("_", " ")}`,
      }));
    }, [] as SubjectOption[]),
    safe(async () => {
      const { data, error } = await supabase
        .from("comms_relationships")
        .select("id, full_name, company_name, stage")
        .eq("organization_id", organizationId)
        .order("updated_at", { ascending: false })
        .limit(100);
      if (error) throw new Error(error.message);
      return ((data ?? []) as Row[]).map<SubjectOption>((row) => ({
        kind: "relationship",
        id: String(row["id"]),
        label:
          String(row["company_name"] || row["full_name"] || "Relationship") +
          (row["company_name"] && row["full_name"] ? ` · ${String(row["full_name"])}` : ""),
        detail: `Comms · ${String(row["stage"] ?? "new").replace("_", " ")}`,
      }));
    }, [] as SubjectOption[]),
  ]);

  return [...clients, ...prospects, ...relationships];
}

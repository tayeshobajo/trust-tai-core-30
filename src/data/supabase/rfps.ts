import { supabase } from "@/integrations/trust-tai/supabase";
import {
  opportunityInput,
  submissionInput,
  validateUpload,
  type Opportunity,
  type OpportunityInput,
  type Snapshot,
  type DraftVersion,
  type Stage,
} from "@/domain/rfps";
const fail = (e: { code?: string; message: string }) =>
  new Error(
    e.code === "23505"
      ? "This source and application cycle are already tracked. Open the existing opportunity."
      : ["42P01", "PGRST205"].includes(e.code || "")
        ? "The RFPs workspace database is not installed yet. No opportunities have been loaded."
        : e.message,
  );
export function rfpService(org: string) {
  async function list(table: string) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .eq("organization_id", org)
      .order("created_at", { ascending: false })
      .limit(501);
    if (error) throw fail(error);
    if (data.length > 500)
      throw new Error(
        "This workspace exceeds the current 500-record view. Narrow server pagination is required before continuing.",
      );
    return data;
  }
  async function insert(table: string, row: object) {
    const { data, error } = await supabase
      .from(table)
      .insert({ ...row, organization_id: org })
      .select()
      .single();
    if (error) throw fail(error);
    return data;
  }
  return {
    async load(): Promise<Snapshot> {
      const access = await supabase
        .from("rfp_access")
        .select("access_level")
        .eq("organization_id", org)
        .eq("scope_id", org)
        .limit(1);
      if (access.error) throw fail(access.error);
      if (!access.data?.length)
        throw new Error(
          "RFP workspace access has not been provisioned. Ask your administrator to review your access; no records were loaded.",
        );
      const [opportunities, versions, submissions, approvals, checks] = await Promise.all(
        [
          "rfp_opportunities",
          "rfp_draft_versions",
          "rfp_submissions",
          "rfp_draft_approvals",
          "rfp_discovery_checks",
        ].map(list),
      );
      return {
        opportunities: opportunities ?? [],
        versions: versions ?? [],
        submissions: submissions ?? [],
        approvals: approvals ?? [],
        checks: checks ?? [],
      };
    },
    async create(input: OpportunityInput) {
      return insert("rfp_opportunities", opportunityInput.parse(input));
    },
    async update(o: Opportunity, input: OpportunityInput, stage: Stage) {
      const { data, error } = await supabase
        .from("rfp_opportunities")
        .update({ ...opportunityInput.parse(input), stage })
        .eq("organization_id", org)
        .eq("id", o.id)
        .eq("revision", o.revision)
        .select()
        .single();
      if (error)
        throw error.code === "PGRST116"
          ? new Error("This opportunity changed. Refresh and review before saving again.")
          : fail(error);
      return data;
    },
    async upload(o: Opportunity, file: File, note: string) {
      validateUpload(file);
      const id = crypto.randomUUID();
      const path = `${org}/${o.id}/${id}/${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const hash = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer())),
      )
        .map((v) => v.toString(16).padStart(2, "0"))
        .join("");
      const { error } = await supabase.storage.from("rfp-drafts").upload(path, file, {
        upsert: false,
        contentType: file.type || "application/octet-stream",
      });
      if (error) throw fail(error);
      try {
        return await insert("rfp_draft_versions", {
          id,
          opportunity_id: o.id,
          file_name: file.name,
          object_path: path,
          note,
          sha256: hash,
        });
      } catch {
        throw new Error(
          "File transfer completed but its version record failed. Do not retry blindly: ask an administrator to reconcile the private orphan upload.",
        );
      }
    },
    async download(version: DraftVersion) {
      const { data, error } = await supabase.storage
        .from("rfp-drafts")
        .download(version.object_path);
      if (error) throw fail(error);
      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url;
      a.download = version.file_name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    async approve(o: Opportunity, version: DraftVersion) {
      return insert("rfp_draft_approvals", { opportunity_id: o.id, draft_id: version.id });
    },
    async recordSubmission(o: Opportunity, input: unknown) {
      const values = submissionInput.parse(input);
      return insert("rfp_submissions", { opportunity_id: o.id, ...values });
    },
    async check(note: string, source_count: number, failed_count: number) {
      if (
        !note.trim() ||
        !Number.isInteger(source_count) ||
        source_count < 1 ||
        !Number.isInteger(failed_count) ||
        failed_count < 0 ||
        failed_count > source_count
      )
        throw new Error("Describe the review and enter valid source counts.");
      return insert("rfp_discovery_checks", { note, source_count, failed_count });
    },
  };
}
export type RfpService = ReturnType<typeof rfpService>;

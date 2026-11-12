import { supabase } from "@/integrations/trust-tai/supabase";
import { jobSchema, type Snapshot, type Job } from "@/domain/hiring";
export function hiringService(org: string) {
  async function rpc(name: string, args: Record<string, unknown>) {
    const r = await supabase.rpc(name, args);
    if (r.error) throw new Error(r.error.message);
    return r.data;
  }
  return {
    async load(): Promise<Snapshot> {
      const allowed = await rpc("hiring_allowed", { org });
      if (!allowed)
        throw new Error(
          "Hiring access is restricted to Tai, Diamond and Ayobami. No candidate records were loaded.",
        );
      const result = await Promise.all(
        ["career_jobs", "career_applications", "career_application_events", "career_messages"].map(
          (t) =>
            supabase
              .from(t)
              .select("*")
              .eq("organization_id", org)
              .order("created_at", { ascending: false })
              .limit(501),
        ),
      );
      for (const r of result) {
        if (r.error) throw new Error(r.error.message);
        if (r.data.length > 500)
          throw new Error(
            "More than 500 records. A paginated review is required; no partial queue is shown.",
          );
      }
      return {
        jobs: result[0]!.data,
        applications: result[1]!.data,
        events: result[2]!.data,
        messages: result[3]!.data,
      } as Snapshot;
    },
    async saveJob(input: unknown, existing?: Job) {
      const row = jobSchema.parse(input);
      const r = existing
        ? await supabase
            .from("career_jobs")
            .update({ ...row, revision: existing.revision + 1 })
            .eq("organization_id", org)
            .eq("id", existing.id)
            .eq("revision", existing.revision)
            .select("id")
            .single()
        : await supabase
            .from("career_jobs")
            .insert({ ...row, organization_id: org })
            .select("id")
            .single();
      if (r.error)
        throw new Error(
          r.error.code === "23505"
            ? "This job URL is already in use."
            : "Job could not be saved. Reload if another reviewer changed it.",
        );
    },
    update: (args: Record<string, unknown>) => rpc("hiring_update_application", args),
    note: (target: string, note: string, operation: string) =>
      rpc("hiring_add_note", { target, note, operation }),
    draft: (args: Record<string, unknown>) => rpc("hiring_save_message", args),
    testSend: (message_id: string, expected: number) =>
      rpc("hiring_test_send", { message_id, expected }),
    async providerQA(message_id: string, expected: number, receipt?: string | null) {
      const outboxId = receipt || (await rpc("hiring_queue_qa", { message_id, expected }));
      const session = await supabase.auth.getSession();
      const response = await fetch("/api/public/hiring/delivery", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.data.session?.access_token || ""}`,
        },
        body: JSON.stringify({ outboxId, reconcile: !!receipt }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Delivery unavailable; reconcile before retry");
      return result;
    },
    async resume(path: string) {
      const r = await supabase.storage
        .from("career-resumes")
        .createSignedUrl(path, 60, { download: true });
      if (r.error) throw new Error("Resume access was denied or the file is unavailable.");
      return r.data.signedUrl;
    },
  };
}
export type HiringService = ReturnType<typeof hiringService>;

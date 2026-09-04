import { createClient } from "@supabase/supabase-js";
const c = createClient(process.env["TRUST_TAI_SUPABASE_URL"]!, process.env["TRUST_TAI_SUPABASE_SERVICE_KEY"]!, { auth: { persistSession: false } });
const batch = "cbat_nooywxzdmtn2noap";
const key = `content:blog_batch:content_batch:${batch}`;
const req = await c.from("approval_requests").select("id").eq("source_key", key).maybeSingle();
if (req.data) {
  for (const t of ["approval_items","approval_events","approval_notes"]) {
    const r = await c.from(t).delete().eq("request_id", req.data.id);
    console.log(t, r.error?.message ?? "cleared");
  }
  console.log("request", (await c.from("approval_requests").delete().eq("id", req.data.id)).error?.message ?? "cleared");
}
console.log("items", (await c.from("content_items").delete().eq("batch_id", batch)).error?.message ?? "cleared");
console.log("batch", (await c.from("content_batches").delete().eq("id", batch)).error?.message ?? "cleared");

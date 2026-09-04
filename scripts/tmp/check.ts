import { createClient } from "@supabase/supabase-js";
const c = createClient(process.env["TRUST_TAI_SUPABASE_URL"]!, process.env["TRUST_TAI_SUPABASE_SERVICE_KEY"]!, { auth: { persistSession: false } });
const b = "cbat_ffebutsjmtn2ydym";
const { data: items } = await c.from("content_items").select("title,state,exception_reasons,seo,internal_links,draft_markdown").eq("batch_id", b).order("position");
for (const i of items ?? []) {
  const links = (i.internal_links as any[]) ?? [];
  console.log(`${i.state.padEnd(9)} ${String((i.draft_markdown as string).split(/\s+/).length).padStart(4)}w  links ${links.filter(l=>l.resolved).length}/${links.length}  ${(i.exception_reasons as string[]).join(",")}  ${i.title.slice(0,60)}`);
}
const { data: req } = await c.from("approval_requests").select("id,source_app,category,status,revision,payload").eq("source_key", `content:blog_batch:content_batch:${b}`).maybeSingle();
console.log("approval", req?.id, req?.source_app, req?.category, req?.status, "rev", req?.revision);
const { count } = await c.from("approval_items").select("*", { count: "exact", head: true }).eq("request_id", req!.id);
console.log("children", count);

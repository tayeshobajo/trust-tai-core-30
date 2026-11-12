import { createClient } from "@supabase/supabase-js";
import { createHash, createHmac } from "node:crypto";
import { z } from "zod";
import { HIRING_ORG } from "@/domain/hiring";
const URL = "https://okydosoacqdnursmmenf.supabase.co";
const MIME = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];
const COLUMNS =
  "id,slug,title,team,arrangement,location,summary,about,responsibilities,requirements,nice_to_have,questions,hiring_steps,status,sort_order";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const link = z
  .string()
  .max(300)
  .url()
  .refine((v) => v.startsWith("https://"))
  .or(z.literal(""))
  .optional();
export const publicHiringSubmission = z.object({
  submissionId: z.string().uuid(),
  jobSlug: z.string().min(1).max(120),
  fullName: z.string().trim().min(2).max(120),
  email: z.string().email().max(254),
  location: z.string().trim().min(1).max(120),
  timezone: z.string().trim().min(1).max(100),
  linkedinUrl: link,
  portfolioUrl: link,
  answers: z
    .record(z.string().max(60), z.string().max(4000))
    .refine((v) => Object.keys(v).length <= 3),
  consent: z.literal(true),
  talentPoolConsent: z.boolean().default(false),
  resumePath: z.string().regex(/^[0-9a-f-]{36}\/resume\.(pdf|doc|docx)$/),
  resumeName: z.string().min(1).max(160),
  resumeReceipt: z.string().regex(/^[0-9a-f]{64}$/),
});
export async function publicHiring(action: string, input: unknown) {
  const key =
    process.env["TRUST_TAI_SUPABASE_SERVICE_KEY"] || process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!key) throw new Error("Hiring backend unavailable");
  const db = createClient(URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (url, init) => {
        const headers = new Headers(init?.headers);
        headers.set("apikey", key);
        if (key.startsWith("sb_") && headers.get("authorization") === `Bearer ${key}`)
          headers.delete("authorization");
        return fetch(url, { ...init, headers });
      },
    },
  });
  const enabled = async () => {
    const r = await db.from("hiring_runtime").select("intake_enabled").eq("id", true).single();
    if (r.error) throw r.error;
    return r.data.intake_enabled === true;
  };
  if (action === "jobs") {
    const r = await db
      .from("career_jobs")
      .select(COLUMNS)
      .eq("organization_id", HIRING_ORG)
      .in("status", ["open", "closed"])
      .order("sort_order")
      .limit(100);
    if (r.error) throw r.error;
    return { jobs: r.data, accepting: await enabled() };
  }
  if (action === "receipt") {
    const p = z
      .object({ submissionId: z.string().uuid(), receipt: z.string().regex(/^[0-9a-f]{64}$/) })
      .parse(input);
    const u = await db
      .from("career_uploads")
      .select("submission_key")
      .eq("submission_key", p.submissionId)
      .eq("receipt_hash", hash(p.receipt))
      .maybeSingle();
    if (u.error) throw u.error;
    if (!u.data) return { saved: false };
    const a = await db
      .from("career_applications")
      .select("id")
      .eq("submission_key", p.submissionId)
      .maybeSingle();
    if (a.error) throw a.error;
    return { saved: !!a.data };
  }
  if (!(await enabled())) return { ok: false, error: "not_open" };
  if (action === "upload") {
    const p = z
      .object({
        submissionId: z.string().uuid(),
        jobSlug: z.string().min(1).max(120),
        name: z.string().min(1).max(160),
        type: z.string(),
        size: z.number().int().positive().max(10485760),
      })
      .parse(input);
    if (!MIME.includes(p.type)) return { ok: false, error: "type" };
    const j = await db
      .from("career_jobs")
      .select("id")
      .eq("organization_id", HIRING_ORG)
      .eq("slug", p.jobSlug)
      .eq("status", "open")
      .maybeSingle();
    if (j.error) throw j.error;
    if (!j.data) return { ok: false, error: "closed" };
    const extension = p.type === MIME[0] ? "pdf" : p.type === MIME[1] ? "doc" : "docx";
    const path = `${p.submissionId}/resume.${extension}`;
    // Domain-separated signing material stays only in the existing canonical server.
    const signing =
      process.env["HIRING_UPLOAD_SIGNING_KEY"] || hash("trust-tai/hiring/upload/v1:" + key);
    const receipt = createHmac("sha256", signing)
      .update(`${p.submissionId}:${p.jobSlug}`)
      .digest("hex");
    const prior = await db
      .from("career_uploads")
      .select("path,job_slug,receipt_hash")
      .eq("submission_key", p.submissionId)
      .maybeSingle();
    if (prior.error) throw prior.error;
    if (
      prior.data &&
      (prior.data.path !== path ||
        prior.data.job_slug !== p.jobSlug ||
        prior.data.receipt_hash !== hash(receipt))
    )
      return { ok: false, error: "unavailable" };
    if (!prior.data) {
      const r = await db.from("career_uploads").insert({
        submission_key: p.submissionId,
        job_slug: p.jobSlug,
        path,
        receipt_hash: hash(receipt),
      });
      if (r.error && r.error.code !== "23505") throw r.error;
    }
    const found = await db.storage
      .from("career-resumes")
      .list(p.submissionId, { search: `resume.${extension}`, limit: 10 });
    if (found.error) throw found.error;
    if (found.data.some((f) => f.name === `resume.${extension}`))
      return { ok: true, path, receipt, signedUrl: null };
    const signed = await db.storage
      .from("career-resumes")
      .createSignedUploadUrl(path, { upsert: false });
    if (signed.error) throw signed.error;
    return { ok: true, path, receipt, signedUrl: signed.data.signedUrl };
  }
  if (action === "submit") {
    const { resumeReceipt, ...p } = publicHiringSubmission.parse(input);
    const r = await db.rpc("hiring_submit", {
      p,
      receipt_hash: hash(resumeReceipt),
      payload_hash: hash(JSON.stringify(p)),
    });
    if (r.error)
      return {
        ok: false,
        error: r.error.message.includes("Role closed")
          ? "closed"
          : r.error.message.includes("Required answer")
            ? "missing"
            : r.error.message.includes("Rate limited")
              ? "rate_limited"
              : "failed",
      };
    return { ok: true, applicationId: r.data, delivery: "disabled" };
  }
  throw new Error("Unknown action");
}

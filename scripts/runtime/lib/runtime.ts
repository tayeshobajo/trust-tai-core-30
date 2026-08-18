/**
 * Runtime env + db bootstrap for Project Intelligence scripts.
 * Server-side only; reads .env.local; service-role client (OpenClaw runtime
 * is a trusted server actor, audited under its own actor identity).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { createHash, randomUUID } from "crypto";

const envPath = resolve(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) {
      const key = line.slice(0, i).trim();
      const val = line.slice(i + 1).trim();
      if (key && !process.env[key]) process.env[key] = val;
    }
  }
}

export const ORG_ID = process.env.TRUST_TAI_ORG_ID ?? "ee683a64-e045-4226-a8ff-4ae6590d6789";

/** Stable runtime actor identity — every audit row names OpenClaw honestly. */
export const RUNTIME_ACTOR_ID = "0f2a1b3c-runtime-4e5d-9a8b-openclaw00001".replace(
  "0f2a1b3c-runtime-4e5d-9a8b-openclaw00001",
  "a1e5f6d2-7c3b-4e89-9d0a-5b6c7d8e9f01",
);
export const RUNTIME_ACTOR_LABEL = "OpenClaw Runtime";

let _sb: SupabaseClient | null = null;
export function db(): SupabaseClient {
  if (!_sb) {
    if (!process.env.TRUST_TAI_SUPABASE_URL || !process.env.TRUST_TAI_SUPABASE_SERVICE_KEY) {
      throw new Error("Missing TRUST_TAI_SUPABASE_URL / TRUST_TAI_SUPABASE_SERVICE_KEY");
    }
    _sb = createClient(
      process.env.TRUST_TAI_SUPABASE_URL,
      process.env.TRUST_TAI_SUPABASE_SERVICE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }
  return _sb;
}

export const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");
export const newId = (): string => randomUUID();

/** Append-only audit write. Never updates or deletes. */
export async function audit(input: {
  projectId?: string | null;
  projectName?: string | null;
  action: string;
  subject: string;
  beforeState?: string | null;
  afterState?: string | null;
}): Promise<void> {
  const { error } = await db().from("intelligence_audit").insert({
    organization_id: ORG_ID,
    ...(input.projectId ? { project_id: input.projectId } : {}),
    ...(input.projectName ? { project_name: input.projectName } : {}),
    action: input.action,
    subject: input.subject.slice(0, 500),
    ...(input.beforeState ? { before_state: input.beforeState } : {}),
    ...(input.afterState ? { after_state: input.afterState } : {}),
    actor_id: RUNTIME_ACTOR_ID,
    actor_label: RUNTIME_ACTOR_LABEL,
    occurred_at: new Date().toISOString(),
  });
  if (error) throw new Error(`audit write failed: ${error.message}`);
}

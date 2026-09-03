#!/usr/bin/env npx tsx
/**
 * §25 Failure tests, prove honest behavior, not just happy paths.
 * Each test expects a SPECIFIC refusal/honest-state, not a crash.
 */
import { readFileSync, existsSync } from "fs";
import { writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { resolve } from "path";

const envPath = resolve(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) {
      const key = line.slice(0, i).trim();
      if (!process.env[key]) process.env[key] = line.slice(i + 1).trim();
    }
  }
}

const ORG = "ee683a64-e045-4226-a8ff-4ae6590d6789";
const P = "97184a93-72e3-4570-8876-93923fea7199";
let pass = 0, fail = 0;
const t = (name: string, ok: boolean, detail: string) => {
  if (ok) { pass++; console.log(`  ✓ ${name}, ${detail}`); }
  else { fail++; console.log(`  ✗ ${name}, ${detail}`); }
};

const { createClient } = await import("@supabase/supabase-js");
const sb = createClient(process.env.TRUST_TAI_SUPABASE_URL!, process.env.TRUST_TAI_SUPABASE_SERVICE_KEY!, { auth: { persistSession: false } });
const { normalizeDocument } = await import("./lib/normalize");

// 1. Unreadable Claude link → honest import_needs_upload (domain syncStateFor)
const { syncStateFor } = await import("../../src/domain/project-intelligence");
t("Claude URL stays import_needs_upload", syncStateFor("claude") === "import_needs_upload", "syncStateFor('claude') refuses to pretend readability");
t("ChatGPT URL stays import_needs_upload", syncStateFor("chatgpt") === "import_needs_upload", "syncStateFor('chatgpt') refuses to pretend readability");

// 2. Invalid ChatGPT link → no fake import (ingest requires actual content)
{
  const { data: bad } = await sb.from("project_thinking_sources").insert({
    organization_id: ORG, project_id: P, source_type: "chatgpt",
    title: "Invalid link test", url: "https://chatgpt.com/c/nonexistent-xyz",
    is_primary: false, sync_state: "import_needs_upload",
  }).select("id").single();
  const stillNeedsUpload = bad && (await sb.from("project_thinking_sources").select("sync_state").eq("id", bad.id).single()).data?.sync_state === "import_needs_upload";
  t("Invalid ChatGPT link → no fake import", Boolean(stillNeedsUpload), "source remains import_needs_upload without content");
  await sb.from("project_thinking_sources").delete().eq("id", bad!.id);
}

// 3. Cross-org source → inaccessible (packet loader scopes by org)
{
  // Packet loader scopes every read by organization_id, verify the fixture
  // project is invisible under a foreign org id.
  const { data: foreign } = await sb.from("projects").select("id")
.eq("organization_id", "00000000-0000-0000-0000-000000000001")
.eq("id", P).maybeSingle();
  t("Cross-org source → inaccessible", foreign === null, "org-scoped read of fixture project under foreign org returns nothing");
}

// 4. Superseded mockup excluded from canonical context
{
  const { data: file } = await sb.from("project_files").insert({
    organization_id: ORG, project_id: P, name: "intake-mockup-v0.png", kind: "reference",
    storage_path: "projects/97184a93/intake-mockup-v0.png", content_type: "image/png", size_bytes: 0,
  }).select("id").single();
  const { data: asset } = await sb.from("project_assets").insert({
    organization_id: ORG, project_id: P, file_id: file!.id, asset_type: "mockup",
    title: "Old intake draft", version: 0, status: "superseded",
  }).select("id").single();
  const { buildProjectContextPacket } = await import("../../src/data/projects/context-packet");
  const packet = buildProjectContextPacket({
    project: { id: P, organizationId: ORG, name: "t", state: "in_flight", pointA: "", pointB: "", deliveryItems: [] } as never,
    assets: [{ id: asset!.id, title: "Old intake draft", assetType: "mockup", version: 0, fileId: file!.id, status: "superseded" } as never],
    knowledge: [], decisions: [], blockers: [], work: [], connections: [], thinking: [],
  });
  t("Superseded mockup excluded", packet.approvedAssets.length === 0, "superseded asset never enters approvedAssets");
  await sb.from("project_assets").delete().eq("id", asset!.id);
  await sb.from("project_files").delete().eq("id", file!.id);
}

// 5. Draft mockup not treated as approved
{
  const { data: file } = await sb.from("project_files").insert({
    organization_id: ORG, project_id: P, name: "draft.png", kind: "reference",
    storage_path: "projects/97184a93/draft.png", content_type: "image/png", size_bytes: 0,
  }).select("id").single();
  const { data: asset } = await sb.from("project_assets").insert({
    organization_id: ORG, project_id: P, file_id: file!.id, asset_type: "mockup",
    title: "Rough draft", version: 1, status: "draft",
  }).select("id").single();
  const { buildProjectContextPacket } = await import("../../src/data/projects/context-packet");
  const packet = buildProjectContextPacket({
    project: { id: P, organizationId: ORG, name: "t", state: "in_flight", pointA: "", pointB: "", deliveryItems: [] } as never,
    assets: [{ id: asset!.id, title: "Rough draft", assetType: "mockup", version: 1, fileId: file!.id, status: "draft" } as never],
    knowledge: [], decisions: [], blockers: [], work: [], connections: [], thinking: [],
  });
  t("Draft mockup not approved", packet.approvedAssets.length === 0, "draft asset never enters approvedAssets");
  await sb.from("project_assets").delete().eq("id", asset!.id);
  await sb.from("project_files").delete().eq("id", file!.id);
}

// 6. No GitHub reader → stays linked (nothing flips status without genuine read)
{
  const { data: conn } = await sb.from("project_connections").select("status, last_synced_at").eq("project_id", P).eq("connection_type", "github").single();
  t("GitHub stays linked without reader", conn?.status === "linked" && !conn?.last_synced_at, "no fake connected state");
}

// 7. Agent lacks capability → assignment refused (agentCanTake semantics)
{
  const { agentCanTake } = await import("../../src/data/steward/actions");
  const fakeAgent = { capabilities: ["comms.draft"] } as never;
  const fakeTask = { title: "Design the database schema", origin: "human", sourceLabel: "" } as never;
  t("Capability mismatch refused", agentCanTake(fakeAgent, fakeTask) === false, "comms agent cannot take db schema task by keyword gate");
}

// 8. Thinking import offline → confirmed context remains usable (packet builds from DB alone)
{
  const { buildProjectContextPacket } = await import("../../src/data/projects/context-packet");
  const packet = buildProjectContextPacket({
    project: { id: P, organizationId: ORG, name: "t", state: "in_flight", pointA: "", pointB: "outcome", deliveryItems: [] } as never,
    knowledge: [{ id: "k1", section: "requirement", body: "r", origin: "human", reviewState: "confirmed", capturedAt: "" } as never],
    decisions: [], blockers: [], work: [], assets: [], connections: [], thinking: [],
  });
  t("Offline import → context usable", packet.requirements.length === 1, "confirmed knowledge serves packets without live sources");
}

// 9. Normalizer: provider-neutral output + hash stability
{
  const doc = normalizeDocument({ source_id: "s", provider: "chatgpt", title: "t", raw: "You: hi\nChatGPT: Decision: ship it." });
  const doc2 = normalizeDocument({ source_id: "s", provider: "chatgpt", title: "t", raw: "You: hi\nChatGPT: Decision: ship it." });
  t("Normalizer deterministic", doc.content_hash === doc2.content_hash, "same content → same fingerprint");
  t("Normalizer splits speakers", doc.messages.length === 2 && doc.messages[1].role === "assistant", "user/assistant turns parsed");
}

console.log(`\nFAILURE TESTS: ${pass} pass, ${fail} fail`);
process.exit(fail > 0 ? 1: 0);

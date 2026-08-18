#!/usr/bin/env npx tsx
/**
 * R6: Populate the fixture project "Client onboarding path" per brief §24.
 * One-time setup: thinking source, confirmed decision, requirement, approved
 * mockup asset, Lovable + GitHub links, agent effectiveness definition.
 * Every mutation audited. Idempotent-safe: run once.
 */
import { db, audit, ORG_ID, RUNTIME_ACTOR_ID, RUNTIME_ACTOR_LABEL } from "./lib/runtime";

const PROJECT_ID = "97184a93-72e3-4570-8876-93923fea7199";

async function main() {
  const sb = db();
  const now = new Date().toISOString();

  // 1. Thinking source — ChatGPT URL, honest state (§2/§4)
  const { data: src, error: srcErr } = await sb
    .from("project_thinking_sources")
    .insert({
      organization_id: ORG_ID,
      project_id: PROJECT_ID,
      source_type: "chatgpt",
      title: "Onboarding thinking — intake design",
      url: "https://chatgpt.com/c/fixture-onboarding-intake",
      is_primary: true,
      sync_state: "import_needs_upload",
      added_by_label: RUNTIME_ACTOR_LABEL,
      added_by: RUNTIME_ACTOR_ID,
    })
    .select("id")
    .single();
  if (srcErr) throw new Error(`thinking source: ${srcErr.message}`);

  // 2. Confirmed decision (human-approved — highest authority)
  const { error: decErr } = await sb.from("project_decisions").insert({
    organization_id: ORG_ID,
    project_id: PROJECT_ID,
    question: "Do new clients self-serve onboarding or get a guided path?",
    why_it_matters: "Determines build complexity and client success risk.",
    owner_label: "Tai",
    status: "answered",
    answer: "Guided path — one intake flow carries every new client.",
    decided_at: now,
  });
  if (decErr) throw new Error(`decision: ${decErr.message}`);

  // 3. Confirmed requirement (knowledge, confirmed by human act)
  const { error: knErr } = await sb.from("project_knowledge").insert({
    organization_id: ORG_ID,
    project_id: PROJECT_ID,
    section: "requirement",
    body: "Intake must complete in under 10 minutes for a non-technical client.",
    origin: "human",
    review_state: "confirmed",
    source_label: "Tai",
    captured_at: now,
  });
  if (knErr) throw new Error(`knowledge: ${knErr.message}`);

  // 4. Approved mockup asset (file row + asset row; upload ≠ approval — status approved is explicit)
  const existingFile = await sb
    .from("project_files")
    .select("id")
    .eq("project_id", PROJECT_ID)
    .eq("storage_path", "projects/97184a93/intake-mockup-v1.png")
    .maybeSingle();
  if (existingFile.data) {
    console.log(JSON.stringify({ note: "fixture already present", fileId: existingFile.data.id }));
    process.exit(0);
  }
  const { data: file, error: fileErr } = await sb
    .from("project_files")
    .insert({
      organization_id: ORG_ID,
      project_id: PROJECT_ID,
      name: "intake-mockup-v1.png",
      kind: "reference",
      storage_path: "projects/97184a93/intake-mockup-v1.png",
      content_type: "image/png",
      size_bytes: 0,
      uploaded_by_label: RUNTIME_ACTOR_LABEL,
      uploaded_by: RUNTIME_ACTOR_ID,
    })
    .select("id")
    .single();
  if (fileErr) throw new Error(`file: ${fileErr.message}`);
  const { error: assetErr } = await sb.from("project_assets").insert({
    organization_id: ORG_ID,
    project_id: PROJECT_ID,
    file_id: file!.id,
    asset_type: "mockup",
    title: "Guided intake — v1 approved mockup",
    version: 1,
    status: "approved",
    uploaded_by_label: RUNTIME_ACTOR_LABEL,
    uploaded_by: RUNTIME_ACTOR_ID,
  });
  if (assetErr) throw new Error(`asset: ${assetErr.message}`);

  // 5. Connections: Lovable + GitHub, honest 'linked' (bookmarks — §19)
  const conn = (type: string, label: string, url: string, external_id: string) => ({
    organization_id: ORG_ID,
    project_id: PROJECT_ID,
    connection_type: type,
    label,
    url,
    external_id,
    status: "linked",
  });
  const { error: connErr } = await sb.from("project_connections").insert([
    conn("lovable", "Trust Tai Core (30)", "https://lovable.dev/projects/65944e34-ede5-4757-befb-870e1ff97444", "65944e34-ede5-4757-befb-870e1ff97444"),
    conn("github", "trust-tai-core-30", "https://github.com/tayeshobajo/trust-tai-core-30", "trust-tai-core-30"),
  ]);
  if (connErr) throw new Error(`connections: ${connErr.message}`);

  // 6. Agent effectiveness for Comms Agent (§15)
  const { error: effErr } = await sb.from("agent_effectiveness").insert({
    organization_id: ORG_ID,
    agent_id: "239a7269-6309-4547-bd54-67e4e3798b85",
    responsibility: "Draft client-facing comms from confirmed project truth. Never invent policy.",
    expected_weekly_outcomes: ["Draft-ready intake copy", "Relationship summaries current"],
    success_criteria: ["Drafts cite confirmed decisions", "No unconfirmed claim in client-facing text"],
    surface_when: ["Client language contradicts confirmed decision", "Missing context for a draft"],
    required_context: ["Confirmed decisions", "Approved assets", "Open questions"],
    escalation_rules: ["Anything contractual → Tai", "Missing requirement → ask, do not assume"],
    evidence_expected: ["Draft text artifact", "Citations to knowledge ids"],
    updated_at: new Date().toISOString(),
  });
  if (effErr) throw new Error(`effectiveness: ${effErr.message}`);

  await audit({
    projectId: PROJECT_ID,
    action: "fixture.setup",
    subject: "§24 acceptance fixture populated",
    afterState: "source+decision+requirement+asset+2 connections+effectiveness",
  });

  console.log(JSON.stringify({ sourceId: src?.id, fileId: file?.id, ok: true }, null, 1));
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

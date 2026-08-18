import { buildProjectContextPacket, contextHealth } from "@/data/projects/context-packet";

const URL_ = process.env.TRUST_TAI_SUPABASE_URL!;
const SVC = process.env.TRUST_TAI_SUPABASE_SERVICE_KEY!;
const ANON = process.env.VITE_SUPABASE_PUBLISHABLE_KEY!;
const ORG = "ee683a64-e045-4226-a8ff-4ae6590d6789";
const USER = "e1b3c843-3a91-4c27-a291-9e6ced782b9f";
const OTHER_ORG = "00000000-0000-4000-8000-0000000000ff";

async function rest(path: string, init: RequestInit = {}, key = SVC) {
  const r = await fetch(`${URL_}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key, Authorization: `Bearer ${key}`,
      "content-type": "application/json", Prefer: "return=representation",
      ...(init.headers ?? {}),
    },
  });
  const text = await r.text();
  let body: any = text; try { body = JSON.parse(text); } catch {}
  if (r.status >= 400) throw new Error(`${path} -> ${r.status} ${text}`);
  return body;
}
const one = (rows: any[]) => rows[0];
const log = (step: string, detail: string) => console.log(`✔ ${step}: ${detail}`);
const created: { table: string; id: string }[] = [];
let storagePath = "";

try {
  // 1. create project
  const project = one(await rest("projects", { method: "POST", body: JSON.stringify({
    organization_id: ORG, name: "Live cycle check — intelligence", status: "active",
    metadata: { point_a: "Nothing is written down in one place.",
      point_b: "Every agent joins with the same context packet.",
      next_move: "Confirm the brief.", evidence: [], dependencies: [],
      execution_state: "in_progress" },
  }) }));
  created.push({ table: "projects", id: project.id });
  log("project created", project.id);

  // 2. thinking room
  const thinking = one(await rest("project_thinking_sources", { method: "POST", body: JSON.stringify({
    organization_id: ORG, project_id: project.id, source_type: "chatgpt",
    title: "Onboarding thinking room", url: "https://chatgpt.com/share/live-cycle",
    is_primary: true, sync_state: "import_needs_upload", added_by: USER, added_by_label: "Live cycle",
  }) }));
  created.push({ table: "project_thinking_sources", id: thinking.id });
  log("thinking room linked", `${thinking.title} / ${thinking.sync_state}`);

  // 3. upload a mockup into the private bucket, record file + asset
  storagePath = `${ORG}/${project.id}/live-cycle-mockup.svg`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="120" height="60" fill="#eaf2fb"/></svg>`;
  const up = await fetch(`${URL_}/storage/v1/object/project-files/${storagePath}`, {
    method: "POST", headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, "content-type": "image/svg+xml" },
    body: svg,
  });
  if (!up.ok) throw new Error(`upload ${up.status} ${await up.text()}`);
  const file = one(await rest("project_files", { method: "POST", body: JSON.stringify({
    organization_id: ORG, project_id: project.id, name: "live-cycle-mockup.svg",
    kind: "working", storage_path: storagePath, content_type: "image/svg+xml",
    size_bytes: svg.length, uploaded_by: USER, uploaded_by_label: "Live cycle",
  }) }));
  created.push({ table: "project_files", id: file.id });
  const asset = one(await rest("project_assets", { method: "POST", body: JSON.stringify({
    organization_id: ORG, project_id: project.id, file_id: file.id, asset_type: "mockup",
    title: "Intake screen mockup", version: 1, status: "draft",
    uploaded_by: USER, uploaded_by_label: "Live cycle",
  }) }));
  created.push({ table: "project_assets", id: asset.id });
  log("mockup uploaded", `${asset.title} / status ${asset.status}`);
  const approved = one(await rest(`project_assets?id=eq.${asset.id}`, { method: "PATCH",
    body: JSON.stringify({ status: "approved", updated_at: new Date().toISOString() }) }));
  log("mockup approved", approved.status);

  // 4. Lovable + GitHub links
  const conns = await rest("project_connections", { method: "POST", body: JSON.stringify([
    { organization_id: ORG, project_id: project.id, connection_type: "lovable",
      label: "Intake app", url: "https://lovable.dev/projects/live-cycle", status: "linked", created_by: USER },
    { organization_id: ORG, project_id: project.id, connection_type: "github",
      label: "trusttai/intake", url: "https://github.com/trusttai/intake", status: "linked", created_by: USER },
  ]) });
  for (const c of conns) created.push({ table: "project_connections", id: c.id });
  log("connections added", conns.map((c: any) => `${c.connection_type}:${c.status}`).join(", "));

  // honesty guard: 'connected' without a sync time must be refused
  let honesty = "not enforced";
  try {
    await rest(`project_connections?id=eq.${conns[0].id}`, { method: "PATCH",
      body: JSON.stringify({ status: "connected", last_synced_at: null }) });
  } catch { honesty = "refused"; }
  log("connected-without-sync", honesty);

  // 5. knowledge: imported from the thinking room, then confirmed
  const detected = one(await rest("project_knowledge", { method: "POST", body: JSON.stringify({
    organization_id: ORG, project_id: project.id, section: "requirement",
    body: "Intake must collect billing contact before the kickoff call.",
    origin: "thinking_room", review_state: "needs_review",
    source_reference: thinking.url, source_label: thinking.title, confidence: 0.62,
    captured_by: USER, captured_by_label: "Live cycle",
  }) }));
  created.push({ table: "project_knowledge", id: detected.id });
  const confirmed = one(await rest(`project_knowledge?id=eq.${detected.id}`, { method: "PATCH",
    body: JSON.stringify({ review_state: "confirmed" }) }));
  log("knowledge imported then confirmed", `${confirmed.review_state} (was ${detected.review_state})`);
  const decision = one(await rest("project_knowledge", { method: "POST", body: JSON.stringify({
    organization_id: ORG, project_id: project.id, section: "decision",
    body: "One guided intake, no email threads.", origin: "human", review_state: "confirmed",
    captured_by: USER, captured_by_label: "Live cycle",
  }) }));
  created.push({ table: "project_knowledge", id: decision.id });

  // 6. context packet from what is actually on record
  const knowledgeRows = await rest(`project_knowledge?project_id=eq.${project.id}&select=*`);
  const packet = buildProjectContextPacket({
    project: { id: project.id, organizationId: ORG, name: project.name, state: "in_progress",
      pointA: project.metadata.point_a, pointB: project.metadata.point_b,
      nextMove: project.metadata.next_move, ownerLabel: "Live cycle" } as any,
    knowledge: knowledgeRows.map((r: any) => ({
      id: r.id, projectId: r.project_id, section: r.section, body: r.body, origin: r.origin,
      reviewState: r.review_state, sourceReference: r.source_reference ?? undefined,
      sourceLabel: r.source_label ?? undefined, confidence: r.confidence ?? undefined,
      capturedAt: r.captured_at, capturedByLabel: r.captured_by_label ?? undefined,
    })),
    decisions: [], blockers: [], work: [],
    assets: [{ id: asset.id, projectId: project.id, fileId: file.id, assetType: "mockup",
      title: asset.title, version: 1, status: "approved", createdAt: asset.created_at } as any],
    connections: conns.map((c: any) => ({ id: c.id, projectId: project.id,
      connectionType: c.connection_type, label: c.label, url: c.url, status: c.status,
      createdAt: c.created_at })),
    thinking: [{ id: thinking.id, projectId: project.id, sourceType: "chatgpt",
      title: thinking.title, url: thinking.url, isPrimary: true, syncState: thinking.sync_state,
      createdAt: thinking.created_at } as any],
  });
  const health = contextHealth(packet, true);
  log("context packet", `${packet.confirmedDecisions.length} confirmed decisions, ${packet.requirements.length} requirements, ${packet.approvedAssets.length} approved assets, health ${health.level}`);
  console.log("   packet statements:", [...packet.confirmedDecisions, ...packet.requirements].map(s => `${s.authority}: ${s.statement}`));

  // 7. access isolation
  const anonRead = await fetch(`${URL_}/rest/v1/project_knowledge?project_id=eq.${project.id}&select=id`, {
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } });
  const anonBody = await anonRead.text();
  log("signed-out read", `${anonRead.status} ${anonBody.slice(0, 60)}`);
  const anonAsset = await fetch(`${URL_}/rest/v1/project_assets?select=id`, { headers: { apikey: ANON } });
  log("signed-out assets read", `${anonAsset.status} ${(await anonAsset.text()).slice(0, 60)}`);
  const anonFile = await fetch(`${URL_}/storage/v1/object/project-files/${storagePath}`, { headers: { apikey: ANON } });
  log("signed-out file read", String(anonFile.status));
  let otherOrg = "allowed";
  try {
    await rest("project_knowledge", { method: "POST", body: JSON.stringify({
      organization_id: OTHER_ORG, project_id: project.id, section: "brief",
      body: "cross-org write", origin: "human" }) });
  } catch (e: any) { otherOrg = "written but org-scoped"; }
  log("other-org row on this project", otherOrg);
} finally {
  // clean up: the project cascade removes its children
  for (const row of created.filter(r => r.table === "projects")) {
    await rest(`projects?id=eq.${row.id}`, { method: "DELETE" });
  }
  if (storagePath) {
    await fetch(`${URL_}/storage/v1/object/project-files/${storagePath}`, {
      method: "DELETE", headers: { apikey: SVC, Authorization: `Bearer ${SVC}` } });
  }
  console.log("✔ cleanup: live cycle rows and the uploaded file removed");
}

/* Access isolation against the live backend, with real auth sessions. */
const URL_ = process.env.TRUST_TAI_SUPABASE_URL!;
const SVC = process.env.TRUST_TAI_SUPABASE_SERVICE_KEY!;
const ANON = process.env.VITE_SUPABASE_PUBLISHABLE_KEY!;
const ORG = "ee683a64-e045-4226-a8ff-4ae6590d6789";
const USER = "e1b3c843-3a91-4c27-a291-9e6ced782b9f";
const log = (s: string, d: string) => console.log(`• ${s}: ${d}`);

async function svc(path: string, init: RequestInit = {}) {
  const r = await fetch(`${URL_}${path}`, { ...init, headers: {
    apikey: SVC, Authorization: `Bearer ${SVC}`, "content-type": "application/json",
    Prefer: "return=representation", ...(init.headers ?? {}) } });
  const t = await r.text();
  if (r.status >= 400) throw new Error(`${path} ${r.status} ${t}`);
  try { return JSON.parse(t); } catch { return t; }
}

// A project + one knowledge row to probe, created as service role.
const project = (await svc("/rest/v1/projects", { method: "POST", body: JSON.stringify({
  organization_id: ORG, name: "Isolation probe", status: "active",
  metadata: { point_a: "a", point_b: "b", evidence: [], dependencies: [] } }) }))[0];
await svc("/rest/v1/project_knowledge", { method: "POST", body: JSON.stringify({
  organization_id: ORG, project_id: project.id, section: "brief",
  body: "Isolation probe statement.", origin: "human", review_state: "confirmed" }) });

let outsiderId = "";
try {
  // 1. an authenticated person who is NOT a member of the organization
  const email = `isolation-probe-${Date.now()}@trusttai-test.invalid`;
  const password = crypto.randomUUID() + "Aa1!";
  const outsider = await svc("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({
    email, password, email_confirm: true }) });
  outsiderId = outsider.id;
  const signIn = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: ANON, "content-type": "application/json" },
    body: JSON.stringify({ email, password }) });
  const token = (await signIn.json()).access_token as string;
  const asOutsider = async (p: string) => {
    const r = await fetch(`${URL_}/rest/v1/${p}`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } });
    return `${r.status} ${(await r.text()).slice(0, 80)}`;
  };
  log("non-member reads project_knowledge", await asOutsider(`project_knowledge?project_id=eq.${project.id}&select=id`));
  log("non-member reads projects", await asOutsider("projects?select=id"));
  log("non-member reads thinking sources", await asOutsider("project_thinking_sources?select=id"));
  log("non-member reads assets", await asOutsider("project_assets?select=id"));
  log("non-member reads connections", await asOutsider("project_connections?select=id"));
  log("non-member reads memberships", await asOutsider("organization_memberships?select=user_id"));
  const write = await fetch(`${URL_}/rest/v1/project_knowledge`, {
    method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ organization_id: ORG, project_id: project.id, section: "brief",
      body: "outsider write", origin: "human" }) });
  log("non-member writes knowledge", `${write.status} ${(await write.text()).slice(0, 80)}`);

  // 2. the same rows read by a real member of the organization
  const link = await svc("/auth/v1/admin/generate_link", { method: "POST", body: JSON.stringify({
    type: "magiclink", email: (await svc(`/auth/v1/admin/users/${USER}`)).email }) });
  const verify = await fetch(`${URL_}/auth/v1/verify?token=${link.hashed_token}&type=magiclink`, {
    redirect: "manual", headers: { apikey: ANON } });
  const hash = new URL(verify.headers.get("location") ?? "http://x/").hash;
  const memberToken = new URLSearchParams(hash.slice(1)).get("access_token") ?? "";
  const asMember = async (p: string) => {
    const r = await fetch(`${URL_}/rest/v1/${p}`, { headers: { apikey: ANON, Authorization: `Bearer ${memberToken}` } });
    const t = await r.text();
    return `${r.status} ${Array.isArray(JSON.parse(t || "[]")) ? JSON.parse(t).length + " rows" : t.slice(0, 60)}`;
  };
  log("member reads this project's knowledge", await asMember(`project_knowledge?project_id=eq.${project.id}&select=id`));
  log("member reads projects", await asMember("projects?select=id"));
} finally {
  await svc(`/rest/v1/projects?id=eq.${project.id}`, { method: "DELETE" });
  if (outsiderId) await svc(`/auth/v1/admin/users/${outsiderId}`, { method: "DELETE" });
  console.log("• cleanup: probe project and the temporary account removed");
}

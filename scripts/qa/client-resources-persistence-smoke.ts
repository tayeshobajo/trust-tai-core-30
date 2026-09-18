/**
 * Files & Links, durable persistence smoke test (no external fetch, no spend).
 *
 * Exercises the real store against the real table with synthetic links on a
 * real client, then removes every row it created. It proves storage, not a
 * signed-in screen: the route's membership and role checks are above this
 * layer and are not exercised here.
 */

import { createClient } from "@supabase/supabase-js";

import { clientResourcesStore } from "@/lib/client-resources-store.server";

const TAG = "QA probe, client links (safe to delete)";

const sb = createClient(
  process.env["TRUST_TAI_SUPABASE_URL"]!,
  process.env["TRUST_TAI_SUPABASE_SERVICE_KEY"]!,
  { auth: { persistSession: false } },
);

function say(label: string, detail: unknown) {
  console.log(`${label}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
}

const created: string[] = [];

async function main() {
  const { data: clients } = await sb
    .from("clients")
    .select("id, organization_id, name")
    .limit(1);
  const client = clients?.[0];
  if (!client) throw new Error("No client to probe against.");

  const { data: projects } = await sb
    .from("projects")
    .select("id, name")
    .eq("organization_id", client["organization_id"])
    .eq("client_id", client["id"])
    .limit(2);

  const { data: members } = await sb
    .from("organization_memberships")
    .select("user_id")
    .eq("organization_id", client["organization_id"])
    .eq("status", "active")
    .limit(1);
  const userId = members?.[0]?.["user_id"];
  if (!userId) throw new Error("No active member to stamp as author.");

  const scope = {
    organizationId: client["organization_id"] as string,
    clientId: client["id"] as string,
    userId: userId as string,
  };
  say("client", `${client["name"]} (${(projects ?? []).length} project(s))`);

  const wide = await clientResourcesStore.add(scope, {
    category: "knowledge_base",
    title: `${TAG} knowledge base`,
    url: "https://example.com/qa/Knowledge-Base",
    projectId: null,
  });
  created.push(wide.id);
  say("client-wide saved", { scope: wide.projectId, id: wide.id });

  for (const project of projects ?? []) {
    const row = await clientResourcesStore.add(scope, {
      category: "lovable_project",
      title: `${TAG} build on ${project["name"]}`,
      url: `https://example.com/qa/build/${project["id"]}`,
      projectId: project["id"] as string,
    });
    created.push(row.id);
    say("project link saved", { project: project["name"], id: row.id });
  }

  // Case matters after the host: /DocA and /doca are two addresses.
  const upper = await clientResourcesStore.add(scope, {
    category: "google_doc",
    title: `${TAG} DocA`,
    url: "https://example.com/qa/DocA",
    projectId: null,
  });
  created.push(upper.id);
  const lower = await clientResourcesStore.add(scope, {
    category: "google_doc",
    title: `${TAG} doca`,
    url: "https://example.com/qa/doca",
    projectId: null,
  });
  created.push(lower.id);
  say("case distinct addresses both saved", [upper.url, lower.url]);

  try {
    await clientResourcesStore.add(scope, {
      category: "knowledge_base",
      title: `${TAG} duplicate`,
      url: "https://example.com/qa/Knowledge-Base",
      projectId: null,
    });
    say("DUPLICATE NOT REFUSED", "unexpected");
  } catch (error) {
    say("duplicate refused", (error as Error).message);
  }

  const edited = await clientResourcesStore.edit(scope, wide.id, {
    category: "knowledge_base",
    title: `${TAG} knowledge base, renamed`,
    url: "https://example.com/qa/Knowledge-Base",
    description: "Edited by the probe.",
    projectId: null,
  });
  say("edit kept scope and changed title", { title: edited.title, scope: edited.projectId });

  const reread = await clientResourcesStore.list(scope);
  say("read back", `${reread.filter((row) => row.title.startsWith(TAG)).length} probe rows`);

  try {
    await clientResourcesStore.remove(
      { organizationId: scope.organizationId, clientId: "00000000-0000-0000-0000-000000000000" },
      wide.id,
    );
    say("WRONG CLIENT REMOVAL ALLOWED", "unexpected");
  } catch (error) {
    say("wrong-client removal refused", (error as Error).message);
  }

  const otherProject = (projects ?? [])[0];
  if (otherProject) {
    const { data: foreign } = await sb
      .from("projects")
      .select("id")
      .neq("client_id", scope.clientId)
      .limit(1);
    if (foreign?.[0]) {
      try {
        await clientResourcesStore.add(scope, {
          category: "other",
          title: `${TAG} foreign project`,
          url: "https://example.com/qa/foreign",
          projectId: foreign[0]["id"] as string,
        });
        say("FOREIGN PROJECT ACCEPTED", "unexpected");
      } catch (error) {
        say("another client's project refused", (error as Error).message);
      }
    }
  }
}

try {
  await main();
} finally {
  for (const id of created) {
    await sb.from("client_resources").delete().eq("id", id);
  }
  const { data: left } = await sb.from("client_resources").select("id").ilike("title", `${TAG}%`);
  say("cleanup", `${created.length} removed, ${(left ?? []).length} probe rows left`);
}

/**
 * Conductor V3.4 live progression read. DEVELOPMENT/QA ONLY. Read-only.
 *
 * Signs in as the headless test account, loads real canon under RLS, and
 * reports milestone attention plus any decision-driven progression. It writes
 * nothing and resolves nothing.
 */

import { supabase } from "../src/integrations/trust-tai/supabase";
import { loadSuiteSnapshot } from "../src/data/intelligence/service";
import { readRoadmapCanon } from "../src/data/intelligence/conductor/roadmap-cycle";

const email = process.env["TEST_USER"];
const password = process.env["TEST_PASS"];
if (!email || !password) throw new Error("TEST_USER / TEST_PASS required.");

const signIn = await supabase.auth.signInWithPassword({ email, password });
if (signIn.error) throw new Error(`sign-in failed: ${signIn.error.message}`);

const memberships = await supabase
  .from("organization_memberships")
  .select("organization_id, role, status")
  .eq("status", "active");
if (memberships.error || !memberships.data?.length) throw new Error("no active membership");
const organizationId = String((memberships.data[0] as Record<string, unknown>)["organization_id"]);

const snapshot = await loadSuiteSnapshot(organizationId);
console.log("organization:", organizationId);
console.log("roadmaps:", snapshot.roadmaps.length);
console.log("open decisions:", snapshot.openDecisions.length);
console.log("resolved decisions:", snapshot.resolvedDecisions.length);
console.log("stages read:", snapshot.roadmapStages ? "yes" : "NO");

for (const roadmap of snapshot.roadmaps) {
  const canon = readRoadmapCanon({
    roadmap,
    decisions: [...snapshot.openDecisions, ...snapshot.resolvedDecisions],
    ...(snapshot.roadmapStages ? { stages: snapshot.roadmapStages[roadmap.id] ?? [] } : {}),
  });
  console.log("\n---", canon.subjectLabel, canon.roadmapId);
  console.log("  milestonesKnown:", canon.milestonesKnown, "count:", canon.milestones.length);
  console.log("  open:", canon.openDecisions.length);
  console.log(
    "  attention:",
    canon.milestoneAttention
      ? `${canon.milestoneAttention.milestone.title} [${canon.milestoneAttention.rule}]`
      : "none",
  );
  console.log("  progression:", canon.milestoneProgression?.statement ?? "none");
}

await supabase.auth.signOut();

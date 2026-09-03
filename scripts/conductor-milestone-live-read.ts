/**
 * Conductor V3.3 live milestone read. DEVELOPMENT/QA ONLY. Read-only.
 *
 * Signs in as the headless test account, loads the real suite snapshot under
 * RLS, and reports milestone visibility and the milestone-attention result for
 * every real roadmap. It writes nothing.
 *
 * Run: TEST_USER=... TEST_PASS=... bun scripts/conductor-milestone-live-read.ts
 */

import { supabase } from "../src/integrations/trust-tai/supabase";
import { loadSuiteSnapshot } from "../src/data/intelligence/service";
import { answerQuestion } from "../src/data/intelligence/conductor";
import { readRoadmapCanon } from "../src/data/intelligence/conductor/roadmap-cycle";

const email = process.env["TEST_USER"];
const password = process.env["TEST_PASS"];
if (!email || !password) throw new Error("TEST_USER / TEST_PASS required.");

const signIn = await supabase.auth.signInWithPassword({ email, password });
if (signIn.error || !signIn.data.user) throw new Error(`sign-in failed: ${signIn.error?.message}`);
console.log("signed in:", signIn.data.user.email);

const memberships = await supabase
.from("organization_memberships")
.select("organization_id, role, status")
.eq("status", "active");
if (memberships.error || !memberships.data?.length) {
  throw new Error(`no active membership: ${memberships.error?.message ?? "none"}`);
}
const organizationId = String(
  (memberships.data[0] as Record<string, unknown>)["organization_id"],
);
console.log("organization:", organizationId, memberships.data[0]);

const snapshot = await loadSuiteSnapshot(organizationId);
console.log("roadmaps:", snapshot.roadmaps.length);
console.log(
  "stages read:",
  snapshot.roadmapStages ? "yes": "NO, withheld",
  snapshot.roadmapStages ? Object.keys(snapshot.roadmapStages).length + " roadmap groups": "",
);

for (const roadmap of snapshot.roadmaps) {
  const canon = readRoadmapCanon({
    roadmap,
    decisions: snapshot.openDecisions,
...(snapshot.roadmapStages ? { stages: snapshot.roadmapStages[roadmap.id] ?? [] }: {}),
  });
  console.log("\n---", canon.subjectLabel, canon.roadmapId);
  console.log("  status:", canon.status, "| Point B:", canon.pointB?.tier ?? "not stated");
  console.log("  milestonesKnown:", canon.milestonesKnown, "| count:", canon.milestones.length);
  console.log("  open decisions:", canon.openDecisions.length);
  console.log(
    "  attention:",
    canon.milestoneAttention
      ? `${canon.milestoneAttention.milestone.title} [${canon.milestoneAttention.rule}], ${canon.milestoneAttention.because}`
: "none",
  );
}

const answer = answerQuestion({
  snapshot,
  question: "Which milestone on our active roadmap deserves my attention next?",
});
console.log("\nanswer topic:", answer.topic);
console.log("answer:", answer.answer);
console.log("proposals:", answer.proposedActions?.length ?? 0);
console.log("milestonesKnown:", answer.roadmapCanon?.milestonesKnown);

await supabase.auth.signOut();

/**
 * Conductor V3.2 live roadmap operating cycle — DEVELOPMENT/QA ONLY.
 *
 * Signs in as the dedicated headless test account, reads the real Roadmap
 * canon under RLS, asks the real reasoning path a roadmap-attention question,
 * and reports what the governed system actually did. It creates nothing on its
 * own: any write is the product's own code path, driven exactly as the console
 * drives it.
 *
 * Run: TEST_USER=... TEST_PASS=... bun scripts/conductor-roadmap-live-cycle.ts
 */

import { supabase } from "../src/integrations/trust-tai/supabase";
import { loadSuiteSnapshot } from "../src/data/intelligence/service";
import { getCurrentIcp } from "../src/data/supabase/icp";
import { answerQuestion } from "../src/data/intelligence/conductor";
import { readRoadmapCanon, describeRoadmapCanon } from "../src/data/intelligence/conductor/roadmap-cycle";
import { roadmapService } from "../src/data/supabase/roadmap-service";
import {
  loadBusinessFigures,
  loadBusinessIntents,
  loadCorrections,
} from "../src/data/supabase/conductor-service";
import {
  loadControlledActions,
  loadReceipts,
} from "../src/data/supabase/conductor-control-service";
import {
  loadLearning,
  loadObservations,
} from "../src/data/supabase/conductor-learning-service";
import { accessContext, can } from "../src/domain/access";

function log(label: string, value?: unknown) {
  if (value === undefined) console.log(`\n=== ${label}`);
  else console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value, null, 2)}`);
}

const email = process.env["TEST_USER"];
const password = process.env["TEST_PASS"];
if (!email || !password) throw new Error("TEST_USER / TEST_PASS required.");

log("STEP 1 — headless sign-in");
const signIn = await supabase.auth.signInWithPassword({ email, password });
if (signIn.error || !signIn.data.user) throw new Error(`sign-in failed: ${signIn.error?.message}`);
log("user", signIn.data.user.email ?? signIn.data.user.id);

log("STEP 2 — membership + capabilities");
const memberships = await supabase
  .from("organization_memberships")
  .select("organization_id, role, status")
  .eq("status", "active");
if (memberships.error || !memberships.data?.length) {
  throw new Error(`no active membership under RLS: ${memberships.error?.message ?? "none"}`);
}
log("active memberships", memberships.data);
const preferred = process.env["TT_ORG_ID"];
const membership = {
  data:
    (preferred
      ? memberships.data.find((row) => String((row as Record<string, unknown>)["organization_id"]) === preferred)
      : undefined) ?? memberships.data[0],
};
const organizationId = String((membership.data as Record<string, unknown>)["organization_id"]);
const role = String((membership.data as Record<string, unknown>)["role"]);
log("organization", `${organizationId} (${role})`);
const access = accessContext({ userId: signIn.data.user.id, organizationId, role: role as never });
log("roadmap.write", can(access, "roadmap.write" as never));
log("conductor.approve", can(access, "conductor.approve" as never));

log("STEP 3 — real roadmap canon");
const roadmaps = await roadmapService.list(organizationId);
log("roadmaps", roadmaps.map((r) => ({ id: r.id, title: r.title, subject: r.subjectLabel, status: r.status })));
const target =
  roadmaps.find((r) => `${r.title} ${r.subjectLabel}`.toLowerCase().includes("teamsynerg")) ??
  roadmaps[0];
if (!target) throw new Error("no roadmap present in the live organization");
const detail = await roadmapService.detail(target.id, organizationId);
if (!detail) throw new Error("roadmap detail unreadable under RLS");
const canon = readRoadmapCanon({
  roadmap: detail.roadmap,
  decisions: detail.decisions,
  stages: detail.stages,
});
log("roadmap", {
  id: detail.roadmap.id,
  status: detail.roadmap.status,
  subjectLabel: detail.roadmap.subjectLabel,
  objective: detail.roadmap.objective,
  pointA: detail.roadmap.pointA.map((n) => ({ label: n.label, tier: n.tier, evidence: n.evidence.length })),
  pointB: detail.roadmap.pointB,
  nextMove: detail.roadmap.nextMove,
});
log("openDecisions", detail.decisions.filter((d) => d.status === "open").map((d) => ({
  id: d.id,
  question: d.question,
  status: d.status,
  createdAt: d.createdAt,
})));
log("canon narrative", describeRoadmapCanon(canon));

log("STEP 4/5/6/7 — real reasoning path");
const [snapshot, icp, intents, figures, corrections, actionsBefore, receiptsBefore, learningBefore, observationsBefore] =
  await Promise.all([
    loadSuiteSnapshot(organizationId),
    getCurrentIcp(organizationId).catch(() => null),
    loadBusinessIntents(organizationId),
    loadBusinessFigures(organizationId),
    loadCorrections(organizationId),
    loadControlledActions(organizationId),
    loadReceipts(organizationId),
    loadLearning(organizationId),
    loadObservations(organizationId),
  ]);
log("counts before", {
  actions: actionsBefore.length,
  receipts: receiptsBefore.length,
  learning: learningBefore.length,
  observations: observationsBefore.length,
  roadmapsInSnapshot: snapshot.roadmaps?.length ?? 0,
  openDecisionsInSnapshot: snapshot.openDecisions?.length ?? 0,
});

const question = "What decision in our active roadmap deserves my attention next?";
const answer = answerQuestion({
  snapshot,
  question,
  icp: icp
    ? {
        profileId: icp.id,
        version: icp.version,
        title: icp.title,
        contentMarkdown: icp.contentMarkdown,
        updatedAt: icp.updatedAt,
      }
    : null,
  intents,
  figures,
  corrections,
  priorLearning: learningBefore,
});
log("topic", answer.topic);
log("answer", answer.answer);
log("nextMove", answer.nextMove ?? null);
log("proposedActions", answer.proposedActions.map((a) => ({ id: a.id, app: a.owningApp, op: a.operation, title: a.title, consequential: a.consequential })));
log("evidence", answer.evidence.map((e) => e.label));
log("roadmapCanon", answer.roadmapCanon ?? null);
log("actionGraph ops", (answer.actionGraph?.actions ?? []).map((a) => ({ app: a.owningApp, op: a.operation, requiresApproval: a.requiresApproval })));
log("inputResolutions", (answer as Record<string, unknown>)["inputResolutions"] ?? null);

log("STEP 11 — related follow-up");
const followUp = answerQuestion({
  snapshot,
  question: "What is blocking progress on that roadmap decision?",
  icp: null,
  intents,
  figures,
  corrections,
  priorLearning: learningBefore,
});
log("follow-up topic", followUp.topic);
log("follow-up answer", followUp.answer);
log("follow-up proposedActions", followUp.proposedActions.map((a) => ({ app: a.owningApp, op: a.operation, title: a.title })));
log("follow-up actionGraph ops", (followUp.actionGraph?.actions ?? []).map((a) => ({ app: a.owningApp, op: a.operation })));

log("STEP 12 — cross-org closure");
const foreign = await supabase
  .from("roadmaps")
  .select("id, organization_id")
  .neq("organization_id", organizationId)
  .limit(5);
log("foreign roadmaps visible", { count: foreign.data?.length ?? 0, error: foreign.error?.message ?? null });

log("POST-STATE");
const [actionsAfter, receiptsAfter, learningAfter, observationsAfter] = await Promise.all([
  loadControlledActions(organizationId),
  loadReceipts(organizationId),
  loadLearning(organizationId),
  loadObservations(organizationId),
]);
log("counts after", {
  actions: actionsAfter.length,
  receipts: receiptsAfter.length,
  learning: learningAfter.length,
  observations: observationsAfter.length,
});
const detailAfter = await roadmapService.detail(target.id, organizationId);
log("open decisions after", detailAfter?.decisions.filter((d) => d.status === "open").length ?? 0);

await supabase.auth.signOut();

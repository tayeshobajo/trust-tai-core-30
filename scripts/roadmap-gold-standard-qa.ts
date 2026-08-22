/**
 * Roadmap Gold Standard acceptance harness — DEVELOPMENT/QA ONLY.
 *
 * Not part of the app bundle and not routable. It runs the exact production
 * intelligence path (same prompts, same normalisation, same ranking, same
 * evidence packet, same validator, same Ask grounding) against a real company,
 * with the authorization gate cleared separately.
 *
 * It never writes to the database and it never invents evidence. Where a step
 * genuinely needs a signed-in Trust Tai person (approvals, persistence), the
 * harness marks that step as a human decision and says so in the output.
 *
 * Run: bun scripts/roadmap-gold-standard-qa.ts "TeamSynerg" https://example.com
 */

import { rankMilestones } from "../src/data/roadmap-milestones";
import {
  normalizeMilestones,
  normalizeStrategy,
  type NormalizedStrategy,
} from "../src/data/roadmap-research-parse";
import { buildEvidencePacket, packetSummary } from "../src/data/roadmap-studio-packet";
import type {
  RoadmapMilestone,
  RoadmapResearch,
  RoadmapStrategy,
  StrategyItem,
} from "../src/domain/roadmap-intel";
import {
  answerRoadmapQuestion,
  researchSubject,
  type RoadmapResearchResult,
} from "../src/lib/roadmap-intelligence.server";
import { callRoadmapProvider } from "../src/lib/roadmap-research.server";
import type { RuntimeModelCaller } from "../src/lib/intelligence-runtime.server";

const offlineCaller: RuntimeModelCaller = (call) =>
  callRoadmapProvider(call.instructions, call.input, {
    webSearch: call.webSearch ?? false,
    ...(call.responseFormat ? { responseFormat: call.responseFormat } : {}),
  });
import { composeStudioDocument } from "../src/lib/roadmap-studio.server";

const subjectLabel = process.argv[2] ?? "TeamSynerg";
const website = process.argv[3];
const objective =
  "Understand this business well enough to propose what Trust Tai should build first, with evidence.";

const now = new Date().toISOString();
function log(label: string, value?: unknown) {
  if (value === undefined) console.log(`\n=== ${label}`);
  else console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
}

/* --------------------------------------------------------------- research */

log("RESEARCH");
let result: RoadmapResearchResult | null = null;
for await (const stage of researchSubject({
  subjectLabel,
  objective,
  ...(website ? { website } : {}),
  known: [],
}, offlineCaller)) {
  console.log(`  [${stage.stage}] ${stage.message}`);
  if (stage.stage === "error") process.exit(1);
  if (stage.stage === "complete") result = stage.data as RoadmapResearchResult;
}
if (!result) process.exit(1);

const research = result.research;
log("provider", `${result.provider} / ${result.model}`);
log("sources", research.sources.length);
log("unknowns", research.unknowns.length);
for (const claim of [...research.companyModel, ...research.buyers, ...research.strengths]) {
  console.log(`  (${claim.tier}/${claim.confidence}) ${claim.statement}`);
}
log("competitors", research.competitors.map((c) => c.name));
log("market direction", research.marketDirection.map((c) => c.statement));

/* --------------------------------------------------------------- strategy */

const normalized: NormalizedStrategy = normalizeStrategy(result.strategy, {
  provider: result.provider,
  model: result.model,
  checkedAt: result.checkedAt,
});

log("STRATEGY (proposed, inferred)");
log("central truth", normalized.centralTruth?.statement ?? "none");
log("point A", normalized.pointA.map((i) => i.statement));
log("anchor proof", normalized.anchorProof.map((i) => i.statement));
log("horizon", normalized.horizon.map((b) => `${b.years}y (${b.tier}): ${b.statement}`));
log("point B", normalized.pointB?.statement ?? "none");
log("point C", normalized.pointC?.statement ?? "none");
log("gaps", normalized.gaps.map((i) => i.statement));
log("leverage point", normalized.leveragePoint?.statement ?? "none");

/* ------------------------------------------------------------- milestones */

const candidates = normalizeMilestones(result.milestones, {
  provider: result.provider,
  model: result.model,
  checkedAt: result.checkedAt,
});
const ranked = rankMilestones(candidates);

log("MILESTONES");
log("candidates considered", ranked.length);
for (const m of ranked) {
  console.log(`  #${m.recommendedSequence} [${m.priorityScore}] ${m.name} (${m.confidence}, ${m.evidence.length} sources)`);
}

/* ---------------------------------------- human decision, simulated in QA */

/**
 * Approval is a human act. The harness cannot sign anything, so it records an
 * explicit acceptance decision here and labels it. Nothing in the product
 * promotes Inferred to Decided on its own.
 */
function approve(item: StrategyItem | null): StrategyItem | null {
  if (!item) return null;
  return { ...item, tier: "decided", approval: "approved", approvedAt: now };
}
const decidedStrategy: RoadmapStrategy = {
  id: "qa-strategy",
  organizationId: "qa",
  roadmapId: "qa",
  pointA: normalized.pointA.map((i) => approve(i)!),
  anchorProof: normalized.anchorProof.map((i) => approve(i)!),
  horizon: normalized.horizon,
  pointB: approve(normalized.pointB),
  pointC: approve(normalized.pointC),
  centralTruth: approve(normalized.centralTruth),
  // Deliberately approve only the first gap: the rest stay proposed, so the
  // packet can be checked for rejected/deferred leakage.
  gaps: normalized.gaps.map((i, index) => (index === 0 ? approve(i)! : i)),
  leveragePoint: approve(normalized.leveragePoint),
  provider: result.provider,
  model: result.model,
  generatedAt: now,
  createdAt: now,
  updatedAt: now,
};

const SELECTED = 3;
const milestones: RoadmapMilestone[] = ranked.map((m, index) => ({
  id: `qa-m${index + 1}`,
  organizationId: "qa",
  roadmapId: "qa",
  name: m.name,
  whatWeBuild: m.whatWeBuild,
  intendedUser: m.intendedUser,
  supportingMarketDirection: m.supportingMarketDirection,
  clientAdvantage: m.clientAdvantage,
  currentGap: m.currentGap,
  evidence: m.evidence,
  immediateValue: m.immediateValue,
  longTermValue: m.longTermValue,
  dependencies: m.dependencies,
  executionBoundary: m.executionBoundary,
  confidence: m.confidence,
  priorityScore: m.priorityScore,
  priorityRationale: m.priorityRationale,
  recommendedSequence: m.recommendedSequence,
  status: index < SELECTED ? "approved" : "candidate",
  tier: index < SELECTED ? "decided" : "inferred",
  ownerLabel: index < SELECTED ? "Tai" : undefined,
  createdAt: now,
  updatedAt: now,
}));
log("selected by a person", milestones.filter((m) => m.status === "approved").map((m) => m.name));

/* ------------------------------------------------------------------ studio */

const researchRow: RoadmapResearch = {
  id: "qa-research",
  organizationId: "qa",
  roadmapId: "qa",
  status: "complete",
  companyModel: research.companyModel,
  buyers: research.buyers,
  strengths: research.strengths,
  digitalPresence: research.digitalPresence,
  competitors: research.competitors,
  marketDirection: research.marketDirection,
  sources: research.sources,
  unknowns: research.unknowns,
  provider: result.provider,
  model: result.model,
  checkedAt: result.checkedAt,
  createdAt: now,
  updatedAt: now,
};

const packet = buildEvidencePacket({
  subjectLabel,
  kind: "full",
  strategy: decidedStrategy,
  milestones,
  research: researchRow,
});
log("STUDIO");
log("packet", packetSummary(packet));
log("support keys", packet.supportKeys);

let composed: { sections: unknown[]; rejected: unknown[] } | null = null;
for await (const stage of composeStudioDocument({
  kind: "full",
  subjectLabel,
  strategy: decidedStrategy,
  milestones,
  research: researchRow,
}, offlineCaller)) {
  console.log(`  [${stage.stage}] ${stage.message}`);
  if (stage.stage === "error") {
    console.log(JSON.stringify(stage.data, null, 2));
    process.exit(1);
  }
  if (stage.stage === "complete") {
    composed = stage.data as { sections: unknown[]; rejected: unknown[] };
  }
}
console.log(JSON.stringify(composed, null, 2));

/* --------------------------------------------------------------------- ask */

log("ASK ROADMAP (grounded, no web search)");
const storedEvidence = {
  research: researchRow,
  strategy: decidedStrategy,
  milestones,
};
for (const question of [
  `What is the central business truth for ${subjectLabel}, and what backs it?`,
  `What was ${subjectLabel}'s exact revenue last quarter?`,
]) {
  const answer = await answerRoadmapQuestion({
    question,
    subjectLabel,
    context: storedEvidence,
    research: false,
  }, offlineCaller);
  console.log(`\nQ: ${question}`);
  console.log(JSON.stringify(answer, null, 2));
}

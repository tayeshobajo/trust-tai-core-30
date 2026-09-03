/**
 * Roadmap live acceptance run. DEVELOPMENT/QA ONLY.
 *
 * Unlike scripts/roadmap-gold-standard-qa.ts, this one runs against the real
 * Trust Tai Supabase project as a signed-in person, so every read and write
 * passes through RLS exactly as it does in the product. It drives the real
 * service functions: create/find roadmap, save research, save strategy,
 * approve strategy items, replace candidates, approve milestones, compose and
 * persist the Studio artifact, hand edit it, prove human-edit protection,
 * replace it explicitly, list versions, and read the Build Order.
 *
 * It is not part of the app bundle and it is not routable.
 *
 * Run: TT_ACCESS_TOKEN=... bun scripts/roadmap-live-acceptance.ts "Teamsynerg"
 */

import { rankMilestones, buildOrder } from "../src/data/roadmap-milestones";
import { normalizeMilestones, normalizeStrategy } from "../src/data/roadmap-research-parse";
import { packetSummary, buildEvidencePacket } from "../src/data/roadmap-studio-packet";
import { roadmapIntel, type IntelContext } from "../src/data/supabase/roadmap-intel-service";
import { roadmapService } from "../src/data/supabase/roadmap-service";
import { supabase } from "../src/integrations/trust-tai/supabase";
import type { ArtifactSection, StrategyItem } from "../src/domain/roadmap-intel";
import { answerRoadmapQuestion, researchSubject } from "../src/lib/roadmap-intelligence.server";
import { composeStudioDocument } from "../src/lib/roadmap-studio.server";

const companyQuery = process.argv[2] ?? "Teamsynerg";
const objective =
  "Understand this business well enough to propose what Trust Tai should build first, with evidence.";

function log(label: string, value?: unknown) {
  if (value === undefined) console.log(`\n=== ${label}`);
  else console.log(`${label}: ${typeof value === "string" ? value: JSON.stringify(value)}`);
}

/* ------------------------------------------------------------ real session */

const accessToken = process.env["TT_ACCESS_TOKEN"];
const refreshToken = process.env["TT_REFRESH_TOKEN"] ?? "qa-no-refresh";
if (!accessToken) throw new Error("TT_ACCESS_TOKEN is required (real signed-in session).");

const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
  access_token: accessToken,
  refresh_token: refreshToken,
});
if (sessionError || !sessionData.user) throw new Error(`sign-in failed: ${sessionError?.message}`);
log("LIVE SESSION");
log("user", sessionData.user.email ?? sessionData.user.id);

const membership = await supabase
.from("organization_memberships")
.select("organization_id, role, status")
.eq("status", "active")
.maybeSingle();
if (membership.error || !membership.data) throw new Error("no active membership under RLS");
const organizationId = String(membership.data["organization_id"]);
log("organization", `${organizationId} (${membership.data["role"]})`);

const context: IntelContext = {
  organizationId,
  userId: sessionData.user.id,
  userLabel: sessionData.user.email ?? "Tai",
};

/* ------------------------------------------------------------- real subject */

const prospect = await supabase
.from("prospects")
.select("id, company_name, website_url, status, fit_score")
.ilike("company_name", `%${companyQuery}%`)
.maybeSingle();
if (prospect.error || !prospect.data) throw new Error(`no live prospect matching ${companyQuery}`);
const subjectLabel = String(prospect.data["company_name"]);
const website = prospect.data["website_url"] ? String(prospect.data["website_url"]): undefined;
log("SUBJECT (live Scout row)");
log("prospect", prospect.data);

const detail = await roadmapService.create(
  { subject: { kind: "prospect", id: String(prospect.data["id"]) }, objective },
  context,
);
const roadmapId = detail.roadmap.id;
log("roadmap", `${roadmapId}, ${detail.roadmap.title}`);

/* ---------------------------------------------------------------- research */

log("RESEARCH (live web, persisted)");
let result: Awaited<ReturnType<typeof collectResearch>> | null = null;
async function collectResearch() {
  let out: any = null;
  for await (const stage of researchSubject({
    subjectLabel,
    objective,
...(website ? { website }: {}),
    known: [],
  }, offlineCaller)) {
    console.log(`  [${stage.stage}] ${stage.message}`);
    if (stage.stage === "error") throw new Error(String(stage.message));
    if (stage.stage === "complete") out = stage.data;
  }
  return out;
}
result = await collectResearch();
if (!result) throw new Error("research produced nothing");

const savedResearch = await roadmapIntel.saveResearch(
  context,
  roadmapId,
  subjectLabel,
  result.research,
  { provider: result.provider, model: result.model, checkedAt: result.checkedAt },
);
log("research row", savedResearch.id);
log("sources", savedResearch.sources.length);
log("unknowns", savedResearch.unknowns.length);

/* ---------------------------------------------------------------- strategy */

const normalized = normalizeStrategy(result.strategy, {
  provider: result.provider,
  model: result.model,
  checkedAt: result.checkedAt,
});
let strategy = await roadmapIntel.saveStrategy(context, roadmapId, subjectLabel, {
...normalized,
  provider: result.provider,
  model: result.model,
  generatedAt: result.checkedAt,
});
log("STRATEGY (saved as Inferred)");
log("central truth", strategy.centralTruth?.statement ?? "none");
log(
  "tiers before approval",
  [strategy.centralTruth, strategy.pointB, strategy.pointC, strategy.leveragePoint]
.filter(Boolean)
.map((i) => `${(i as StrategyItem).key}=${(i as StrategyItem).tier}`),
);

// A person approves. This is the only path from Inferred to Decided.
const approvable: string[] = [
...strategy.pointA.map((i) => i.key),
...strategy.anchorProof.map((i) => i.key),
  strategy.centralTruth?.key,
  strategy.pointB?.key,
  strategy.pointC?.key,
  strategy.leveragePoint?.key,
  strategy.gaps[0]?.key,
].filter((k): k is string => Boolean(k));

for (const key of approvable) {
  strategy = await roadmapIntel.setStrategyApproval(context, strategy, key, "approved", subjectLabel);
}
log("approved by a person", approvable);
log(
  "tiers after approval",
  [strategy.centralTruth, strategy.pointB, strategy.pointC, strategy.leveragePoint]
.filter(Boolean)
.map((i) => `${(i as StrategyItem).key}=${(i as StrategyItem).tier}`),
);
log(
  "gaps left proposed",
  strategy.gaps.filter((g) => g.approval !== "approved").map((g) => g.key),
);

/* -------------------------------------------------------------- milestones */

const candidates = normalizeMilestones(result.milestones, {
  provider: result.provider,
  model: result.model,
  checkedAt: result.checkedAt,
});
let milestones = await roadmapIntel.replaceCandidates(
  context,
  roadmapId,
  subjectLabel,
  candidates,
);
log("MILESTONES (persisted candidates)");
for (const m of rankMilestones(candidates)) {
  console.log(`  #${m.recommendedSequence} [${m.priorityScore}] ${m.name} (${m.confidence})`);
}

const shortlist = [...milestones].sort((a, b) => a.recommendedSequence - b.recommendedSequence).slice(0, 3);
for (const m of shortlist) {
  const updated = await roadmapIntel.setMilestoneStatus(context, m, "approved", subjectLabel, "Live acceptance run");
  milestones = milestones.map((x) => (x.id === updated.id ? updated: x));
}
log("approved by a person", shortlist.map((m) => m.name));
log("build order", buildOrder(milestones).map((m) => `${m.recommendedSequence}. ${m.name} [${m.status}]`));

/* ------------------------------------------------------------------ studio */

const reloaded = await roadmapIntel.load(roadmapId);
const packet = buildEvidencePacket({
  subjectLabel,
  kind: "full",
  strategy: reloaded.strategy!,
  milestones: reloaded.milestones,
  research: reloaded.research,
});
log("STUDIO");
log("packet (from stored rows)", packetSummary(packet));

let composed: { title?: string; sections: ArtifactSection[]; rejected: any[] } | null = null;
for await (const stage of composeStudioDocument({
  kind: "full",
  subjectLabel,
  strategy: reloaded.strategy!,
  milestones: reloaded.milestones,
  research: reloaded.research,
}, offlineCaller)) {
  console.log(`  [${stage.stage}] ${stage.message}`);
  if (stage.stage === "error") throw new Error(JSON.stringify(stage.data));
  if (stage.stage === "complete") composed = stage.data as typeof composed;
}
if (!composed) throw new Error("studio produced nothing");
log("sections", composed.sections.length);
log("rejected lines", composed.rejected.length);

let artifact = await roadmapIntel.saveArtifact(
  context,
  roadmapId,
  "full",
  composed.title ?? `${subjectLabel} Roadmap`,
  composed.sections,
  { provider: result.provider, model: result.model, rejected: composed.rejected },
);
log("artifact saved", `${artifact.id} v${artifact.version} humanEdited=${artifact.humanEdited}`);

/* --------------------------------------- human edit + protection + versions */

const edited: ArtifactSection[] = artifact.sections.map((section, index) =>
  index === 0 ? {...section, body: [...section.body, "Reviewed and signed off by Tai."] }: section,
);
artifact = await roadmapIntel.editArtifact(context, artifact, edited);
log("hand edited", `v${artifact.version} humanEdited=${artifact.humanEdited}`);

let refused = "not refused";
try {
  await roadmapIntel.saveArtifact(context, roadmapId, "full", artifact.title, composed.sections, {
    provider: result.provider,
    model: result.model,
  });
} catch (error) {
  refused = (error as Error).message;
}
log("regeneration over a hand edit", refused);

const replaced = await roadmapIntel.saveArtifact(
  context,
  roadmapId,
  "full",
  artifact.title,
  composed.sections,
  { provider: result.provider, model: result.model, replaceHumanEdits: true },
);
log("explicit replace", `v${replaced.version} humanEdited=${replaced.humanEdited}`);
log(
  "versions",
  (await roadmapIntel.listArtifactVersions(replaced.id)).map(
    (v) => `v${v.version} humanEdited=${v.humanEdited} at ${v.replacedAt}`,
  ),
);

/* --------------------------------------------------------------------- ask */

log("ASK ROADMAP (grounded on stored rows)");
const stored = await roadmapIntel.load(roadmapId);
for (const question of [
  `What is the central business truth for ${subjectLabel}, and what backs it?`,
  `What was ${subjectLabel}'s exact revenue last quarter?`,
]) {
  const answer = await answerRoadmapQuestion({
    question,
    subjectLabel,
    context: { research: stored.research, strategy: stored.strategy, milestones: stored.milestones },
    research: false,
  }, offlineCaller);
  const saved = await roadmapIntel.saveAnswer(context, roadmapId, {...answer, question });
  console.log(`\nQ: ${question}`);
  console.log(JSON.stringify({...answer, savedId: saved.id }, null, 2));
}

log("DONE, every step above wrote through RLS as the signed-in person.");

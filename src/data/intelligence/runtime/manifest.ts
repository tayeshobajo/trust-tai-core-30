/**
 * The Intelligence Readiness Manifest.
 *
 * One code-backed declaration per suite room across the eight readiness
 * dimensions, with three honest states: ready, delegated (a named
 * architectural equivalent, with the reason), or not_ready. There is no
 * "partial": machinery that exists but is not wired into the room's reasoning
 * is NOT READY, because a nice shell that cannot solve problems is exactly
 * the failure mode this contract exists to prevent.
 *
 * The acceptance tests (runtime/acceptance.test.ts) enforce the floor: every
 * registered room declares all eight dimensions, every delegation names its
 * equivalent, and no room reads as ready while a required dimension is
 * missing. The report is Ready / Delegated-equivalent / Not ready, never
 * manufactured green.
 */

import { APP_REGISTRY } from "@/domain/registry";
import {
  delegationIsValid,
  REQUIRED_ASPECTS,
  type ReadinessAspect,
  type ReadinessAspectReport,
  type RoomReadinessManifest,
} from "@/domain/intelligence-runtime";
import { roomCapabilities } from "@/domain/intelligence-capabilities";

type Aspects = RoomReadinessManifest["aspects"];

function capabilityAspect(room: string): ReadinessAspectReport {
  const answer = roomCapabilities(room);
  if (answer.executable.length > 0) {
    return r(
      `adapter registry declares ${answer.executable.length} executable operations (src/domain/adapter-registry.ts)`,
    );
  }
  return d(
    "read-only room; the capability question is answered for the rooms it routes to",
    "src/domain/intelligence-capabilities.ts",
    "the room executes nothing itself, so capability awareness means surfacing what owning rooms can do",
  );
}

const r = (evidence: string): ReadinessAspectReport => ({ state: "ready", evidence });
const d = (evidence: string, delegatedTo: string, because: string): ReadinessAspectReport => ({
  state: "delegated",
  evidence,
  delegatedTo,
  because,
});
const nr = (evidence: string): ReadinessAspectReport => ({ state: "not_ready", evidence });

function manifest(
  room: string,
  overrides: Partial<Record<ReadinessAspect, ReadinessAspectReport>>,
): RoomReadinessManifest {
  const registered = APP_REGISTRY.find((app) => app.id === room);
  const defaults: Aspects = {
    evidence_grounding: nr("no evidence composition exists for this room"),
    retrieval: nr("the room does not retrieve through the shared runtime"),
    domain_patterns: nr("no domain or pattern knowledge backs this room"),
    capability_awareness: capabilityAspect(room),
    safe_diagnostic_loop: nr("a failed attempt dead-ends; no bounded diagnostic loop"),
    verification: nr("no completion gate; a bare action claim would be accepted"),
    approval_boundary: nr("no authorization boundary is enforced"),
    outcome_learning: nr("outcomes do not feed back into reasoning"),
  };
  return {
    room,
    layer: registered?.layer ?? "business",
    aspects: {...defaults,...overrides },
  };
}

export const READINESS_MANIFESTS: RoomReadinessManifest[] = [
  manifest("home", {
    evidence_grounding: r(
      "engine observations carry provenance tiers (src/data/intelligence/engine/observe.ts)",
    ),
    retrieval: r("engine packet composition + runtime retrieval (src/data/intelligence/engine)"),
    domain_patterns: r("canon matches on observations (src/data/intelligence/canon/match.ts)"),
    safe_diagnostic_loop: r(
      "shared protocol module governs bounded diagnosis (src/data/intelligence/runtime/protocol.ts)",
    ),
    verification: r(
      "engine verify + completion gate (src/data/intelligence/engine/verify.ts, runtime/verification.ts)",
    ),
    approval_boundary: r("role-bound authority (src/domain/action-authority.ts)"),
    outcome_learning: r("canon cases, outcomes and revisions (src/data/intelligence/canon)"),
  }),
  manifest("scout", {
    evidence_grounding: r(
      "prospect fit evidence + services under RLS (src/data/supabase/scout-service.ts)",
    ),
    retrieval: r(
      "discovery reasons through the runtime boundary with ICP + calibration composed per run (src/lib/scout-discover.server.ts)",
    ),
    domain_patterns: r(
      "canon patterns via the runtime retrieval seam (src/data/intelligence/runtime/retrieval.ts)",
    ),
    safe_diagnostic_loop: d(
      "discovery is single-shot research; a provider failure fails the run honestly and records why",
      "src/data/intelligence/runtime/protocol.ts",
      "bounded multi-step diagnosis lives in the shared protocol; a research run's correct failure mode is an honest error, not a retry loop",
    ),
    verification: r(
      "strict candidate schema + run failure recording (src/lib/scout-discovery-request.ts)",
    ),
    approval_boundary: r(
      "every candidate is a person's decision; qualify/pass are human actions (src/domain/action-authority.ts)",
    ),
    outcome_learning: r(
      "prospect decisions and activities persist under RLS; canon case ledger accumulates (src/data/intelligence/canon/cases.ts)",
    ),
  }),
  manifest("comms", {
    evidence_grounding: r(
      "relationship state + handoff briefs under RLS (src/data/supabase/comms-service.ts)",
    ),
    retrieval: r(
      "drafts reason through the runtime boundary over governed evidence, memory, thread, commitments, behind a deterministic grounding gate: thread plus identity grounds a reply, identity plus a real prior interaction plus a reason grounds a proactive note (src/lib/comms-draft.server.ts, src/domain/comms-judgment.ts)",
    ),
    domain_patterns: r(
      "Tai's canonical relationship voice is the baseline; the org Voice DNA and approved/sent examples layer on top with separate provenance, never replacing it (src/domain/voice.ts, src/lib/comms-draft.server.ts)",
    ),
    safe_diagnostic_loop: d(
      "drafting is reason-then-write over governed evidence; a provider failure or an ungrounded request fails the draft honestly and nothing generic is created",
      "src/data/intelligence/runtime/protocol.ts",
      "a draft never needs a tool-using diagnostic loop; the honest failure mode is no draft at all, never a mail-merge fallback or an invented reason",
    ),
    verification: r(
      "the deterministic Voice pass gates every draft and the communication judgment persists with it; nothing sends without a person (src/data/voice-policy.ts, src/lib/comms-draft.server.ts)",
    ),
    approval_boundary: r(
      "drafts are proposals; sending is always the person (src/domain/action-authority.ts)",
    ),
    outcome_learning: d(
      "interactions record as activities; learning accumulates at suite level",
      "src/data/intelligence/canon (case ledger)",
      "comms outcomes are relationship events; the canon ledger is the shared place they become experience",
    ),
  }),
  manifest("roadmap", {
    evidence_grounding: r(
      "roadmap state + decided statements with provenance (src/data/supabase/roadmap-service.ts)",
    ),
    retrieval: r(
      "research and Q&A reason through the runtime boundary with stored evidence composed per call (src/lib/roadmap-intelligence.server.ts)",
    ),
    domain_patterns: r(
      "canon patterns via the runtime retrieval seam (src/data/intelligence/runtime/retrieval.ts)",
    ),
    safe_diagnostic_loop: r(
      "studio inspects the approved packet before it generates; refusal is a named outcome (src/lib/roadmap-studio.server.ts)",
    ),
    verification: r(
      "fabricated statements are rejected before anything saves (src/lib/roadmap-studio.server.ts)",
    ),
    approval_boundary: r("decided statements are a person's; generation never overrides them"),
    outcome_learning: r(
      "roadmap intelligence records + canon outcomes (src/data/intelligence/canon)",
    ),
  }),
  manifest("projects", {
    evidence_grounding: r(
      "context packets with tier-preserving provenance (src/data/projects/context-packet.ts)",
    ),
    retrieval: r(
      "context packet + runtime retrieval compose confirmed project knowledge, canon and prior cases (src/data/intelligence/runtime/retrieval.ts)",
    ),
    domain_patterns: r(
      "canon patterns matched on project observations (src/data/intelligence/canon/match.ts)",
    ),
    capability_awareness: r(
      "paperclip bridge + adapter registry (src/lib/execution-bridge.server.ts)",
    ),
    safe_diagnostic_loop: r(
      "the operator read contract and work contract encode the bounded loop (src/domain/project-operator-read.ts, src/domain/work-contract.ts)",
    ),
    verification: r(
      "work contracts carry acceptance criteria; the completion gate separates attempted/executed/verified/accepted (src/domain/work-contract.ts)",
    ),
    approval_boundary: r(
      "no work contract exists without human approval; no consequential write is silent (src/data/projects/work-contract.ts)",
    ),
    outcome_learning: r(
      "accepted work feeds the canon case ledger through the prior-case seam (src/data/intelligence/runtime/prior-cases.ts)",
    ),
  }),
  manifest("ops", {
    evidence_grounding: d(
      "ops events arrive via the projection, read-only",
      "src/domain/ops-projection.ts",
      "Ops is an external app; the suite reads its state through projection receipts, never its internals",
    ),
    retrieval: nr(
      "external app: the runtime cannot compose Ops-side knowledge; only routed packets cross the bridge",
    ),
    domain_patterns: nr("canon shapes do not cover Ops work; no Ops-side pattern library exists"),
    capability_awareness: d(
      "suite-side routing knows what may be sent to Ops",
      "src/domain/ops-projection.ts",
      "capability awareness here means knowing the suite may only route, never act",
    ),
    safe_diagnostic_loop: nr(
      "external app: no bounded diagnostic loop exists at the boundary; a failed Ops handoff cannot be inspected from here",
    ),
    verification: nr(
      "projection receipts prove delivery, not completion; no acceptance evidence crosses back",
    ),
    approval_boundary: r(
      "the suite never acts in Ops; routing requires human authority (src/domain/ops-projection.ts)",
    ),
    outcome_learning: nr("external app: Ops outcomes do not return to the canon ledger"),
  }),
  manifest("steward", {
    evidence_grounding: r(
      "transcripts, commitments and beliefs under RLS (src/data/supabase/steward-service.ts)",
    ),
    retrieval: r(
      "interpretation reasons through the runtime boundary; memory + beliefs composed per conversation (src/lib/steward-interpret.server.ts)",
    ),
    domain_patterns: r(
      "judgment states + canon patterns (src/domain/steward-judgment.ts, src/data/intelligence/canon)",
    ),
    safe_diagnostic_loop: d(
      "interpretation is single-shot; transcript/memory disagreement surfaces as a conflict banner, not a guess",
      "src/data/intelligence/runtime/protocol.ts",
      "Steward's recovery discipline is naming the disagreement for a person; the bounded protocol governs suites that act",
    ),
    verification: r(
      "audited interpreter selection + conflict banners (docs/steward-memory-learning.md)",
    ),
    approval_boundary: r("commitments and beliefs are recorded; nothing executes"),
    outcome_learning: r("append-only beliefs ledger (public.steward_beliefs)"),
  }),
  manifest("pulse", {
    evidence_grounding: r("signals derived from room state (src/data/intelligence/derive.ts)"),
    retrieval: r("suite snapshot + canon experience (src/data/intelligence/service.ts)"),
    domain_patterns: r("canon matches on engine observations (src/data/intelligence/canon/match.ts)"),
    safe_diagnostic_loop: d(
      "read-only visibility surface; it routes attention, it does not diagnose",
      "src/data/intelligence/runtime/protocol.ts",
      "Pulse owns no execution, so the bounded loop lives in the owning rooms it routes to",
    ),
    verification: d(
      "owns no completion; surfaces the owning rooms' verification state",
      "src/data/intelligence/runtime/verification.ts",
      "a read-only surface cannot accept completion; the gate runs where the work runs",
    ),
    approval_boundary: r("read-only by law (docs/architecture-canon.md)"),
    outcome_learning: r("reads the canon ledger (src/data/intelligence/canon)"),
  }),
  manifest("conductor", {
    evidence_grounding: r("plan steps cite room state (src/lib/conductor-control.ts)"),
    retrieval: r("composes engine + canon per plan (src/lib/conductor-control.ts)"),
    domain_patterns: r("canon patterns drive plan hypotheses (src/data/intelligence/canon)"),
    safe_diagnostic_loop: r(
      "factory execution with outcome observation and bounded retries (src/data/intelligence/canon/outcome-checks.ts)",
    ),
    verification: r("approval queue + outcome observer; nothing counts done on a bare action"),
    approval_boundary: r("approval-driven by design (Conductor v2)"),
    outcome_learning: r("conductor learning ledger + canon outcomes (docs/conductor-v3.md)"),
  }),
  manifest("studio", {
    evidence_grounding: r(
      "composes only approved roadmap packets; generation reasons through the runtime boundary (src/lib/roadmap-studio.server.ts)",
    ),
    retrieval: r(
      "the approved evidence packet is the retrieval boundary; nothing else reaches the model (src/lib/roadmap-studio.server.ts)",
    ),
    domain_patterns: d(
      "expression knowledge is Voice DNA and the roadmap's decided strategy",
      "src/lib/roadmap-studio.server.ts",
      "Studio expresses a roadmap's domain knowledge; it does not hold a separate pattern library",
    ),
    safe_diagnostic_loop: d(
      "two-step flow: the packet step inspects before the expression step generates",
      "src/data/intelligence/runtime/protocol.ts",
      "Studio's recovery is refusal with named rejected claims, not autonomous retry",
    ),
    verification: r(
      "statements the packet cannot back are rejected before save (src/lib/roadmap-studio.server.ts)",
    ),
    approval_boundary: r("artifacts are person-reviewed before use"),
    outcome_learning: d(
      "artifact history records what shipped; outcomes return through roadmap records",
      "src/data/intelligence/canon (case ledger)",
      "Studio artifacts attach to roadmap outcomes, which the canon ledger already accumulates",
    ),
  }),
  manifest("website", {
    evidence_grounding: r(
      "provider sync ledger + page inventory with freshness state (src/data/website)",
    ),
    retrieval: r(
      "freshness + signals composed per read; sync adapters are server-side (src/lib/website-providers.server.ts)",
    ),
    domain_patterns: d(
      "analytics room; engine observations carry pattern matching",
      "src/data/intelligence/canon/match.ts",
      "Website signals become engine observations, where canon matching already runs",
    ),
    safe_diagnostic_loop: r(
      "quiet vs failed vs stale states are named honestly per provider (src/domain/website-analytics.ts)",
    ),
    verification: r("sync receipts recorded per provider run (src/domain/website-analytics.ts)"),
    approval_boundary: r("read-only analytics; the person owns every response to a signal"),
    outcome_learning: r("the sync ledger accumulates freshness history per provider"),
  }),
];

export function manifestFor(room: string): RoomReadinessManifest | null {
  return READINESS_MANIFESTS.find((entry) => entry.room === room) ?? null;
}

export interface RoomReadinessCheck {
  room: string;
  ready: boolean;
  /** Required dimensions that are missing or whose delegation is invalid. */
  missing: ReadinessAspect[];
  /** Dimensions covered by a named architectural equivalent. */
  delegated: ReadinessAspect[];
  manifest: RoomReadinessManifest;
}

/**
 * A room is ready when every required dimension is ready or validly
 * delegated. An invalid delegation (no named equivalent, no reason) counts
 * as missing. Nothing manufactures green.
 */
export function checkRoomReadiness(room: string): RoomReadinessCheck | null {
  const manifestEntry = manifestFor(room);
  if (!manifestEntry) return null;
  const missing: ReadinessAspect[] = [];
  const delegated: ReadinessAspect[] = [];
  for (const aspect of REQUIRED_ASPECTS) {
    const report = manifestEntry.aspects[aspect];
    if (report.state === "not_ready") missing.push(aspect);
    else if (report.state === "delegated") {
      if (delegationIsValid(report)) delegated.push(aspect);
      else missing.push(aspect);
    }
  }
  return { room, ready: missing.length === 0, missing, delegated, manifest: manifestEntry };
}

/** Every registered room without a manifest, the acceptance test requires none. */
export function roomsMissingManifests(): string[] {
  return APP_REGISTRY.filter((app) => !manifestFor(app.id)).map((app) => app.id);
}

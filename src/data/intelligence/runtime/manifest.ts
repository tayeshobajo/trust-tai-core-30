/**
 * The Intelligence Readiness Manifest.
 *
 * One code-backed declaration per suite room: which of the eight readiness
 * aspects the room actually has today, and where in the code that backing
 * lives. The acceptance tests (runtime/acceptance.test.ts) enforce the
 * floor: no business room may be absent on evidence grounding, capability
 * awareness, verification or the approval boundary.
 *
 * Honesty rule: "partial" means the machinery exists but the room has not
 * adopted the shared runtime for it yet; "absent" means nothing exists. The
 * manifest is the migration map, not a brochure.
 */

import { APP_REGISTRY } from "@/domain/registry";
import {
  REQUIRED_ASPECTS,
  type AspectState,
  type ReadinessAspect,
  type RoomReadinessManifest,
} from "@/domain/intelligence-runtime";
import { roomCapabilities } from "@/domain/intelligence-capabilities";

type Aspects = RoomReadinessManifest["aspects"];

function capabilityAspect(room: string): { state: AspectState; evidence: string } {
  const answer = roomCapabilities(room);
  if (answer.executable.length > 0) {
    return {
      state: "available",
      evidence: `adapter registry declares ${answer.executable.length} executable operations (src/domain/adapter-registry.ts)`,
    };
  }
  if (answer.unavailable.length > 0) {
    return {
      state: "partial",
      evidence: "operations declared but not yet routable (src/domain/adapter-registry.ts)",
    };
  }
  return { state: "partial", evidence: "read-only room; the person executes every step" };
}

const a = (evidence: string): { state: AspectState; evidence: string } => ({
  state: "available",
  evidence,
});
const p = (evidence: string): { state: AspectState; evidence: string } => ({
  state: "partial",
  evidence,
});
const x = (evidence: string): { state: AspectState; evidence: string } => ({
  state: "absent",
  evidence,
});

function manifest(
  room: string,
  overrides: Partial<Record<ReadinessAspect, { state: AspectState; evidence: string }>>,
): RoomReadinessManifest {
  const registered = APP_REGISTRY.find((app) => app.id === room);
  const defaults: Aspects = {
    evidence_grounding: p("no runtime adoption yet"),
    retrieval: p("no runtime adoption yet"),
    domain_patterns: p("canon patterns exist suite-wide (src/data/intelligence/canon/patterns.ts)"),
    capability_awareness: capabilityAspect(room),
    safe_diagnostic_loop: x("no protocol adoption yet"),
    verification: p("no completion gate adoption yet"),
    approval_boundary: a("role-bound authority (src/domain/action-authority.ts)"),
    outcome_learning: p("canon case ledger exists (src/data/intelligence/canon/cases.ts)"),
  };
  return {
    room,
    layer: registered?.layer ?? "business",
    aspects: { ...defaults, ...overrides },
  };
}

export const READINESS_MANIFESTS: RoomReadinessManifest[] = [
  manifest("home", {
    evidence_grounding: a(
      "engine observations with provenance (src/data/intelligence/engine/observe.ts)",
    ),
    retrieval: a("engine + packet composition (src/data/intelligence/engine)"),
    domain_patterns: a("canon matches (src/data/intelligence/canon/match.ts)"),
    safe_diagnostic_loop: p("engine recommends; no retry protocol yet"),
    verification: a(
      "engine verify + proposal verification (src/data/intelligence/engine/verify.ts)",
    ),
    outcome_learning: a("canon cases, outcomes and revisions (src/data/intelligence/canon)"),
  }),
  manifest("scout", {
    evidence_grounding: a(
      "prospect fit evidence + services under RLS (src/data/supabase/scout-service.ts)",
    ),
    retrieval: p("own queries; runtime retrieval adoption pending"),
    safe_diagnostic_loop: x("scout-discover bypasses the runtime (see boundary registry)"),
    verification: p("parse-level checks only; no completion gate"),
  }),
  manifest("comms", {
    evidence_grounding: a(
      "relationship state + handoff briefs under RLS (src/data/supabase/comms-service.ts)",
    ),
    retrieval: p("own queries; runtime retrieval adoption pending"),
    safe_diagnostic_loop: x("comms-draft bypasses the runtime (see boundary registry)"),
    verification: p("drafts are person-approved; no completion gate"),
  }),
  manifest("roadmap", {
    evidence_grounding: a(
      "roadmap state + decided statements (src/data/supabase/roadmap-service.ts)",
    ),
    retrieval: p("research context composed per call; runtime retrieval adoption pending"),
    safe_diagnostic_loop: p("two-step studio flow inspects before generating"),
    verification: p("engine verify reused for reasoning; no completion gate"),
    outcome_learning: p("roadmap intelligence records exist"),
  }),
  manifest("projects", {
    evidence_grounding: a("context packets (src/data/projects/context-packet.ts)"),
    retrieval: p("context packet composition; runtime retrieval adoption pending"),
    safe_diagnostic_loop: p(
      "operator read contract defines the loop (src/domain/project-operator-read.ts)",
    ),
    verification: p("operator read carries a verification plan; gate adoption pending"),
    capability_awareness: a(
      "paperclip bridge + adapter registry (src/lib/execution-bridge.server.ts)",
    ),
  }),
  manifest("ops", {
    evidence_grounding: p("ops events via projection (src/domain/ops.ts)"),
    retrieval: x("external app; reads via bridge only"),
    domain_patterns: x("external app; canon not yet extended to ops shapes"),
    safe_diagnostic_loop: x("external app"),
    verification: p("SSO + projection receipts"),
    approval_boundary: a("external room; suite never acts in it (src/domain/ops-projection.ts)"),
    outcome_learning: x("external app"),
  }),
  manifest("steward", {
    evidence_grounding: a(
      "transcripts, commitments, beliefs under RLS (src/data/supabase/steward-service.ts)",
    ),
    retrieval: p("memory + beliefs composed per conversation; runtime adoption pending"),
    domain_patterns: p("judgment states (src/domain/steward-judgment.ts)"),
    safe_diagnostic_loop: p("conflict banners name the disagreement"),
    verification: p("steward-interpret goes through the transport; no completion gate"),
    outcome_learning: p("steward beliefs ledger (append-only)"),
  }),
  manifest("pulse", {
    evidence_grounding: a("signals derived from room state (src/data/intelligence/derive.ts)"),
    retrieval: a("suite snapshot + canon experience (src/data/intelligence/service.ts)"),
    domain_patterns: a("canon matches on engine observations"),
    safe_diagnostic_loop: p("read-only; diagnostic hints via canon"),
    verification: a("visibility surface only; owns no execution"),
    approval_boundary: a("read-only by law"),
    outcome_learning: a("reads the canon ledger"),
  }),
  manifest("conductor", {
    evidence_grounding: a("plan steps cite room state (src/lib/conductor-control.ts)"),
    retrieval: p("composes engine + canon per plan"),
    safe_diagnostic_loop: a(
      "factory execution with outcome observation (src/data/intelligence/canon/outcome-checks.ts)",
    ),
    verification: a("approval queue + outcome observer"),
    approval_boundary: a("approval-driven by design (conductor v2)"),
    outcome_learning: a("conductor learning ledger + canon outcomes"),
  }),
  manifest("studio", {
    evidence_grounding: p("implementation deferred; produced content attaches to core entities"),
    retrieval: x("implementation deferred"),
    domain_patterns: x("implementation deferred"),
    safe_diagnostic_loop: x("implementation deferred"),
    verification: p("artifacts are person-reviewed before use"),
    outcome_learning: x("implementation deferred"),
  }),
  manifest("website", {
    evidence_grounding: a("provider sync ledger + page inventory (src/data/website)"),
    retrieval: p("freshness + signals composed per read"),
    safe_diagnostic_loop: p("quiet vs failed states named honestly"),
    verification: p("sync receipts recorded per provider run"),
    outcome_learning: p("sync ledger accumulates freshness history"),
  }),
];

export function manifestFor(room: string): RoomReadinessManifest | null {
  return READINESS_MANIFESTS.find((entry) => entry.room === room) ?? null;
}

export interface RoomReadinessCheck {
  room: string;
  ready: boolean;
  /** Required aspects at "absent". */
  missing: ReadinessAspect[];
  manifest: RoomReadinessManifest;
}

/** A room is ready when no required aspect is absent. */
export function checkRoomReadiness(room: string): RoomReadinessCheck | null {
  const manifestEntry = manifestFor(room);
  if (!manifestEntry) return null;
  const missing = REQUIRED_ASPECTS.filter(
    (aspect) => manifestEntry.aspects[aspect].state === "absent",
  );
  return { room, ready: missing.length === 0, missing, manifest: manifestEntry };
}

/** Every registered room without a manifest — the acceptance test requires none. */
export function roomsMissingManifests(): string[] {
  return APP_REGISTRY.filter((app) => !manifestFor(app.id)).map((app) => app.id);
}

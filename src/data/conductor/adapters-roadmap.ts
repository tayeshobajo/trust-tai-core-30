/**
 * Roadmap execution adapters (Conductor V3).
 *
 * Roadmap holds decided truth: what a person chose, and in what order. The
 * Conductor may prepare the ground and it may ask a question. It may never
 * answer one.
 *
 *   - `roadmapService.create` · a draft roadmap shell for an approved subject.
 *     Idempotent: the service returns the existing roadmap for that subject.
 *   - `roadmapService.addDecision` · an open question waiting for a person.
 *
 * Not adapted, deliberately: resolving a decision and changing approved
 * sequencing. Both are decided truth, and letting inference write them would
 * put the machine above the human.
 */

import { roadmapService } from "@/data/supabase/roadmap-service";
import type { RoadmapSubjectKind } from "@/domain/roadmap";
import type { RoomAdapter } from "@/domain/conductor-control";
import { existingEquivalentDecision } from "@/data/intelligence/conductor/roadmap-cycle";
import { adapterReceipt, requireText, roomVerdict } from "./adapter-kit";

const SUBJECT_KINDS: RoadmapSubjectKind[] = ["client", "prospect", "relationship"];

function subjectKind(value: string | undefined): RoadmapSubjectKind | undefined {
  return SUBJECT_KINDS.find((kind) => kind === value);
}

/** Create a draft roadmap shell for a subject a person approved. */
export const roadmapShellAdapter: RoomAdapter = {
  id: "adapter:roadmap.shell",
  room: "roadmap",
  operations: ["roadmap.create_shell"],
  boundary: "roadmapService.create, idempotent per subject, drafts only",
  supports(operation) {
    return this.operations.includes(operation);
  },
  canRoute(action, access) {
    const refused = roomVerdict(this, action, access);
    if (refused) return refused;
    const kind = subjectKind(requireText(action.payload, "subjectKind"));
    if (
      !kind ||
      !requireText(action.payload, "subjectId") ||
      !requireText(action.payload, "objective")
    ) {
      return {
        routable: false,
        because:
          "Roadmap can open a draft, but this action names no subject and no objective. Name them in Roadmap.",
        refusal: "missing_input",
      };
    }
    return { routable: true, because: "Roadmap will open a draft for this subject." };
  },
  async prepare(action) {
    const kind = subjectKind(requireText(action.payload, "subjectKind"));
    const subjectId = requireText(action.payload, "subjectId");
    const objective = requireText(action.payload, "objective");
    if (!kind || !subjectId || !objective) {
      return { ready: false, because: "A subject reference and an objective are required." };
    }
    return {
      ready: true,
      because: "Roadmap will draft from what the organization already knows.",
      payload: {
        subjectKind: kind,
        subjectId,
        objective,
        ...(requireText(action.payload, "extraContext")
          ? { extraContext: requireText(action.payload, "extraContext")! }
          : {}),
      },
    };
  },
  async route(action, context) {
    const prepared = await this.prepare(action, context);
    if (!prepared.ready) {
      return adapterReceipt({
        action,
        adapter: this,
        context,
        status: "refused",
        resultingState: "approved",
        failure: prepared.because,
      });
    }
    try {
      const detail = await roadmapService.create(
        {
          subject: {
            kind: prepared.payload!["subjectKind"] as RoadmapSubjectKind,
            id: String(prepared.payload!["subjectId"]),
          },
          objective: String(prepared.payload!["objective"]),
          ...(prepared.payload!["extraContext"]
            ? { extraContext: String(prepared.payload!["extraContext"]) }
            : {}),
        },
        {
          organizationId: context.organizationId,
          userId: context.actor.id,
          userLabel: context.actor.label,
        },
      );
      return adapterReceipt({
        action,
        adapter: this,
        context,
        status: "routed",
        resultingState: "routed",
        result: {
          reference: detail.roadmap.id,
          label: `Draft roadmap open: ${detail.roadmap.title}`,
        },
      });
    } catch (error) {
      return adapterReceipt({
        action,
        adapter: this,
        context,
        status: "failed",
        resultingState: "failed",
        failure: (error as Error).message,
      });
    }
  },
  async readStatus(action) {
    return action.status;
  },
};

/** Raise a question for a person to answer. Never records an answer. */
export const roadmapDecisionAdapter: RoomAdapter = {
  id: "adapter:roadmap.decision",
  room: "roadmap",
  operations: ["roadmap.request_decision"],
  boundary: "roadmapService.addDecision, an open question, never an answer",
  supports(operation) {
    return this.operations.includes(operation);
  },
  canRoute(action, access) {
    const refused = roomVerdict(this, action, access);
    if (refused) return refused;
    if (!requireText(action.payload, "roadmapId") || !requireText(action.payload, "question")) {
      return {
        routable: false,
        because:
          "Roadmap can hold an open question, but this action names no roadmap and no question.",
        refusal: "missing_input",
      };
    }
    return {
      routable: true,
      because: "Roadmap will hold this as an open question for you to answer.",
    };
  },
  async prepare(action) {
    const roadmapId = requireText(action.payload, "roadmapId");
    const question = requireText(action.payload, "question");
    if (!roadmapId || !question) {
      return { ready: false, because: "A roadmap reference and a question are required." };
    }
    const options = Array.isArray(action.payload?.["options"])
      ? (action.payload!["options"] as unknown[]).map(String).filter((item) => item.trim())
      : [];
    return {
      ready: true,
      because: "Roadmap will record the question as open.",
      payload: {
        roadmapId,
        question,
        whyItMatters: requireText(action.payload, "whyItMatters") ?? action.whyItMatters,
        options,
        ...(requireText(action.payload, "recommendation")
          ? { recommendation: requireText(action.payload, "recommendation")! }
          : {}),
      },
    };
  },
  async route(action, context) {
    const prepared = await this.prepare(action, context);
    if (!prepared.ready) {
      return adapterReceipt({
        action,
        adapter: this,
        context,
        status: "refused",
        resultingState: "approved",
        failure: prepared.because,
      });
    }
    const roadmapId = String(prepared.payload!["roadmapId"]);
    try {
      const detail = await roadmapService.detail(roadmapId, context.organizationId);
      if (!detail) {
        return adapterReceipt({
          action,
          adapter: this,
          context,
          status: "refused",
          resultingState: "approved",
          failure: "That roadmap is not in this organization.",
        });
      }
      /*
       * Duplication safety. A retry, a refresh or a second phrasing of the
       * same unresolved question must not leave Roadmap holding the same
       * decision twice. The existing one is returned as the receipt.
       */
      const already = existingEquivalentDecision(
        String(prepared.payload!["question"]),
        detail.decisions,
      );
      if (already) {
        return adapterReceipt({
          action,
          adapter: this,
          context,
          status: "routed",
          resultingState: "routed",
          result: {
            reference: already.id,
            label: "That decision is already open in Roadmap, waiting on you",
          },
        });
      }

      const options = prepared.payload!["options"] as string[];
      const recommendation = prepared.payload!["recommendation"];
      const decision = await roadmapService.addDecision(
        roadmapId,
        detail.roadmap.title,
        {
          question: String(prepared.payload!["question"]),
          whyItMatters: String(prepared.payload!["whyItMatters"]),
          ...(options.length > 0 ? { options } : {}),
          ...(recommendation
            ? {
                recommendation: String(recommendation),
                recommendationBecause: "Suggested by the Conductor; the decision remains yours.",
              }
            : {}),
          evidence: action.evidence,
        },
        {
          organizationId: context.organizationId,
          userId: context.actor.id,
          userLabel: context.actor.label,
        },
      );
      return adapterReceipt({
        action,
        adapter: this,
        context,
        status: "routed",
        resultingState: "routed",
        result: { reference: decision.id, label: "Open question waiting in Roadmap" },
      });
    } catch (error) {
      return adapterReceipt({
        action,
        adapter: this,
        context,
        status: "failed",
        resultingState: "failed",
        failure: (error as Error).message,
      });
    }
  },
  async readStatus(action) {
    return action.status;
  },
};

export const ROADMAP_ADAPTERS: RoomAdapter[] = [roadmapShellAdapter, roadmapDecisionAdapter];

/**
 * Stage six: propose a bounded action.
 *
 * A recommendation says what is worth doing. An action proposal is the
 * smallest, reversible piece of that work, named as an operation the owning
 * room already performs, and routed there. Four laws hold it in place:
 *
 *   1. The engine never executes. Every proposal carries `requiresApproval`
 *      and is completed by a person, inside the room that owns the change.
 *   2. Every action is bounded. It states what it will do and what it will
 *      not do, and both lists are non-empty.
 *   3. Only reversible work is proposed. Anything irreversible stays a
 *      recommendation for a person to carry out unaided.
 *   4. A hunch earns no action. A recommendation resting on one room, or on
 *      low confidence, routes a person to look, never to act.
 */

import {
  MAX_ACTION_PROPOSALS,
  type ActionProposal,
  type Recommendation,
} from "@/domain/intelligence-engine";

interface ActionTemplate {
  /** Recommendation id this action belongs to. */
  recommendationId: string;
  operation: string;
  title: string;
  summary: string;
  willDo: string[];
  willNotDo: string[];
  reversible: boolean;
  route: string;
  routeLabel: string;
}

const TEMPLATES: ActionTemplate[] = [
  {
    recommendationId: "rec:hyp:idle_capacity",
    operation: "scout.route_to_comms",
    title: "Route the strongest-fit companies to Comms",
    summary:
      "Opens Scout's board filtered to qualified companies so you can hand the strongest ones to Comms yourself.",
    willDo: ["Open Scout with the qualified companies in view", "Prepare the handoff to Comms"],
    willNotDo: ["Send anything", "Change any company's status without you"],
    reversible: true,
    route: "/modules/scout?view=board&status=qualified",
    routeLabel: "Open Scout board",
  },
  {
    recommendationId: "rec:hyp:thin_pipeline",
    operation: "scout.open_discovery",
    title: "Open a sourcing session against the current ICP",
    summary: "Opens Scout's discovery surface with the organisation's saved ICP as the criteria.",
    willDo: ["Open Scout discovery", "Use the ICP already saved for this organisation"],
    willNotDo: ["Source or contact anyone automatically", "Change the ICP"],
    reversible: true,
    route: "/modules/scout?view=discover",
    routeLabel: "Open Scout discovery",
  },
  {
    recommendationId: "rec:hyp:delivery_slipping",
    operation: "projects.record_blocker",
    title: "Record what the stalled work is waiting on",
    summary: "Opens the project in Projects so you can name the blocker and who must answer it.",
    willDo: ["Open the stalled project", "Leave the blocker field ready for you"],
    willNotDo: ["Change the project's status", "Notify anyone"],
    reversible: true,
    route: "/modules/projects",
    routeLabel: "Open Projects",
  },
  {
    recommendationId: "rec:hyp:promises_slipping",
    operation: "steward.review_overdue_commitments",
    title: "Review the promises that have passed their date",
    summary:
      "Opens Steward Today filtered to promises past a date a person set, so you can close or honestly move each one.",
    willDo: ["Open Steward Today", "Show only promises past their date"],
    willNotDo: ["Move any date for you", "Mark anything done"],
    reversible: true,
    route: "/modules/steward",
    routeLabel: "Open Steward",
  },
  {
    recommendationId: "rec:hyp:reply_debt",
    operation: "comms.draft_reply",
    title: "Draft the reply you owe",
    summary:
      "Opens the overdue relationship in Comms with a draft prepared in the house voice, unsent.",
    willDo: ["Open the relationship in Comms", "Prepare a draft for you to edit"],
    willNotDo: ["Send the message", "Contact anyone without your approval"],
    reversible: true,
    route: "/modules/comms",
    routeLabel: "Open Comms",
  },
  {
    recommendationId: "rec:hyp:client_drift",
    operation: "comms.open_quiet_relationships",
    title: "Reopen the relationships that went quiet",
    summary:
      "Opens Comms filtered to relationships with no recorded touch, so you can reach out or archive each deliberately.",
    willDo: ["Open Comms with the quiet relationships in view"],
    willNotDo: ["Send anything", "Archive a relationship for you"],
    reversible: true,
    route: "/modules/comms",
    routeLabel: "Open Comms",
  },
  {
    recommendationId: "rec:hyp:structural_friction",
    operation: "roadmap.sequence_capability",
    title: "Sequence the missing step in Roadmap",
    summary:
      "Opens Roadmap so you can sequence a small capability that removes the recurring obstruction.",
    willDo: ["Open Roadmap", "Carry the recurring obstruction across as evidence"],
    willNotDo: ["Create or approve a roadmap item", "Commit to any dates"],
    reversible: true,
    route: "/modules/roadmap",
    routeLabel: "Open Roadmap",
  },
  {
    recommendationId: "rec:hyp:unworked_opportunity",
    operation: "scout.review_strong_fit",
    title: "Decide on the strong-fit companies already found",
    summary: "Opens Scout's board filtered to strong-fit companies nobody has reviewed yet.",
    willDo: ["Open Scout with the unreviewed strong-fit companies in view"],
    willNotDo: ["Qualify or pass anything for you"],
    reversible: true,
    route: "/modules/scout?view=board",
    routeLabel: "Open Scout board",
  },
];

/**
 * The bounded actions a recommendation may offer. Empty is a valid answer:
 * plenty of good advice has no safe, reversible first step to authorise.
 */
export function proposeActions(recommendation: Recommendation): ActionProposal[] {
  /* Law 4: a hunch routes a person to look, never to act. */
  if (recommendation.confidence === "low" || recommendation.confidence === "unknown") return [];

  return (
    TEMPLATES.filter((template) => template.recommendationId === recommendation.id)
      /* Law 3: irreversible work is never offered for authorisation. */
      .filter((template) => template.reversible)
      /* Law 2: an action with no stated limits is not an action we propose. */
      .filter((template) => template.willDo.length > 0 && template.willNotDo.length > 0)
      .slice(0, MAX_ACTION_PROPOSALS)
      .map((template) => ({
        id: `act:${recommendation.id}:${template.operation}`,
        recommendationId: recommendation.id,
        appId: recommendation.destination.appId,
        operation: template.operation,
        title: template.title,
        summary: template.summary,
        willDo: template.willDo,
        willNotDo: template.willNotDo,
        payload: {
          theme: recommendation.theme,
          patternKey: recommendation.patternKey,
          expectedSignal: recommendation.expectedSignal,
          observationRefs: recommendation.observationRefs,
        },
        reversible: true,
        route: template.route,
        routeLabel: template.routeLabel,
        requiresApproval: true,
      }))
  );
}

/** Every bounded action currently on offer, keyed by recommendation. */
export function actionsForRead(
  recommendations: Recommendation[],
): Record<string, ActionProposal[]> {
  const out: Record<string, ActionProposal[]> = {};
  for (const recommendation of recommendations) {
    const actions = proposeActions(recommendation);
    if (actions.length > 0) out[recommendation.id] = actions;
  }
  return out;
}

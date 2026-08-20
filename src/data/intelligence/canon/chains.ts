/**
 * Diagnostic chains: the ordered questions a careful person would ask.
 *
 * A chain is machine readable so the suite can answer the parts it can see and
 * hand the rest back as evidence to inspect. A chain never concludes on its
 * own: it ends on a hypothesis candidate, which a person still has to accept.
 */

import type { DiagnosticChain } from "@/domain/intelligence-canon";

function chain(input: Omit<DiagnosticChain, "version" | "status">): DiagnosticChain {
  return { version: 1, status: "active", ...input };
}

export const DIAGNOSTIC_CHAINS: DiagnosticChain[] = [
  chain({
    id: "chain.project_late",
    domain: "delivery",
    question: "Why is this project late?",
    trigger: "A project is past its expected date.",
    checks: [
      {
        id: "late.blocker",
        question: "Is a blocker already recorded?",
        kind: "evidence",
        requiredEvidence: ["project_blocked"],
        appId: "projects",
        branches: [
          { when: "A blocker exists", hypothesis: "Work is waiting on a named blocker nobody has cleared." },
          { when: "No blocker recorded", next: "late.decision" },
        ],
      },
      {
        id: "late.decision",
        question: "Is a decision still open that this work depends on?",
        kind: "evidence",
        requiredEvidence: ["open_decisions", "roadmap_direction_undecided"],
        appId: "roadmap",
        branches: [
          { when: "A decision is open", hypothesis: "Work is waiting on a decision rather than on effort." },
          { when: "Nothing open", next: "late.capacity" },
        ],
      },
      {
        id: "late.capacity",
        question: "Is more than one project late at the same time?",
        kind: "evidence",
        requiredEvidence: ["delivery_delay_count", "open_projects"],
        appId: "projects",
        branches: [
          { when: "Several are late", hypothesis: "Capacity is committed beyond what the team can carry." },
          { when: "Only this one", next: "late.criteria" },
        ],
      },
      {
        id: "late.criteria",
        question: "Is it agreed in writing what finished means here?",
        kind: "human",
        requiredEvidence: [],
        appId: "projects",
        branches: [
          { when: "No written criteria", hypothesis: "Acceptance criteria are unclear, so the work cannot be called done." },
          { when: "Criteria exist and are met", hypothesis: "The work is finished and the record was never closed." },
        ],
      },
    ],
    stopConditions: [
      "A blocker is found: stop and clear it before diagnosing further.",
      "No evidence is available for any check: return the evidence request instead of a reading.",
    ],
    hypothesisCandidates: [
      "Work is waiting on a named blocker nobody has cleared.",
      "Work is waiting on a decision rather than on effort.",
      "Capacity is committed beyond what the team can carry.",
      "Acceptance criteria are unclear, so the work cannot be called done.",
    ],
    nextEvidenceRequest: [
      {
        inspect: "The last three updates on the project",
        appId: "projects",
        wouldConfirm: "Repeated updates with no new step",
        wouldRefute: "A new step each time",
      },
    ],
  }),
  chain({
    id: "chain.client_unhappy",
    domain: "client",
    question: "Why is this client becoming unhappy?",
    trigger: "A relationship has gone quiet, or replies are owed.",
    checks: [
      {
        id: "unhappy.reply",
        question: "Are we the ones who owe a reply?",
        kind: "evidence",
        requiredEvidence: ["reply_debt"],
        appId: "comms",
        branches: [
          { when: "We owe a reply", hypothesis: "Trust is thinning because we have not answered." },
          { when: "Nothing owed", next: "unhappy.delivery" },
        ],
      },
      {
        id: "unhappy.delivery",
        question: "Is their work late?",
        kind: "evidence",
        requiredEvidence: ["project_delayed", "delivery_delay_count"],
        appId: "projects",
        branches: [
          { when: "Their work is late", hypothesis: "The relationship is carrying the cost of a late delivery." },
          { when: "Delivery is on time", next: "unhappy.expectations" },
        ],
      },
      {
        id: "unhappy.expectations",
        question: "Was it ever agreed in writing what good looks like?",
        kind: "human",
        requiredEvidence: [],
        appId: "comms",
        branches: [
          { when: "Never agreed", hypothesis: "What was delivered and what was expected are not the same thing." },
          { when: "Agreed and met", hypothesis: "Nothing is wrong with the work and the quiet is theirs, not ours." },
        ],
      },
    ],
    stopConditions: [
      "The client has replied recently and positively: stop.",
      "No conversation data is readable: say so rather than guessing at mood.",
    ],
    hypothesisCandidates: [
      "Trust is thinning because we have not answered.",
      "The relationship is carrying the cost of a late delivery.",
      "What was delivered and what was expected are not the same thing.",
    ],
    nextEvidenceRequest: [
      {
        inspect: "The last exchange with this client",
        appId: "comms",
        wouldConfirm: "An open concern nobody closed",
        wouldRefute: "A clean, closed exchange",
      },
    ],
  }),
  chain({
    id: "chain.prospect_not_moving",
    domain: "pipeline",
    question: "Why is this prospect not moving?",
    trigger: "A company is qualified or strongly fitting and nothing has happened.",
    checks: [
      {
        id: "prospect.decision",
        question: "Has anyone decided on it?",
        kind: "evidence",
        requiredEvidence: ["strong_fit_unreviewed"],
        appId: "scout",
        branches: [
          { when: "No decision recorded", hypothesis: "The company is waiting on a decision, not on the market." },
          { when: "Decided", next: "prospect.handover" },
        ],
      },
      {
        id: "prospect.handover",
        question: "Did it reach a conversation?",
        kind: "evidence",
        requiredEvidence: ["pipeline_unrouted"],
        appId: "comms",
        branches: [
          { when: "Never handed over", hypothesis: "The handover from Scout to Comms did not happen." },
          { when: "A conversation exists", next: "prospect.followup" },
        ],
      },
      {
        id: "prospect.followup",
        question: "Did the conversation continue after the first message?",
        kind: "human",
        requiredEvidence: ["reply_debt"],
        appId: "comms",
        branches: [
          { when: "One message and nothing after", hypothesis: "Follow-up stops after the first message." },
          { when: "A live thread", hypothesis: "The conversation is running and simply not finished." },
        ],
      },
    ],
    stopConditions: ["The company was passed on purpose: stop, the decision stands."],
    hypothesisCandidates: [
      "The company is waiting on a decision, not on the market.",
      "The handover from Scout to Comms did not happen.",
      "Follow-up stops after the first message.",
    ],
    nextEvidenceRequest: [
      {
        inspect: "The evidence behind the fit score",
        appId: "scout",
        wouldConfirm: "Observed evidence supporting the fit",
        wouldRefute: "Only what the company said about itself",
      },
    ],
  }),
  chain({
    id: "chain.founder_bottleneck",
    domain: "founder",
    question: "Why is Tai becoming the bottleneck?",
    trigger: "Decisions and returned work are concentrating on one person.",
    checks: [
      {
        id: "bottleneck.decisions",
        question: "How many decisions are open on one desk?",
        kind: "evidence",
        requiredEvidence: ["open_decisions"],
        appId: "roadmap",
        branches: [
          { when: "Several open", next: "bottleneck.capacity" },
          { when: "None", hypothesis: "Decisions are not the constraint here." },
        ],
      },
      {
        id: "bottleneck.capacity",
        question: "Does the team have room to take work on?",
        kind: "evidence",
        requiredEvidence: ["open_projects", "activity_volume"],
        appId: "projects",
        branches: [
          { when: "There is room", next: "bottleneck.clarity" },
          { when: "The team is full", hypothesis: "This is a capacity problem, not a delegation problem." },
        ],
      },
      {
        id: "bottleneck.clarity",
        question: "When work comes back, is it for context or for judgment?",
        kind: "human",
        requiredEvidence: ["memory_recurring_work"],
        appId: "steward",
        branches: [
          { when: "For context", hypothesis: "Context lives with the founder rather than in the work." },
          { when: "For judgment", hypothesis: "Acceptance criteria are unclear, so work returns for a ruling." },
        ],
      },
    ],
    stopConditions: [
      "Team capacity cannot be read: say the delegation reading is unproven and ask for it.",
    ],
    hypothesisCandidates: [
      "Context lives with the founder rather than in the work.",
      "Acceptance criteria are unclear, so work returns for a ruling.",
      "This is a capacity problem, not a delegation problem.",
    ],
    nextEvidenceRequest: [
      {
        inspect: "The last three pieces of work that came back",
        appId: "steward",
        wouldConfirm: "Each needed knowledge only the founder held",
        wouldRefute: "Each needed an authority only the founder has",
      },
    ],
  }),
  chain({
    id: "chain.busy_but_slow",
    domain: "founder",
    question: "Why is the team busy but delivery slow?",
    trigger: "High activity alongside late work.",
    checks: [
      {
        id: "busy.where",
        question: "Which rooms is the activity in?",
        kind: "evidence",
        requiredEvidence: ["activity_volume", "room_quiet"],
        appId: "activity",
        branches: [
          { when: "Mostly outside delivery", hypothesis: "Attention is going somewhere other than the late work." },
          { when: "Concentrated on delivery", next: "busy.parallel" },
        ],
      },
      {
        id: "busy.parallel",
        question: "How many pieces of work are open at once?",
        kind: "evidence",
        requiredEvidence: ["open_projects", "delivery_delay_count"],
        appId: "projects",
        branches: [
          { when: "Many at once", hypothesis: "Too much is in flight for any of it to finish." },
          { when: "Few", hypothesis: "The work itself is harder than the plan assumed." },
        ],
      },
    ],
    stopConditions: ["Activity cannot be read for the period: stop rather than infer effort."],
    hypothesisCandidates: [
      "Attention is going somewhere other than the late work.",
      "Too much is in flight for any of it to finish.",
      "The work itself is harder than the plan assumed.",
    ],
    nextEvidenceRequest: [
      {
        inspect: "Time spent per project this week",
        appId: "projects",
        wouldConfirm: "Effort spread evenly across everything",
        wouldRefute: "Effort concentrated where it should be",
      },
    ],
  }),
  chain({
    id: "chain.website_no_opportunities",
    domain: "website",
    question: "Why are website visitors not becoming opportunities?",
    trigger: "Intakes arrive but few become companies worth talking to.",
    checks: [
      {
        id: "web.volume",
        question: "Are intakes arriving at all?",
        kind: "evidence",
        requiredEvidence: ["inbound_volume"],
        appId: "website",
        branches: [
          { when: "Intakes arriving", next: "web.worked" },
          { when: "Almost none", hypothesis: "This is an attention problem before it is a conversion problem." },
        ],
      },
      {
        id: "web.worked",
        question: "Are the intakes we do get being worked?",
        kind: "evidence",
        requiredEvidence: ["strong_fit_unreviewed", "pipeline_unrouted"],
        appId: "scout",
        branches: [
          { when: "Waiting undecided", hypothesis: "Inbound is arriving faster than it is being worked." },
          { when: "All decided", next: "web.completion" },
        ],
      },
      {
        id: "web.completion",
        question: "Do the intakes arrive complete enough to act on?",
        kind: "human",
        requiredEvidence: [],
        appId: "website",
        branches: [
          { when: "Mostly incomplete", hypothesis: "The question sequence is costing more trust than it earns." },
          { when: "Complete", hypothesis: "The audience arriving is not the audience the questions were written for." },
        ],
      },
    ],
    stopConditions: [
      "Visitor sessions are not readable: name that gap before calling anything a conversion problem.",
    ],
    hypothesisCandidates: [
      "This is an attention problem before it is a conversion problem.",
      "Inbound is arriving faster than it is being worked.",
      "The question sequence is costing more trust than it earns.",
      "The audience arriving is not the audience the questions were written for.",
    ],
    nextEvidenceRequest: [
      {
        inspect: "Visitor sessions and starts against completed intakes",
        appId: "website",
        wouldConfirm: "Many starts and few completions",
        wouldRefute: "Few visitors in the first place",
      },
    ],
  }),
  chain({
    id: "chain.roadmap_stalled",
    domain: "roadmap",
    question: "Why did this roadmap milestone stall?",
    trigger: "A roadmap has not moved for weeks.",
    checks: [
      {
        id: "roadmap.decision",
        question: "Is the direction still undecided?",
        kind: "evidence",
        requiredEvidence: ["roadmap_direction_undecided", "open_decisions"],
        appId: "roadmap",
        branches: [
          { when: "Undecided", hypothesis: "The plan cannot move until the direction is settled." },
          { when: "Decided", next: "roadmap.execution" },
        ],
      },
      {
        id: "roadmap.execution",
        question: "Did anything downstream pick it up?",
        kind: "evidence",
        requiredEvidence: ["open_projects", "no_active_project"],
        appId: "projects",
        branches: [
          { when: "Nothing picked it up", hypothesis: "The plan was agreed and never handed to delivery." },
          { when: "Work exists", hypothesis: "The plan is moving in Projects and the roadmap record is stale." },
        ],
      },
    ],
    stopConditions: ["The roadmap is complete: close it rather than diagnosing it."],
    hypothesisCandidates: [
      "The plan cannot move until the direction is settled.",
      "The plan was agreed and never handed to delivery.",
      "The plan is moving in Projects and the roadmap record is stale.",
    ],
    nextEvidenceRequest: [
      {
        inspect: "The next unfinished stage and what it depends on",
        appId: "roadmap",
        wouldConfirm: "A dependency nobody owns",
        wouldRefute: "A stage already underway",
      },
    ],
  }),
  chain({
    id: "chain.attention_today",
    domain: "business_health",
    question: "What deserves Tai's attention today?",
    trigger: "Asked on arrival, or when several rooms hold something waiting.",
    checks: [
      {
        id: "today.promises",
        question: "Is anything we promised past its date?",
        kind: "evidence",
        requiredEvidence: ["commitment_overdue"],
        appId: "steward",
        branches: [
          { when: "Something is overdue", hypothesis: "A promise past its date outranks everything else today." },
          { when: "Nothing overdue", next: "today.people" },
        ],
      },
      {
        id: "today.people",
        question: "Is anyone waiting on us?",
        kind: "evidence",
        requiredEvidence: ["reply_debt", "relationship_silent"],
        appId: "comms",
        branches: [
          { when: "Someone is waiting", hypothesis: "A person is waiting on us and that is today's first move." },
          { when: "Nobody waiting", next: "today.decisions" },
        ],
      },
      {
        id: "today.decisions",
        question: "Is work waiting on a decision?",
        kind: "evidence",
        requiredEvidence: ["open_decisions", "project_blocked"],
        appId: "roadmap",
        branches: [
          { when: "A decision is open", hypothesis: "One decision would unblock more than one room." },
          { when: "Nothing open", hypothesis: "Nothing needs a decision today, which is a real answer." },
        ],
      },
    ],
    stopConditions: ["Nothing fires: say nothing needs attention rather than manufacturing something."],
    hypothesisCandidates: [
      "A promise past its date outranks everything else today.",
      "A person is waiting on us and that is today's first move.",
      "One decision would unblock more than one room.",
      "Nothing needs a decision today, which is a real answer.",
    ],
    nextEvidenceRequest: [],
  }),
  chain({
    id: "chain.quietly_worse",
    domain: "business_health",
    question: "What is quietly getting worse?",
    trigger: "Asked periodically, or when a room stops recording.",
    checks: [
      {
        id: "worse.quiet",
        question: "Has a room stopped recording anything?",
        kind: "evidence",
        requiredEvidence: ["room_quiet"],
        appId: "activity",
        branches: [
          { when: "A room is quiet", hypothesis: "Work in that room either stopped or moved out of sight." },
          { when: "Every room active", next: "worse.pipeline" },
        ],
      },
      {
        id: "worse.pipeline",
        question: "Is anything new coming in?",
        kind: "evidence",
        requiredEvidence: ["pipeline_sourcing_stale", "pipeline_volume", "inbound_volume"],
        appId: "scout",
        branches: [
          { when: "Nothing new", hypothesis: "Today looks healthy and the quarter ahead does not." },
          { when: "New demand arriving", next: "worse.relationships" },
        ],
      },
      {
        id: "worse.relationships",
        question: "Has a relationship gone quiet?",
        kind: "evidence",
        requiredEvidence: ["relationship_silent"],
        appId: "comms",
        branches: [
          { when: "One has", hypothesis: "A relationship is cooling before anyone has said so." },
          { when: "None", hypothesis: "Nothing is quietly worsening in what the suite can see." },
        ],
      },
    ],
    stopConditions: ["Rooms are withheld from the read: name them rather than declaring health."],
    hypothesisCandidates: [
      "Work in that room either stopped or moved out of sight.",
      "Today looks healthy and the quarter ahead does not.",
      "A relationship is cooling before anyone has said so.",
    ],
    nextEvidenceRequest: [],
  }),
  chain({
    id: "chain.capacity_or_clarity",
    domain: "business_health",
    question: "Is this a capacity problem, a clarity problem, a dependency problem, or a decision problem?",
    trigger: "Work is not moving and the cause has not been named.",
    checks: [
      {
        id: "kind.decision",
        question: "Is a decision open that this work depends on?",
        kind: "evidence",
        requiredEvidence: ["open_decisions", "roadmap_direction_undecided"],
        appId: "roadmap",
        branches: [
          { when: "Yes", hypothesis: "This is a decision problem." },
          { when: "No", next: "kind.dependency" },
        ],
      },
      {
        id: "kind.dependency",
        question: "Is a blocker recorded, or is someone else holding it?",
        kind: "evidence",
        requiredEvidence: ["project_blocked", "ops_open_signal"],
        appId: "projects",
        branches: [
          { when: "Yes", hypothesis: "This is a dependency problem." },
          { when: "No", next: "kind.capacity" },
        ],
      },
      {
        id: "kind.capacity",
        question: "Is more work open than the team can carry?",
        kind: "evidence",
        requiredEvidence: ["open_projects", "delivery_delay_count"],
        appId: "projects",
        branches: [
          { when: "Yes", hypothesis: "This is a capacity problem." },
          { when: "No", hypothesis: "This is a clarity problem: nobody knows what finished looks like." },
        ],
      },
    ],
    stopConditions: ["Two answers fire at once: report both rather than choosing."],
    hypothesisCandidates: [
      "This is a decision problem.",
      "This is a dependency problem.",
      "This is a capacity problem.",
      "This is a clarity problem: nobody knows what finished looks like.",
    ],
    nextEvidenceRequest: [],
  }),
  chain({
    id: "chain.commitment_slipping",
    domain: "commitments",
    question: "Why are our promises slipping?",
    trigger: "More than one commitment is past its date.",
    checks: [
      {
        id: "promise.count",
        question: "How many promises are overdue?",
        kind: "evidence",
        requiredEvidence: ["commitment_overdue"],
        appId: "steward",
        branches: [
          { when: "Several", next: "promise.load" },
          { when: "One", hypothesis: "One promise slipped, which is a single follow-up rather than a pattern." },
        ],
      },
      {
        id: "promise.load",
        question: "Was delivery already late over the same period?",
        kind: "evidence",
        requiredEvidence: ["delivery_delay_count"],
        appId: "projects",
        branches: [
          { when: "Yes", hypothesis: "Promises are being made against time the team does not have." },
          { when: "No", hypothesis: "Promises are being kept and not closed in the record." },
        ],
      },
    ],
    stopConditions: ["Commitments cannot be read: ask for Steward rather than assuming follow-through."],
    hypothesisCandidates: [
      "Promises are being made against time the team does not have.",
      "Promises are being kept and not closed in the record.",
    ],
    nextEvidenceRequest: [],
  }),
  chain({
    id: "chain.inbound_to_decision",
    domain: "website",
    question: "What happened to the people who came in through the site?",
    trigger: "Intakes have arrived in the period being looked at.",
    checks: [
      {
        id: "inbound.linked",
        question: "Did each intake reach Scout?",
        kind: "evidence",
        requiredEvidence: ["inbound_volume"],
        appId: "website",
        branches: [
          { when: "Some did not", hypothesis: "Intakes are arriving without reaching anyone who can act." },
          { when: "All reached Scout", next: "inbound.decided" },
        ],
      },
      {
        id: "inbound.decided",
        question: "Was each one decided?",
        kind: "evidence",
        requiredEvidence: ["strong_fit_unreviewed"],
        appId: "scout",
        branches: [
          { when: "Some waiting", hypothesis: "Warm demand is waiting on a decision." },
          { when: "All decided", hypothesis: "Inbound is being worked as it arrives." },
        ],
      },
    ],
    stopConditions: ["No intakes in the period: say so plainly."],
    hypothesisCandidates: [
      "Intakes are arriving without reaching anyone who can act.",
      "Warm demand is waiting on a decision.",
      "Inbound is being worked as it arrives.",
    ],
    nextEvidenceRequest: [],
  }),
];

export function chainById(id: string): DiagnosticChain | undefined {
  return DIAGNOSTIC_CHAINS.find((entry) => entry.id === id);
}

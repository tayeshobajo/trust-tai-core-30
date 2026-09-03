/**
 * The initial Trust Tai pattern canon.
 *
 * Each entry answers the same seven questions: what you see, what it may mean,
 * what else to inspect, what else it could be, what evidence comes next, what
 * could be done, and how you would know later whether the reading was right.
 *
 * Triggers are written against engine observation kinds only, so a pattern can
 * never fire on something the suite did not actually observe. Where the suite
 * cannot yet see a condition, it is named as evidence to inspect rather than
 * quietly assumed. Nothing here encodes X equals Y.
 */

import type { IntelligencePattern } from "@/domain/intelligence-canon";

const CANON = "trust_tai_canon" as const;

function pattern(
  input: Omit<IntelligencePattern, "source" | "version" | "status"> &
    Partial<Pick<IntelligencePattern, "source" | "version" | "status">>,
): IntelligencePattern {
  return {
    source: CANON,
    version: 1,
    status: "active",
    ...input,
  };
}

export const INTELLIGENCE_PATTERNS: IntelligencePattern[] = [
  /* ------------------------------------------------------------- delivery */
  pattern({
    id: "delivery.ownership_ambiguity",
    domain: "delivery",
    name: "Ownership ambiguity",
    description: "A project is past its date while conversation about it continues.",
    mayMean: "Nobody holds the next step, so the work is discussed rather than moved.",
    triggers: [
      { observationKind: "project_delayed", looksFor: "A project past its expected date" },
      {
        observationKind: "activity_volume",
        looksFor: "Steady conversation this week",
        minMagnitude: 8,
        optional: true,
      },
      { observationKind: "open_decisions", looksFor: "Decisions still open", optional: true },
    ],
    negativeIndicators: [
      { observationKind: "project_blocked", looksFor: "A named blocker already recorded" },
    ],
    hypotheses: [
      "The next step has no named owner.",
      "Two people each believe the other is carrying it.",
      "The owner is named but has no authority to unblock it.",
    ],
    competingExplanations: [
      {
        explanation: "The date was never realistic.",
        distinguishedBy: "Whether the plan changed after the date was set.",
      },
      {
        explanation: "A dependency outside the team is holding it.",
        distinguishedBy: "Whether the last update names something external.",
      },
    ],
    evidenceToInspect: [
      {
        inspect: "Who is named on the current milestone in Projects",
        appId: "projects",
        wouldConfirm: "No owner, or an owner who has not touched it",
        wouldRefute: "A clear owner with recent movement",
      },
    ],
    confidenceCap: "moderate",
    chainId: "chain.project_late",
    possibleNextMoves: [{ move: "Name one owner for the next step", appId: "projects" }],
    verifyOutcomeBy: "The project shows movement within a week of an owner being named.",
  }),
  pattern({
    id: "delivery.hidden_blocker",
    domain: "delivery",
    name: "Work stalled near the end",
    description: "A project sits close to done for several days without moving.",
    mayMean: "Something is in the way, or done was never defined.",
    triggers: [
      { observationKind: "project_delayed", looksFor: "A project past its expected date" },
      { observationKind: "room_quiet", looksFor: "Projects has been quiet", optional: true },
    ],
    negativeIndicators: [
      { observationKind: "project_blocked", looksFor: "The blocker is already named" },
    ],
    hypotheses: [
      "A blocker exists but was never written down.",
      "Acceptance criteria were never agreed, so nobody can call it finished.",
      "The remaining work is larger than the last update suggested.",
    ],
    competingExplanations: [
      {
        explanation: "The team moved on to more urgent client work.",
        distinguishedBy: "Whether other projects moved in the same period.",
      },
    ],
    evidenceToInspect: [
      {
        inspect: "The last three updates on the project",
        appId: "projects",
        wouldConfirm: "Updates that repeat without a new step",
        wouldRefute: "Steady progress with a new step each time",
      },
      {
        inspect: "Whether acceptance criteria exist for this milestone",
        appId: "projects",
        wouldConfirm: "No written definition of done",
        wouldRefute: "Criteria written and agreed with the client",
      },
    ],
    confidenceCap: "moderate",
    chainId: "chain.project_late",
    possibleNextMoves: [
      { move: "Write down what finished means for this milestone", appId: "projects" },
    ],
    verifyOutcomeBy: "The milestone closes, or a real blocker is recorded within days.",
  }),
  pattern({
    id: "delivery.blocked_and_unaddressed",
    domain: "delivery",
    name: "Named blocker, nobody moving",
    description: "A blocker is recorded and the room has gone quiet around it.",
    mayMean: "The blocker needs a decision or an escalation that nobody has made.",
    triggers: [
      { observationKind: "project_blocked", looksFor: "A recorded blocker" },
      { observationKind: "room_quiet", looksFor: "Projects has been quiet", optional: true },
    ],
    negativeIndicators: [],
    hypotheses: [
      "The blocker needs a decision that sits with someone else.",
      "The person who could clear it does not know it exists.",
    ],
    competingExplanations: [
      {
        explanation: "The blocker was cleared but never closed in the record.",
        distinguishedBy: "Whether downstream work has continued.",
      },
    ],
    evidenceToInspect: [
      {
        inspect: "Who the blocker is waiting on",
        appId: "projects",
        wouldConfirm: "A person named with no reply",
        wouldRefute: "The blocker is already resolved",
      },
    ],
    confidenceCap: "moderate",
    chainId: "chain.project_late",
    possibleNextMoves: [
      { move: "Escalate the blocker to the person who can clear it", appId: "projects" },
    ],
    verifyOutcomeBy: "The blocker is closed, or an owner replies within two days.",
  }),
  pattern({
    id: "delivery.delay_cluster",
    domain: "delivery",
    name: "Several projects late at once",
    description: "More than one project is past its date in the same period.",
    mayMean: "This is a system condition rather than a project problem.",
    triggers: [
      {
        observationKind: "delivery_delay_count",
        looksFor: "Two or more late projects",
        minMagnitude: 2,
      },
    ],
    negativeIndicators: [],
    hypotheses: [
      "Capacity is committed beyond what the team can carry.",
      "One shared dependency is holding several pieces of work.",
      "Estimates are set the same way each time and are consistently short.",
    ],
    competingExplanations: [
      {
        explanation: "One client changed scope and pulled attention from the rest.",
        distinguishedBy: "Whether the late projects share a client.",
      },
    ],
    evidenceToInspect: [
      {
        inspect: "Whether the late projects share a client, a person or a dependency",
        appId: "projects",
        wouldConfirm: "A shared factor across the late work",
        wouldRefute: "Unrelated projects late for unrelated reasons",
      },
    ],
    confidenceCap: "moderate",
    chainId: "chain.capacity_or_clarity",
    possibleNextMoves: [
      { move: "Sequence the late work rather than running it in parallel", appId: "projects" },
    ],
    verifyOutcomeBy: "The count of late projects falls over the next two weeks.",
  }),
  pattern({
    id: "delivery.repeat_friction",
    domain: "delivery",
    name: "The same thing keeps going wrong",
    description: "A blocker of the same shape has appeared more than once.",
    mayMean: "A step in the way work is run is missing, not a person failing.",
    triggers: [
      {
        observationKind: "recurring_blocker",
        looksFor: "A blocker seen more than once",
        minMagnitude: 2,
      },
    ],
    negativeIndicators: [],
    hypotheses: ["A handover step is undefined.", "A dependency is discovered too late each time."],
    competingExplanations: [
      {
        explanation: "Two unrelated blockers were described in similar words.",
        distinguishedBy: "Whether the projects and people involved differ.",
      },
    ],
    evidenceToInspect: [
      {
        inspect: "The two most recent occurrences side by side",
        appId: "projects",
        wouldConfirm: "The same step failing in both",
        wouldRefute: "Different causes with similar wording",
      },
    ],
    confidenceCap: "moderate",
    possibleNextMoves: [{ move: "Change the step that keeps failing", appId: "projects" }],
    verifyOutcomeBy: "The blocker does not appear again in the next cycle.",
  }),
  pattern({
    id: "delivery.repeated_manual_workflow",
    domain: "delivery",
    name: "The same manual work across projects",
    description: "The same remembered work keeps recurring across delivery.",
    mayMean: "There is an internal system worth building, not more effort to spend.",
    triggers: [
      {
        observationKind: "memory_recurring_work",
        looksFor: "Work the workspace has seen repeat",
        minMagnitude: 3,
      },
      {
        observationKind: "open_projects",
        looksFor: "More than one project open",
        minMagnitude: 2,
        optional: true,
      },
    ],
    negativeIndicators: [],
    hypotheses: [
      "A repeated step could be templated or automated.",
      "One person is the only route for a routine task.",
    ],
    competingExplanations: [
      {
        explanation: "The repetition is client specific and not worth generalising.",
        distinguishedBy: "Whether the same shape appears for more than one client.",
      },
    ],
    evidenceToInspect: [
      {
        inspect: "How long the repeated step takes each time",
        appId: "projects",
        wouldConfirm: "Meaningful time spent on every run",
        wouldRefute: "A few minutes, rarely",
      },
    ],
    confidenceCap: "low",
    possibleNextMoves: [
      { move: "Write the repeated step down as a template first", appId: "projects" },
    ],
    verifyOutcomeBy: "The work stops appearing as remembered work.",
  }),

  /* --------------------------------------------------------------- client */
  pattern({
    id: "client.expectation_mismatch",
    domain: "client",
    name: "Expectation mismatch",
    description: "Work has been delivered while the relationship has gone flat.",
    mayMean: "What was delivered and what was expected are not the same thing.",
    triggers: [
      { observationKind: "relationship_silent", looksFor: "A client relationship gone quiet" },
      {
        observationKind: "open_projects",
        looksFor: "Work in flight for that client",
        optional: true,
      },
    ],
    negativeIndicators: [],
    hypotheses: [
      "Acceptance criteria were never agreed in writing.",
      "The client expected something outside the stated scope.",
      "The result is fine and the client is simply busy.",
    ],
    competingExplanations: [
      {
        explanation: "Normal quiet between phases.",
        distinguishedBy: "Whether the last exchange ended on an open question.",
      },
    ],
    evidenceToInspect: [
      {
        inspect: "The last message thread with this client",
        appId: "comms",
        wouldConfirm: "An unanswered concern or a question left hanging",
        wouldRefute: "A clean, closed exchange",
      },
    ],
    confidenceCap: "moderate",
    chainId: "chain.client_unhappy",
    possibleNextMoves: [
      { move: "Ask the client directly what good looks like now", appId: "comms" },
    ],
    verifyOutcomeBy: "The client replies and the next milestone is agreed in writing.",
  }),
  pattern({
    id: "client.reply_debt",
    domain: "client",
    name: "Reply debt",
    description: "Messages are waiting on us.",
    mayMean: "Trust is being spent quietly while replies sit.",
    triggers: [
      { observationKind: "reply_debt", looksFor: "Threads waiting on a reply", minMagnitude: 1 },
    ],
    negativeIndicators: [],
    hypotheses: ["The reply needs a decision nobody has made.", "The thread has no owner."],
    competingExplanations: [
      {
        explanation: "The reply was sent outside the connected inbox.",
        distinguishedBy: "Whether the client responded elsewhere.",
      },
    ],
    evidenceToInspect: [
      {
        inspect: "The oldest waiting thread",
        appId: "comms",
        wouldConfirm: "A direct question from the client with no answer",
        wouldRefute: "An informational message needing nothing",
      },
    ],
    confidenceCap: "moderate",
    chainId: "chain.client_unhappy",
    possibleNextMoves: [{ move: "Answer the oldest waiting thread", appId: "comms" }],
    verifyOutcomeBy: "Reply debt falls to zero and stays there for a week.",
  }),
  pattern({
    id: "client.status_question_loop",
    domain: "client",
    name: "Repeated status questions",
    description: "A client keeps asking where things stand.",
    mayMean: "Confidence is thinning because progress is not visible to them.",
    triggers: [
      /*
       * Reply debt alone is already its own pattern. This shape only earns a
       * separate reading when the client is waiting while work is also past
       * its date, which is what makes progress invisible to them.
       */
      { observationKind: "reply_debt", looksFor: "Threads waiting on us", minMagnitude: 1 },
      { observationKind: "project_delayed", looksFor: "Work past its date" },
      {
        observationKind: "activity_volume",
        looksFor: "Regular conversation",
        minMagnitude: 5,
        optional: true,
      },
    ],

    negativeIndicators: [],
    hypotheses: [
      "There is no regular update the client can rely on.",
      "The last date given has passed without a new one.",
    ],
    competingExplanations: [
      {
        explanation: "One person on the client side is out of the loop internally.",
        distinguishedBy: "Whether the questions come from the same person each time.",
      },
    ],
    evidenceToInspect: [
      {
        inspect: "How many times status was asked in the last month",
        appId: "comms",
        wouldConfirm: "The same question more than twice",
        wouldRefute: "A single check-in",
      },
    ],
    confidenceCap: "low",
    chainId: "chain.client_unhappy",
    possibleNextMoves: [{ move: "Agree a standing update the client can expect", appId: "comms" }],
    verifyOutcomeBy: "Status questions stop arriving between updates.",
  }),
  pattern({
    id: "client.scope_drift",
    domain: "client",
    name: "Scope drifting without a change",
    description: "Work keeps being revised while the agreement has not moved.",
    mayMean: "Acceptance criteria are weak, or scope is growing without being named.",
    triggers: [
      { observationKind: "project_delayed", looksFor: "Work past its date" },
      {
        observationKind: "activity_volume",
        looksFor: "Heavy conversation this week",
        minMagnitude: 12,
        optional: true,
      },
    ],
    negativeIndicators: [
      { observationKind: "memory_decided", looksFor: "A recorded scope decision" },
    ],
    hypotheses: [
      "Each round adds work that was never agreed.",
      "Nobody wrote down what would end the revisions.",
    ],
    competingExplanations: [
      {
        explanation: "Quality genuinely missed the brief the first time.",
        distinguishedBy: "Whether the revisions repeat the same point or add new ones.",
      },
    ],
    evidenceToInspect: [
      {
        inspect: "Whether a change was ever agreed in writing",
        appId: "comms",
        wouldConfirm: "New asks with no written change",
        wouldRefute: "An agreed and priced change",
      },
    ],
    confidenceCap: "moderate",
    chainId: "chain.client_unhappy",
    possibleNextMoves: [
      { move: "Name the change and agree it before the next round", appId: "comms" },
    ],
    verifyOutcomeBy: "The next round closes without new scope appearing.",
  }),
  pattern({
    id: "client.relationship_drift",
    domain: "client",
    name: "A relationship going quiet",
    description: "A client we used to speak with regularly has gone silent.",
    mayMean: "The relationship is cooling before anyone has said so.",
    triggers: [
      {
        observationKind: "relationship_silent",
        looksFor: "No contact for a long stretch",
        minMagnitude: 1,
      },
    ],
    negativeIndicators: [],
    hypotheses: [
      "The work finished and nothing followed it.",
      "Something went wrong that was never raised.",
    ],
    competingExplanations: [
      {
        explanation: "Their side is between budget cycles.",
        distinguishedBy: "Whether the last exchange mentioned timing.",
      },
    ],
    evidenceToInspect: [
      {
        inspect: "How the last conversation ended",
        appId: "comms",
        wouldConfirm: "An open thread nobody closed",
        wouldRefute: "A clean ending with a date to reconnect",
      },
    ],
    confidenceCap: "moderate",
    possibleNextMoves: [
      { move: "Reopen the thread with something useful, not a check-in", appId: "comms" },
    ],
    verifyOutcomeBy: "The client replies within a week.",
  }),

  /* --------------------------------------------------------------- founder */
  pattern({
    id: "founder.held_context",
    domain: "founder",
    name: "Founder-held context",
    description: "Decisions and work keep returning to one person while the team has room.",
    mayMean: "Context lives with the founder rather than in the work.",
    triggers: [
      {
        observationKind: "open_decisions",
        looksFor: "Decisions waiting on one person",
        minMagnitude: 2,
      },
      {
        observationKind: "commitment_overdue",
        looksFor: "Promises past their date",
        optional: true,
      },
      {
        observationKind: "memory_recurring_work",
        looksFor: "The same work returning to the same person",
        optional: true,
      },
    ],
    negativeIndicators: [],
    hypotheses: [
      "Only one person holds the context needed to decide.",
      "Delegation exists in name but not in authority.",
    ],
    competingExplanations: [
      {
        explanation:
          "Acceptance criteria are unclear, so work returns for judgment rather than for context.",
        distinguishedBy: "Whether the returned work shares a definition-of-done gap.",
      },
      {
        explanation: "The team is at capacity and has nowhere to put the work.",
        distinguishedBy: "Whether open projects per person is high.",
      },
    ],
    evidenceToInspect: [
      {
        inspect: "The last three pieces of work that came back to the founder",
        appId: "steward",
        wouldConfirm: "Each needed knowledge only the founder held",
        wouldRefute: "Each needed a decision the founder alone could authorise",
      },
      {
        inspect: "Team utilisation over the same period",
        appId: "projects",
        wouldConfirm: "Available capacity alongside the returned work",
        wouldRefute: "A team already fully committed",
      },
    ],
    confidenceCap: "moderate",
    chainId: "chain.founder_bottleneck",
    possibleNextMoves: [
      { move: "Write down the context behind one recurring decision", appId: "steward" },
    ],
    verifyOutcomeBy: "The same decision is made without the founder next time.",
  }),
  pattern({
    id: "founder.decision_bottleneck",
    domain: "founder",
    name: "Decisions queueing at one desk",
    description: "Several decisions are open at once and the rooms around them are quiet.",
    mayMean: "Work is waiting on a decision rather than on effort.",
    triggers: [
      { observationKind: "open_decisions", looksFor: "Open decisions", minMagnitude: 3 },
      {
        observationKind: "roadmap_direction_undecided",
        looksFor: "Direction still undecided",
        optional: true,
      },
    ],
    negativeIndicators: [],
    hypotheses: [
      "The decisions need information nobody has gathered.",
      "The decisions are being deferred because their consequences are unclear.",
    ],
    competingExplanations: [
      {
        explanation: "The decisions are already made and simply not recorded.",
        distinguishedBy: "Whether downstream work has already moved.",
      },
    ],
    evidenceToInspect: [
      {
        inspect: "What each open decision is actually waiting for",
        appId: "roadmap",
        wouldConfirm: "Missing information or unclear consequence",
        wouldRefute: "A date already set to decide",
      },
    ],
    confidenceCap: "moderate",
    chainId: "chain.founder_bottleneck",
    possibleNextMoves: [
      { move: "Decide the oldest open decision, or say what it waits on", appId: "roadmap" },
    ],
    verifyOutcomeBy: "Open decisions fall and the rooms downstream move again.",
  }),
  pattern({
    id: "founder.busy_but_slow",
    domain: "founder",
    name: "Busy but not moving",
    description: "Plenty of activity this week alongside work that has not progressed.",
    mayMean: "Effort is going somewhere other than the work that matters.",
    triggers: [
      { observationKind: "activity_volume", looksFor: "High activity this week", minMagnitude: 15 },
      {
        observationKind: "delivery_delay_count",
        looksFor: "Late delivery at the same time",
        minMagnitude: 1,
      },
    ],
    negativeIndicators: [],
    hypotheses: [
      "Attention is split across too many parallel pieces.",
      "Coordination is consuming the time the work needed.",
    ],
    competingExplanations: [
      {
        explanation: "The activity belongs to a different, healthy stream of work.",
        distinguishedBy: "Which rooms the activity came from.",
      },
    ],
    evidenceToInspect: [
      {
        inspect: "Which rooms this week's activity came from",
        appId: "activity",
        wouldConfirm: "Most activity outside the late work",
        wouldRefute: "Activity concentrated on the late work",
      },
    ],
    confidenceCap: "low",
    chainId: "chain.busy_but_slow",
    possibleNextMoves: [
      { move: "Pick the one piece of work that finishes first", appId: "projects" },
    ],
    verifyOutcomeBy: "One late project closes without new work being started.",
  }),

  /* -------------------------------------------------------------- pipeline */
  pattern({
    id: "pipeline.qualified_not_moving",
    domain: "pipeline",
    name: "Good fits sitting unreviewed",
    description: "Strong-fit companies are waiting and nothing has been decided.",
    mayMean: "The pipeline is being fed faster than it is being worked.",
    triggers: [
      {
        observationKind: "strong_fit_unreviewed",
        looksFor: "Strong fits with no decision",
        minMagnitude: 1,
      },
    ],
    negativeIndicators: [],
    hypotheses: [
      "Nobody owns the first move on a new prospect.",
      "Deciding takes longer than expected because evidence is thin.",
    ],
    competingExplanations: [
      {
        explanation: "The fit score is generous and these are not really strong fits.",
        distinguishedBy: "Whether the evidence behind the score is observed or stated.",
      },
    ],
    evidenceToInspect: [
      {
        inspect: "The evidence behind the top unreviewed company",
        appId: "scout",
        wouldConfirm: "Enough to decide already present",
        wouldRefute: "Thin evidence that needs research first",
      },
    ],
    confidenceCap: "moderate",
    chainId: "chain.prospect_not_moving",
    possibleNextMoves: [{ move: "Decide the oldest strong fit", appId: "scout" }],
    verifyOutcomeBy: "The count of unreviewed strong fits falls to zero.",
  }),
  pattern({
    id: "pipeline.unrouted_qualified",
    domain: "pipeline",
    name: "Qualified but never handed over",
    description: "Companies are ready for a conversation and no conversation started.",
    mayMean: "The handover between Scout and Comms is not happening.",
    triggers: [
      {
        observationKind: "pipeline_unrouted",
        looksFor: "Qualified companies not routed",
        minMagnitude: 1,
      },
    ],
    negativeIndicators: [],
    hypotheses: [
      "The handover is manual and gets forgotten.",
      "Nobody is sure who opens the conversation.",
    ],
    competingExplanations: [
      {
        explanation: "The conversation started outside the connected inbox.",
        distinguishedBy: "Whether a relationship exists for the company.",
      },
    ],
    evidenceToInspect: [
      {
        inspect: "Whether a relationship already exists for those companies",
        appId: "comms",
        wouldConfirm: "No relationship record at all",
        wouldRefute: "A live thread already running",
      },
    ],
    confidenceCap: "moderate",
    chainId: "chain.prospect_not_moving",
    possibleNextMoves: [{ move: "Hand the qualified company to Comms", appId: "scout" }],
    verifyOutcomeBy: "A relationship is created and a first message goes out.",
  }),
  pattern({
    id: "pipeline.sourcing_stalled",
    domain: "pipeline",
    name: "Nothing new coming in",
    description: "Sourcing has not run for a while and the pipeline is thin.",
    mayMean: "Today looks fine and next quarter does not.",
    triggers: [
      { observationKind: "pipeline_sourcing_stale", looksFor: "No recent sourcing" },
      { observationKind: "pipeline_volume", looksFor: "A small pipeline", optional: true },
    ],
    negativeIndicators: [
      { observationKind: "inbound_volume", looksFor: "Inbound arriving instead", minMagnitude: 3 },
    ],
    hypotheses: [
      "Delivery work has crowded out sourcing.",
      "The current ICP is not producing candidates worth reviewing.",
    ],
    competingExplanations: [
      {
        explanation: "Inbound is carrying the pipeline instead.",
        distinguishedBy: "Whether inbound volume is healthy over the same period.",
      },
    ],
    evidenceToInspect: [
      {
        inspect: "When sourcing last ran and what it returned",
        appId: "scout",
        wouldConfirm: "A long gap, or poor candidates",
        wouldRefute: "Recent sourcing with usable results",
      },
    ],
    confidenceCap: "moderate",
    possibleNextMoves: [
      { move: "Run one bounded sourcing pass against the current ICP", appId: "scout" },
    ],
    verifyOutcomeBy: "New candidates appear and at least one is reviewed.",
  }),
  pattern({
    id: "pipeline.healthy_volume_no_conversion",
    domain: "pipeline",
    name: "Full pipeline, nothing closing",
    description: "There are plenty of companies and little movement out of the pipeline.",
    mayMean: "Qualification, positioning, pricing or follow-up is where it stops.",
    triggers: [
      {
        observationKind: "pipeline_volume",
        looksFor: "A pipeline with real volume",
        minMagnitude: 8,
      },
      {
        observationKind: "pipeline_unrouted",
        looksFor: "Qualified work not handed over",
        optional: true,
      },
      { observationKind: "reply_debt", looksFor: "Conversations waiting on us", optional: true },
    ],
    negativeIndicators: [],
    hypotheses: [
      "Qualification is letting through companies that were never going to buy.",
      "Follow-up stops after the first message.",
      "Positioning is not landing with this audience.",
    ],
    competingExplanations: [
      {
        explanation: "The cycle for this audience is simply longer than the window looked at.",
        distinguishedBy: "How long the oldest live conversation has been running.",
      },
    ],
    evidenceToInspect: [
      {
        inspect: "Where companies stop in the pipeline",
        appId: "scout",
        wouldConfirm: "A single stage where most stop",
        wouldRefute: "Even attrition across stages",
      },
      {
        inspect: "How many follow-ups each conversation received",
        appId: "comms",
        wouldConfirm: "One message and no follow-up",
        wouldRefute: "Sustained, answered conversations",
      },
    ],
    confidenceCap: "low",
    chainId: "chain.prospect_not_moving",
    possibleNextMoves: [{ move: "Look at the stage most companies stop at", appId: "scout" }],
    verifyOutcomeBy: "Movement appears at the stage that was changed.",
  }),

  /* --------------------------------------------------------------- roadmap */
  pattern({
    id: "roadmap.direction_undecided",
    domain: "roadmap",
    name: "Direction still open",
    description: "A roadmap decision has been waiting while work continues around it.",
    mayMean: "Work is being done that the decision could invalidate.",
    triggers: [
      { observationKind: "roadmap_direction_undecided", looksFor: "An open direction decision" },
      { observationKind: "open_projects", looksFor: "Projects running meanwhile", optional: true },
    ],
    negativeIndicators: [],
    hypotheses: [
      "The decision needs evidence nobody has gathered.",
      "The consequences of each option are not written down.",
    ],
    competingExplanations: [
      {
        explanation: "The decision is deliberately being held until a client answers.",
        distinguishedBy: "Whether a dependency is named on the decision.",
      },
    ],
    evidenceToInspect: [
      {
        inspect: "What the decision is waiting on",
        appId: "roadmap",
        wouldConfirm: "Nothing recorded as pending",
        wouldRefute: "A named external dependency",
      },
    ],
    confidenceCap: "moderate",
    chainId: "chain.roadmap_stalled",
    possibleNextMoves: [{ move: "Decide, or record what the decision waits on", appId: "roadmap" }],
    verifyOutcomeBy: "The decision is recorded and downstream work follows it.",
  }),
  pattern({
    id: "roadmap.milestone_stalled",
    domain: "roadmap",
    name: "A roadmap that stopped moving",
    description: "A roadmap has not changed for a long stretch.",
    mayMean: "It stopped being the plan people work from.",
    triggers: [{ observationKind: "roadmap_stale", looksFor: "A roadmap untouched for weeks" }],
    negativeIndicators: [],
    hypotheses: [
      "The plan was overtaken by client work and never updated.",
      "The next milestone depends on a decision that is still open.",
    ],
    competingExplanations: [
      {
        explanation: "The roadmap is finished and nobody closed it.",
        distinguishedBy: "Whether the final stage is complete.",
      },
    ],
    evidenceToInspect: [
      {
        inspect: "The next unfinished stage and its dependency",
        appId: "roadmap",
        wouldConfirm: "A stage blocked on something named",
        wouldRefute: "All stages complete",
      },
    ],
    confidenceCap: "moderate",
    chainId: "chain.roadmap_stalled",
    possibleNextMoves: [
      { move: "Restate the next milestone, or close the roadmap", appId: "roadmap" },
    ],
    verifyOutcomeBy: "The roadmap moves within a week, or is honestly closed.",
  }),

  /* --------------------------------------------------------------- website */
  pattern({
    id: "website.inbound_unworked",
    domain: "website",
    name: "Inbound arriving faster than it is worked",
    description: "Intakes have come in and are still waiting for a decision.",
    mayMean: "The warmest demand we have is going cold.",
    triggers: [
      { observationKind: "inbound_volume", looksFor: "Intakes received", minMagnitude: 1 },
      {
        observationKind: "strong_fit_unreviewed",
        looksFor: "Companies waiting on a decision",
        optional: true,
      },
    ],
    negativeIndicators: [],
    hypotheses: [
      "Nobody owns the first response to an intake.",
      "Intakes arrive without enough for anyone to decide on.",
    ],
    competingExplanations: [
      {
        explanation: "The intakes were answered outside the connected inbox.",
        distinguishedBy: "Whether a relationship exists for the company.",
      },
    ],
    evidenceToInspect: [
      {
        inspect: "The oldest waiting intake and what the founder actually asked for",
        appId: "website",
        wouldConfirm: "A clear ask with no answer",
        wouldRefute: "An incomplete submission with no contact",
      },
    ],
    confidenceCap: "moderate",
    chainId: "chain.website_no_opportunities",
    possibleNextMoves: [{ move: "Decide the oldest inbound company", appId: "scout" }],
    verifyOutcomeBy: "Every intake older than two days has a decision.",
  }),
  pattern({
    id: "website.start_high_finish_low",
    domain: "website",
    name: "Conversations start and do not finish",
    description: "Intakes begin but arrive incomplete.",
    mayMean: "Something in the sequence costs more trust than it earns.",
    triggers: [
      { observationKind: "inbound_volume", looksFor: "Intakes arriving", minMagnitude: 2 },
    ],
    negativeIndicators: [],
    hypotheses: [
      "A question is asked before enough trust exists to answer it.",
      "The sequence is longer than the visitor expected.",
    ],
    competingExplanations: [
      {
        explanation: "The traffic is not the audience the questions were written for.",
        distinguishedBy: "Whether completion differs by where the visitor came from.",
      },
    ],
    evidenceToInspect: [
      {
        inspect: "Which question the incomplete intakes stop at",
        appId: "website",
        wouldConfirm: "A single question most people stop at",
        wouldRefute: "Even drop-off across all questions",
      },
      {
        inspect: "Visitor sessions and where they came from",
        appId: "website",
        wouldConfirm: "Steady arrivals with few starts",
        wouldRefute: "Very few visitors at all",
      },
    ],
    confidenceCap: "low",
    chainId: "chain.website_no_opportunities",
    possibleNextMoves: [
      { move: "Look at the question people stop at before changing anything", appId: "website" },
    ],
    verifyOutcomeBy: "Completed intakes rise without traffic changing.",
  }),
  pattern({
    id: "website.repeated_founder_pain",
    domain: "website",
    name: "The same pain, said again and again",
    description: "Founders arriving through the site keep describing the same problem.",
    mayMean: "There is something worth publishing about it, in our own words.",
    triggers: [
      { observationKind: "inbound_volume", looksFor: "Several intakes", minMagnitude: 3 },
      {
        observationKind: "memory_recurring_work",
        looksFor: "The same theme recurring",
        optional: true,
      },
    ],
    negativeIndicators: [],
    hypotheses: [
      "One problem is common enough to write about directly.",
      "Our current words do not name the problem people arrive with.",
    ],
    competingExplanations: [
      {
        explanation: "The similarity comes from the question we asked, not from them.",
        distinguishedBy: "Whether the phrasing appears in free text or in a prompted answer.",
      },
    ],
    evidenceToInspect: [
      {
        inspect: "The verbatim answers across recent intakes",
        appId: "website",
        wouldConfirm: "The same problem in their own words",
        wouldRefute: "Different problems described in our wording",
      },
    ],
    confidenceCap: "low",
    possibleNextMoves: [
      { move: "Note the recurring theme for Studio to consider", appId: "studio" },
    ],
    verifyOutcomeBy: "New intakes reference the published piece, or say the problem differently.",
  }),

  /* ----------------------------------------------------------- commitments */
  pattern({
    id: "commitments.promises_slipping",
    domain: "commitments",
    name: "Promises past their date",
    description: "Things we said we would do are overdue.",
    mayMean: "Follow-through is slipping before anyone has noticed.",
    triggers: [
      { observationKind: "commitment_overdue", looksFor: "Overdue promises", minMagnitude: 1 },
    ],
    negativeIndicators: [],
    hypotheses: [
      "The promise was made without the time to keep it.",
      "The promise was kept but never closed in the record.",
    ],
    competingExplanations: [
      {
        explanation: "The other side moved the date and it was not recorded.",
        distinguishedBy: "Whether the last exchange mentions a new date.",
      },
    ],
    evidenceToInspect: [
      {
        inspect: "The oldest overdue promise and who it was made to",
        appId: "steward",
        wouldConfirm: "A promise to a client with no follow-up",
        wouldRefute: "An internal note already handled",
      },
    ],
    confidenceCap: "moderate",
    possibleNextMoves: [{ move: "Close or renegotiate the oldest promise", appId: "steward" }],
    verifyOutcomeBy: "Overdue promises fall to zero.",
  }),
  pattern({
    id: "commitments.unanswered_question_loop",
    domain: "commitments",
    name: "The same question keeps being asked",
    description: "A question recurs across conversations without a settled answer.",
    mayMean: "Something is missing from how we write things down, not from the people asking.",
    triggers: [
      {
        observationKind: "memory_recurring_work",
        looksFor: "A recurring theme in memory",
        minMagnitude: 3,
      },
      { observationKind: "reply_debt", looksFor: "Threads waiting on us", optional: true },
    ],
    negativeIndicators: [
      { observationKind: "memory_decided", looksFor: "A settled decision on the same theme" },
    ],
    hypotheses: [
      "The answer exists but lives in one person's head.",
      "The answer changes each time because nobody decided it.",
    ],
    competingExplanations: [
      {
        explanation: "Different people are asking slightly different questions.",
        distinguishedBy: "Whether the asks share the same underlying decision.",
      },
    ],
    evidenceToInspect: [
      {
        inspect: "The last three times the question came up",
        appId: "steward",
        wouldConfirm: "The same answer given from memory each time",
        wouldRefute: "Genuinely different questions",
      },
    ],
    confidenceCap: "moderate",
    possibleNextMoves: [
      { move: "Write the answer down once, where people look", appId: "steward" },
    ],
    verifyOutcomeBy: "The question stops recurring in new conversations.",
  }),

  /* ------------------------------------------------------- business health */
  pattern({
    id: "health.no_work_no_pipeline",
    domain: "business_health",
    name: "Nothing running and nothing coming",
    description: "No project is open and the pipeline is thin.",
    mayMean: "The next quarter is being decided by this week's silence.",
    triggers: [
      { observationKind: "no_active_project", looksFor: "No open project" },
      { observationKind: "pipeline_volume", looksFor: "A small pipeline", optional: true },
      {
        observationKind: "pipeline_sourcing_stale",
        looksFor: "No recent sourcing",
        optional: true,
      },
    ],
    negativeIndicators: [{ observationKind: "open_projects", looksFor: "Projects already open" }],
    hypotheses: [
      "Delivery finished and nothing was lined up behind it.",
      "Work is happening outside the rooms that record it.",
    ],
    competingExplanations: [
      {
        explanation: "Projects are being run somewhere the suite cannot see.",
        distinguishedBy: "Whether activity exists without project records.",
      },
    ],
    evidenceToInspect: [
      {
        inspect: "Whether recent activity points at unrecorded work",
        appId: "activity",
        wouldConfirm: "Delivery conversation with no project record",
        wouldRefute: "Genuine quiet across every room",
      },
    ],
    confidenceCap: "moderate",
    possibleNextMoves: [{ move: "Put one bounded sourcing pass in the calendar", appId: "scout" }],
    verifyOutcomeBy: "A project opens, or the pipeline grows within two weeks.",
  }),
  pattern({
    id: "health.room_gone_quiet",
    domain: "business_health",
    name: "A room has gone quiet",
    description: "One room has recorded nothing for a long stretch while others move.",
    mayMean: "Either the work stopped, or it stopped being recorded.",
    triggers: [
      { observationKind: "room_quiet", looksFor: "A room with no recent activity" },
      {
        observationKind: "activity_volume",
        looksFor: "Activity elsewhere",
        minMagnitude: 5,
        optional: true,
      },
    ],
    negativeIndicators: [],
    hypotheses: [
      "The work moved outside the suite.",
      "That part of the business genuinely paused.",
    ],
    competingExplanations: [
      {
        explanation: "The room's connection stopped reporting.",
        distinguishedBy: "Whether the room was withheld from the read.",
      },
    ],
    evidenceToInspect: [
      {
        inspect: "The last thing recorded in that room",
        appId: "activity",
        wouldConfirm: "A clean stop with no follow-up",
        wouldRefute: "A connection problem rather than a work problem",
      },
    ],
    confidenceCap: "low",
    chainId: "chain.quietly_worse",
    possibleNextMoves: [
      { move: "Check whether the room's work moved elsewhere", appId: "activity" },
    ],
    verifyOutcomeBy: "The room records something, or is honestly parked.",
  }),
  pattern({
    id: "health.ops_signal_unattended",
    domain: "business_health",
    name: "Technical signals left open",
    description: "Ops has open signals nobody has picked up.",
    mayMean: "A small technical problem is being allowed to become a client problem.",
    triggers: [
      { observationKind: "ops_open_signal", looksFor: "Open Ops signals", minMagnitude: 1 },
    ],
    negativeIndicators: [],
    hypotheses: [
      "Nobody owns triage for Ops signals.",
      "The signal is noise and should be turned off.",
    ],
    competingExplanations: [
      {
        explanation: "The signal was handled in Ops and not closed here.",
        distinguishedBy: "Whether Ops shows recent movement on it.",
      },
    ],
    evidenceToInspect: [
      {
        inspect: "The oldest open signal and what it affects",
        appId: "ops",
        wouldConfirm: "Something client facing still open",
        wouldRefute: "An internal warning already handled",
      },
    ],
    confidenceCap: "moderate",
    possibleNextMoves: [{ move: "Triage the oldest open Ops signal", appId: "ops" }],
    verifyOutcomeBy: "Open Ops signals fall and stay down.",
  }),
  pattern({
    id: "health.attention_thin_spread",
    domain: "business_health",
    name: "Attention spread thin",
    description: "Several rooms each hold something waiting, and none of it is moving.",
    mayMean: "Everything is started and nothing is finishing.",
    triggers: [
      { observationKind: "open_decisions", looksFor: "Open decisions", minMagnitude: 2 },
      { observationKind: "reply_debt", looksFor: "Threads waiting on us", minMagnitude: 1 },
      { observationKind: "delivery_delay_count", looksFor: "Late delivery", minMagnitude: 1 },
    ],
    negativeIndicators: [],
    hypotheses: ["Too many things are in flight at once.", "There is no agreed order of work."],
    competingExplanations: [
      {
        explanation: "One underlying blocker is causing all three.",
        distinguishedBy: "Whether the waiting items share a client or a decision.",
      },
    ],
    evidenceToInspect: [
      {
        inspect: "Whether the waiting items share a client or a decision",
        appId: "activity",
        wouldConfirm: "Unrelated items each waiting",
        wouldRefute: "One shared cause",
      },
    ],
    confidenceCap: "low",
    chainId: "chain.attention_today",
    possibleNextMoves: [
      { move: "Finish one thing before starting anything else", appId: "conductor" },
    ],
    verifyOutcomeBy: "One waiting item closes without a new one opening.",
  }),
];

export function patternById(id: string): IntelligencePattern | undefined {
  return INTELLIGENCE_PATTERNS.find((entry) => entry.id === id);
}

export function activePatterns(): IntelligencePattern[] {
  return INTELLIGENCE_PATTERNS.filter((entry) => entry.status === "active");
}

/**
 * MOCKUP FIXTURES — Pulse Next.
 *
 * Illustrative data only. Nothing here is read from the suite, no service is
 * called, and no production type is imported. It exists purely so the isolated
 * `/mockups/pulse-next` prototype can be judged as an experience.
 */

export type DemoRoom = "Comms" | "Scout" | "Roadmap" | "Projects" | "Studio" | "Ops" | "Steward";

export type DemoSeverity = "act_now" | "evaluate" | "watch_closely" | "good_to_know";

export interface DemoQueueItem {
  id: string;
  /** What needs Tai, said as a claim rather than a metric. */
  headline: string;
  /** Why now, and what happens if it is ignored. */
  implication: string;
  consequence: string;
  room: DemoRoom;
  entity: string;
  action: string;
  leverage: "Highest leverage" | "High leverage" | "Time-bound";
  age: string;
}

export const DEMO_QUEUE: DemoQueueItem[] = [
  {
    id: "q-replies",
    headline: "Six replies are older than your own response promise",
    implication:
      "Two are from clients who already asked twice. Response debt is compounding faster than new outbound can offset.",
    consequence: "Left another week, these become trust conversations rather than work conversations.",
    room: "Comms",
    entity: "Spartan Security, Mental Dental, 4 others",
    action: "Open replies",
    leverage: "Highest leverage",
    age: "Oldest 6 days",
  },
  {
    id: "q-approval",
    headline: "Three intros are written and waiting on your approval",
    implication:
      "Scout drafted these in your voice against qualified companies. Nothing leaves until you say so.",
    consequence: "The window on two of them closes once their current search project ships.",
    room: "Scout",
    entity: "Kestrel Dental, Northline Legal, Harbor Ortho",
    action: "Review drafts",
    leverage: "High leverage",
    age: "2 days waiting",
  },
  {
    id: "q-promise",
    headline: "Houston visibility work will miss its promised date",
    implication:
      "Access to the Google Business Profile has been outstanding for nine days, so the build cannot continue.",
    consequence: "The client hears about the slip from the calendar instead of from you.",
    room: "Projects",
    entity: "Spartan Security › Houston Search Visibility",
    action: "Resolve blocker",
    leverage: "Time-bound",
    age: "9 days blocked",
  },
  {
    id: "q-prospect",
    headline: "A strong-fit company has sat unclaimed for two weeks",
    implication:
      "Kestrel Dental matched on every ICP criterion you set, and no person in the business owns the relationship.",
    consequence: "A qualified company quietly ages out of relevance without anyone deciding to pass.",
    room: "Scout",
    entity: "Kestrel Dental, Austin",
    action: "Assign owner",
    leverage: "High leverage",
    age: "14 days",
  },
];

export interface DemoMetric {
  label: string;
  value: string;
  /** One short line of interpretation, not a restatement of the number. */
  read: string;
  /** True when the source could not be read at all. Unknown is never zero. */
  unknown?: boolean;
}

export const DEMO_BUSINESS: DemoMetric[] = [
  {
    label: "Recurring revenue",
    value: "$18,400",
    read: "Up one client since August. Two renewals decide the next step.",
  },
  {
    label: "Run clients",
    value: "17 of 20",
    read: "Capacity exists. Delivery, not demand, is the current constraint.",
  },
  {
    label: "First touches this week",
    value: "6 of 12",
    read: "Half the week's outreach is unsent, and three drafts are waiting on you.",
  },
  {
    label: "Client value ledger",
    value: "Unreadable",
    read: "The source has not been readable since Tuesday. This is unknown, not zero.",
    unknown: true,
  },
];

export interface DemoSignal {
  id: string;
  severity: DemoSeverity;
  /** The observed fact, stated without interpretation. */
  observed: string;
  /** Pulse's reading of that fact, clearly separate from the fact. */
  read: string;
  room: DemoRoom;
  entity: string;
  action: string;
}

export const DEMO_SIGNALS: DemoSignal[] = [
  {
    id: "s-1",
    severity: "act_now",
    observed: "Two client threads have had no reply for six and five days.",
    read: "Both clients are mid-delivery, so silence reads as a delivery problem.",
    room: "Comms",
    entity: "Spartan Security, Mental Dental",
    action: "Open replies",
  },
  {
    id: "s-2",
    severity: "act_now",
    observed: "One project has been blocked on an access request for nine days.",
    read: "The promised date cannot hold unless access lands this week.",
    room: "Projects",
    entity: "Houston Search Visibility",
    action: "Resolve blocker",
  },
  {
    id: "s-3",
    severity: "evaluate",
    observed: "A roadmap milestone has no agreed destination recorded.",
    read: "Work can start, but nobody will be able to say whether it worked.",
    room: "Roadmap",
    entity: "Mental Dental › Patient intake",
    action: "Write the destination",
  },
  {
    id: "s-4",
    severity: "evaluate",
    observed: "Three qualified companies have no named owner.",
    read: "Fit was decided, ownership was not. That gap is where pipeline leaks.",
    room: "Scout",
    entity: "Kestrel, Northline, Harbor",
    action: "Assign owners",
  },
  {
    id: "s-5",
    severity: "evaluate",
    observed: "Two proposals have been open longer than your usual close window.",
    read: "Neither has a next contact date, so they will drift unless you set one.",
    room: "Comms",
    entity: "Northline Legal, Harbor Ortho",
    action: "Set next contact",
  },
  {
    id: "s-6",
    severity: "watch_closely",
    observed: "LinkedIn invitations are running at 8 a day against a 10 a day ceiling.",
    read: "Nothing is wrong yet. Another quiet week would show in next month's pipeline.",
    room: "Scout",
    entity: "Outreach volume",
    action: "Open outreach",
  },
  {
    id: "s-7",
    severity: "watch_closely",
    observed: "No article has been published in eleven days.",
    read: "Search demand Studio noticed in August has not been answered yet.",
    room: "Studio",
    entity: "Insights",
    action: "Open Studio",
  },
  {
    id: "s-8",
    severity: "watch_closely",
    observed: "One meeting commitment is approaching its stated date.",
    read: "Still on time. Worth a glance before it becomes a slipped promise.",
    room: "Steward",
    entity: "Mental Dental › weekly review",
    action: "Open commitments",
  },
  {
    id: "s-9",
    severity: "good_to_know",
    observed: "A new company matched your ICP on every criterion.",
    read: "Strong fit, no urgency. It will keep until you are choosing who to approach.",
    room: "Scout",
    entity: "Bellwether Dental, Dallas",
    action: "Review company",
  },
  {
    id: "s-10",
    severity: "good_to_know",
    observed: "The Houston landing page gained impressions for a new phrase.",
    read: "Early movement, too small to act on, worth remembering.",
    room: "Studio",
    entity: "trusttai.com › Houston",
    action: "Open Studio",
  },
];

export interface DemoMovement {
  id: string;
  when: string;
  what: string;
  room: DemoRoom;
}

export const DEMO_MOVEMENT: DemoMovement[] = [
  { id: "m-1", when: "2h ago", what: "Harbor Ortho replied to your proposal thread.", room: "Comms" },
  { id: "m-2", when: "Yesterday", what: "Patient intake milestone was approved.", room: "Roadmap" },
  { id: "m-3", when: "Yesterday", what: "Kestrel Dental was qualified by Scout.", room: "Scout" },
  { id: "m-4", when: "2 days ago", what: "Houston visibility work was marked blocked.", room: "Projects" },
  { id: "m-5", when: "3 days ago", what: "Weekly review commitments were recorded.", room: "Steward" },
];

export const SEVERITY_LABEL: Record<DemoSeverity, string> = {
  act_now: "Act now",
  evaluate: "Evaluate",
  watch_closely: "Watch closely",
  good_to_know: "Good to know",
};

export const SEVERITY_MEANING: Record<DemoSeverity, string> = {
  act_now: "Something is blocked, overdue, or stopping progress.",
  evaluate: "A judgment is needed from a person.",
  watch_closely: "Nothing to do yet. It could become important.",
  good_to_know: "Context worth holding, no action expected.",
};

export const SEVERITY_ORDER: DemoSeverity[] = [
  "act_now",
  "evaluate",
  "watch_closely",
  "good_to_know",
];

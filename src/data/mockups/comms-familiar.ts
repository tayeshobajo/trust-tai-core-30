/**
 * MOCKUP FIXTURES — Familiar Comms directions (A, B, C).
 *
 * Invented sample data only. Nothing here is read from or written to Supabase,
 * no value describes a real person, a real message, or a real send, and no
 * production Comms record is touched by anything that imports this file.
 */

export type ThreadState = "needs_reply" | "waiting" | "draft" | "done";

export const THREAD_STATE_LABEL: Record<ThreadState, string> = {
  needs_reply: "Needs reply",
  waiting: "Waiting on them",
  draft: "Draft saved",
  done: "Nothing outstanding",
};

/** Status lines that say the implication, not just the state. */
export const THREAD_STATE_MEANING: Record<ThreadState, string> = {
  needs_reply: "They wrote last. Nothing moves until you answer.",
  waiting: "You wrote last. The next move is theirs, not yours.",
  draft: "A reply is written but unsent. It needs your read before it can go.",
  done: "Nothing is owed in either direction right now.",
};

export interface DemoMessage {
  id: string;
  author: string;
  role: "them" | "us";
  at: string;
  body: string;
}

export interface DemoFinding {
  id: string;
  group: "must_fix" | "confirm" | "suggestion";
  excerpt: string;
  issue: string;
  why: string;
  replacement?: string;
}

export const FINDING_GROUP_LABEL: Record<DemoFinding["group"], string> = {
  must_fix: "Fix before sending",
  confirm: "Confirm with a human",
  suggestion: "Optional improvement",
};

export interface DemoFollowUp {
  id: string;
  threadId: string;
  what: string;
  who: string;
  when: string;
  dueTone: "overdue" | "today" | "later";
  origin: "Agreed with them" | "Suggested by Trust Tai";
}

export interface DemoThread {
  id: string;
  personId: string;
  person: string;
  title: string;
  company: string;
  subject: string;
  preview: string;
  activity: string;
  state: ThreadState;
  unread: boolean;
  channel: "Gmail" | "WhatsApp" | "Logged by hand";
  messageCount: number;
  messages: DemoMessage[];
  draft?: string;
  read: {
    need: string;
    open: string;
    move: string;
    because: string;
  };
  findings: DemoFinding[];
}

export interface DemoPerson {
  id: string;
  name: string;
  title: string;
  company: string;
  email: string;
  lastTouch: string;
  health: "steady" | "slipping" | "quiet";
  healthNote: string;
  memory: string[];
  threadIds: string[];
}

export const HEALTH_LABEL: Record<DemoPerson["health"], string> = {
  steady: "Steady",
  slipping: "Slipping",
  quiet: "Gone quiet",
};

export const DEMO_THREADS: DemoThread[] = [
  {
    id: "t-northlight",
    personId: "p-adaeze",
    person: "Adaeze Obi",
    title: "Operations Director",
    company: "Northlight Care",
    subject: "Launch scope and who owns updates",
    preview: "Four questions before we sign off on the launch date.",
    activity: "22 minutes ago",
    state: "draft",
    unread: true,
    channel: "Gmail",
    messageCount: 63,
    messages: [
      {
        id: "m1",
        author: "Adaeze Obi",
        role: "them",
        at: "Today, 09:12",
        body: "Morning. Before we confirm the launch date I need four things settled. What exactly is in the launch scope. Who owns content updates after go live, us or you. Can the booking form take card payments at launch. And finance asked whether the annual figure includes the support retainer, because the line items do not appear to add up to the total.",
      },
      {
        id: "m2",
        author: "Sam Oyelaran",
        role: "us",
        at: "Today, 10:40",
        body: "Thanks Adaeze. Let me come back to you properly on all four today.",
      },
    ],
    draft:
      "Thanks for laying these out so clearly, Adaeze. Taking them in order.\n\nLaunch scope covers the new site, the booking form and the content migration. Everything will be ready Friday.\n\nCard payments are on the roadmap.\n\nOn the annual figure, I will confirm with finance today.",
    read: {
      need: "An itemised answer to four questions before she can approve the launch date.",
      open: "Ownership after go live is unanswered. The pricing arithmetic is unanswered. No date exists for card payments.",
      move: "Answer the four questions in order, then confirm the date only for the scope actually agreed.",
      because: "She listed the questions herself and tied her approval to them.",
    },
    findings: [
      {
        id: "f1",
        group: "must_fix",
        excerpt: "Everything will be ready Friday.",
        issue: "Everything is undefined, and no Friday date has been confirmed by anyone.",
        why: "She will forward this to finance as a commitment. The promise is what she remembers.",
      },
      {
        id: "f2",
        group: "must_fix",
        excerpt: "(no sentence covers this)",
        issue: "Her second question, who owns content updates after go live, is unanswered.",
        why: "This decides whether her team needs training or a retainer.",
        replacement:
          "After go live your team owns day to day content. We hold the platform, and anything structural comes to us.",
      },
      {
        id: "f3",
        group: "confirm",
        excerpt: "Card payments are on the roadmap.",
        issue: "Roadmap is not an answer to when. Confirm whether a date exists.",
        why: "She asked a yes or no question about launch. Ambiguity reads as avoidance.",
      },
      {
        id: "f4",
        group: "suggestion",
        excerpt: "I will confirm with finance today.",
        issue: "Say when today, so she can plan her own sign off.",
        why: "A time turns a promise into something she can schedule around.",
        replacement: "I will have the finance answer to you before 4pm today.",
      },
    ],
  },
  {
    id: "t-ferngrove",
    personId: "p-priya",
    person: "Priya Nair",
    title: "Practice Manager",
    company: "Ferngrove Dental",
    subject: "Invoice and the two days we lost",
    preview: "We were down Tuesday and Wednesday. I do not think this invoice is right.",
    activity: "2 days ago",
    state: "needs_reply",
    unread: true,
    channel: "Gmail",
    messageCount: 9,
    messages: [
      {
        id: "m1",
        author: "Priya Nair",
        role: "them",
        at: "Monday, 08:05",
        body: "The booking page was down Tuesday and Wednesday last week. We lost appointments both days. I do not think this month's invoice should stand as issued. Can you look at it before I pass it to our accountant.",
      },
    ],
    read: {
      need: "A decision on the invoice, and an acknowledgement that the outage cost her real appointments.",
      open: "No one has said whether a credit is possible. She has waited two days.",
      move: "Decide the position on the credit first, then reply once with the decision and the reason.",
      because: "Replying before the decision exists would only restate the problem back to her.",
    },
    findings: [],
  },
  {
    id: "t-harbour",
    personId: "p-michael",
    person: "Michael Reid",
    title: "Founder",
    company: "Harbour Studio",
    subject: "Thank you for the handover session",
    preview: "That walkthrough saved my team a week. Genuinely grateful.",
    activity: "Yesterday",
    state: "needs_reply",
    unread: false,
    channel: "Gmail",
    messageCount: 12,
    messages: [
      {
        id: "m1",
        author: "Michael Reid",
        role: "them",
        at: "Yesterday, 16:02",
        body: "That walkthrough saved my team a week. My ops lead has already rebuilt her Monday routine around it. She has now mentioned manual reporting twice in our meetings.",
      },
    ],
    read: {
      need: "Nothing. He is saying thank you.",
      open: "Nothing outstanding. Manual reporting has come up twice, but not in this message.",
      move: "Send a short, warm acknowledgement with no ask in it.",
      because: "There is no request here, and a pitch would cost more than it earns.",
    },
    findings: [],
  },
  {
    id: "t-lumen",
    personId: "p-grace",
    person: "Grace Whitford",
    title: "Managing Partner",
    company: "Lumen Advisory",
    subject: "Proposal follow up",
    preview: "Thanks, we are reviewing internally this week.",
    activity: "4 days ago",
    state: "waiting",
    unread: false,
    channel: "Gmail",
    messageCount: 6,
    messages: [
      {
        id: "m1",
        author: "Sam Oyelaran",
        role: "us",
        at: "Thursday, 11:20",
        body: "Sending the proposal through as promised. Happy to walk the partners through it whenever suits.",
      },
      {
        id: "m2",
        author: "Grace Whitford",
        role: "them",
        at: "Thursday, 18:44",
        body: "Thanks, we are reviewing internally this week.",
      },
    ],
    read: {
      need: "Room to review without being chased.",
      open: "Their partner meeting was Thursday. No outcome has come back.",
      move: "Leave it until Friday, then ask one question about the partner meeting.",
      because: "She named her own timeline and has not yet run past it.",
    },
    findings: [],
  },
  {
    id: "t-calder",
    personId: "p-tobi",
    person: "Tobi Eze",
    title: "Head of Marketing",
    company: "Calder & Rowe",
    subject: "Photos for the new site",
    preview: "Sent over the shortlist, all approved on our side.",
    activity: "Last week",
    state: "done",
    unread: false,
    channel: "WhatsApp",
    messageCount: 21,
    messages: [
      {
        id: "m1",
        author: "Tobi Eze",
        role: "them",
        at: "Last Wednesday",
        body: "Sent over the shortlist, all approved on our side. Nothing needed back from you.",
      },
    ],
    read: {
      need: "Nothing.",
      open: "Nothing outstanding.",
      move: "No action. This one is closed.",
      because: "He explicitly said nothing is needed back.",
    },
    findings: [],
  },
];

export const DEMO_PEOPLE: DemoPerson[] = [
  {
    id: "p-adaeze",
    name: "Adaeze Obi",
    title: "Operations Director",
    company: "Northlight Care",
    email: "adaeze@northlightcare.example",
    lastTouch: "Today",
    health: "steady",
    healthNote: "Replies within the day and asks precise questions.",
    memory: [
      "Forwards everything to finance, so answers need to survive being read alone.",
      "Prefers numbered answers in the order she asked.",
      "Approval for the launch date sits with her, not with her director.",
    ],
    threadIds: ["t-northlight"],
  },
  {
    id: "p-priya",
    name: "Priya Nair",
    title: "Practice Manager",
    company: "Ferngrove Dental",
    email: "priya@ferngrovedental.example",
    lastTouch: "2 days ago",
    health: "slipping",
    healthNote: "Waiting two days on a money question. This is where goodwill leaks.",
    memory: [
      "Two days of outage cost her real appointments, not just inconvenience.",
      "Passes invoices to an external accountant, so the wording becomes a record.",
      "Has never asked for a discount before.",
    ],
    threadIds: ["t-ferngrove"],
  },
  {
    id: "p-michael",
    name: "Michael Reid",
    title: "Founder",
    company: "Harbour Studio",
    email: "michael@harbourstudio.example",
    lastTouch: "Yesterday",
    health: "steady",
    healthNote: "Warm, unprompted thanks. The relationship is in credit.",
    memory: [
      "Mentioned manual reporting in two separate meetings, unprompted.",
      "His ops lead is the person who actually uses what we build.",
      "Responds well to short messages with no ask attached.",
    ],
    threadIds: ["t-harbour"],
  },
  {
    id: "p-grace",
    name: "Grace Whitford",
    title: "Managing Partner",
    company: "Lumen Advisory",
    email: "grace@lumenadvisory.example",
    lastTouch: "4 days ago",
    health: "quiet",
    healthNote: "Set her own review timeline. Quiet, but not yet late.",
    memory: [
      "Decisions go through a Thursday partner meeting.",
      "Asked for the proposal in one document, not a deck.",
    ],
    threadIds: ["t-lumen"],
  },
  {
    id: "p-tobi",
    name: "Tobi Eze",
    title: "Head of Marketing",
    company: "Calder & Rowe",
    email: "tobi@calderrowe.example",
    lastTouch: "Last week",
    health: "steady",
    healthNote: "Nothing owed in either direction.",
    memory: ["Works over WhatsApp, not email.", "Approves assets quickly and without a meeting."],
    threadIds: ["t-calder"],
  },
];

export const DEMO_FOLLOWUPS: DemoFollowUp[] = [
  {
    id: "fu1",
    threadId: "t-ferngrove",
    what: "Decide the Ferngrove invoice position, then reply to Priya.",
    who: "Tai",
    when: "Overdue since yesterday",
    dueTone: "overdue",
    origin: "Agreed with them",
  },
  {
    id: "fu2",
    threadId: "t-northlight",
    what: "Send Northlight the confirmed scope and the ownership answer.",
    who: "Sam",
    when: "Today, before 4pm",
    dueTone: "today",
    origin: "Agreed with them",
  },
  {
    id: "fu3",
    threadId: "t-lumen",
    what: "Lumen's partner meeting was Thursday. Ask how it landed.",
    who: "Tai",
    when: "Friday",
    dueTone: "later",
    origin: "Suggested by Trust Tai",
  },
];

/** The quiet opportunity, shown in context rather than as its own room. */
export const DEMO_OPPORTUNITY = {
  personId: "p-michael",
  observation: "Harbour Studio has mentioned manual reporting in two recent meetings.",
  timing: "After the handover settles. Not in the thank you reply.",
  step: "Ask whether reviewing that reporting routine would be useful.",
};

/** Said plainly on every direction, so nobody mistakes a prototype for a product. */
export const SIMULATED_BEHAVIOUR: string[] = [
  "Every person, thread, draft, reading and follow up here is invented sample data.",
  "Review results are scripted. No model runs and no intelligence record is written.",
  "Send, approve, save and snooze change this screen only. Nothing leaves the browser.",
  "No production Comms record is read, changed, or sent from this route.",
];

export function threadById(id: string): DemoThread {
  return DEMO_THREADS.find((thread) => thread.id === id) ?? DEMO_THREADS[0]!;
}

export function personById(id: string): DemoPerson {
  return DEMO_PEOPLE.find((person) => person.id === id) ?? DEMO_PEOPLE[0]!;
}

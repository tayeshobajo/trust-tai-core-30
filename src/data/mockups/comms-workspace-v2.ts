/**
 * MOCKUP FIXTURES — Comms workspace v2.
 *
 * Invented sample content only. Nothing here is read from or written to
 * Supabase, no value describes a real person, message or send, and no
 * production Comms record is touched by anything that imports this file.
 */

export type WorkState = "needs_reply" | "in_review" | "waiting" | "done";

export const WORK_STATE_LABEL: Record<WorkState, string> = {
  needs_reply: "Needs reply",
  in_review: "In review",
  waiting: "Waiting on them",
  done: "Nothing outstanding",
};

export interface V2Message {
  id: string;
  author: string;
  role: "them" | "us";
  at: string;
  body: string;
}

export type FindingGroup = "must_fix" | "confirm" | "style";

export const FINDING_GROUP_LABEL: Record<FindingGroup, string> = {
  must_fix: "Fix before sending",
  confirm: "Confirm with a human",
  style: "Optional style note",
};

export interface V2Finding {
  id: string;
  group: FindingGroup;
  /** Exact sentence in the draft this note is anchored to. */
  anchor: string;
  issue: string;
  /** Why it matters for this client specifically. */
  why: string;
  /** Only offered when the change is grounded in the source. */
  suggestion?: string;
}

export type CoverageState = "answered" | "missing" | "pending";

export interface V2Question {
  id: string;
  /** The exact sentence in the source message. */
  sourceText: string;
  state: CoverageState;
  /** The draft sentence that answers it, when one does. */
  answeredBy?: string;
  note: string;
}

export interface V2Thread {
  id: string;
  kind: "Message" | "Proposal";
  person: string;
  title: string;
  company: string;
  email: string;
  subject: string;
  snippet: string;
  activity: string;
  state: WorkState;
  unread: boolean;
  channel: "Gmail" | "WhatsApp" | "Pasted in";
  owner: string;
  earlierCount: number;
  messages: V2Message[];
  draft: string;
  goal: string;
  nextStep: string;
  nextStepSource: string;
  judgment: { fact: string; interpretation: string; move: string };
  opportunity?: { observation: string; hypothesis: string; timing: string };
  humour?: { line: string; note: string };
  findings: V2Finding[];
  questions: V2Question[];
  memory: { fact: string; source: string; at: string }[];
}

export const V2_THREADS: V2Thread[] = [
  {
    id: "t-northlight",
    kind: "Message",
    person: "Adaeze Obi",
    title: "Operations Director",
    company: "Northlight Care",
    email: "adaeze@northlightcare.example",
    subject: "Launch scope and who owns updates",
    snippet: "Four things settled before we confirm the launch date.",
    activity: "22 min ago",
    state: "in_review",
    unread: true,
    channel: "Gmail",
    owner: "Sam Oyelaran",
    earlierCount: 61,
    messages: [
      {
        id: "m1",
        author: "Adaeze Obi",
        role: "them",
        at: "Today, 09:12",
        body: "Morning. Before we confirm the launch date I need four things settled. What exactly is in the launch scope? Who owns content updates after go live, us or you? Can the booking form take card payments at launch? And finance asked whether the annual figure includes the support retainer, because the line items do not appear to add up to the total.",
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
    goal: "Help Adaeze confirm launch scope without promising unconfirmed work.",
    nextStep: "Answer all four questions in her order, then confirm only the scope already agreed.",
    nextStepSource: "Her message today, 09:12",
    judgment: {
      fact: "She named four clarifications she needs before she will confirm the launch date.",
      interpretation:
        "She needs a reply she can forward to finance without having to explain it herself.",
      move: "Itemise scope, ownership, payments readiness and pricing. Name the unknowns instead of promising Friday.",
    },
    opportunity: {
      observation: "Ownership after go live is an open question in her own words.",
      hypothesis:
        "A documented ownership and handover plan may be useful to her — after scope is settled, not inside this reply.",
      timing: "Hypothesis only. Keep it out of the client draft.",
    },
    findings: [
      {
        id: "f1",
        group: "must_fix",
        anchor: "Everything will be ready Friday.",
        issue: "Everything is undefined, and no Friday date has been confirmed by anyone here.",
        why: "She forwards replies to finance as a commitment. The promise is what gets remembered.",
        suggestion:
          "The site and the content migration are on track for Friday. The booking form depends on the payments answer below.",
      },
      {
        id: "f2",
        group: "must_fix",
        anchor: "",
        issue: "Her second question — who owns content updates after go live — has no answer at all.",
        why: "This decides whether her team needs training or a retainer, and she cannot sign off without it.",
        suggestion:
          "After go live your team owns day to day content. We hold the platform, and anything structural comes to us.",
      },
      {
        id: "f3",
        group: "confirm",
        anchor: "Card payments are on the roadmap.",
        issue: "Roadmap is not an answer to when. Confirm internally whether a date exists.",
        why: "She asked a yes or no question about launch day. Ambiguity here reads as avoidance.",
      },
      {
        id: "f4",
        group: "style",
        anchor: "On the annual figure, I will confirm with finance today.",
        issue: "Say when today, so she can schedule her own sign off.",
        why: "A time turns a promise into something she can plan around.",
        suggestion: "On the annual figure, I will have finance's answer to you before 4pm today.",
      },
    ],
    questions: [
      {
        id: "q1",
        sourceText: "What exactly is in the launch scope?",
        state: "answered",
        answeredBy:
          "Launch scope covers the new site, the booking form and the content migration.",
        note: "Named in the draft, in her order.",
      },
      {
        id: "q2",
        sourceText: "Who owns content updates after go live, us or you?",
        state: "missing",
        note: "No sentence in the draft addresses ownership.",
      },
      {
        id: "q3",
        sourceText: "Can the booking form take card payments at launch?",
        state: "pending",
        answeredBy: "Card payments are on the roadmap.",
        note: "Acknowledged but not answered. No date is given.",
      },
      {
        id: "q4",
        sourceText:
          "And finance asked whether the annual figure includes the support retainer, because the line items do not appear to add up to the total.",
        state: "pending",
        answeredBy: "On the annual figure, I will confirm with finance today.",
        note: "An answer is promised rather than given. The question stays open.",
      },
    ],
    memory: [
      {
        fact: "Forwards replies to finance, so answers have to survive being read alone.",
        source: "Her email, 14 Aug",
        at: "14 Aug",
      },
      {
        fact: "Prefers numbered answers in the order she asked them.",
        source: "Call note, Sam",
        at: "2 Sep",
      },
      {
        fact: "Approval for the launch date sits with her, not her director.",
        source: "Her email, 9 Sep",
        at: "9 Sep",
      },
    ],
  },
  {
    id: "t-ferngrove",
    kind: "Message",
    person: "Priya Nair",
    title: "Practice Manager",
    company: "Ferngrove Dental",
    email: "priya@ferngrovedental.example",
    subject: "Invoice and the two days we lost",
    snippet: "We were down Tuesday and Wednesday. I do not think this invoice is right.",
    activity: "2 days ago",
    state: "needs_reply",
    unread: true,
    channel: "Gmail",
    owner: "Tai",
    earlierCount: 8,
    messages: [
      {
        id: "m1",
        author: "Priya Nair",
        role: "them",
        at: "Monday, 08:05",
        body: "The booking page was down Tuesday and Wednesday last week. We lost appointments both days. I do not think this month's invoice should stand as issued. Can you look at it before I pass it to our accountant?",
      },
    ],
    draft: "",
    goal: "Give Priya a decision on the invoice, not another apology.",
    nextStep: "Decide the credit position first. Replying before that only restates her problem.",
    nextStepSource: "Her email, Monday 08:05",
    judgment: {
      fact: "Two days of outage, and she has waited two days for an answer on money.",
      interpretation: "The wording becomes a record — her accountant reads it, not just her.",
      move: "Decide the credit, then reply once with the decision and the reason.",
    },
    findings: [],
    questions: [],
    memory: [
      {
        fact: "Passes invoices to an external accountant, so wording becomes a record.",
        source: "Her email, 4 Jul",
        at: "4 Jul",
      },
      { fact: "Has never asked for a discount before.", source: "Billing history", at: "—" },
    ],
  },
  {
    id: "t-harbour",
    kind: "Message",
    person: "Michael Reid",
    title: "Founder",
    company: "Harbour Studio",
    email: "michael@harbourstudio.example",
    subject: "Thank you for the handover session",
    snippet: "That walkthrough saved my team a week. Genuinely grateful.",
    activity: "Yesterday",
    state: "needs_reply",
    unread: false,
    channel: "Gmail",
    owner: "Tai",
    earlierCount: 11,
    messages: [
      {
        id: "m1",
        author: "Michael Reid",
        role: "them",
        at: "Yesterday, 16:02",
        body: "That walkthrough saved my team a week. My ops lead has already rebuilt her Monday routine around it. She has mentioned manual reporting twice now in our meetings.",
      },
    ],
    draft:
      "Thank you, Michael. Glad it landed — and credit to your ops lead for turning it into a routine that fast.",
    goal: "Say thank you back, warmly, with nothing attached to it.",
    nextStep: "Send a short acknowledgement. No ask, no meeting.",
    nextStepSource: "His email, yesterday 16:02",
    judgment: {
      fact: "There is no request in his message.",
      interpretation: "Goodwill is the whole content. An ask here would cost more than it earns.",
      move: "Reply short and warm. Leave the reporting thread for another day.",
    },
    opportunity: {
      observation: "Manual reporting has come up twice in his meetings, unprompted.",
      hypothesis: "A reporting review may be useful to his ops lead.",
      timing: "Not in this reply. Keep it for a later conversation.",
    },
    humour: {
      line: "Your ops lead moves faster than our changelog.",
      note: "Optional. Fits here because he is thanking you and nothing is at stake. Remove it freely.",
    },
    findings: [],
    questions: [],
    memory: [
      {
        fact: "His ops lead is the person who actually uses what we build.",
        source: "Handover call",
        at: "11 Sep",
      },
      { fact: "Responds well to short messages with no ask.", source: "Thread history", at: "—" },
    ],
  },
  {
    id: "t-lumen",
    kind: "Proposal",
    person: "Grace Whitford",
    title: "Managing Partner",
    company: "Lumen Advisory",
    email: "grace@lumenadvisory.example",
    subject: "Proposal follow up",
    snippet: "Thanks, we are reviewing internally this week.",
    activity: "4 days ago",
    state: "waiting",
    unread: false,
    channel: "Gmail",
    owner: "Sam Oyelaran",
    earlierCount: 4,
    messages: [
      {
        id: "m1",
        author: "Grace Whitford",
        role: "them",
        at: "Thursday, 18:44",
        body: "Thanks, we are reviewing internally this week.",
      },
    ],
    draft: "",
    goal: "Leave room, then ask one question about the partner meeting.",
    nextStep: "Nothing until Friday. She named her own timeline and has not run past it.",
    nextStepSource: "Her email, Thursday 18:44",
    judgment: {
      fact: "She set a review timeline this week and it has not expired.",
      interpretation: "Chasing early would cost more than waiting two more days.",
      move: "Hold until Friday, then ask how the partner meeting landed.",
    },
    findings: [],
    questions: [],
    memory: [
      { fact: "Decisions go through a Thursday partner meeting.", source: "Her email", at: "3 Sep" },
      { fact: "Asked for the proposal as one document, not a deck.", source: "Her email", at: "28 Aug" },
    ],
  },
];

export interface V2FollowUp {
  id: string;
  threadId: string;
  what: string;
  who: string;
  when: string;
  tone: "overdue" | "today" | "later";
}

export const V2_FOLLOWUPS: V2FollowUp[] = [
  {
    id: "fu1",
    threadId: "t-ferngrove",
    what: "Decide the Ferngrove invoice position, then reply to Priya.",
    who: "Tai",
    when: "Overdue since yesterday",
    tone: "overdue",
  },
  {
    id: "fu2",
    threadId: "t-northlight",
    what: "Send Northlight the confirmed scope and the ownership answer.",
    who: "Sam",
    when: "Today, before 4pm",
    tone: "today",
  },
];

/** Sample intake content for the standalone New review demo. */
export const V2_INTAKE_SAMPLE = {
  context:
    "Pasted from WhatsApp — Dele Amadi, Founder, Kestrel Logistics, yesterday 20:41:\n\n\"We liked the outline. Before the board sees it, can you set out what happens if the rollout slips past January, and be explicit about who pays for the extra depots? Also the board will ask about support after month three.\"",
  draft:
    "Dear Dele,\n\nThank you for the outline feedback. Please find the revised proposal attached.\n\nWe are confident the rollout will complete on time and the depots are included. Support continues as standard.\n\nKind regards,\nSam",
  recipient: "Dele Amadi · Kestrel Logistics",
  goal: "Give the board a proposal that survives being read without us in the room.",
};

export interface V2SourceFile {
  id: string;
  name: string;
  size: string;
  status: "read" | "unread";
  note: string;
}

export const V2_CONTEXT_FILES: V2SourceFile[] = [
  {
    id: "sf1",
    name: "kestrel-board-questions.md",
    size: "3 KB",
    status: "read",
    note: "Markdown, read in full. Used as context for the review.",
  },
  {
    id: "sf2",
    name: "kestrel-depot-costs.pdf",
    size: "412 KB",
    status: "unread",
    note: "Comms cannot read PDFs. Nothing in this file was used, and no claim is made about it.",
  },
];

export const V2_PROTOTYPE_NOTES: string[] = [
  "Every person, message, draft, finding and follow up here is invented sample data.",
  "Review results are scripted. No model runs, and no intelligence record is written.",
  "Review, approve and send change this screen only. Nothing leaves the browser.",
  "No production Comms record is read, changed, approved or sent from this route.",
];

export function v2ThreadById(id: string): V2Thread {
  return V2_THREADS.find((thread) => thread.id === id) ?? V2_THREADS[0]!;
}

/**
 * MOCKUP FIXTURES — Comms Next.
 *
 * Sample data only, isolated from every production record. Nothing here is
 * read from or written to Supabase, and no value describes a real client,
 * a real message, or a real send. Names are invented for review purposes.
 */

export type ThreadState = "needs_reply" | "waiting" | "draft" | "closed";

export interface DemoMessage {
  id: string;
  author: string;
  role: "them" | "us";
  at: string;
  body: string;
  /** Marks content that sits past the old 900 character truncation point. */
  late?: boolean;
}

export interface DemoThread {
  id: string;
  person: string;
  title: string;
  company: string;
  subject: string;
  preview: string;
  owner: string;
  activity: string;
  state: ThreadState;
  channel: "Email" | "WhatsApp" | "Manual";
  /** Illustrative: this thread holds more messages than the old 40 cap. */
  messageCount: number;
  priority?: string;
  messages: DemoMessage[];
  read: {
    need: string;
    achieve: string;
    open: string;
    move: string;
    because: string;
  };
}

export const DEMO_THREADS: DemoThread[] = [
  {
    id: "t-northlight",
    person: "Adaeze Obi",
    title: "Operations Director",
    company: "Northlight Care",
    subject: "Launch scope and who owns updates",
    preview: "Four questions before we sign off on the launch date.",
    owner: "Sam (sales)",
    activity: "22 minutes ago",
    state: "needs_reply",
    channel: "Email",
    messageCount: 63,
    priority: "She asked who owns updates after launch. The current draft explains the build and leaves ownership unanswered.",
    messages: [
      {
        id: "m1",
        author: "Adaeze Obi",
        role: "them",
        at: "Today, 09:12 (WAT)",
        body: "Morning. Before we confirm the launch date I need four things settled. First, what exactly is included in the launch scope. Second, who owns content updates after go live, us or you. Third, can the booking form take card payments at launch or is that later. And one more thing further down: our finance team asked whether the annual figure in the proposal includes the support retainer, because the line items do not appear to add to the total shown.",
        late: true,
      },
      {
        id: "m2",
        author: "Sam (sales)",
        role: "us",
        at: "Today, 10:40 (WAT)",
        body: "Thanks Adaeze. Everything will be ready Friday. The build covers the new site, the booking form and the migration. Card payments are on the roadmap. Speak soon.",
      },
    ],
    read: {
      need: "A clear, itemised answer to four questions before she can approve the launch date.",
      achieve: "Give her something she can forward to finance and operations without asking again.",
      open: "Ownership of post launch updates is unanswered. The pricing arithmetic question is unanswered. No confirmed date exists for card payments.",
      move: "Answer the four questions in order, then confirm the date only for the scope that is actually agreed.",
      because: "She listed the questions herself and tied approval to them.",
    },
  },
  {
    id: "t-harbour",
    person: "Michael Reid",
    title: "Founder",
    company: "Harbour Studio",
    subject: "Thank you for the handover session",
    preview: "That walkthrough saved my team a week. Genuinely grateful.",
    owner: "Tai",
    activity: "Yesterday",
    state: "waiting",
    channel: "Email",
    messageCount: 12,
    messages: [
      {
        id: "m1",
        author: "Michael Reid",
        role: "them",
        at: "Yesterday, 16:02 (WAT)",
        body: "That walkthrough saved my team a week. My ops lead has already rebuilt her Monday routine around it. Also, she has now mentioned manual reporting twice in our meetings.",
      },
    ],
    read: {
      need: "Nothing. He is saying thank you.",
      achieve: "Receive the thanks warmly and leave the relationship lighter than you found it.",
      open: "Nothing outstanding.",
      move: "Send a short, warm acknowledgement. No ask.",
      because: "There is no request in the message, and a pitch here would cost more than it earns.",
    },
  },
  {
    id: "t-ferngrove",
    person: "Priya Nair",
    title: "Practice Manager",
    company: "Ferngrove Dental",
    subject: "Invoice and the two days we lost",
    preview: "We were down Tuesday and Wednesday and nobody told us.",
    owner: "Sam (sales)",
    activity: "2 days ago",
    state: "draft",
    channel: "Email",
    messageCount: 8,
    messages: [
      {
        id: "m1",
        author: "Priya Nair",
        role: "them",
        at: "Tuesday, 08:31 (WAT)",
        body: "Our booking page was down Tuesday and Wednesday. Nobody told us. We are being invoiced in full for the month and I would like an explanation before I pay it.",
      },
    ],
    read: {
      need: "An explanation, ownership of the outage, and a decision about the invoice.",
      achieve: "Take responsibility plainly and tell her what happens to the invoice.",
      open: "No decision has been recorded about the invoice amount.",
      move: "Own the outage, say what changed, and state the invoice decision. No humour here.",
      because: "This is a complaint about money and downtime. Warmth means directness.",
    },
  },
  {
    id: "t-lumen",
    person: "Kofi Mensah",
    title: "Managing Partner",
    company: "Lumen Advisory",
    subject: "Proposal, phase one",
    preview: "Sending through for review before Thursday's partners meeting.",
    owner: "Tai",
    activity: "Last week",
    state: "closed",
    channel: "Manual",
    messageCount: 4,
    messages: [
      {
        id: "m1",
        author: "Kofi Mensah",
        role: "them",
        at: "Last Thursday, 11:00 (WAT)",
        body: "Received, thank you. We will come back to you after the partners meeting.",
      },
    ],
    read: {
      need: "Nothing right now. The ball is with them.",
      achieve: "Stay out of the way until Thursday.",
      open: "Their decision.",
      move: "Leave it alone. A follow up is already dated for Friday.",
      because: "They named their own timeline.",
    },
  },
];

export const DEMO_PEOPLE = [
  { id: "p1", name: "Adaeze Obi", company: "Northlight Care", threads: 3, note: "Two open threads, one closed." },
  { id: "p2", name: "Michael Reid", company: "Harbour Studio", threads: 1, note: "Warm. No open request." },
  { id: "p3", name: "Priya Nair", company: "Ferngrove Dental", threads: 2, note: "Complaint open since Tuesday." },
  { id: "p4", name: "Kofi Mensah", company: "Lumen Advisory", threads: 1, note: "Awaiting their decision." },
  { id: "p5", name: "Dele Aina", company: "No email on record", threads: 0, note: "Relationship kept without a thread." },
];

/* --------------------------------- Review --------------------------------- */

export type FindingGroup = "must_fix" | "confirm" | "suggestion";

export interface DemoFinding {
  id: string;
  group: FindingGroup;
  excerpt: string;
  issue: string;
  why: string;
  replacement?: string;
  evidence: string;
  optional?: boolean;
}

export const FINDING_GROUP_LABEL: Record<FindingGroup, string> = {
  must_fix: "Must fix",
  confirm: "Confirm",
  suggestion: "Suggestions",
};

export const DEMO_FINDINGS: DemoFinding[] = [
  {
    id: "f1",
    group: "must_fix",
    excerpt: "Everything will be ready Friday.",
    issue: "Two problems in one sentence: everything is undefined, and no Friday date has been confirmed by anyone.",
    why: "She will forward this to finance as a commitment. If the scope behind it moves, the promise is what she remembers.",
    evidence: "No delivery date appears in the thread or in the project record.",
  },
  {
    id: "f2",
    group: "must_fix",
    excerpt: "(no sentence covers this)",
    issue: "Her second question, who owns content updates after go live, has no answer anywhere in the draft.",
    why: "This is the question that decides whether her team needs training or a retainer.",
    replacement: "After go live your team owns day to day content. We hold the platform, and anything structural comes to us.",
    evidence: "Source email, today 09:12, question 2.",
  },
  {
    id: "f3",
    group: "must_fix",
    excerpt: "Annual total: 4,800,000",
    issue: "The line items add to 5,150,000. The stated total is 4,800,000.",
    why: "A proposal whose arithmetic does not close costs trust that the writing cannot win back.",
    evidence: "Proposal v2, pricing table, rows 1 to 4. Checked as arithmetic, not as prose.",
  },
  {
    id: "f4",
    group: "must_fix",
    excerpt: "Includes our existing appointment reminder engine.",
    issue: "The scope section presents proposed work as existing capability.",
    why: "If she buys it as existing and it is not, the first delivery conversation starts with a correction.",
    evidence: "Proposal v2, scope section 3, against the capability record.",
  },
  {
    id: "f5",
    group: "confirm",
    excerpt: "Card payments are on the roadmap.",
    issue: "Roadmap is not an answer to when. Confirm whether a date exists before sending.",
    why: "She asked a yes or no question about launch. Ambiguity here reads as avoidance.",
    evidence: "Source email, question 3.",
  },
  {
    id: "f6",
    group: "confirm",
    excerpt: "Sam's signature block",
    issue: "This message is written by Sam. Confirm it goes out under Sam's name and signature.",
    why: "Tai's standards apply. Tai's signature does not.",
    evidence: "Sender profile: Sam, sales.",
  },
  {
    id: "f7",
    group: "suggestion",
    excerpt: "Thanks Adaeze.",
    issue: "The opening could acknowledge that she did the work of listing the questions clearly.",
    why: "Specific attention makes the answer land better than a warmer adjective would.",
    replacement: "Thanks for laying these out so clearly, Adaeze. Taking them in order.",
    evidence: "Tone read from the source email.",
  },
  {
    id: "f8",
    group: "suggestion",
    excerpt: "Speak soon.",
    issue: "Optional light line for a warm exchange. Remove it if the moment does not want it.",
    why: "Humour is situational, never owed.",
    replacement: "Speak soon, and I will keep the finance answer short enough to forward.",
    evidence: "Optional alternative.",
    optional: true,
  },
];

export type CoverageStatus = "answered" | "partly" | "missing" | "pending";

export const COVERAGE_LABEL: Record<CoverageStatus, string> = {
  answered: "Answered",
  partly: "Partly answered",
  missing: "Missing",
  pending: "Pending confirmation",
};

export const DEMO_COVERAGE: { id: string; question: string; status: CoverageStatus; where: string }[] = [
  { id: "q1", question: "What is included in the launch scope?", status: "answered", where: "Draft, paragraph 2" },
  { id: "q2", question: "Who owns content updates after go live?", status: "missing", where: "Source email, 09:12" },
  { id: "q3", question: "Can the booking form take card payments at launch?", status: "partly", where: "Draft, paragraph 2" },
  {
    id: "q4",
    question: "Does the annual figure include the support retainer?",
    status: "pending",
    where: "Source email, 09:12, after character 900",
  },
];

export type SourceState = "reading" | "ready" | "partial" | "unsupported" | "failed";

export const SOURCE_STATE_LABEL: Record<SourceState, string> = {
  reading: "Reading",
  ready: "Ready",
  partial: "Partially read",
  unsupported: "Unsupported",
  failed: "Failed",
};

export const DEMO_SOURCES: {
  id: string;
  name: string;
  kind: "Context only" | "File to send";
  state: SourceState;
  note: string;
}[] = [
  { id: "s1", name: "Thread: Northlight Care, 63 messages", kind: "Context only", state: "ready", note: "Newest 12 loaded, including today 09:12." },
  { id: "s2", name: "Proposal v2.docx", kind: "File to send", state: "ready", note: "14 of 14 sections read." },
  { id: "s3", name: "Finance call recording.m4a", kind: "Context only", state: "unsupported", note: "Audio is not read. Nothing was guessed from the filename." },
  { id: "s4", name: "Scanned signature page.pdf", kind: "Context only", state: "partial", note: "3 of 5 pages read. Pages 4 and 5 are unreadable scans." },
];

export const DEMO_FOLLOWUPS: {
  id: string;
  what: string;
  who: string;
  when: string;
  origin: "Agreed with the client" | "Suggested reminder";
  thread: string;
}[] = [
  {
    id: "fu1",
    what: "Send Northlight the confirmed launch scope and the ownership answer.",
    who: "Sam",
    when: "Today",
    origin: "Agreed with the client",
    thread: "Northlight Care, launch scope",
  },
  {
    id: "fu2",
    what: "Decide the Ferngrove invoice position before replying.",
    who: "Tai",
    when: "Tomorrow",
    origin: "Agreed with the client",
    thread: "Ferngrove Dental, invoice",
  },
  {
    id: "fu3",
    what: "Lumen partners meeting was Thursday. Check in on Friday.",
    who: "Tai",
    when: "Friday",
    origin: "Suggested reminder",
    thread: "Lumen Advisory, proposal",
  },
];

export const DEMO_OPPORTUNITY = {
  observation: "Harbour Studio has mentioned manual reporting in two recent meetings.",
  timing: "After the current handover settles, not in the thank you reply.",
  step: "Ask whether reviewing that reporting routine would be useful.",
};

/** What the prototype only pretends to do. Shown in the UI, honestly. */
export const SIMULATED_BEHAVIOUR: string[] = [
  "Every thread, person, draft, finding and follow up is invented sample data.",
  "Review runs are scripted. No model call is made and no intelligence run is recorded.",
  "Approve, send, save and link to Scout change local screen state only.",
  "File ingestion states are illustrative. Nothing is uploaded or extracted.",
  "No production Comms record is read, changed, or sent from this route.",
];

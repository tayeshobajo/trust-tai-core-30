/**
 * MOCKUP / DEMO DATA ONLY — Studio × Website Content Intelligence prototype.
 *
 * Nothing here is production truth. These values are static, illustrative and
 * exist purely so Tai can review the proposed Studio experience visually before
 * anything real is wired. No production surface imports this file, and nothing
 * here is read from or written to Supabase.
 */

export type DemoConfidence = "Observed" | "Supported" | "Thin";

export type DemoMove =
  | "new_post"
  | "update_existing"
  | "internal_link"
  | "landing_page"
  | "faq"
  | "no_action";

export const DEMO_MOVE_LABEL: Record<DemoMove, string> = {
  new_post: "Write a new story",
  update_existing: "Update an existing page",
  internal_link: "Add an internal link",
  landing_page: "Build a landing page",
  faq: "Answer it as a question",
  no_action: "No action yet",
};

export interface DemoOpportunity {
  id: string;
  phrase: string;
  window: string;
  impressions: number | null;
  ctr: number | null;
  averagePosition: number | null;
  provenance: string;
  interpretation: string;
  move: DemoMove;
  overlap?: string;
  confidence: DemoConfidence;
}

/** Three illustrative opportunities, chosen to show range, not to report truth. */
export const DEMO_OPPORTUNITIES: DemoOpportunity[] = [
  {
    id: "demo-transformational-advisory",
    phrase: "transformational advisory",
    window: "Last 28 days",
    impressions: 412,
    ctr: 0.011,
    averagePosition: 14.2,
    provenance: "Search Console",
    interpretation:
      "People are already using our own words to look for us, but they are landing on two pages that say almost the same thing. The demand looks real; the answer is split.",
    move: "update_existing",
    overlap:
      "Two pages compete for this phrase: /advisory and /what-we-do. Neither one wins outright.",
    confidence: "Supported",
  },
  {
    id: "demo-fractional-cto",
    phrase: "what a fractional operating partner actually does",
    window: "Last 28 days",
    impressions: 268,
    ctr: 0.004,
    averagePosition: 22.6,
    provenance: "Search Console",
    interpretation:
      "This is a question, asked in full sentences, that no page of ours answers. The people asking it are already past the curiosity stage — they are trying to justify the decision to someone else.",
    move: "new_post",
    confidence: "Observed",
  },
  {
    id: "demo-ai-operating-system",
    phrase: "ai operating system for advisory firms",
    window: "Last 28 days",
    impressions: 11,
    ctr: null,
    averagePosition: null,
    provenance: "Search Console",
    interpretation:
      "Too few appearances to tell whether this is a real pattern or noise. Nobody has clicked, and there is not enough here to say where we rank.",
    move: "no_action",
    confidence: "Thin",
  },
];

export const DEMO_SPARSE_LINE =
  "Search data is too thin for a confident content opportunity right now.";

/* ------------------------------- Brief -------------------------------- */

export interface DemoTitle {
  id: string;
  title: string;
  familiarAnchor: string;
  freshTurn: string;
  intentFit: string;
}

export const DEMO_BRIEF = {
  opportunityId: "demo-transformational-advisory",
  coreIdea:
    "Most advisory work fails quietly, not loudly — it dies in the gap between the advice and the week after it.",
  angle:
    "Written from inside the follow-through, not the pitch. We show the mechanics of what happens after the recommendation lands, because that is the part clients are actually buying.",
  audienceLanguage: [
    "transformational advisory",
    "advisory that actually sticks",
    "what happens after the strategy deck",
    "operating partner",
  ],
  titles: [
    {
      id: "t1",
      title: "The Week After the Strategy Deck",
      familiarAnchor: "Everyone knows the strategy deck.",
      freshTurn: "The story starts where the deck ends.",
      intentFit: "Speaks to people comparing advisors on follow-through.",
    },
    {
      id: "t2",
      title: "Advice Is Cheap. The Follow-Through Is the Product.",
      familiarAnchor: "\"Advice is cheap\" is a phrase people already say.",
      freshTurn: "It reframes the follow-through as the thing being sold.",
      intentFit: "Matches buyers who have been burned by a previous advisor.",
    },
    {
      id: "t3",
      title: "What Transformational Advisory Looks Like on a Tuesday",
      familiarAnchor: "Uses the exact phrase people search for.",
      freshTurn: "Drops an abstract category into an ordinary day.",
      intentFit: "Directly answers the searched phrase without repeating it back flatly.",
    },
    {
      id: "t4",
      title: "Why Good Advice Keeps Dying in Good Companies",
      familiarAnchor: "A tension every operator has watched happen.",
      freshTurn: "Blames the system, not the people.",
      intentFit: "Draws in leaders who suspect the problem is structural.",
    },
  ] satisfies DemoTitle[],
};

/* --------------------------- Opening + spine --------------------------- */

export const DEMO_OPENING = {
  paragraph:
    "The recommendation was right. Everyone in the room agreed it was right. Eleven weeks later, nothing about the company had changed — and the people who had agreed with it most loudly were the ones quietest about why.",
  earnsParagraphTwo:
    "It opens on a failure the reader has personally witnessed, then withholds the reason for it. The second paragraph is the only place the answer can come from.",
  structureChosen: "End first",
  structureWhy:
    "The consequence is more interesting than the setup, and the reader already knows the setup.",
  spine: [
    {
      step: "End",
      note: "Eleven weeks after the agreement, nothing moved. Start with the damage.",
    },
    {
      step: "Beginning",
      note: "How the engagement was framed, and what everyone assumed would happen next.",
    },
    {
      step: "Middle",
      note: "Three real scenes from the gap: the unowned decision, the calendar, the quiet re-scope.",
    },
    {
      step: "Landing",
      note: "Advisory is not a document. It is a weekly obligation someone has to hold.",
    },
  ],
  searchIntelligence: {
    audienceLanguage: "transformational advisory · advisory that actually sticks",
    intent: "Comparing advisors, looking for proof of follow-through.",
    visibility:
      "We appear for this phrase, but two pages compete for it and neither one wins.",
    source: "Search Console · last 28 days",
  },
};

/* ------------------------------ Image plan ----------------------------- */

export interface DemoImage {
  id: string;
  role: "Hero" | "Scene" | "Contrast" | "Evidence" | "Diagram";
  jobInStory: string;
  placement: string;
  direction: string;
  alt: string;
}

export const DEMO_IMAGES: DemoImage[] = [
  {
    id: "img-hero",
    role: "Hero",
    jobInStory:
      "Without it, the story reads as an argument. With it, the reader feels the weeks passing before they read a word.",
    placement: "Featured",
    direction:
      "Natural window light across a boardroom table the morning after: chairs pushed back at angles, one printed deck left behind, condensation on a glass. Documentary, unstyled, no people. Warm neutral tones, shallow depth.",
    alt: "An empty boardroom the morning after a strategy session, one printed deck left on the table.",
  },
  {
    id: "img-scene",
    role: "Scene",
    jobInStory:
      "Turns the abstract 'gap' into something the reader can point at — the ordinary Tuesday where the work either happens or does not.",
    placement: "After \"Three scenes from the gap\"",
    direction:
      "A founder mid-conversation in a real working office, sleeves up, a whiteboard half-erased behind them. Candid, cinematic restraint, natural light. People shown should reflect Trust Tai's actual audience and leadership, not generic stock casting.",
    alt: "A founder working through a decision at a whiteboard with a colleague.",
  },
  {
    id: "img-evidence",
    role: "Evidence",
    jobInStory:
      "Carries the one claim readers will argue with — that the drop-off is predictable and dated. Removing it turns a proof into an assertion.",
    placement: "After \"What the eleven weeks actually contained\"",
    direction:
      "A simple, typographic timeline in Trust Tai's own type and cream palette: decision date, owner, the week it stalled. Editorial diagram, not a dashboard screenshot.",
    alt: "A timeline showing when each decision was made, who owned it, and the week it stalled.",
  },
];

export const DEMO_IMAGE_RESTRAINT = "No other image earns a place in this story.";

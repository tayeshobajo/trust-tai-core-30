// @vitest-environment jsdom

/**
 * The recommended-move card, proved at the DOM:
 *
 *  A. The card never renders the move's reason twice, and the always-visible
 *     "Why we think this" block is gone. "Why this move" holds concise
 *     evidence behind a disclosure.
 *  B. A gated first message shows "Resolve N blockers", never an outreach CTA.
 *  C. A ready handoff shows the outreach headline and the explicit carry
 *     confirmation before anything leaves Scout.
 *  D. "Resolve N blockers" opens a guided flow: each blocker with its own
 *     action, honest progress as blockers clear, and a way back.
 *  E. When the final blocker clears, the flow advances straight into the
 *     first-message confirmation — no rediscovery.
 *  F. Research pending and failure states stay in place and truthful.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { HandoffBlocker } from "@/data/comms-handoff";
import { buildMoveBlockers, type MoveBlocker } from "@/data/scout/move-blockers";
import { buildRecommendedNextMove } from "@/data/scout/recommended-move";
import type { Person } from "@/domain/people";
import type { ResearchCoverage } from "@/domain/prospect-modules";
import type { ProspectCandidate } from "@/domain/scout";
import { EMPTY_INTEL, type ScoutIntel } from "@/domain/scout-intel";
import type {
  RelationshipDevelopmentBrief,
  RelationshipResearchMarker,
} from "@/domain/relationship-development";

import { RecommendedNextMoveCard } from "./recommended-move";

(globalThis as Record<string, unknown>)["IS_REACT_ACT_ENVIRONMENT"] = true;

afterEach(cleanup);

const claire = {
  id: "person-1",
  fullName: "Claire Meneely",
  roleTitle: "Founder",
  email: "claire@example.com",
  emailStatus: "found",
  confidence: "asserted_by_provider",
  decisionMakerLikelihood: "high",
  sourceId: "website-pages",
  sourceUrl: "https://acme.example/about",
} as unknown as Person;

const intel: ScoutIntel = {
  ...EMPTY_INTEL,
  collectedAt: "2026-08-19T00:00:00.000Z",
  people: [{ ...claire, id: undefined }],
} as unknown as ScoutIntel;

const brief: RelationshipDevelopmentBrief = {
  whyNow: null,
  humanSignal: "Their catering and wholesale path converts well",
  whatIsInteresting: "A neighborhood bakery growing into wholesale",
  whatTaiCanNotice: "Their catering and wholesale path converts well",
  risksOrAssumptions: [],
  bestChannel: "email",
  channelReason: "A legitimate business email is on record for Claire Meneely.",
  bridgeIdeas: [],
  firstMovePosture: "Step into Claire Meneely's world.",
  shouldActNow: false,
  evidenceUsed: [],
  grounded: true,
  generatedAt: "2026-08-21T00:00:00.000Z",
};

const candidate = {
  prospect: {
    id: "p1",
    name: "Dozen Bakery",
    status: "discovered",
    websiteUrl: "https://dozen.example",
    domain: "dozen.example",
  },
  evaluation: { scoreable: true, score: 86, light: "green" },
  intel,
  signals: [],
  fit: { whyItFits: "A strong ICP match." },
  development: {
    watch: null,
    research: {
      state: "prepared",
      because: "Fit and a traceable person line up.",
      version: 1,
      preparedAt: "2026-08-21T00:00:00.000Z",
      evidenceAt: "2026-08-19T00:00:00.000Z",
      brief,
    } as RelationshipResearchMarker,
  },
  lastCheckedAt: "2026-08-19T00:00:00.000Z",
} as unknown as ProspectCandidate;

const EMAIL_BLOCKER: HandoffBlocker = {
  kind: "email_unverified",
  message: "claire@example.com is unverified, so it cannot be treated as reachable.",
  personId: "person-1",
};
const COVERAGE_BLOCKER: HandoffBlocker = {
  kind: "thin_coverage",
  message: "Research coverage is thin, so the brief rests on partial reading.",
};
const BOTH = [EMAIL_BLOCKER, COVERAGE_BLOCKER];
const THIN_COVERAGE = { thin: true } as ResearchCoverage;

const blockedMove = buildRecommendedNextMove({
  candidate,
  people: [claire],
  firstMessage: { ready: false, blockers: BOTH.map((blocker) => blocker.message) },
  now: new Date("2026-08-24T00:00:00.000Z"),
});

const readyMove = buildRecommendedNextMove({
  candidate,
  people: [claire],
  firstMessage: { ready: true, blockers: [] },
  now: new Date("2026-08-24T00:00:00.000Z"),
});

function renderCard(over: Record<string, unknown> = {}) {
  const props = {
    move: blockedMove,
    candidate,
    blockers: buildMoveBlockers({ candidate, people: [claire], coverage: THIN_COVERAGE }),
    firstMessageReady: false,
    onPrimary: vi.fn(),
    onPrepareFirstMessage: vi.fn(),
    onPrepareBrief: vi.fn(),
    onConfirmEmail: vi.fn(),
    onRunResearch: vi.fn(),
    onOpenPeople: vi.fn(),
    onWatch: vi.fn(),
    onSeeResearch: vi.fn(),
    ...over,
  };
  const view = render(<RecommendedNextMoveCard {...props} />);
  return { ...view, props };
}

/* ---------------------------------------------------------- A · one reason */

describe("one move, one clear reason", () => {
  it("never repeats the reason and never renders the old always-visible rationale", () => {
    const { container } = renderCard();
    const text = container.textContent ?? "";
    // The reason's distinctive phrase appears exactly once on the card.
    expect(text.split("credible person with a useful opening").length - 1).toBe(1);
    expect(screen.queryByText(/why we think this/i)).toBeNull();
    expect(screen.queryByText(/how sure are we/i)).toBeNull();
    // The card ends shortly after its action row: evidence sits behind a disclosure.
    expect(screen.getByText("Why this move")).toBeTruthy();
  });

  it("the disclosure carries concise evidence and the quiet confidence chip", () => {
    renderCard({ confidenceLevel: "moderate" });
    expect(screen.getByText("ICP fit 86%")).toBeTruthy();
    expect(screen.getByText("Claire Meneely identified as Founder")).toBeTruthy();
    expect(screen.getByText("Business email found but unverified")).toBeTruthy();
    expect(screen.getByText("No dated signal on record")).toBeTruthy();
    expect(screen.getByText("moderate")).toBeTruthy();
  });
});

/* ------------------------------------------- B · gated means no outreach CTA */

describe("a gated first message", () => {
  it("shows the gate headline and Resolve 2 blockers, never Prepare first message", () => {
    renderCard();
    expect(
      screen.getByRole("heading", { name: "Email looks like the right way in — verify it first" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Resolve 2 blockers" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Prepare first message" })).toBeNull();
  });
});

/* ----------------------------------------------------- D · the guided flow */

describe("the guided blocker flow", () => {
  it("opens with honest progress, one action per blocker, and a way back", () => {
    const { props } = renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Resolve 2 blockers" }));

    const flow = screen.getByRole("region", { name: "Resolve the way in" });
    expect(flow.textContent).toContain("0 of 2 resolved");
    expect(flow.textContent).toContain(EMAIL_BLOCKER.message);
    expect(flow.textContent).toContain(COVERAGE_BLOCKER.message);

    fireEvent.click(screen.getByRole("button", { name: "Confirm this address" }));
    expect(props.onConfirmEmail).toHaveBeenCalledWith(
      expect.objectContaining({ id: "person-1" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Refresh the company read" }));
    expect(props.onRunResearch).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Back to the recommendation" }));
    expect(screen.queryByRole("region", { name: "Resolve the way in" })).toBeNull();
  });

  it("counts what has cleared as blockers resolve", () => {
    const verified = { ...claire, emailStatus: "verified" } as unknown as Person;
    const oneLeft: MoveBlocker[] = buildMoveBlockers({
      candidate,
      people: [verified],
      coverage: THIN_COVERAGE,
    });
    const { rerender, props } = renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Resolve 2 blockers" }));
    expect(screen.getByText("0 of 2 resolved")).toBeTruthy();

    rerender(
      <RecommendedNextMoveCard
        {...props}
        blockers={oneLeft}
      />,
    );
    expect(screen.getByText("1 of 2 resolved")).toBeTruthy();
    expect(screen.queryByText(EMAIL_BLOCKER.message)).toBeNull();
  });
});

/* ------------------------------------------- E · the flow hands over itself */

describe("clearing the final blocker", () => {
  it("advances straight into the first-message confirmation", () => {
    const { rerender, props } = renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Resolve 2 blockers" }));

    rerender(
      <RecommendedNextMoveCard
        {...props}
        move={readyMove}
        blockers={[]}
        firstMessageReady={true}
      />,
    );

    expect(screen.queryByRole("region", { name: "Resolve the way in" })).toBeNull();
    expect(screen.getByText(/Carry Dozen Bakery into Comms\?/)).toBeTruthy();
    expect(screen.getByText(/Nothing is sent automatically/)).toBeTruthy();
  });
});

/* ----------------------------------------------- C · ready means outreach */

describe("a ready handoff", () => {
  it("shows the outreach headline and asks before anything leaves Scout", () => {
    const { props } = renderCard({ move: readyMove, blockers: [], firstMessageReady: true });
    expect(
      screen.getByRole("heading", { name: "Start with email to Claire Meneely" }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Prepare first message" }));
    expect(props.onPrepareFirstMessage).not.toHaveBeenCalled();

    fireEvent.click(screen.getAllByRole("button", { name: "Prepare first message" }).at(-1)!);
    expect(props.onPrepareFirstMessage).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------------- F · research state truth */

describe("prepare research feedback", () => {
  const researchMove = buildRecommendedNextMove({
    candidate: { ...candidate, development: undefined } as unknown as ProspectCandidate,
    people: [claire],
    now: new Date("2026-08-24T00:00:00.000Z"),
  });

  it("shows the working state in place while research is prepared", () => {
    renderCard({ move: researchMove, blockers: [], preparingBrief: true });
    expect(screen.getByRole("status").textContent).toContain("Preparing relationship research");
  });

  it("shows failure inline with a retry that re-invokes the governed action", () => {
    const { props } = renderCard({
      move: researchMove,
      blockers: [],
      prepareError: "Research could not be prepared.",
    });
    expect(screen.getByRole("alert").textContent).toContain("Research was not prepared.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(props.onPrepareBrief).toHaveBeenCalledWith(false);
  });
});

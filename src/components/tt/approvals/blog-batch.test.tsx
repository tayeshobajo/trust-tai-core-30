// @vitest-environment jsdom

/**
 * The bug Tai reported, proved at the DOM.
 *
 * Ten flagged articles, each with a tick box that could not be ticked, read as
 * broken. These tests hold the fix: a flagged article has no tick box at all,
 * the whole card and its button open one compact review, the reason is asked
 * for only then, approval is closed until a real reason is given, reading the
 * article never selects it, and the approval calls the one governed handler.
 * Ready articles keep their tick boxes, and an accepted article reads as
 * accepted once the data comes back.
 */

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { blogBatchSubmission } from "@/data/approvals/submissions";
import type { ApprovalItem, ApprovalRequest } from "@/domain/approvals";

import { ApprovalWorkspace } from "./approval-workspace";
import { rendererFor } from "./renderers";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
    onClick,
    className,
  }: {
    children: React.ReactNode;
    to: string;
    params?: Record<string, string>;
    onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
    className?: string;
  }) => (
    <a
      href={params ? to.replace("$itemId", params["itemId"] ?? "") : to}
      onClick={(event) => {
        event.preventDefault();
        onClick?.(event);
      }}
      className={className}
    >
      {children}
    </a>
  ),
}));

(globalThis as Record<string, unknown>)["IS_REACT_ACT_ENVIRONMENT"] = true;

afterEach(cleanup);

/* ------------------------------------------------------------ fixtures */

const NOW = "2026-09-10T09:00:00.000Z";

function build(
  spec: Array<{ slug: string; state: "ready" | "exception" | "approved"; by?: string }>,
): { request: ApprovalRequest; items: ApprovalItem[] } {
  const submission = blogBatchSubmission({
    batchId: "cbat_test",
    campaignName: "Spring series",
    items: spec.map((entry) => ({
      slug: entry.slug,
      title: `Post ${entry.slug.toUpperCase()}`,
      state: entry.state === "approved" ? "ready" : entry.state,
      ...(entry.state === "exception" ? { exceptionReasons: ["low_confidence" as const] } : {}),
      hitScore: entry.state === "exception" ? 44 : 82,
    })),
  });

  const items: ApprovalItem[] = submission.items.map((item, index) => {
    const wanted = spec[index]!;
    return {
      id: `item-${wanted.slug}`,
      requestId: "apr_test",
      position: index,
      title: item.title,
      state: wanted.state,
      exceptionReasons: item.exceptionReasons ?? [],
      facts: {
        ...item.facts,
        contentItemId: `citm_${wanted.slug}`,
        ...(wanted.state === "approved" && wanted.by
          ? { override: { reason: "Read it end to end.", by: { id: "u1", label: wanted.by }, at: NOW } }
          : {}),
      },
    } as ApprovalItem;
  });

  const exceptions = items.filter((item) => item.state === "exception").length;
  const request = {
    id: "apr_test",
    organizationId: "org-1",
    sourceApp: submission.sourceApp,
    sourceEntity: submission.sourceEntity,
    approvalType: submission.approvalType,
    title: submission.title,
    summary: submission.summary,
    whyItNeedsYou: submission.whyItNeedsYou,
    urgency: "today",
    impact: "external",
    status: "needs_review",
    revision: 1,
    payload: submission.payload,
    boundary: submission.boundary,
    submittedBy: { id: "content-engine", label: "Content Engine" },
    createdAt: NOW,
    updatedAt: NOW,
    batch: {
      total: items.length,
      ready: items.filter((item) => item.state === "ready").length,
      exceptions,
      exceptionReasons: exceptions > 0 ? ["low_confidence"] : [],
    },
  } as unknown as ApprovalRequest;

  return { request, items };
}

function renderBatch(
  items: ApprovalItem[],
  request: ApprovalRequest,
  overrides: Partial<{
    refusal: string | null;
    pending: boolean;
    onSubmit: (itemId: string, reason: string) => void;
    onToggle: (itemId: string) => void;
    selected: Set<string>;
  }> = {},
) {
  const Renderer = rendererFor("content_batch");
  const onSubmit = overrides.onSubmit ?? vi.fn();
  const onToggle = overrides.onToggle ?? vi.fn();
  const view = render(
    <Renderer
      request={request}
      items={items}
      selected={overrides.selected ?? new Set()}
      onToggle={onToggle}
      override={{
        refusal: overrides.refusal ?? null,
        pending: overrides.pending ?? false,
        onSubmit,
      }}
    />,
  );
  return { ...view, onSubmit, onToggle };
}

const card = (title: string) =>
  screen.getByText(title).closest("[data-item-state]") as HTMLElement;

/* ---------------------------------------------------------------- tests */

describe("a flagged article", () => {
  it("has no tick box, disabled or otherwise", () => {
    const { request, items } = build([{ slug: "a", state: "exception" }]);
    renderBatch(items, request);

    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(card("Post A").getAttribute("data-item-state")).toBe("exception");
    expect(screen.getByRole("button", { name: /review & approve/i })).toBeEnabled();
  });

  it("keeps its reason panel hidden until review is opened", () => {
    const { request, items } = build([{ slug: "a", state: "exception" }]);
    renderBatch(items, request);

    expect(screen.queryByTestId("review-panel")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("opens for review from its button", () => {
    const { request, items } = build([{ slug: "a", state: "exception" }]);
    renderBatch(items, request);

    fireEvent.click(screen.getByRole("button", { name: /review & approve/i }));

    expect(screen.getByTestId("review-panel")).toBeTruthy();
    expect(card("Post A").getAttribute("data-reviewing")).toBe("true");
    expect(screen.getByRole("button", { name: /approve this article/i })).toBeTruthy();
    expect(screen.getByText(/nothing is queued or published/i)).toBeTruthy();
  });

  it("opens for review from anywhere on the card", () => {
    const { request, items } = build([{ slug: "a", state: "exception" }]);
    renderBatch(items, request);

    fireEvent.click(screen.getByText("Post A"));

    expect(screen.getByTestId("review-panel")).toBeTruthy();
  });

  it("does not open when 'Read the article' is clicked", () => {
    const { request, items } = build([{ slug: "a", state: "exception" }]);
    renderBatch(items, request);

    const link = screen.getByRole("link", { name: /read the article/i });
    expect(link.getAttribute("href")).toBe("/modules/studio/citm_a");
    fireEvent.click(link);

    expect(screen.queryByTestId("review-panel")).toBeNull();
    expect(card("Post A").hasAttribute("data-reviewing")).toBe(false);
  });

  it("keeps approval closed until a real reason is written", () => {
    const { request, items } = build([{ slug: "a", state: "exception" }]);
    const { onSubmit } = renderBatch(items, request);

    fireEvent.click(screen.getByRole("button", { name: /review & approve/i }));
    const approve = screen.getByRole("button", { name: /approve this article/i });
    expect(approve).toBeDisabled();

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "ok" } });
    expect(approve).toBeDisabled();
    fireEvent.click(approve);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("calls the governed override with this item and the reason", () => {
    const { request, items } = build([
      { slug: "a", state: "exception" },
      { slug: "b", state: "exception" },
    ]);
    const { onSubmit } = renderBatch(items, request);

    fireEvent.click(within(card("Post B")).getByRole("button", { name: /review & approve/i }));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Read it end to end and the claim holds." },
    });
    fireEvent.click(screen.getByRole("button", { name: /approve this article/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith("item-b", "Read it end to end and the claim holds.");
  });

  it("opens one review at a time", () => {
    const { request, items } = build([
      { slug: "a", state: "exception" },
      { slug: "b", state: "exception" },
    ]);
    renderBatch(items, request);

    fireEvent.click(within(card("Post A")).getByRole("button", { name: /review & approve/i }));
    expect(screen.getAllByTestId("review-panel")).toHaveLength(1);

    fireEvent.click(within(card("Post B")).getByRole("button", { name: /review & approve/i }));
    const panels = screen.getAllByTestId("review-panel");
    expect(panels).toHaveLength(1);
    expect(card("Post B").getAttribute("data-reviewing")).toBe("true");
    expect(card("Post A").hasAttribute("data-reviewing")).toBe(false);
  });

  it("closes on Cancel without calling anything", () => {
    const { request, items } = build([{ slug: "a", state: "exception" }]);
    const { onSubmit } = renderBatch(items, request);

    fireEvent.click(screen.getByRole("button", { name: /review & approve/i }));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(screen.queryByTestId("review-panel")).toBeNull();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("offers no way in to a person who may not decide here", () => {
    const { request, items } = build([{ slug: "a", state: "exception" }]);
    renderBatch(items, request, {
      refusal: "Approving work is a leadership act. Ask an owner or admin.",
    });

    expect(screen.queryByRole("button", { name: /review & approve/i })).toBeNull();
    fireEvent.click(screen.getByText("Post A"));
    expect(screen.queryByTestId("review-panel")).toBeNull();
    expect(screen.getByText(/leadership act/i)).toBeTruthy();
  });
});

describe("a ready article", () => {
  it("keeps the familiar tick box and bulk selection", () => {
    const { request, items } = build([
      { slug: "a", state: "ready" },
      { slug: "b", state: "exception" },
    ]);
    const { onToggle } = renderBatch(items, request, { selected: new Set(["item-a"]) });

    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(1);
    expect((boxes[0] as HTMLInputElement).checked).toBe(true);
    expect(boxes[0]).toBeEnabled();

    fireEvent.click(boxes[0]!);
    expect(onToggle).toHaveBeenCalledWith("item-a");
    expect(screen.queryByTestId("review-panel")).toBeNull();
  });
});

describe("an accepted article", () => {
  it("renders as approved, with who accepted it and why, once the data returns", () => {
    const { request, items } = build([
      { slug: "a", state: "approved", by: "Tai" },
      { slug: "b", state: "exception" },
    ]);
    renderBatch(items, request);

    const accepted = card("Post A");
    expect(accepted.getAttribute("data-item-state")).toBe("approved");
    expect(within(accepted).getByText("Approved")).toBeTruthy();
    expect(within(accepted).getByText(/accepted by tai/i)).toBeTruthy();
    expect(within(accepted).queryByRole("button", { name: /review & approve/i })).toBeNull();
    expect(within(accepted).queryByRole("checkbox")).toBeNull();
  });

  it("reads as the instruction line for what is left", () => {
    const { request, items } = build([
      { slug: "a", state: "approved", by: "Tai" },
      { slug: "b", state: "exception" },
    ]);
    renderBatch(items, request);

    expect(screen.getByTestId("batch-review-line").textContent).toMatch(/1 article needs your review/i);
  });
});

describe("the decision bar", () => {
  const trail = () => [];

  it("never shows an approve-zero primary action when every article is flagged", () => {
    const { request, items } = build([
      { slug: "a", state: "exception" },
      { slug: "b", state: "exception" },
      { slug: "c", state: "exception" },
    ]);
    const onDecide = vi.fn();
    render(
      <ApprovalWorkspace
        request={request}
        items={items}
        events={trail()}
        refusal={null}
        pending={false}
        onDecide={onDecide}
        onNote={vi.fn()}
        onOverrideItem={vi.fn()}
      />,
    );

    const bar = screen.getByTestId("decision-bar");
    expect(within(bar).queryByRole("button", { name: /approve 0/i })).toBeNull();
    expect(within(bar).queryByRole("button", { name: /^approve/i })).toBeNull();
    expect(within(bar).getByTestId("bulk-closed").textContent).toMatch(/one at a time/i);
    expect(within(bar).getByRole("button", { name: /send back/i })).toBeTruthy();
    expect(within(bar).getByRole("button", { name: /not now/i })).toBeTruthy();
    expect(within(bar).getByRole("link", { name: /open source/i })).toBeTruthy();
    expect(screen.getByText(/3 articles need your review before they can be approved/i)).toBeTruthy();
  });

  it("shows the bulk count when ready articles exist", () => {
    const { request, items } = build([
      { slug: "a", state: "ready" },
      { slug: "b", state: "ready" },
      { slug: "c", state: "exception" },
    ]);
    const onDecide = vi.fn();
    render(
      <ApprovalWorkspace
        request={request}
        items={items}
        events={trail()}
        refusal={null}
        pending={false}
        onDecide={onDecide}
        onNote={vi.fn()}
        onOverrideItem={vi.fn()}
      />,
    );

    const bar = screen.getByTestId("decision-bar");
    const approve = within(bar).getByRole("button", { name: /approve 2 of 2 ready/i });
    expect(approve).toBeEnabled();
    fireEvent.click(approve);
    expect(onDecide).toHaveBeenCalledTimes(1);
    expect(onDecide.mock.calls[0]![0].action.id).toBe("approve_ready");
    expect(onDecide.mock.calls[0]![0].itemIds.sort()).toEqual(["item-a", "item-b"]);
  });

  it("keeps Send back and Not now closed until a reason is given, and never routes Open source through onDecide", () => {
    const { request, items } = build([{ slug: "a", state: "exception" }]);
    const onDecide = vi.fn();
    render(
      <ApprovalWorkspace
        request={request}
        items={items}
        events={trail()}
        refusal={null}
        pending={false}
        onDecide={onDecide}
        onNote={vi.fn()}
        onOverrideItem={vi.fn()}
      />,
    );

    const bar = screen.getByTestId("decision-bar");
    expect(within(bar).getByRole("button", { name: /send back/i })).toBeDisabled();
    expect(within(bar).getByRole("button", { name: /not now/i })).toBeDisabled();

    fireEvent.click(within(bar).getByRole("link", { name: /open source/i }));
    expect(onDecide).not.toHaveBeenCalled();

    fireEvent.change(within(bar).getByRole("textbox"), { target: { value: "Voice is off." } });
    fireEvent.click(within(bar).getByRole("button", { name: /send back/i }));
    expect(onDecide).toHaveBeenCalledTimes(1);
    expect(onDecide.mock.calls[0]![0].action.id).toBe("request_revision");
    expect(onDecide.mock.calls[0]![0].reason).toBe("Voice is off.");
  });
});

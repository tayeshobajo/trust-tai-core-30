import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FeaturedImageReview } from "@/components/tt/studio/featured-image";
import { PeopleWorkspace } from "@/components/tt/studio/people-workspace";
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, ...props }: any) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/tt/studio/studio-shell", () => ({
  StudioShell: ({ children, onSearch }: any) => (
    <main>
      <input aria-label="Search workspace people" onChange={(e) => onSearch(e.target.value)} />
      {children}
    </main>
  ),
  StudioState: ({ title, children, onRetry }: any) => (
    <div>
      <h2>{title}</h2>
      {children}
      {onRetry && <button onClick={onRetry}>Try again</button>}
    </div>
  ),
}));
vi.mock("@/data/supabase/contacts", () => ({
  listOrganizationContacts: vi.fn(async () =>
    Array.from({ length: 30 }, (_, i) => ({
      id: String(i),
      fullName: `Example Person ${i + 1}`,
      roleTitle: "Founder",
      seniority: "founder",
      confidence: "human_confirmed",
      note: "Fictional test record",
    })),
  ),
}));
afterEach(cleanup);
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:local-preview");
  URL.revokeObjectURL = vi.fn();
});
const image = {
  state: "ready" as const,
  brief: "A team handing over a real project",
  altText: "A team at a whiteboard",
  assetUrl: "https://example.com/image.png",
  provider: null,
};
describe("featured image review", () => {
  it("keeps approval and generation disabled while allowing a local preview and discard", () => {
    render(<FeaturedImageReview image={image} title="A useful handoff" />);
    expect(
      (screen.getByRole("button", { name: "Approve image" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Request image" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    const input = screen.getByLabelText("Choose image for local preview");
    fireEvent.change(input, {
      target: { files: [new File(["image"], "image.png", { type: "image/png" })] },
    });
    expect(screen.getByText("Local preview · unsaved")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Discard local preview" }));
    expect(screen.getByText("Review required")).toBeTruthy();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:local-preview");
  });
  it("keeps notes through a failed image and allows retry without claiming readiness", () => {
    render(<FeaturedImageReview image={image} title="A useful handoff" />);
    fireEvent.change(screen.getByLabelText("Revision notes · unsaved"), {
      target: { value: "Use a real project context" },
    });
    fireEvent.error(screen.getByRole("img"));
    expect(screen.getByRole("alert").textContent).toContain("could not be displayed");
    expect(screen.getByText("Image unavailable")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry image" }));
    expect(screen.getByRole("img")).toBeTruthy();
    expect((screen.getByLabelText("Revision notes · unsaved") as HTMLTextAreaElement).value).toBe(
      "Use a real project context",
    );
  });
  it("rejects unsupported upload without losing the existing asset", () => {
    render(<FeaturedImageReview image={image} title="A useful handoff" />);
    fireEvent.change(screen.getByLabelText("Choose image for local preview"), {
      target: { files: [new File(["bad"], "image.svg", { type: "image/svg+xml" })] },
    });
    expect(screen.getByRole("alert").textContent).toContain("JPEG");
    expect(screen.getByRole("img").getAttribute("src")).toBe(image.assetUrl);
  });
});
it("bounds people results and opens details immediately with a return focus target", async () => {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <PeopleWorkspace
        identity={{ organizationId: "test", name: "Test", apps: [{ appId: "clients" }] } as any}
      />
    </QueryClientProvider>,
  );
  await screen.findByText("Example Person 1");
  expect(screen.getAllByRole("article")).toHaveLength(24);
  const trigger = screen.getByRole("button", { name: "View Example Person 1" });
  trigger.focus();
  fireEvent.click(trigger);
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByRole("heading", { name: "Example Person 1" })).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getAllByRole("article")).toHaveLength(6);
  fireEvent.change(screen.getByLabelText("Search workspace people"), {
    target: { value: "Person 1" },
  });
  expect(screen.getByText("Example Person 1")).toBeTruthy();
});

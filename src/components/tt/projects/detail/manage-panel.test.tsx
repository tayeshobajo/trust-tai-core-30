// @vitest-environment jsdom
import { RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ManageProjectPanel } from "./manage-panel";
import type { ExecutionProject } from "@/domain/projects";

afterEach(cleanup);

function project(overrides: Partial<ExecutionProject> = {}): ExecutionProject {
  return {
    id: "p1",
    organizationId: "o1",
    name: "Mental Dental Academy",
    state: "in_flight",
    ownerLabel: "Tai",
    pointA: "Nothing recorded yet.",
    pointB: "The academy is live.",
    deliveryItems: [
      { label: "Scope agreed", done: true },
      { label: "First build", done: false },
    ],
    evidence: [],
    dependencies: [],
    origin: { kind: "manual", subjectLabel: "Mental Dental" },
    lastMovedAt: "2026-09-01T00:00:00.000Z",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("ManageProjectPanel", () => {
  it("saves a corrected name through the projects service contract", () => {
    const onUpdate = vi.fn();
    render(
      <ManageProjectPanel project={project()} busy={false} savedLabel={null} onUpdate={onUpdate} />,
    );

    fireEvent.change(screen.getByDisplayValue("Mental Dental Academy"), {
      target: { value: "Mental Dental Academy v2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save details" }));

    expect(onUpdate).toHaveBeenCalledWith({ name: "Mental Dental Academy v2" });
  });

  it("refuses a blank name before anything is written", () => {
    const onUpdate = vi.fn();
    render(
      <ManageProjectPanel project={project()} busy={false} savedLabel={null} onUpdate={onUpdate} />,
    );

    fireEvent.change(screen.getByDisplayValue("Mental Dental Academy"), {
      target: { value: "  " },
    });

    expect(
      (screen.getByRole("button", { name: "Save details" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByRole("alert").textContent).toMatch(/needs a name/i);
  });

  it("keeps ticks on delivery items that survive an edit", () => {
    const onUpdate = vi.fn();
    render(
      <ManageProjectPanel project={project()} busy={false} savedLabel={null} onUpdate={onUpdate} />,
    );

    fireEvent.change(screen.getByPlaceholderText(/Scope agreed/), {
      target: { value: "Scope agreed\nFirst build\nHanded over" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save details" }));

    expect(onUpdate).toHaveBeenCalledWith({
      deliveryItems: [
        { label: "Scope agreed", done: true },
        { label: "First build", done: false },
        { label: "Handed over", done: false },
      ],
    });
  });

  it("cannot create a label that disagrees with the real client, and offers the client's page", async () => {
    const linked = project({ clientId: "client-1" });
    await renderInRouter(
      <ManageProjectPanel project={linked} busy={false} savedLabel={null} onUpdate={vi.fn()} />,
    );

    const field = screen.getByDisplayValue("Mental Dental") as HTMLInputElement;
    expect(field.readOnly).toBe(true);
    expect(screen.getByText(/attached to a Client record/i)).toBeTruthy();
    const link = screen.getByRole("link", { name: "Open the client" }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toContain("/modules/clients/client-1");
  });

  it("says who owns the company field when it came from a roadmap", () => {
    render(
      <ManageProjectPanel
        project={project({
          origin: { kind: "roadmap_milestone", roadmapId: "r1", subjectLabel: "X" },
        })}
        busy={false}
        savedLabel={null}
        onUpdate={vi.fn()}
      />,
    );
    expect(screen.getByText(/Roadmap owns this/i)).toBeTruthy();
  });

  it("still carries the move controls and the wait", () => {
    const onUpdate = vi.fn();
    render(
      <ManageProjectPanel
        project={project()}
        busy={false}
        savedLabel="Saved."
        onUpdate={onUpdate}
      />,
    );

    expect(screen.getByRole("status").textContent).toBe("Saved.");
    fireEvent.click(screen.getByRole("button", { name: "In review" }));
    expect(onUpdate).toHaveBeenCalledWith({ state: "in_review" });

    fireEvent.change(screen.getByLabelText("Next move"), { target: { value: "Send the draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Record next move" }));
    expect(onUpdate).toHaveBeenCalledWith({ nextMove: "Send the draft" });
  });
});

/** The panel deep-links, so a router has to exist around it. */
async function renderInRouter(ui: React.ReactElement) {
  const root = createRootRoute({ component: () => ui });
  const index = createRoute({ getParentRoute: () => root, path: "/", component: () => ui });
  const client = createRoute({
    getParentRoute: () => root,
    path: "/modules/clients/$clientId",
    component: () => null,
  });
  const router = createRouter({
    routeTree: root.addChildren([index, client]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(<RouterProvider router={router as never} />);
  await screen.findByText("Project details");
}

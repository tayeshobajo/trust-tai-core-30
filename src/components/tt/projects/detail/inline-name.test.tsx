// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InlineProjectName } from "./inline-name";
import type { ExecutionProject } from "@/domain/projects";

afterEach(cleanup);

function project(overrides: Partial<ExecutionProject> = {}): ExecutionProject {
  return {
    id: "p1",
    organizationId: "o1",
    name: "Mental Dental Academy",
    state: "in_flight",
    pointA: "Nothing recorded yet.",
    pointB: "The academy is live.",
    evidence: [],
    dependencies: [],
    origin: { kind: "manual", subjectLabel: "Mental Dental" },
    lastMovedAt: "2026-09-01T00:00:00.000Z",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("InlineProjectName", () => {
  it("reads as a title until someone clicks it, then saves on Enter", () => {
    const onRename = vi.fn();
    render(
      <InlineProjectName project={project()} busy={false} savedLabel={null} onRename={onRename} />,
    );

    expect(screen.getByRole("heading", { name: "Mental Dental Academy" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Edit project name/i }));

    const field = screen.getByLabelText("Project name") as HTMLInputElement;
    expect(field.value).toBe("Mental Dental Academy");
    fireEvent.change(field, { target: { value: "Mental Dental Academy v2" } });
    fireEvent.keyDown(field, { key: "Enter" });

    expect(onRename).toHaveBeenCalledWith("Mental Dental Academy v2");
  });

  it("writes nothing on Escape and restores the recorded name", () => {
    const onRename = vi.fn();
    render(
      <InlineProjectName project={project()} busy={false} savedLabel={null} onRename={onRename} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Edit project name/i }));
    const field = screen.getByLabelText("Project name");
    fireEvent.change(field, { target: { value: "Half typed" } });
    fireEvent.keyDown(field, { key: "Escape" });

    expect(onRename).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Mental Dental Academy" })).toBeTruthy();
  });

  it("does not write while typing", () => {
    const onRename = vi.fn();
    render(
      <InlineProjectName project={project()} busy={false} savedLabel={null} onRename={onRename} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Edit project name/i }));
    fireEvent.change(screen.getByLabelText("Project name"), { target: { value: "M" } });
    expect(onRename).not.toHaveBeenCalled();
  });

  it("refuses a blank name in the same words as the service", () => {
    const onRename = vi.fn();
    render(
      <InlineProjectName project={project()} busy={false} savedLabel={null} onRename={onRename} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Edit project name/i }));
    const field = screen.getByLabelText("Project name");
    fireEvent.change(field, { target: { value: "   " } });

    expect(screen.getByRole("alert").textContent).toMatch(/needs a name/i);
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onRename).not.toHaveBeenCalled();
  });

  it("confirms quietly once the room reports the save", () => {
    render(
      <InlineProjectName project={project()} busy={false} savedLabel="Saved." onRename={vi.fn()} />,
    );
    expect(screen.getByRole("status").textContent).toBe("Saved.");
  });
});

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  Link: ({
    to,
    children,
    activeOptions: _activeOptions,
    ...props
  }: {
    to: string;
    children: ReactNode;
    activeOptions?: unknown;
  }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));
import { CommsTabs } from "./comms-tabs";
afterEach(() => {
  cleanup();
  navigate.mockReset();
});

describe("consistent Comms navigation", () => {
  it.each([false, true])("shows the same three primary links with workspace=%s", (workspace) => {
    render(<CommsTabs active="integrations" workspace={workspace} />);
    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Conversations",
      "Accounts & Connections",
      "Voice DNA",
    ]);
    expect(
      screen.getByRole("link", { name: "Accounts & Connections" }).getAttribute("aria-current"),
    ).toBe("page");
    expect(screen.queryByText("Templates")).toBeNull();
    expect(screen.getByRole("button", { name: "New Message" })).toBeTruthy();
  });
  it("retains keyboard-accessible saved-writing and history links under More", async () => {
    render(<CommsTabs active="drafts" />);
    fireEvent.keyDown(screen.getByRole("button", { name: "More Comms options" }), {
      key: "ArrowDown",
    });
    const saved = await screen.findByRole("menuitem", { name: "Saved writing" });
    expect(saved.getAttribute("href")).toBe("/modules/comms/drafts");
    expect(saved.getAttribute("aria-current")).toBe("page");
    expect(
      screen.getByRole("menuitem", { name: "Communication records" }).getAttribute("href"),
    ).toBe("/modules/comms/history");
    fireEvent.keyDown(saved, { key: "Escape" });
    expect(screen.queryByRole("menuitem", { name: "Saved writing" })).toBeNull();
  });
  it.each(["Message", "Email", "Proposal"])(
    "opens existing %s intake without creating or sending a record",
    (kind) => {
      render(<CommsTabs active="conversations" />);
      fireEvent.click(screen.getByRole("button", { name: "New Message" }));
      fireEvent.click(screen.getByRole("menuitem", { name: kind }));
      expect(navigate).toHaveBeenCalledExactlyOnceWith({
        to: "/modules/comms/drafts",
        search: { new: kind.toLowerCase() },
      });
      expect(screen.queryByRole("menu")).toBeNull();
    },
  );
});

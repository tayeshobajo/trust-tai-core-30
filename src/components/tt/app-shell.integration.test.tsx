// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { readFileSync } from "node:fs";
import { AppShell } from "./app-shell";
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
  useNavigate: () => vi.fn(),
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname: "/modules/comms/relationships" } }),
}));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({}) }));
vi.mock("@/hooks/use-presence", () => ({ usePresence: vi.fn() }));
vi.mock("@/lib/workspace", () => ({ signOut: vi.fn() }));
afterEach(cleanup);
describe("integrated room shell isolation", () => {
  it.each(["default", "workroom", "roadmap"] as const)(
    "retains the %s canvas without opting into Comms",
    (canvas) => {
      const { container } = render(
        <AppShell canvas={canvas}>
          <p>Room</p>
        </AppShell>,
      );
      expect(container.firstElementChild?.hasAttribute("data-shell-appearance")).toBe(false);
      expect(container.querySelector("aside")?.className.includes("w-[184px]")).toBe(
        canvas === "roadmap",
      );
      expect(container.querySelector("main")?.className.includes("@container/workroom")).toBe(
        canvas !== "default",
      );
      expect(container.querySelector(".tt-shell-canvas")?.className.includes("max-w-canvas")).toBe(
        canvas === "default",
      );
      fireEvent.click(
        screen.getByRole("button", {
          name: canvas === "default" ? "Open navigation" : "Open app navigation",
        }),
      );
      expect(
        screen.getAllByRole("navigation", { name: "Trust Tai suite", hidden: true }).length,
      ).toBeGreaterThan(1);
    },
  );
  it.each(["default", "workroom", "roadmap"] as const)(
    "Comms appearance composes with %s",
    (canvas) => {
      const { container } = render(
        <AppShell appearance="comms" canvas={canvas}>
          Comms
        </AppShell>,
      );
      expect(container.firstElementChild?.getAttribute("data-shell-appearance")).toBe("comms");
      expect(container.querySelector(".tt-shell-main")).not.toBeNull();
      expect(container.querySelector("main")?.className.includes("@container/workroom")).toBe(
        canvas !== "default",
      );
    },
  );
  it("routes opt into their own presentation while retaining access gates", () => {
    const comms = readFileSync("src/routes/modules.comms.relationships.tsx", "utf8");
    const roadmap = readFileSync("src/routes/modules.roadmap.index.tsx", "utf8");
    expect(comms).toContain('appearance="comms"');
    expect(roadmap).toContain('canvas={view === "evidence" ? "roadmap" : "default"}');
    expect(roadmap).not.toContain('appearance="comms"');
    expect(comms).toContain('<WorkspaceGate appId="comms">');
    expect(roadmap).toContain('<WorkspaceGate appId="roadmap">');
  });
});

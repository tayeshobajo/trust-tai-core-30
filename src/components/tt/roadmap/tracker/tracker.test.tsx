// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { trackerBaseline } from "@/data/roadmap-tracker/baseline.server";
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
vi.mock("@/components/tt/primitives", () => ({
  TTButton: ({
    children,
    variant: _variant,
    ...props
  }: React.ComponentProps<"button"> & { variant?: string }) => (
    <button {...props}>{children}</button>
  ),
  TTInput: (props: React.ComponentProps<"input">) => <input {...props} />,
}));
vi.mock("@/integrations/trust-tai/supabase", () => ({
  supabase: {
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: "user" }, access_token: "token" } },
        error: null,
      }),
    },
  },
}));
import { RoadmapTracker } from "./tracker";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function mount(readError = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RoadmapTracker
        organizationId="org"
        userId="user"
        roadmaps={[]}
        loading={false}
        readError={readError}
      />
    </QueryClientProvider>,
  );
}
it("reviews all source columns and stale Elevate without an apply or send action", async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => trackerBaseline });
  vi.stubGlobal("fetch", fetch);
  mount();
  await screen.findByText(/12 source rows need/);
  expect(screen.getByText(/No recorded closed outcomes/)).toBeTruthy();
  fireEvent.click(screen.getAllByRole("button", { name: "Review Elevate" })[0]!);
  expect(screen.getByText("Current Conversation Position")).toBeTruthy();
  expect(screen.getByRole("link", { name: /October 2/ }).getAttribute("href")).toContain(
    "1a0fe768c3425eb3",
  );
  expect(screen.queryByRole("button", { name: /apply|send/i })).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0]![1].method).toBeUndefined();
});
it("filters the tracker and keeps unknowns explicit", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => trackerBaseline }),
  );
  mount();
  await screen.findByText(/12 source rows need/);
  fireEvent.change(screen.getByRole("textbox", { name: /Find a source/ }), {
    target: { value: "SASE" },
  });
  expect(screen.getByText("1 of 12 rows · No live import applied")).toBeTruthy();
  fireEvent.click(screen.getAllByRole("button", { name: "Review SASE" })[0]!);
  expect(screen.getAllByText("Unknown · blank in source").length).toBe(11);
});
it("does not show an empty-success result when canonical reads fail", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => trackerBaseline }),
  );
  mount(true);
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.queryByText(/No recorded closed outcomes/)).toBeNull();
});

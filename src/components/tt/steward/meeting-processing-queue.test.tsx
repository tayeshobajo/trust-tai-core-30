import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { StoredConversation } from "@/data/supabase/steward-service";
import type { WorkspaceIdentity } from "@/lib/workspace";
const process = vi.hoisted(() => vi.fn());
vi.mock("@/data/steward/ingest", () => ({ interpretConversation: process }));
import { MeetingProcessingQueue } from "./meeting-processing-queue";
const identity = {
  organizationId: "org",
  userId: "user",
  apps: [{ appId: "steward", canWork: true }],
} as WorkspaceIdentity;
const meetings = [1, 2, 3].map((n) => ({
  id: String(n),
  title: `Meeting ${n}`,
  conversation: { segments: [{ text: "fixture" }] },
})) as StoredConversation[];
afterEach(() => {
  cleanup();
  process.mockReset();
});
it("does not process on mount and saves sequentially until failure, with partial progress visible", async () => {
  process.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("Provider unavailable"));
  const saved = vi.fn(async () => {});
  render(
    <MeetingProcessingQueue
      identity={identity}
      meetings={meetings}
      readings={new Map()}
      onSaved={saved}
    />,
  );
  expect(process).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /Prepare 3/ }));
  await screen.findByText(/1 readings saved. Processing stopped: Provider unavailable/);
  expect(process).toHaveBeenCalledTimes(2);
  expect(saved).toHaveBeenCalledTimes(1);
});
it("resumes only unsaved, available transcripts and never confirms a task", async () => {
  process.mockResolvedValue({});
  const loaded = [
    ...meetings,
    { id: "missing", conversation: { segments: [] } },
  ] as StoredConversation[];
  const readings = new Map([["1", { result: {} as never, message: "saved" }]]);
  render(
    <MeetingProcessingQueue
      identity={identity}
      meetings={loaded}
      readings={readings}
      onSaved={async () => {}}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /Prepare 2/ }));
  await waitFor(() => expect(process).toHaveBeenCalledTimes(2));
  expect(process.mock.calls.map((call) => call[0].conversationId)).toEqual(["2", "3"]);
  await screen.findByText(/No tasks were confirmed automatically/);
  expect(screen.getByText(/1 meeting transcripts are missing/)).toBeTruthy();
});

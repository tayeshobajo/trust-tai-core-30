import { supabase } from "@/integrations/trust-tai/supabase";
import type { Roadmap } from "@/domain/roadmap";
import type { TrackerPatch } from "@/domain/roadmap-tracker-edit";

export class TrackerSaveError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly current?: Roadmap,
  ) {
    super(message);
  }
}
export interface TrackerSaveInput {
  organizationId: string;
  roadmapId: string;
  operationId: string;
  expectedRevision: string;
  patch: TrackerPatch;
}
export interface TrackerSaveResult {
  roadmap: Roadmap;
  warning?: string | null;
  replayed?: boolean;
  unchanged?: boolean;
}
async function call(
  userId: string,
  url: string,
  input?: TrackerSaveInput,
): Promise<TrackerSaveResult> {
  const session = await supabase.auth.getSession();
  if (session.error || session.data.session?.user.id !== userId)
    throw new TrackerSaveError("Your session changed. Sign in again.", 401);
  const response = await fetch(url, {
    method: input ? "PATCH" : "GET",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${session.data.session.access_token}`,
      ...(input ? { "Content-Type": "application/json" } : {}),
    },
    ...(input ? { body: JSON.stringify(input) } : {}),
  });
  const result = await response.json();
  const after = await supabase.auth.getSession();
  if (after.error || after.data.session?.user.id !== userId)
    throw new TrackerSaveError(
      "Your session changed. Reopen the tracker and check the saved state.",
      401,
    );
  if (!response.ok)
    throw new TrackerSaveError(
      result.error || "The save was not confirmed.",
      response.status,
      result.current,
    );
  return result as TrackerSaveResult;
}
export const trackerEditorClient = {
  read: (org: string, id: string, user: string) =>
    call(
      user,
      `/api/public/roadmap/tracker?organizationId=${encodeURIComponent(org)}&roadmapId=${encodeURIComponent(id)}`,
    ),
  save: (input: TrackerSaveInput, user: string) => call(user, "/api/public/roadmap/tracker", input),
};

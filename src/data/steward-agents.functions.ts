import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { StewardAgentRead } from "@/domain/steward-accountability";

/** Read the Paperclip workforce for one workspace. Membership is enforced. */
export const getStewardAgents = createServerFn({ method: "GET" })
  .inputValidator((data: { organizationId: string }) => data)
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }): Promise<StewardAgentRead> => {
    const { assertStewardMembership, readStewardAgents } = await import(
      "@/lib/steward-agents.server"
    );
    await assertStewardMembership(context, data.organizationId);
    return await readStewardAgents(data.organizationId);
  });

/**
 * Hand one bounded task to a Paperclip agent. Steward asks; Paperclip decides
 * how and when it runs, and reports its own completion.
 *
 * Idempotency is enforced via `execution_bindings.idempotency_key`. Passing
 * `sourceEntityId` (the Trust Tai task key) prevents duplicate Paperclip
 * issues even on retry.
 */
export const assignStewardAgentTask = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      organizationId: string;
      agentId: string;
      title: string;
      description: string;
      /** Trust Tai task key — used as idempotency key base. */
      sourceEntityId?: string | null;
      sourceEntityType?: string | null;
      sourceApp?: string | null;
    }) => data,
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }): Promise<{ issueId: string; bindingId: string; isNew: boolean }> => {
    const { assertStewardMembership, assignPaperclipTask } = await import(
      "@/lib/steward-agents.server"
    );
    await assertStewardMembership(context, data.organizationId);
    return await assignPaperclipTask({
      organizationId: data.organizationId,
      agentId: data.agentId,
      title: data.title,
      description: data.description,
      sourceEntityId: data.sourceEntityId ?? null,
      sourceEntityType: data.sourceEntityType ?? null,
      sourceApp: data.sourceApp ?? "steward",
    });
  });

/**
 * Pause or resume a Paperclip agent. Reflects the new state immediately.
 * Steward does not store its own paused flag — Paperclip owns execution state.
 */
export const setPaperclipAgentPausedFn = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { organizationId: string; agentId: string; paused: boolean }) => data,
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }): Promise<{ status: string; pausedAt: string | null }> => {
    const { assertStewardMembership, setPaperclipAgentPaused } = await import(
      "@/lib/steward-agents.server"
    );
    await assertStewardMembership(context, data.organizationId);
    return await setPaperclipAgentPaused(data.agentId, data.paused);
  });

/**
 * Post a Tai response note into a Paperclip issue comment thread.
 * Used to answer agent questions or leave context mid-task.
 */
export const postTaiNoteToIssueFn = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { organizationId: string; issueId: string; note: string }) => data,
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }): Promise<{ commentId: string }> => {
    const { assertStewardMembership, postTaiNoteToIssue } = await import(
      "@/lib/steward-agents.server"
    );
    await assertStewardMembership(context, data.organizationId);
    const identity = context as unknown as { name?: string };
    return await postTaiNoteToIssue({
      issueId: data.issueId,
      note: data.note,
      taiName: identity.name ?? "Tai",
    });
  });

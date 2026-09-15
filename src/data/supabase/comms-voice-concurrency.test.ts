import { describe, expect, it, vi } from "vitest";

/**
 * Two people, one document. The save names the version it started from; if
 * the row moved on, nothing is written and the person keeps their writing.
 */

const calls: { table: string; op: string; filters: Record<string, unknown> }[] = [];
let updateResult: { data: unknown; error: null } = { data: null, error: null };
let latestRow: Record<string, unknown> | null = null;

function updateChain(filters: Record<string, unknown>) {
  const chain: Record<string, unknown> = {
    eq: (column: string, value: unknown) => {
      filters[column] = value;
      return chain;
    },
    select: () => chain,
    maybeSingle: async () => updateResult,
  };
  return chain;
}

vi.mock("@/integrations/trust-tai/supabase", () => ({
  supabase: {
    from: (table: string) => ({
      update: (_values: unknown) => {
        const filters: Record<string, unknown> = {};
        calls.push({ table, op: "update", filters });
        return updateChain(filters);
      },
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: latestRow, error: null }) }),
      }),
    }),
  },
}));

const { saveVoiceProfile, VoiceConflictError } = await import("./comms-voice");
const { DEFAULT_VOICE_DOCUMENT } = await import("@/domain/voice");

const current = {
  id: "voice-1",
  organizationId: "org-1",
  title: "Voice DNA",
  contentMarkdown: "How Tai sounds.",
  version: 4,
  updatedBy: null,
  updatedAt: null,
};

describe("saveVoiceProfile", () => {
  it("only writes over the exact version the edit started from", async () => {
    calls.length = 0;
    updateResult = { data: { ...current, version: 5, content_markdown: "New" }, error: null };
    await saveVoiceProfile({
      organizationId: "org-1",
      current,
      contentMarkdown: "New",
      userId: "user-1",
    });
    expect(calls[0]?.filters).toEqual({
      id: "voice-1",
      organization_id: "org-1",
      version: 4,
    });
  });

  it("refuses and hands back the newer row when someone else saved first", async () => {
    updateResult = { data: null, error: null };
    latestRow = { id: "voice-1", organization_id: "org-1", version: 7, content_markdown: "Theirs" };

    const failure = await saveVoiceProfile({
      organizationId: "org-1",
      current,
      contentMarkdown: "Mine",
      userId: "user-1",
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(VoiceConflictError);
    expect((failure as InstanceType<typeof VoiceConflictError>).latest?.version).toBe(7);
  });

  it("says it was refused when the row did not move on", async () => {
    updateResult = { data: null, error: null };
    latestRow = { id: "voice-1", organization_id: "org-1", version: 4, content_markdown: "Same" };

    await expect(
      saveVoiceProfile({
        organizationId: "org-1",
        current,
        contentMarkdown: "Mine",
        userId: "user-1",
      }),
    ).rejects.toThrow(/could not be saved/i);
  });

  it("never turns a blank save into the starting document by itself", async () => {
    await expect(
      saveVoiceProfile({
        organizationId: "org-1",
        current,
        contentMarkdown: "   ",
        userId: "user-1",
      }),
    ).rejects.toThrow(/nothing to save/i);
  });

  it("restores the starting document only when that was chosen", async () => {
    calls.length = 0;
    updateResult = { data: { ...current, version: 5 }, error: null };
    await saveVoiceProfile({
      organizationId: "org-1",
      current,
      contentMarkdown: "",
      userId: "user-1",
      reset: true,
    });
    expect(DEFAULT_VOICE_DOCUMENT.length).toBeGreaterThan(0);
    expect(calls).toHaveLength(1);
  });
});

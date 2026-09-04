/**
 * Comms Queue, draft approval surface.
 *
 * Shows emails the Comms Agent drafted and queued for Tai's review.
 * Tai approves (triggers send) or rejects (marks draft discarded).
 * Batch approve up to 20 at a time.
 *
 * The send itself hits the `comms-send` edge function with Tai's auth token.
 * Agent drafts always land in `needs_human_review`, this screen is the gate.
 */

import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { AppShell } from "@/components/tt/app-shell";
import { CommsTabs } from "@/components/tt/comms/comms-tabs";
import { PageHeader, TTButton } from "@/components/tt/primitives";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { supabase } from "@/integrations/trust-tai/supabase";
import { cn } from "@/lib/utils";
import type { WorkspaceIdentity } from "@/lib/workspace";

const TITLE = "Queue · Comms · Trust Tai OS";
const DESCRIPTION = "Comms Agent draft emails awaiting Tai's approval before send.";

export const Route = createFileRoute("/modules/comms/queue")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: QueueRoute,
});

function QueueRoute() {
  return (
    <WorkspaceGate appId="comms">
      {(identity) => (
        <AppShell identity={identity}>
          <QueueView identity={identity} />
        </AppShell>
      )}
    </WorkspaceGate>
  );
}

interface DraftRow {
  id: string;
  organization_id: string;
  relationship_id: string;
  subject: string | null;
  body: string;
  intent: string;
  register: string;
  review_state: string;
  rationale: Record<string, unknown> | null;
  created_at: string;
}

interface RelationshipRow {
  id: string;
  full_name: string;
  company_name: string | null;
  email: string | null;
  stage: string;
}

interface QueueItem {
  draft: DraftRow;
  relationship: RelationshipRow | null;
}

async function fetchQueue(organizationId: string): Promise<QueueItem[]> {
  const { data: drafts, error } = await supabase
    .from("comms_drafts")
    .select(
      "id, organization_id, relationship_id, subject, body, intent, register, review_state, rationale, created_at",
    )
    .eq("organization_id", organizationId)
    .in("review_state", ["needs_human_review"])
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) throw new Error(error.message);
  if (!drafts || drafts.length === 0) return [];

  const relIds = [...new Set((drafts as DraftRow[]).map((d) => d.relationship_id))];
  const { data: relationships } = await supabase
    .from("comms_relationships")
    .select("id, full_name, company_name, email, stage")
    .in("id", relIds);

  const relMap = new Map<string, RelationshipRow>(
    ((relationships ?? []) as RelationshipRow[]).map((r) => [r.id, r]),
  );

  return (drafts as DraftRow[]).map((d) => ({
    draft: d,
    relationship: relMap.get(d.relationship_id) ?? null,
  }));
}

async function approveDraft(draftId: string): Promise<void> {
  const { error } = await supabase
    .from("comms_drafts")
    .update({ review_state: "approved", updated_at: new Date().toISOString() })
    .eq("id", draftId);
  if (error) throw new Error(error.message);
}

async function rejectDraft(draftId: string): Promise<void> {
  const { error } = await supabase
    .from("comms_drafts")
    .update({ review_state: "discarded", updated_at: new Date().toISOString() })
    .eq("id", draftId);
  if (error) throw new Error(error.message);
}

/**
 * A send that failed leaves the draft where a person can decide again, and
 * Approvals must know: re-parking at the human boundary is the same boundary,
 * so it goes back through the one governed intake rather than quietly sitting
 * in Comms alone.
 */
async function reopenDraft(draftId: string, identity: WorkspaceIdentity): Promise<void> {
  await supabase
    .from("comms_drafts")
    .update({ review_state: "needs_human_review", updated_at: new Date().toISOString() })
    .eq("id", draftId)
    .eq("review_state", "approved");
  try {
    const { submitCommsDraftForApproval } = await import("@/data/approvals/sources");
    await submitCommsDraftForApproval(draftId, {
      organizationId: identity.organizationId,
      userId: identity.userId,
    });
  } catch (error) {
    console.warn("[approvals] reopen intake deferred:", (error as Error).message);
  }
}

async function sendDraft(draftId: string): Promise<void> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated.");

  const supabaseUrl = import.meta.env["VITE_SUPABASE_URL"] as string;
  const res = await fetch(`${supabaseUrl}/functions/v1/comms-send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ draft_id: draftId }),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({ error: "Send failed." }))) as { error?: string };
    throw new Error(body.error ?? "Send failed.");
  }
}

function QueueView({ identity }: { identity: WorkspaceIdentity }) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);

  const queue = useQuery({
    queryKey: ["comms", "queue", identity.organizationId],
    queryFn: () => fetchQueue(identity.organizationId),
    refetchInterval: 30_000,
  });

  const items = queue.data ?? [];

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(items.slice(0, 20).map((i) => i.draft.id)));
  const clearSelection = () => setSelected(new Set());

  // Approve then send each selected draft sequentially
  const batchSend = useMutation({
    mutationFn: async (ids: string[]) => {
      const results: { id: string; ok: boolean; error?: string }[] = [];
      for (const id of ids.slice(0, 20)) {
        try {
          await approveDraft(id);
          await sendDraft(id);
          results.push({ id, ok: true });
        } catch (err) {
          results.push({ id, ok: false, error: err instanceof Error ? err.message : "Failed." });
          await reopenDraft(id, identity);
        }
      }
      return results;
    },
    onSuccess: (results) => {
      const sent = results.filter((r) => r.ok).length;
      const failed = results.filter((r) => !r.ok).length;
      if (sent > 0) toast.success(`${sent} email${sent === 1 ? "" : "s"} sent`);
      if (failed > 0) toast.error(`${failed} failed, check queue`);
      setSelected(new Set());
      void queryClient.invalidateQueries({ queryKey: ["comms", "queue"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const rejectOne = useMutation({
    mutationFn: rejectDraft,
    onSuccess: () => {
      toast.success("Draft rejected");
      void queryClient.invalidateQueries({ queryKey: ["comms", "queue"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const approveAndSendOne = useMutation({
    mutationFn: async (id: string) => {
      await approveDraft(id);
      await sendDraft(id);
    },
    onSuccess: () => {
      toast.success("Sent");
      void queryClient.invalidateQueries({ queryKey: ["comms", "queue"] });
    },
    onError: async (err: Error, id: string) => {
      toast.error(err.message);
      await reopenDraft(id, identity);
    },
  });

  const loading = queue.isLoading;
  const isBusy = batchSend.isPending || rejectOne.isPending || approveAndSendOne.isPending;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Comms"
        title="Queue"
        supporting="Emails the Comms Agent drafted. Review each one, then approve to send or reject to discard. Nothing leaves without your say."
        appId="comms"
      />
      <CommsTabs active="queue" />

      {queue.error ? (
        <p className="text-sm text-destructive">
          {queue.error instanceof Error ? queue.error.message : "Failed to load queue."}
        </p>
      ) : loading ? (
        <p className="text-sm text-muted-foreground">Loading queue…</p>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-border p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No drafts waiting. The Comms Agent will add emails here after its next run.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Batch controls */}
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-[13px] text-muted-foreground">
              {items.length} draft{items.length === 1 ? "" : "s"} waiting
              {selected.size > 0 ? ` · ${selected.size} selected` : ""}
            </span>
            <TTButton variant="quiet" size="sm" onClick={selectAll} disabled={isBusy}>
              Select all (up to 20)
            </TTButton>
            {selected.size > 0 && (
              <>
                <TTButton variant="quiet" size="sm" onClick={clearSelection} disabled={isBusy}>
                  Clear
                </TTButton>
                <TTButton
                  variant="primary"
                  size="sm"
                  disabled={isBusy || selected.size === 0}
                  onClick={() => batchSend.mutate([...selected])}
                >
                  Send {selected.size} email{selected.size === 1 ? "" : "s"}
                </TTButton>
              </>
            )}
          </div>

          {/* Draft list */}
          <ul className="space-y-3">
            {items.map(({ draft, relationship }) => {
              const isExpanded = expanded === draft.id;
              const isSelected = selected.has(draft.id);
              const contactName = relationship?.full_name ?? "Unknown contact";
              const company =
                relationship?.company_name ??
                (draft.rationale?.["company"] as string | undefined) ??
                "";
              const toEmail = relationship?.email ?? null;
              const hook = draft.rationale?.["hook"] as string | undefined;

              return (
                <li
                  key={draft.id}
                  className={cn(
                    "rounded-xl border transition-colors",
                    isSelected ? "border-[var(--royal)]" : "border-border",
                  )}
                >
                  {/* Row header */}
                  <div className="flex flex-wrap items-start gap-3 p-4">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelect(draft.id)}
                      disabled={isBusy}
                      className="mt-1 h-4 w-4 cursor-pointer rounded accent-[var(--royal)]"
                      aria-label={`Select draft for ${contactName}`}
                    />
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => setExpanded(isExpanded ? null : draft.id)}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[15px] font-medium text-foreground">
                          {contactName}
                        </span>
                        {company && (
                          <span className="text-[13px] text-muted-foreground">· {company}</span>
                        )}
                        {!toEmail && (
                          <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-600">
                            no email
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-[13px] text-muted-foreground">
                        {draft.subject ?? "(no subject)"}
                      </p>
                      {hook && (
                        <p className="mt-1 text-[12px] italic text-muted-foreground/70">
                          Hook: {hook}
                        </p>
                      )}
                    </button>

                    {/* Per-draft actions */}
                    <div className="flex items-center gap-2">
                      <TTButton
                        variant="quiet"
                        size="sm"
                        disabled={isBusy}
                        onClick={() => rejectOne.mutate(draft.id)}
                      >
                        Reject
                      </TTButton>
                      <TTButton
                        variant="primary"
                        size="sm"
                        disabled={isBusy || !toEmail}
                        onClick={() => approveAndSendOne.mutate(draft.id)}
                        title={
                          !toEmail
                            ? "No email address, add one to the relationship first"
                            : undefined
                        }
                      >
                        Send
                      </TTButton>
                    </div>
                  </div>

                  {/* Expanded body */}
                  {isExpanded && (
                    <div className="border-t border-border px-4 pb-4 pt-3">
                      <div className="rounded-lg bg-secondary/40 p-4">
                        <p className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                          To: {toEmail ?? "no email set"}
                        </p>
                        <p className="mb-2 text-[13px] font-medium text-foreground">
                          Subject: {draft.subject ?? "(no subject)"}
                        </p>
                        <pre className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground">
                          {draft.body}
                        </pre>
                      </div>
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        Drafted{" "}
                        {new Date(draft.created_at).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Studio, the content room.
 *
 * One command in, an editorial package out: a cluster plan a person can argue
 * with, then ten prepared articles, each with the reason it should exist. The
 * room prepares; it never decides. Approving the batch happens in Approvals,
 * and publishing to trusttai.com happens only after that, with a receipt.
 */

import { Link, createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { AppShell } from "@/components/tt/app-shell";
import { RoomHero } from "@/components/tt/room-hero";
import { Markdown } from "@/components/tt/markdown";
import {
  EmptyState,
  MetaPill,
  SectionHeading,
  TTButton,
  TTCard,
  TTInput,
} from "@/components/tt/primitives";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { submitContentBatchForApproval } from "@/data/content/intake";
import { contentService } from "@/data/supabase/content-service";
import { supabase } from "@/integrations/trust-tai/supabase";
import { readNdjsonStream } from "@/lib/ndjson-stream";
import {
  CONTENT_ITEM_STATE_LABEL,
  readBatch,
  wordCount,
  type ContentBatch,
  type ContentItem,
} from "@/domain/content";
import type { PreparedItem, PreparedPlan } from "@/lib/content-engine.server";
import type { WorkspaceIdentity } from "@/lib/workspace";

const TITLE = "Studio · The content room · Trust Tai OS";
const DESCRIPTION =
  "One command becomes an editorial package: a topic cluster, per-post briefs, drafts in Trust Tai's voice, and one approval that a person still has to give.";

export const Route = createFileRoute("/modules/studio")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: StudioRoute,
});

function StudioRoute() {
  return <WorkspaceGate appId="studio">{(identity) => <Studio identity={identity} />}</WorkspaceGate>;
}

async function accessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Your session expired. Sign in again.");
  return token;
}

function Studio({ identity }: { identity: WorkspaceIdentity }) {
  const { organizationId, userId } = identity;
  const context = useMemo(() => ({ organizationId, userId }), [organizationId, userId]);
  const queryClient = useQueryClient();

  const [keyword, setKeyword] = useState("");
  const [count, setCount] = useState(10);
  const [progress, setProgress] = useState<string[]>([]);
  const [openBatchId, setOpenBatchId] = useState<string | null>(null);

  const batches = useQuery({
    queryKey: ["studio", "batches", organizationId],
    queryFn: () => contentService.listBatches(context, 20),
  });

  const open = useQuery({
    queryKey: ["studio", "batch", openBatchId],
    queryFn: () => (openBatchId ? contentService.getBatch(context, openBatchId) : null),
    enabled: Boolean(openBatchId),
  });

  const publisher = useQuery({
    queryKey: ["studio", "publisher"],
    queryFn: async () => {
      const response = await fetch("/api/public/content/publish");
      return (await response.json()) as { configured: boolean; because: string };
    },
  });

  /* The run streams, so the room says which article is being written. */
  const generate = useMutation({
    mutationFn: async () => {
      const term = keyword.trim();
      if (!term) throw new Error("Give Studio a keyword to work from.");
      setProgress([]);

      const token = await accessToken();
      const response = await fetch("/api/public/content/generate", {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          organization_id: organizationId,
          keyword: term,
          count,
          known_paths: [],
        }),
      });

      const payload = await readNdjsonStream(response, (stage) => {
        setProgress((current) => [...current, stage.message]);
      });
      if (!payload) throw new Error("The run ended without returning a batch.");

      const plan = payload["plan"] as PreparedPlan;
      const items = (payload["items"] ?? []) as PreparedItem[];

      /* The room writes its own truth, under its own membership. */
      const batch = await contentService.createBatch(context, {
        keyword: plan.keyword,
        topicCluster: plan.topicCluster,
        searchIntent: plan.searchIntent,
        audienceProblem: plan.audienceProblem,
        whyTogether: plan.whyTogether,
        editorialPlan: plan.editorialPlan,
        provenance: plan.provenance,
      });
      for (const item of items) {
        await contentService.saveItem(context, batch.id, item);
      }
      await contentService.setBatchState(context, batch.id, "prepared");
      return batch;
    },
    onSuccess: (batch) => {
      toast.success("The editorial batch is prepared. Read it before you submit it.");
      setOpenBatchId(batch.id);
      void queryClient.invalidateQueries({ queryKey: ["studio", "batches"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const submit = useMutation({
    mutationFn: async (batchId: string) => submitContentBatchForApproval(batchId, context),
    onSuccess: (request) => {
      if (!request) {
        toast.warning("Every post in this batch has already been decided.");
        return;
      }
      toast.success("Sent to Approvals as one decision. Nothing publishes until you approve it.");
      void queryClient.invalidateQueries({ queryKey: ["studio"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const publish = useMutation({
    mutationFn: async (input: { itemId: string; action: "publish" | "verify" }) => {
      const token = await accessToken();
      const response = await fetch("/api/public/content/publish", {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          organization_id: organizationId,
          item_id: input.itemId,
          action: input.action,
        }),
      });
      const payload = (await response.json()) as Record<string, unknown>;
      if (!response.ok) throw new Error(String(payload["error"] ?? "That did not work."));
      return payload;
    },
    onSuccess: (payload) => {
      const verification = payload["verification"] as { because?: string } | undefined;
      toast.success(String(verification?.because ?? payload["because"] ?? "Recorded."));
      void queryClient.invalidateQueries({ queryKey: ["studio"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const running = generate.isPending;

  return (
    <AppShell identity={identity}>
      <RoomHero
        eyebrow="Studio"
        title="Say what the market is asking about."
        supporting="Studio plans the cluster, writes each article in Trust Tai's voice and says why it should exist. You approve the batch in Approvals, and only then does anything reach trusttai.com."
      />

      <TTCard className="p-6">
        <SectionHeading
          title="One command"
          description="For example: ten posts around fractional operations for founders."
        />
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <TTInput
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="Keyword or theme"
            className="flex-1"
            disabled={running}
          />
          <TTInput
            type="number"
            min={1}
            max={12}
            value={count}
            onChange={(event) => setCount(Number(event.target.value) || 10)}
            className="sm:w-28"
            disabled={running}
            aria-label="How many posts"
          />
          <TTButton onClick={() => generate.mutate()} disabled={running}>
            {running ? "Writing" : "Prepare the batch"}
          </TTButton>
        </div>

        {progress.length > 0 ? (
          <ol className="mt-4 space-y-1 text-sm text-muted-foreground">
            {progress.slice(-6).map((line, index) => (
              <li key={`${line}-${index}`}>{line}</li>
            ))}
          </ol>
        ) : null}

        {publisher.data && !publisher.data.configured ? (
          <p className="mt-4 text-sm text-muted-foreground">{publisher.data.because}</p>
        ) : null}
      </TTCard>

      <div className="mt-8 grid gap-6 lg:grid-cols-[22rem_1fr]">
        <TTCard className="p-5">
          <SectionHeading title="Batches" description="Newest first." />
          <div className="mt-4 space-y-2">
            {(batches.data ?? []).length === 0 ? (
              <EmptyState
                title="Nothing prepared yet"
                description="Give Studio a keyword and it will plan a cluster."
              />
            ) : null}
            {(batches.data ?? []).map((batch) => (
              <button
                key={batch.id}
                type="button"
                onClick={() => setOpenBatchId(batch.id)}
                className={`w-full rounded-lg border p-3 text-left transition ${
                  openBatchId === batch.id ? "border-primary" : "border-border hover:border-primary/40"
                }`}
              >
                <p className="font-medium">{batch.keyword}</p>
                <p className="text-sm text-muted-foreground">{batch.state.replace(/_/g, " ")}</p>
              </button>
            ))}
          </div>
        </TTCard>

        <div>
          {open.data ? (
            <BatchView
              batch={open.data.batch}
              items={open.data.items}
              onSubmit={() => submit.mutate(open.data!.batch.id)}
              submitting={submit.isPending}
              canPublish={Boolean(publisher.data?.configured)}
              onPublish={(itemId, action) => publish.mutate({ itemId, action })}
              publishing={publish.isPending}
            />
          ) : (
            <EmptyState
              title="Open a batch"
              description="Read the plan and the posts before anything is submitted for approval."
            />
          )}
        </div>
      </div>
    </AppShell>
  );
}

function BatchView({
  batch,
  items,
  onSubmit,
  submitting,
  canPublish,
  onPublish,
  publishing,
}: {
  batch: ContentBatch;
  items: ContentItem[];
  onSubmit: () => void;
  submitting: boolean;
  canPublish: boolean;
  onPublish: (itemId: string, action: "publish" | "verify") => void;
  publishing: boolean;
}) {
  const readout = readBatch(items);
  const undecided = readout.ready + readout.exceptions + readout.failed;

  return (
    <div className="space-y-6">
      <TTCard className="p-6">
        <SectionHeading title={batch.keyword} description={batch.searchIntent} />
        {batch.audienceProblem ? <p className="mt-3">{batch.audienceProblem}</p> : null}
        {batch.whyTogether ? (
          <p className="mt-3 text-sm text-muted-foreground">{batch.whyTogether}</p>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <MetaPill>{readout.total} posts</MetaPill>
          <MetaPill>{readout.ready} ready</MetaPill>
          <MetaPill>{readout.exceptions} need review</MetaPill>
          <MetaPill>{readout.failed} failed</MetaPill>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <TTButton onClick={onSubmit} disabled={submitting || undecided === 0}>
            {undecided === 0 ? "Already decided" : "Send to Approvals"}
          </TTButton>
          <Link to="/modules/approvals" className="text-sm underline">
            Open Approvals
          </Link>
        </div>
      </TTCard>

      {items.map((item) => (
        <TTCard key={item.id} className="p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-medium">{item.title}</h3>
              <p className="text-sm text-muted-foreground">{item.angle}</p>
            </div>
            <MetaPill>{CONTENT_ITEM_STATE_LABEL[item.state]}</MetaPill>
          </div>

          {item.hitRationale ? <p className="mt-4">{item.hitRationale}</p> : null}

          <div className="mt-4 flex flex-wrap gap-2">
            <MetaPill>{wordCount(item.draftMarkdown)} words</MetaPill>
            <MetaPill>{item.seo.slug}</MetaPill>
            <MetaPill>
              {item.image.state === "ready" ? "Image ready" : "No featured image yet"}
            </MetaPill>
            {item.internalLinks.some((link) => !link.resolved) ? (
              <MetaPill>
                {item.internalLinks.filter((link) => !link.resolved).length} links unresolved
              </MetaPill>
            ) : null}
          </div>

          {item.exceptionReasons.length > 0 ? (
            <ul className="mt-3 list-disc pl-5 text-sm text-muted-foreground">
              {item.exceptionReasons.map((reason) => (
                <li key={reason}>{reason.replace(/_/g, " ")}</li>
              ))}
            </ul>
          ) : null}

          {item.failureReason ? (
            <p className="mt-3 text-sm text-muted-foreground">{item.failureReason}</p>
          ) : null}

          {item.draftMarkdown ? (
            <details className="mt-4">
              <summary className="cursor-pointer text-sm underline">Read the draft</summary>
              <div className="mt-3">
                <Markdown content={item.draftMarkdown} />
              </div>
            </details>
          ) : null}

          {item.state === "queued" || item.state === "published" || item.state === "verified" ? (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              {item.state === "queued" ? (
                <TTButton
                  onClick={() => onPublish(item.id, "publish")}
                  disabled={publishing || !canPublish}
                >
                  Publish to trusttai.com
                </TTButton>
              ) : null}
              {item.canonicalUrl ? (
                <a href={item.canonicalUrl} className="text-sm underline">
                  {item.canonicalUrl}
                </a>
              ) : null}
              {item.state === "published" ? (
                <TTButton
                  variant="secondary"
                  onClick={() => onPublish(item.id, "verify")}
                  disabled={publishing}
                >
                  Verify the live page
                </TTButton>
              ) : null}
              <span className="text-sm text-muted-foreground">{item.verification.because}</span>
            </div>
          ) : null}
        </TTCard>
      ))}
    </div>
  );
}

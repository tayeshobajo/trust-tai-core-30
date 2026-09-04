/**
 * One prepared article, read the way a person reviews an article.
 *
 * Five things are inspectable, each on its own: the article, the featured
 * image, the search work, the sources that were active for the request that
 * produced it, and the voice those sources set. Nothing is invented: when a
 * batch predates the sources layer, the page says so rather than showing an
 * empty evidence chain as if it were proof of nothing having been used.
 *
 * It never shows a live address unless the publisher returned one, and never
 * calls a post live until the page was read back.
 */

import { Link, createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "@/components/tt/app-shell";
import { Markdown } from "@/components/tt/markdown";
import { EmptyState, MetaPill, SectionHeading, TTCard } from "@/components/tt/primitives";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { contentService } from "@/data/supabase/content-service";
import { contentCommandService } from "@/data/supabase/content-request-service";
import { approvalsService } from "@/data/supabase/approvals-service";
import { CONTENT_ITEM_STATE_LABEL, wordCount, type ContentItem } from "@/domain/content";
import { EXTRACTION_LABEL, provenanceLine, type ContentSource } from "@/domain/content-source";
import type { WorkspaceIdentity } from "@/lib/workspace";

const TITLE = "Studio article · Trust Tai OS";
const DESCRIPTION =
  "A prepared Trust Tai article: the draft, the brief behind it, and the honest state of everything it still needs before anyone approves it.";

const SECTIONS = ["Article", "Featured image", "SEO", "Sources", "Voice"] as const;
type Section = (typeof SECTIONS)[number];

export const Route = createFileRoute("/modules/studio/$itemId")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ArticleRoute,
});

function ArticleRoute() {
  const { itemId } = Route.useParams();
  return (
    <WorkspaceGate appId="studio">
      {(identity) => <Article identity={identity} itemId={itemId} />}
    </WorkspaceGate>
  );
}

function Article({ identity, itemId }: { identity: WorkspaceIdentity; itemId: string }) {
  const { organizationId, userId } = identity;
  const context = useMemo(() => ({ organizationId, userId }), [organizationId, userId]);
  const [section, setSection] = useState<Section>("Article");

  const item = useQuery({
    queryKey: ["studio", "item", itemId],
    queryFn: () => contentService.getItem(context, itemId),
  });

  const batchId = item.data?.batchId ?? null;

  /* The request that produced this batch is the only honest place sources and
     voice can come from. A batch written before that layer existed has none,
     and says so. */
  const request = useQuery({
    queryKey: ["studio", "request-for-batch", batchId],
    queryFn: () => (batchId ? contentCommandService.requestForBatch(organizationId, batchId) : null),
    enabled: Boolean(batchId),
  });

  const sources = useQuery({
    queryKey: ["studio", "sources", organizationId],
    queryFn: () => contentCommandService.listSources(organizationId),
  });

  const approval = useQuery({
    queryKey: ["studio", "approval-for-batch", batchId],
    queryFn: () =>
      batchId
        ? approvalsService.findForEntity({ organizationId, userId }, { type: "content_batch", id: batchId })
        : null,
    enabled: Boolean(batchId),
  });

  const imageStatus = useQuery({
    queryKey: ["studio", "image-provider"],
    queryFn: async () => {
      const response = await fetch("/api/public/content/image");
      return (await response.json()) as { ready: boolean; because: string; missing: string[] };
    },
  });

  const activeSources: ContentSource[] = (sources.data ?? []).filter((source) =>
    (request.data?.sourceIds ?? []).includes(source.id),
  );

  return (
    <AppShell identity={identity}>
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <Link to="/modules/studio" className="text-sm underline">
          Back to Studio
        </Link>
        {approval.data ? (
          <Link
            to="/modules/approvals"
            search={{ request: approval.data.id }}
            className="text-sm underline"
          >
            Open the approval for this batch ({approval.data.status.replace(/_/g, " ")})
          </Link>
        ) : (
          <span className="text-sm text-muted-foreground">
            No approval card is linked to this batch yet.
          </span>
        )}
      </div>

      {item.isLoading ? (
        <p className="text-sm text-muted-foreground">Opening the article…</p>
      ) : item.data ? (
        <div className="space-y-6">
          <ArticleHeader item={item.data} />

          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Review sections">
            {SECTIONS.map((name) => (
              <button
                key={name}
                type="button"
                role="tab"
                aria-selected={section === name}
                onClick={() => setSection(name)}
                className={`rounded-full border px-4 py-1.5 text-sm transition ${
                  section === name
                    ? "border-primary text-foreground"
                    : "border-border text-muted-foreground hover:border-primary/40"
                }`}
              >
                {name}
              </button>
            ))}
          </div>

          {section === "Article" ? <ArticleSection item={item.data} /> : null}
          {section === "Featured image" ? (
            <ImageSection
              item={item.data}
              providerBecause={imageStatus.data?.because ?? "Checking the image provider…"}
              missing={imageStatus.data?.missing ?? []}
            />
          ) : null}
          {section === "SEO" ? <SeoSection item={item.data} /> : null}
          {section === "Sources" ? (
            <SourcesSection
              loading={request.isLoading || sources.isLoading}
              hasRequest={Boolean(request.data)}
              requestedSourceIds={request.data?.sourceIds ?? []}
              sources={activeSources}
            />
          ) : null}
          {section === "Voice" ? (
            <VoiceSection
              loading={request.isLoading}
              prompt={request.data?.prompt ?? ""}
              settings={(request.data?.settings ?? {}) as Record<string, { value?: string; origin?: string }>}
              sources={activeSources}
            />
          ) : null}
        </div>
      ) : (
        <EmptyState
          title="That article is not in this workspace"
          belongsHere="Studio articles belong to the workspace that prepared them."
          whyItMatters="Nothing outside your workspace is ever shown here."
        />
      )}
    </AppShell>
  );
}

function ArticleHeader({ item }: { item: ContentItem }) {
  const unresolved = item.internalLinks.filter((link) => !link.resolved);
  return (
    <TTCard className="p-6">
      <p className="tt-eyebrow">{item.seo.slug}</p>
      <h1 className="mt-2 text-2xl font-medium">{item.title}</h1>
      {item.angle ? <p className="mt-2 text-muted-foreground">{item.angle}</p> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <MetaPill>{CONTENT_ITEM_STATE_LABEL[item.state]}</MetaPill>
        <MetaPill>{wordCount(item.draftMarkdown)} words</MetaPill>
        <MetaPill>{item.image.state === "ready" ? "Image ready" : "No featured image yet"}</MetaPill>
        {unresolved.length > 0 ? <MetaPill>{unresolved.length} links unresolved</MetaPill> : null}
      </div>
      {item.hitRationale ? <p className="mt-4">{item.hitRationale}</p> : null}
      {item.canonicalUrl ? (
        <p className="mt-4 text-sm">
          <a href={item.canonicalUrl} className="underline">
            {item.canonicalUrl}
          </a>{" "}
          <span className="text-muted-foreground">{item.verification.because}</span>
        </p>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          This article has no live address yet, because nothing has been published.
        </p>
      )}
    </TTCard>
  );
}

function ArticleSection({ item }: { item: ContentItem }) {
  return (
    <>
      <TTCard className="p-6">
        <SectionHeading title="Why this post exists" description={item.readerJob} />
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="text-muted-foreground">Where it should lead</dt>
            <dd>{item.cta.line || "No call to action"}</dd>
          </div>
        </dl>
        {item.exceptionReasons.length > 0 ? (
          <ul className="mt-4 list-disc pl-5 text-sm text-muted-foreground">
            {item.exceptionReasons.map((reason) => (
              <li key={reason}>{reason.replace(/_/g, " ")}</li>
            ))}
          </ul>
        ) : null}
      </TTCard>

      <TTCard className="p-6">
        {item.draftMarkdown ? (
          <Markdown content={item.draftMarkdown} />
        ) : (
          <p className="text-sm text-muted-foreground">
            {item.failureReason ?? "This post has no draft yet."}
          </p>
        )}
      </TTCard>
    </>
  );
}

function ImageSection({
  item,
  providerBecause,
  missing,
}: {
  item: ContentItem;
  providerBecause: string;
  missing: string[];
}) {
  return (
    <TTCard className="p-6">
      <SectionHeading
        title="Featured image"
        description="The brief is real. The picture only exists once a provider really returns one."
      />
      {item.image.assetUrl ? (
        <img
          src={item.image.assetUrl}
          alt={item.image.altText || item.title}
          className="mb-4 w-full rounded-lg border border-border"
        />
      ) : null}
      <dl className="space-y-3 text-sm">
        <div>
          <dt className="text-muted-foreground">Brief</dt>
          <dd>{item.image.brief || "No image brief was written."}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Alt text</dt>
          <dd>{item.image.altText || "Not written yet"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">State</dt>
          <dd>{item.image.state}</dd>
        </div>
      </dl>
      <p className="mt-4 text-sm text-muted-foreground">{providerBecause}</p>
      {missing.length > 0 ? (
        <ul className="mt-2 list-disc pl-5 text-sm text-muted-foreground">
          {missing.map((entry) => (
            <li key={entry}>{entry}</li>
          ))}
        </ul>
      ) : null}
    </TTCard>
  );
}

function SeoSection({ item }: { item: ContentItem }) {
  return (
    <TTCard className="p-6">
      <SectionHeading title="Search work" description="What a search result would show." />
      <dl className="space-y-3 text-sm">
        <div>
          <dt className="text-muted-foreground">Search title</dt>
          <dd>{item.seo.title || "Not written yet"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Search description</dt>
          <dd>{item.seo.metaDescription || "Not written yet"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Slug</dt>
          <dd>{item.seo.slug}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Category and tags</dt>
          <dd>{[item.taxonomy.category, ...item.taxonomy.tags].filter(Boolean).join(", ") || "None"}</dd>
        </div>
      </dl>
      {item.internalLinks.length > 0 ? (
        <ul className="mt-4 space-y-1 text-sm">
          {item.internalLinks.map((link) => (
            <li key={`${link.path ?? "unresolved"}-${link.anchor}`}>
              <span className={link.resolved ? "" : "text-muted-foreground line-through"}>
                {link.anchor} → {link.path ?? "no matching page"}
              </span>
              {link.resolved ? null : (
                <span className="ml-2 text-muted-foreground">{link.because}</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </TTCard>
  );
}

function SourcesSection({
  loading,
  hasRequest,
  requestedSourceIds,
  sources,
}: {
  loading: boolean;
  hasRequest: boolean;
  requestedSourceIds: string[];
  sources: ContentSource[];
}) {
  if (loading) return <TTCard className="p-6 text-sm text-muted-foreground">Reading the request…</TTCard>;

  if (!hasRequest) {
    return (
      <TTCard className="p-6">
        <SectionHeading title="Sources" description="Where the material came from." />
        <p className="text-sm text-muted-foreground">
          This batch was written before Studio kept sources with each request, so there is no source
          record for it. Nothing is being hidden and nothing is being invented: the evidence simply
          does not exist for this batch.
        </p>
      </TTCard>
    );
  }

  const missing = requestedSourceIds.length - sources.length;

  return (
    <TTCard className="p-6">
      <SectionHeading title="Sources" description="Exactly what was active for this request." />
      {requestedSourceIds.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No sources were active. This article was written in the Trust Tai voice alone.
        </p>
      ) : null}
      <div className="space-y-2">
        {sources.map((source) => (
          <div key={source.id} className="rounded-lg border border-border p-3">
            <p className="text-sm font-medium">{source.label}</p>
            <p className="mt-1 text-xs text-muted-foreground">{provenanceLine(source)}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {source.kind} · {EXTRACTION_LABEL[source.extractionState]}
              {source.extractionNote ? ` · ${source.extractionNote}` : ""}
            </p>
          </div>
        ))}
      </div>
      {missing > 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          {missing} source{missing === 1 ? " was" : "s were"} used for this request and has since been
          removed from the library.
        </p>
      ) : null}
    </TTCard>
  );
}

function VoiceSection({
  loading,
  prompt,
  settings,
  sources,
}: {
  loading: boolean;
  prompt: string;
  settings: Record<string, { value?: string; origin?: string }>;
  sources: ContentSource[];
}) {
  if (loading) return <TTCard className="p-6 text-sm text-muted-foreground">Reading the request…</TTCard>;

  if (!prompt) {
    return (
      <TTCard className="p-6">
        <SectionHeading title="Voice" description="What this article was told to sound like." />
        <p className="text-sm text-muted-foreground">
          This batch predates the request record, so the exact wording behind it was not kept. It was
          written in the Trust Tai house voice.
        </p>
      </TTCard>
    );
  }

  const readable = sources.filter((source) => source.extractionState === "extracted");

  return (
    <TTCard className="p-6">
      <SectionHeading title="Voice" description="What this article was told to sound like." />
      <p className="text-sm">“{prompt}”</p>
      <dl className="mt-4 space-y-2 text-sm">
        {Object.entries(settings)
          .filter(([, setting]) => setting?.value)
          .map(([key, setting]) => (
            <div key={key} className="flex flex-wrap gap-2">
              <dt className="text-muted-foreground">{key}</dt>
              <dd>
                {setting.value}{" "}
                <span className="text-xs text-muted-foreground">({setting.origin ?? "default"})</span>
              </dd>
            </div>
          ))}
      </dl>
      <p className="mt-4 text-sm text-muted-foreground">
        {readable.length === 0
          ? "No readable writing was attached, so no cadence reference influenced this article."
          : `${readable.length} piece${readable.length === 1 ? "" : "s"} of your own writing set the cadence. Reference only: never copied, and never treated as fact.`}
      </p>
    </TTCard>
  );
}

/**
 * One prepared article, read the way a person reads an article.
 *
 * This page shows the draft, its brief and the honest state of everything the
 * post still needs. It never shows a live address unless the publisher
 * returned one, and never calls a post live until the page was read back.
 */

import { Link, createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "@/components/tt/app-shell";
import { Markdown } from "@/components/tt/markdown";
import { EmptyState, MetaPill, SectionHeading, TTCard } from "@/components/tt/primitives";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { contentService } from "@/data/supabase/content-service";
import { CONTENT_ITEM_STATE_LABEL, wordCount, type ContentItem } from "@/domain/content";
import type { WorkspaceIdentity } from "@/lib/workspace";

const TITLE = "Studio article · Trust Tai OS";
const DESCRIPTION =
  "A prepared Trust Tai article: the draft, the brief behind it, and the honest state of everything it still needs before anyone approves it.";

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

  const item = useQuery({
    queryKey: ["studio", "item", itemId],
    queryFn: () => contentService.getItem(context, itemId),
  });

  return (
    <AppShell identity={identity}>
      <div className="mb-6">
        <Link to="/modules/studio" className="text-sm underline">
          Back to Studio
        </Link>
      </div>

      {item.isLoading ? (
        <p className="text-sm text-muted-foreground">Opening the article…</p>
      ) : item.data ? (
        <ArticleBody item={item.data} />
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

function ArticleBody({ item }: { item: ContentItem }) {
  const unresolved = item.internalLinks.filter((link) => !link.resolved);

  return (
    <div className="space-y-6">
      <TTCard className="p-6">
        <p className="tt-eyebrow">{item.seo.slug}</p>
        <h1 className="mt-2 text-2xl font-medium">{item.title}</h1>
        {item.angle ? <p className="mt-2 text-muted-foreground">{item.angle}</p> : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <MetaPill>{CONTENT_ITEM_STATE_LABEL[item.state]}</MetaPill>
          <MetaPill>{wordCount(item.draftMarkdown)} words</MetaPill>
          <MetaPill>
            {item.image.state === "ready" ? "Image ready" : "No featured image yet"}
          </MetaPill>
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

      <TTCard className="p-6">
        <SectionHeading title="Why this post exists" description={item.readerJob} />
        <dl className="mt-4 space-y-3 text-sm">
          <div>
            <dt className="text-muted-foreground">Search title</dt>
            <dd>{item.seo.title || "Not written yet"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Search description</dt>
            <dd>{item.seo.metaDescription || "Not written yet"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Where it should lead</dt>
            <dd>{item.cta.line || "No call to action"}</dd>
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
    </div>
  );
}

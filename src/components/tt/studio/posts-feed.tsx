import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { FileText, ArrowRight, BookOpen, Link2 } from "lucide-react";
import { contentService } from "@/data/supabase/content-service";
import { CONTENT_ITEM_STATE_LABEL, type ContentBatch } from "@/domain/content";
import type { ContentSource } from "@/domain/content-source";
import type { WorkspaceIdentity } from "@/lib/workspace";
import { StudioState } from "./studio-shell";
export function PostsFeed({
  identity,
  batches,
  sources,
  loading,
  error,
}: {
  identity: WorkspaceIdentity;
  batches: ContentBatch[];
  sources: ContentSource[];
  loading: boolean;
  error: boolean;
}) {
  const [filter, setFilter] = useState("all");
  const [referenceId, setReferenceId] = useState<string | null>(null);
  const q = useQuery({
    queryKey: [
      "studio",
      "recent-posts",
      identity.organizationId,
      batches
        .slice(0, 10)
        .map((b) => b.id)
        .join(","),
    ],
    queryFn: async () =>
      (await Promise.all(batches.slice(0, 10).map((b) => contentService.listItems(identity, b.id))))
        .flat()
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    enabled: !loading && !error,
    retry: false,
  });
  const refs = sources.filter((s) => s.kind === "linkedin");
  const articles = q.data ?? [];
  const excerpt = (text: string) =>
    text
      .replace(/[#*_`>]/g, "")
      .trim()
      .slice(0, 440);
  return (
    <section className="sw-post-feed">
      <section className="sw-profile-card">
        <span className="sw-profile-avatar">
          {identity.avatarUrl ? (
            <img src={identity.avatarUrl} alt="" />
          ) : (
            identity.name
              .split(/\s/)
              .map((n) => n[0])
              .slice(0, 2)
              .join("")
          )}
        </span>
        <div>
          <h2>{identity.name}</h2>
          <p>Your writing, in one place.</p>
          <div className="sw-profile-badges">
            <span>Workspace articles</span>
            <span>LinkedIn feed not connected</span>
          </div>
        </div>
        <div className="sw-profile-count">
          <strong>{q.isSuccess ? articles.length : "—"}</strong>
          <small>loaded articles</small>
        </div>
      </section>
      <div className="sw-toolbar">
        <div className="sw-filter">
          {[
            ["all", "All writing"],
            ["articles", "Articles"],
            ["linkedin", "LinkedIn references"],
          ].map(([id, name]) => (
            <button key={id} aria-pressed={filter === id} onClick={() => setFilter(id!)}>
              {name}
            </button>
          ))}
        </div>
      </div>
      {loading || (q.isPending && !error) ? (
        <StudioState title="Reading your recent posts…" />
      ) : error || q.isError ? (
        <StudioState title="Recent posts could not be read" onRetry={() => void q.refetch()}>
          This is not an empty feed. {q.error?.message}
        </StudioState>
      ) : (
        <>
          {filter !== "linkedin" &&
            articles.slice(0, 12).map((item) => (
              <article key={item.id} className="sv-card sw-post-card">
                <header>
                  <span className="sw-post-avatar">{identity.organizationName.slice(0, 1)}</span>
                  <div>
                    <strong>{identity.organizationName}</strong>
                    <small>
                      Workspace article ·{" "}
                      {new Date(item.createdAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                    </small>
                  </div>
                  <span className="sw-status">{CONTENT_ITEM_STATE_LABEL[item.state]}</span>
                </header>
                <h3>{item.title}</h3>
                <p>
                  {excerpt(item.draftMarkdown) ||
                    item.angle ||
                    "This draft has no article text yet."}
                  {item.draftMarkdown.length > 440 ? "…" : ""}
                </p>
                <div className="sw-post-tags">
                  {[item.taxonomy.category, ...item.taxonomy.tags.slice(0, 3)]
                    .filter(Boolean)
                    .map((tag, i) => (
                      <span key={i}>{tag}</span>
                    ))}
                </div>
                <footer>
                  <Link to="/modules/studio/$itemId" params={{ itemId: item.id }}>
                    <FileText />
                    Open article
                    <ArrowRight />
                  </Link>
                  <span>
                    {item.verification.state === "verified"
                      ? "Live page verified"
                      : "Review before sharing"}
                  </span>
                </footer>
              </article>
            ))}
          {filter !== "articles" &&
            refs.map((source) => (
              <article key={source.id} className="sv-card sw-post-card">
                <header>
                  <span className="sw-post-avatar">in</span>
                  <div>
                    <strong>Saved LinkedIn writing</strong>
                    <small>
                      Manually saved LinkedIn reference · added{" "}
                      {new Date(source.createdAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                    </small>
                  </div>
                  <span className="sw-status">Imported text</span>
                </header>
                <h3>{source.label}</h3>
                <p className={referenceId === source.id ? "sw-expanded-post" : ""}>
                  {referenceId === source.id ? source.extractedText : excerpt(source.extractedText)}
                  {source.extractedText.length > 440 && referenceId !== source.id ? "…" : ""}
                </p>
                <footer>
                  <button
                    className="sw-text-button"
                    onClick={() => setReferenceId(referenceId === source.id ? null : source.id)}
                  >
                    <BookOpen />
                    {referenceId === source.id ? "Show less" : "Read saved text"}
                  </button>
                  <Link to="/modules/studio/sources">
                    <Link2 />
                    Open Sources
                  </Link>
                </footer>
              </article>
            ))}
          {(filter === "linkedin"
            ? !refs.length
            : filter === "articles"
              ? !articles.length
              : !articles.length && !refs.length) && (
            <StudioState
              title={
                filter === "linkedin"
                  ? "Bring in a post you’ve already written"
                  : "Your writing will appear here"
              }
            >
              {filter === "linkedin"
                ? "LinkedIn sync is not connected. Add your own post text in Sources and choose LinkedIn writing as the content type."
                : "Prepare an article below, or add your existing LinkedIn writing to Sources. No sample posts are shown as yours."}
            </StudioState>
          )}
          <p className="sw-quiet-note">
            Articles come from the latest 10 workspace batches; up to 12 are shown. LinkedIn
            references are text you saved yourself, not a synced activity feed.
          </p>
        </>
      )}
    </section>
  );
}

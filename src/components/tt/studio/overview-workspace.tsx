import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, FileText, Lightbulb, BookOpen, Video } from "lucide-react";
import { StudioShell, StudioState } from "./studio-shell";
import { useStudioBatches, useStudioBriefs, useStudioSources } from "./use-studio-library";
import { isStudioIdea } from "@/domain/studio-ideas";
import { usableAsVoice } from "@/domain/content-source";
import type { WorkspaceIdentity } from "@/lib/workspace";
export function OverviewWorkspace({ identity }: { identity: WorkspaceIdentity }) {
  const batches = useStudioBatches(identity);
  const briefs = useStudioBriefs(identity);
  const sources = useStudioSources(identity);
  const [search, setSearch] = useState("");
  const ideas = (briefs.data?.value ?? []).filter(isStudioIdea);
  const recent = (batches.data?.value ?? []).filter((b) =>
    `${b.keyword} ${b.topicCluster.join(" ")}`.toLowerCase().includes(search.toLowerCase()),
  );
  const readable = (sources.data?.value ?? []).filter(usableAsVoice);
  const count = (
    q: { isSuccess: boolean; data: { provisioned: boolean; value: unknown[] } | undefined },
    value: number,
  ) => (q.isSuccess && q.data?.provisioned ? value : "—");
  return (
    <StudioShell
      identity={identity}
      section="Overview"
      description="Your ideas, your voice, and the next thing worth sharing."
      search={search}
      onSearch={setSearch}
      searchLabel="Search recent article batches"
      action={
        <Link className="sv-button sv-primary" to="/modules/studio/posts">
          <PlusIcon />
          Write a post
        </Link>
      }
    >
      <div className="sw-overview-grid">
        <section className="sw-stats" aria-label="Recent workspace counts">
          {[
            {
              label: "Recent article batches",
              value: count(batches, batches.data?.value.length ?? 0),
              Icon: FileText,
              to: "/modules/studio/posts",
            },
            {
              label: "Saved ideas",
              value: count(briefs, ideas.length),
              Icon: Lightbulb,
              to: "/modules/studio/ideas",
            },
            {
              label: "Readable references",
              value: count(sources, readable.length),
              Icon: BookOpen,
              to: "/modules/studio/sources",
            },
          ].map(({ label, value, Icon, to }) => (
            <Link key={label} to={to as "/modules/studio/posts"} className="sv-card sw-stat">
              <Icon />
              <div>
                <strong>{value}</strong>
                <span>{label}</span>
              </div>
              <ArrowRight />
            </Link>
          ))}
        </section>
        <section className="sw-recent">
          <header className="sw-section-heading">
            <div>
              <span className="sw-kicker">YOUR WORKSPACE</span>
              <h2>Continue working</h2>
            </div>
            <Link to="/modules/studio/posts" className="sw-text-button">
              Open Posts
              <ArrowRight />
            </Link>
          </header>
          {batches.isPending ? (
            <StudioState title="Reading your recent work…" />
          ) : batches.isError ? (
            <StudioState
              title="Recent work could not be read"
              onRetry={() => void batches.refetch()}
            >
              {batches.error.message}
            </StudioState>
          ) : !batches.data?.provisioned ? (
            <StudioState title="The article workspace is not available">
              The existing content store must be available before article batches can be shown.
            </StudioState>
          ) : !recent.length ? (
            <StudioState
              title={
                search ? "No matching article batches" : "Your first article starts with an idea"
              }
            >
              Write from your experience, choose the sources you trust, and review the result in
              Posts.
            </StudioState>
          ) : (
            <div className="sv-card sw-feed">
              {recent.slice(0, 6).map((b) => (
                <Link
                  key={b.id}
                  to="/modules/studio/posts"
                  search={{ batch: b.id }}
                  className="sw-feed-row"
                >
                  <span className="sw-source-icon">
                    <FileText />
                  </span>
                  <div>
                    <span className="sw-kicker">ARTICLE BATCH</span>
                    <h3>{b.keyword}</h3>
                    <p>
                      {b.audienceProblem ||
                        b.searchIntent ||
                        "Open the batch to review its plan and posts."}
                    </p>
                    <small>
                      {new Date(b.createdAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}{" "}
                      · {b.state.replaceAll("_", " ")}
                    </small>
                  </div>
                  <ArrowRight />
                </Link>
              ))}
            </div>
          )}
          <p className="sw-quiet-note">
            This view covers the latest 20 article batches, up to 100 saved briefs, and up to 60
            sources. It is not an all-time analytics report.
          </p>
        </section>
        <aside className="sw-overview-aside">
          <section className="sv-card">
            <span className="sw-line-icon">
              <Lightbulb />
            </span>
            <h2>Your next idea</h2>
            {briefs.isError ? (
              <p className="sw-error">
                Ideas could not be read.{" "}
                <button onClick={() => void briefs.refetch()}>Try again</button>
              </p>
            ) : briefs.data?.provisioned === false ? (
              <p>The saved brief store is unavailable.</p>
            ) : briefs.isPending ? (
              <p>Reading your ideas…</p>
            ) : ideas.length ? (
              <ul className="sw-mini-list">
                {ideas.slice(0, 3).map((i) => (
                  <li key={i.id}>
                    <Link to="/modules/studio/posts" search={{ idea: i.id }}>
                      {i.chosenTitle}
                      <ArrowRight />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No saved ideas yet. A sentence is enough to begin.</p>
            )}
            <Link to="/modules/studio/ideas" className="sw-text-button">
              All ideas
              <ArrowRight />
            </Link>
          </section>
          <section className="sv-card">
            <span className="sw-line-icon">
              <Video />
            </span>
            <h2>Say it on camera.</h2>
            <p>
              Shape a focused video brief around one message. Video plans are currently saved only
              on your device.
            </p>
            <Link to="/modules/studio/video" className="sw-text-button">
              Open Video
              <ArrowRight />
            </Link>
          </section>
          <section className="sw-quiet-note">
            {sources.isError
              ? "The source library could not be read."
              : sources.data?.provisioned === false
                ? "The source store is unavailable."
                : "Website demand suggestions remain in Posts. External trend feeds and social publishing are not connected."}
          </section>
        </aside>
      </div>
    </StudioShell>
  );
}
function PlusIcon() {
  return (
    <span aria-hidden style={{ fontSize: 20, lineHeight: 1 }}>
      +
    </span>
  );
}

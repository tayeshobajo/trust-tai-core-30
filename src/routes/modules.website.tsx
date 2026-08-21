/**
 * The Website room.
 *
 * One question: is our digital presence moving Trust Tai forward, and what
 * should we do next. Website owns attention, behaviour, intake, public site
 * health and what published content does after it goes live. Studio creates,
 * Scout qualifies, Conductor recommends governed action. This room is read
 * only by architecture. Nothing here creates a roadmap or a project.
 */

import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Globe, Inbox, MousePointerClick, Search, Sparkles } from "lucide-react";

import { AppShell } from "@/components/tt/app-shell";
import { RoomHero } from "@/components/tt/room-hero";
import { EmptyState, MetaPill, SectionHeading } from "@/components/tt/primitives";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { listWebsiteEvents, listWebsiteSubmissions } from "@/data/supabase/website-service";
import {
  listPageMetrics,
  listSearchMetrics,
  listWebsitePages,
} from "@/data/supabase/website-analytics-service";
import {
  aiReferrals,
  buildPageRows,
  providerReadiness,
  sourceGroups,
  type WebsiteAnalyticsInput,
} from "@/data/website/pages";
import { AiReferralsPanel, ProviderReadinessPanel } from "@/components/tt/website/panels";
import { decimal, percent } from "@/data/website/format";
import { CLASSIFICATION_LABELS, buildContentRows } from "@/data/website/content";
import { healthFindings } from "@/data/website/health";
import {
  competingPages,
  contentOpportunities,
  decliningQueries,
  growingQueries,
  highImpressionLowCtr,
  queryRows,
  searchTopics,
  strikingDistance,
} from "@/data/website/search";
import { laneFallback, overviewMetrics, overviewObservations } from "@/data/website/overview";
import { formatKnown, intakeFunnel, isQualified } from "@/data/website/projection";
import { normalizePath } from "@/data/website/url";
import type {
  AiReferralSummary,
  ContentRow,
  ObservationLane,
  PageRow,
  ProviderReadiness,
} from "@/domain/website-analytics";
import { WEBSITE_INTAKE_LABEL, type WebsiteSubmission } from "@/domain/website";
import type { WorkspaceIdentity } from "@/lib/workspace";
import { cn } from "@/lib/utils";

const TITLE = "Website · Trust Tai OS";
const DESCRIPTION =
  "What TrustTai.com is bringing in: attention, discovery, published content, behaviour, intake and the conversations Scout picks up.";

export const Route = createFileRoute("/modules/website")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: WebsiteRoute,
});

type Tab = "overview" | "pages" | "content" | "search" | "intake";

const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "pages", label: "Pages" },
  { key: "content", label: "Content" },
  { key: "search", label: "Search" },
  { key: "intake", label: "Intake" },
];

const WINDOW_DAYS = 30;

function WebsiteRoute() {
  return (
    <WorkspaceGate appId="website">
      {(identity) => (
        <AppShell identity={identity}>
          <WebsiteRoom identity={identity} />
        </AppShell>
      )}
    </WorkspaceGate>
  );
}

function WebsiteRoom({ identity }: { identity: WorkspaceIdentity }) {
  const [tab, setTab] = useState<Tab>("overview");
  const organizationId = identity.organizationId;

  const since = useMemo(
    () => new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    [],
  );
  const sinceDate = since.slice(0, 10);

  const submissions = useQuery({
    queryKey: ["website", "submissions", organizationId],
    queryFn: () => listWebsiteSubmissions(organizationId),
  });
  const events = useQuery({
    queryKey: ["website", "events", organizationId, since],
    queryFn: () => listWebsiteEvents(organizationId, since),
  });
  const pages = useQuery({
    queryKey: ["website", "pages", organizationId],
    queryFn: () => listWebsitePages(organizationId),
  });
  const pageMetrics = useQuery({
    queryKey: ["website", "page-metrics", organizationId, sinceDate],
    queryFn: () => listPageMetrics(organizationId, sinceDate),
  });
  const searchMetrics = useQuery({
    queryKey: ["website", "search-metrics", organizationId, sinceDate],
    queryFn: () => listSearchMetrics(organizationId, sinceDate),
  });

  const loading =
    submissions.isPending || events.isPending || pages.isPending || pageMetrics.isPending;

  const input: WebsiteAnalyticsInput = useMemo(
    () => ({
      pages: pages.data?.value ?? [],
      pageMetrics: pageMetrics.data?.value ?? [],
      searchMetrics: searchMetrics.data?.value ?? [],
      events: events.data?.value ?? [],
      submissions: submissions.data?.value ?? [],
    }),
    [pages.data, pageMetrics.data, searchMetrics.data, events.data, submissions.data],
  );

  const readiness = useMemo(() => providerReadiness(input), [input]);
  const pageRows = useMemo(() => buildPageRows(input), [input]);
  const contentRows = useMemo(
    () =>
      buildContentRows({
        pageRows,
        pages: input.pages,
        pageMetrics: input.pageMetrics,
        searchMetrics: input.searchMetrics,
      }),
    [pageRows, input],
  );
  const queries = useMemo(() => queryRows(input.searchMetrics), [input.searchMetrics]);
  const health = useMemo(() => healthFindings(pageRows, input.pages), [pageRows, input.pages]);
  const referrals = useMemo(
    () => aiReferrals(input.events, input.submissions),
    [input.events, input.submissions],
  );

  const overviewInput = {
    pageRows,
    contentRows,
    queries,
    health,
    submissions: input.submissions,
    readiness,
    windowDays: WINDOW_DAYS,
  };
  const metrics = overviewMetrics(overviewInput);
  const metricAt = (index: number) =>
    metrics[index] ?? { key: String(index), label: "", value: null, note: "" };
  const observations = overviewObservations(overviewInput);
  const submissionsProvisioned = submissions.data?.provisioned ?? true;

  return (
    <div className="space-y-6">
      <RoomHero
        eyebrow="Website"
        title="What Trust Tai is bringing in"
        supporting="Is our digital presence moving Trust Tai forward, and what should we do next? TrustTai.com owns attention and intake, hands completed conversations to Scout, and never creates delivery work on its own."
        metrics={[
          {
            icon: <MousePointerClick className="size-4 text-royal" aria-hidden />,
            value: loading ? "…" : formatKnown(metricAt(0).value),
            label: "Visitors",
            note: metricAt(0).note,
          },
          {
            icon: <Search className="size-4 text-royal" aria-hidden />,
            value: loading ? "…" : formatKnown(metricAt(1).value),
            label: "Search clicks",
            note: metricAt(1).note,
          },
          {
            icon: <Inbox className="size-4 text-royal" aria-hidden />,
            value: loading ? "…" : formatKnown(metricAt(2).value),
            label: "Intake conversations",
          },
          {
            icon: <Globe className="size-4 text-royal" aria-hidden />,
            value: loading ? "…" : formatKnown(metricAt(3).value),
            label: "Qualified in Scout",
          },
        ]}
      />

      {submissionsProvisioned ? null : (
        <div className="tt-surface p-5">
          <p className="text-sm text-foreground">The website signal tables are not applied yet.</p>
          <p className="mt-1 max-w-reading text-xs text-muted-foreground">
            Apply <span className="font-mono">docs/website-signals-schema.sql</span> and{" "}
            <span className="font-mono">docs/website-analytics-schema.sql</span> to the Trust Tai
            database. Until then this room shows nothing rather than inventing numbers.
          </p>
        </div>
      )}

      <nav
        aria-label="Website sections"
        className="flex flex-wrap items-center gap-1 border-b border-border pb-px"
      >
        {TABS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            onClick={() => setTab(entry.key)}
            aria-current={tab === entry.key ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-4 py-2.5 text-sm transition-colors",
              tab === entry.key
                ? "border-foreground font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      {tab === "overview" ? (
        <Overview
          metrics={metrics}
          observations={observations}
          readiness={readiness}
          sources={sourceGroups(input.events, input.submissions)}
          referrals={referrals}
        />
      ) : null}
      {tab === "pages" ? <Pages rows={pageRows} health={health} /> : null}
      {tab === "content" ? <Content rows={contentRows} /> : null}
      {tab === "search" ? (
        <SearchTab input={input} queries={queries} referrals={referrals} />
      ) : null}
      {tab === "intake" ? (
        <Intake input={input} loading={loading} />
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------------- overview */

const LANES: { key: ObservationLane; title: string }[] = [
  { key: "working", title: "What is working" },
  { key: "changing", title: "What is changing" },
  { key: "attention", title: "Needs attention" },
  { key: "next_move", title: "Next move" },
];

function Overview({
  metrics,
  observations,
  readiness,
  sources,
  referrals,
}: {
  metrics: ReturnType<typeof overviewMetrics>;
  observations: ReturnType<typeof overviewObservations>;
  readiness: ProviderReadiness[];
  sources: { source: string; visits: number; submissions: number }[];
  referrals: AiReferralSummary;
}) {
  return (
    <div className="space-y-4">
      <div className="tt-surface p-5">
        <SectionHeading
          eyebrow="Last 30 days"
          title="The short version"
          description="A dash means Core has not been told, which is different from zero."
        />
        <ol className="grid gap-3 md:grid-cols-5">
          {metrics.map((metric) => (
            <li key={metric.key} className="rounded-xl border border-border bg-card px-4 py-3">
              <p className="font-mono text-[19px] leading-none text-foreground">
                {formatKnown(metric.value)}
              </p>
              <p className="mt-1.5 text-[12px] text-foreground">{metric.label}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">{metric.note}</p>
            </li>
          ))}
        </ol>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {LANES.map((lane) => {
          const rows = observations.filter((entry) => entry.lane === lane.key);
          return (
            <div key={lane.key} className="tt-surface p-5">
              <SectionHeading eyebrow="Reading" title={lane.title} />
              {rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">{laneFallback(lane.key, readiness)}</p>
              ) : (
                <ul className="space-y-3">
                  {rows.map((row) => (
                    <li key={row.id}>
                      <p className="text-sm text-foreground">{row.statement}</p>
                      <ul className="mt-1 space-y-0.5">
                        {row.evidence.filter(Boolean).map((line, index) => (
                          <li key={index} className="text-[12px] text-muted-foreground">
                            {line}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="tt-surface p-5">
          <SectionHeading
            eyebrow="Sources"
            title="Where attention comes from"
            description="Referrers we can read, grouped. Arrivals with no referrer are counted as direct."
          />
          {sources.length === 0 ? (
            <p className="text-sm text-muted-foreground">No source data has been received yet.</p>
          ) : (
            <ul className="space-y-2">
              {sources.slice(0, 8).map((row) => (
                <li key={row.source} className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate text-foreground">{row.source}</span>
                  <span className="font-mono text-[12px] text-muted-foreground">
                    {row.visits} visits · {row.submissions} conversations
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <AiReferralsPanel summary={referrals} />
      </div>

      <ProviderReadinessPanel readiness={readiness} />

    </div>
  );
}

/* ------------------------------------------------------------------ pages */

function Pages({
  rows,
  pages,
  health,
}: {
  rows: PageRow[];
  pages: WebsitePage[];
  health: ReturnType<typeof healthFindings>;
}) {
  const [openPath, setOpenPath] = useState<string | null>(null);
  const open = rows.find((row) => row.path === openPath) ?? null;

  if (rows.length === 0) {
    return (
      <EmptyState
        title="No public pages are represented yet"
        belongsHere="Every public TrustTai.com page belongs here, with its traffic, search performance, behaviour and the conversations it produced."
        whyItMatters="Without the page inventory the room can only describe paths a provider happened to mention."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="tt-surface overflow-x-auto p-5">
        <SectionHeading
          eyebrow="Pages"
          title="Every public page"
          description="Only measured columns are filled. A dash means the provider behind that column is not connected."
        />
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[12px] text-muted-foreground">
              <th className="py-2 pr-4 font-normal">Page</th>
              <th className="py-2 pr-4 font-normal">Type</th>
              <th className="py-2 pr-4 font-normal">Views</th>
              <th className="py-2 pr-4 font-normal">Landing</th>
              <th className="py-2 pr-4 font-normal">Clicks</th>
              <th className="py-2 pr-4 font-normal">Impressions</th>
              <th className="py-2 pr-4 font-normal">CTR</th>
              <th className="py-2 pr-4 font-normal">Position</th>
              <th className="py-2 font-normal">Conversations</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.path} className="border-b border-border/60 last:border-0">
                <td className="py-2 pr-4">
                  <button
                    type="button"
                    className="text-left text-royal hover:underline"
                    onClick={() => setOpenPath(row.path === openPath ? null : row.path)}
                  >
                    {row.title}
                  </button>
                  <p className="font-mono text-[11px] text-muted-foreground">{row.path}</p>
                </td>
                <td className="py-2 pr-4 text-muted-foreground">{row.pageType.replace("_", " ")}</td>
                <td className="py-2 pr-4 font-mono text-[12px]">{formatKnown(row.views)}</td>
                <td className="py-2 pr-4 font-mono text-[12px]">{formatKnown(row.landingSessions)}</td>
                <td className="py-2 pr-4 font-mono text-[12px]">{formatKnown(row.clicks)}</td>
                <td className="py-2 pr-4 font-mono text-[12px]">{formatKnown(row.impressions)}</td>
                <td className="py-2 pr-4 font-mono text-[12px]">{percent(row.ctr)}</td>
                <td className="py-2 pr-4 font-mono text-[12px]">{decimal(row.averagePosition)}</td>
                <td className="py-2 font-mono text-[12px]">{formatKnown(row.intakeSubmissions)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open ? (
        <PageDetail row={open} page={pages.find((page) => normalizePath(page.path) === open.path)} />
      ) : null}

      <div className="tt-surface p-5">
        <SectionHeading eyebrow="Health" title="What the public site is telling us" />
        <ul className="space-y-3">
          {health.map((finding) => (
            <li key={finding.id}>
              <p className="text-sm text-foreground">
                {finding.title}
                <span
                  className={cn(
                    "ml-2 font-mono text-[11px] uppercase tracking-[0.12em]",
                    finding.severity === "attention" ? "text-warning" : "text-muted-foreground",
                  )}
                >
                  {finding.severity === "healthy" ? "Clear" : finding.severity}
                </span>
              </p>
              <p className="text-[12px] text-muted-foreground">{finding.detail}</p>
              {finding.paths.length > 0 ? (
                <p className="font-mono text-[11px] text-muted-foreground">
                  {finding.paths.slice(0, 6).join(" · ")}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function PageDetail({ row, page }: { row: PageRow; page: WebsitePage | undefined }) {
  const groups: { title: string; entries: [string, string][] }[] = [
    {
      title: "Traffic",
      entries: [
        ["Views", formatKnown(row.views)],
        ["Visitors", formatKnown(row.users)],
        ["Landing sessions", formatKnown(row.landingSessions)],
      ],
    },
    {
      title: "Search",
      entries: [
        ["Clicks", formatKnown(row.clicks)],
        ["Impressions", formatKnown(row.impressions)],
        ["CTR", percent(row.ctr)],
        ["Average position", decimal(row.averagePosition)],
      ],
    },
    {
      title: "Behaviour",
      entries: [
        ["Engaged sessions", formatKnown(row.engagedSessions)],
        ["Engagement rate", percent(row.engagementRate)],
        ["Average engagement", row.averageEngagementSeconds === null ? "—" : `${Math.round(row.averageEngagementSeconds)}s`],
        ["Content reads", formatKnown(row.contentReads)],
      ],
    },
    {
      title: "Conversion",
      entries: [
        ["Intake starts", formatKnown(row.intakeStarts)],
        ["Conversations", formatKnown(row.intakeSubmissions)],
        ["Qualified in Scout", formatKnown(row.qualified)],
        ["Primary next step", row.primaryCta ?? "—"],
      ],
    },
  ];

  return (
    <div className="tt-surface p-5">
      <SectionHeading eyebrow={row.path} title={row.title} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {groups.map((group) => (
          <div key={group.title} className="rounded-xl border border-border bg-card px-4 py-3">
            <p className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
              {group.title}
            </p>
            <ul className="mt-1.5 space-y-1 text-[13px]">
              {group.entries.map(([label, value]) => (
                <li key={label} className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-mono text-foreground">{value}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <p className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
            Health
          </p>
          <ul className="mt-1.5 space-y-1 text-[13px]">
            {pageReadiness(page, row).map((field) => (
              <li key={field.label} className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">{field.label}</span>
                <span className="font-mono text-foreground">
                  {field.present === null ? "—" : field.present ? "Yes" : "No"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- content */

function Content({ rows }: { rows: ContentRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No published content is registered yet"
        belongsHere="Articles and case studies appear here once the page inventory holds them, with what happened after publishing."
        whyItMatters="Website measures published work. Studio still owns writing and approval."
      />
    );
  }

  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <article key={row.path} className="tt-surface p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
                {row.pageType.replace("_", " ")}
                {row.publishedAt
                  ? ` · published ${new Date(row.publishedAt).toLocaleDateString()}`
                  : ""}
              </p>
              <h3 className="mt-1 text-[17px] text-foreground">{row.title}</h3>
              <p className="font-mono text-[11px] text-muted-foreground">{row.path}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {row.classifications.map((label) => (
                <MetaPill key={label}>{CLASSIFICATION_LABELS[label]}</MetaPill>
              ))}
              {row.topic ? <MetaPill>Topic · {row.topic}</MetaPill> : null}
            </div>
          </div>

          <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 font-mono text-[12px] text-muted-foreground">
            <span>Views {formatKnown(row.views)}</span>
            <span>Impressions {formatKnown(row.impressions)}</span>
            <span>Clicks {formatKnown(row.clicks)}</span>
            <span>CTR {percent(row.ctr)}</span>
            <span>Position {decimal(row.averagePosition)}</span>
            <span>Engagement {percent(row.engagementRate)}</span>
            <span>Starts {formatKnown(row.intakeStarts)}</span>
            <span>Conversations {formatKnown(row.intakeSubmissions)}</span>
            <span>Qualified {formatKnown(row.qualified)}</span>
          </dl>

          {row.reasons.length > 0 ? (
            <ul className="mt-2 space-y-0.5">
              {row.reasons.map((reason, index) => (
                <li key={index} className="text-[12px] text-muted-foreground">
                  {reason}
                </li>
              ))}
            </ul>
          ) : null}

          {row.intent.topic || row.intent.audience || row.intent.primaryNextStep ? (
            <p className="mt-2 text-[12px] text-muted-foreground">
              Intent · {[row.intent.audience, row.intent.searchIntent, row.intent.purpose, row.intent.primaryNextStep]
                .filter(Boolean)
                .join(" · ")}
            </p>
          ) : null}
        </article>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------------- search */

function SearchTab({
  input,
  queries,
}: {
  input: WebsiteAnalyticsInput;
  queries: ReturnType<typeof queryRows>;
}) {
  if (queries.length === 0) {
    return (
      <EmptyState
        title="No search data yet"
        belongsHere="Queries, impressions, click through and position belong here once Search Console data is flowing."
        whyItMatters="Search is how most people discover a company they have never heard of. Until it is connected this stays unknown, not zero."
      />
    );
  }

  const opportunities = contentOpportunities(
    input.searchMetrics,
    input.pages.map((page) => page.path),
  );
  const competing = competingPages(input.searchMetrics);

  const lists: { title: string; description: string; rows: typeof queries }[] = [
    { title: "Bringing traffic", description: "The queries producing clicks today.", rows: queries.slice(0, 10) },
    { title: "Growing", description: "More clicks in the second half of the window.", rows: growingQueries(queries).slice(0, 8) },
    { title: "Declining", description: "Fewer clicks in the second half of the window.", rows: decliningQueries(queries).slice(0, 8) },
    { title: "Seen, rarely clicked", description: "Real demand meeting a weak title or description.", rows: highImpressionLowCtr(queries).slice(0, 8) },
    { title: "Positions four to twenty", description: "Close enough that a better page would move them.", rows: strikingDistance(queries).slice(0, 8) },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        {lists.map((list) => (
          <div key={list.title} className="tt-surface p-5">
            <SectionHeading eyebrow="Search" title={list.title} description={list.description} />
            {list.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing meets this rule in the window.</p>
            ) : (
              <ul className="space-y-1.5">
                {list.rows.map((row) => (
                  <li key={row.query} className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate text-foreground">{row.query}</span>
                    <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                      {row.clicks}c · {row.impressions}i · {percent(row.ctr)} · p
                      {decimal(row.averagePosition)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}

        <div className="tt-surface p-5">
          <SectionHeading eyebrow="Search" title="Topics people find us for" />
          <ul className="space-y-1.5">
            {searchTopics(queries).map((row) => (
              <li key={row.topic} className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate text-foreground">{row.topic}</span>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {row.impressions} impressions
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {competing.length > 0 ? (
        <div className="tt-surface p-5">
          <SectionHeading
            eyebrow="Search"
            title="Our own pages competing"
            description="More than one of our pages shows for the same query."
          />
          <ul className="space-y-1.5">
            {competing.slice(0, 8).map((row) => (
              <li key={row.query} className="text-sm">
                <span className="text-foreground">{row.query}</span>
                <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                  {row.paths.map((entry) => entry.path).join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="tt-surface p-5">
        <SectionHeading
          eyebrow="Search"
          title="Content opportunities"
          description="Repeated demand meeting weak coverage. These are observations for a person. Website never creates content."
        />
        {opportunities.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No query in this window shows repeated demand with weak coverage.
          </p>
        ) : (
          <ul className="space-y-2">
            {opportunities.slice(0, 10).map((row) => (
              <li key={row.query}>
                <p className="text-sm text-foreground">{row.query}</p>
                <p className="text-[12px] text-muted-foreground">
                  {row.reason}
                  {row.refreshPath ? ` Start with ${row.refreshPath}.` : ""}
                </p>
                <p className="font-mono text-[11px] text-muted-foreground">
                  {row.impressions} impressions · {percent(row.ctr)} · p{decimal(row.averagePosition)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- intake */

function Intake({ input, loading }: { input: WebsiteAnalyticsInput; loading: boolean }) {
  const stages = intakeFunnel(input.events, input.submissions);
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <div className="tt-surface p-5">
        <SectionHeading
          eyebrow="Intake"
          title="Visit, conversation, submitted, Scout, qualified"
          description="A dash means Core has not been told, which is different from zero."
        />
        <ol className="grid gap-3 md:grid-cols-5">
          {stages.map((stage) => (
            <li key={stage.key} className="rounded-xl border border-border bg-card px-4 py-3">
              <p className="font-mono text-[19px] leading-none text-foreground">
                {formatKnown(stage.value)}
              </p>
              <p className="mt-1.5 text-[12px] text-foreground">{stage.label}</p>
              {stage.note ? (
                <p className="mt-1 text-[11px] text-muted-foreground">{stage.note}</p>
              ) : null}
            </li>
          ))}
        </ol>
      </div>

      {loading ? (
        <div className="tt-surface p-5 text-sm text-muted-foreground">Loading…</div>
      ) : input.submissions.length === 0 ? (
        <EmptyState
          title="No website conversations yet"
          belongsHere="Completed adaptive intakes from TrustTai.com land here the moment they are received."
          whyItMatters="Verbatim answers are preserved exactly, so Scout qualifies a real conversation rather than a summary of one."
        />
      ) : (
        input.submissions.map((submission) => (
          <Submission
            key={submission.id}
            submission={submission}
            open={openId === submission.id}
            onToggle={() => setOpenId(openId === submission.id ? null : submission.id)}
          />
        ))
      )}
    </div>
  );
}

function Submission({
  submission,
  open,
  onToggle,
}: {
  submission: WebsiteSubmission;
  open: boolean;
  onToggle: () => void;
}) {
  const utm = submission.attribution.utm ?? {};
  return (
    <article className="tt-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
            {WEBSITE_INTAKE_LABEL}
          </p>
          <h3 className="mt-1 text-[17px] text-foreground">
            {submission.company.name || submission.person.name || "Inbound founder"}
          </h3>
          <p className="mt-1 max-w-reading text-sm text-muted-foreground">
            {submission.structured.desiredFuture[0] ||
              submission.structured.goals[0] ||
              submission.verbatim[0]?.answerText ||
              "No summary was supplied with this submission."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <MetaPill>{new Date(submission.submittedAt).toLocaleDateString()}</MetaPill>
          <MetaPill>{utm.source ? `Source · ${utm.source}` : "Source · Direct"}</MetaPill>
          {submission.attribution.landingPath ? (
            <MetaPill>Landed on {normalizePath(submission.attribution.landingPath)}</MetaPill>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-[13px]">
        {submission.scoutProspectId ? (
          <>
            <span className="text-muted-foreground">
              Scout ·{" "}
              {isQualified(submission.scoutStatus)
                ? "Qualified"
                : (submission.scoutStatus ?? "In Scout")}
            </span>
            <Link
              to="/modules/scout/prospects/$prospectId"
              params={{ prospectId: submission.scoutProspectId }}
              search={{ section: "scout" as const, fit: "all" as const }}
              className="text-royal hover:underline"
            >
              Open in Scout
            </Link>
          </>
        ) : (
          <span className="text-muted-foreground">
            Held as an unlinked signal · {submission.linkReason}
          </span>
        )}
        <button type="button" className="text-royal hover:underline" onClick={onToggle}>
          {open ? "Hide the conversation" : "Read the conversation"}
        </button>
        <Link
          to="/modules/website/submissions/$submissionId"
          params={{ submissionId: submission.id }}
          className="inline-flex items-center rounded-lg border border-royal/30 bg-royal/8 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-royal hover:bg-royal/12"
        >
          Open submission
        </Link>
      </div>

      {open ? (
        <div className="mt-4 space-y-3 border-t border-border pt-4">
          <ol className="space-y-3">
            {submission.verbatim.map((answer, index) => (
              <li key={`${answer.questionId}-${index}`}>
                <p className="text-[13px] text-foreground">{answer.questionText}</p>
                <p className="mt-0.5 whitespace-pre-wrap text-sm text-muted-foreground">
                  {answer.skipped ? "Skipped." : answer.answerText}
                </p>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </article>
  );
}


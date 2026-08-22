/**
 * One page, whole.
 *
 * The Pages table answers "which pages matter". This route answers "what is
 * this page actually doing", grouped the way a person reads it: Traffic,
 * Search, Behavior, Conversion, Health. Every figure is either observed or
 * shown as unknown, with the provider that would have told us named alongside.
 * Website reports. It never creates work here.
 */

import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { ArrowLeft } from "lucide-react";

import { AppShell } from "@/components/tt/app-shell";
import { EmptyState, MetaPill, SectionHeading } from "@/components/tt/primitives";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { ProviderReadinessPanel } from "@/components/tt/website/panels";
import { listWebsiteEvents, listWebsiteSubmissions } from "@/data/supabase/website-service";
import {
  listPageMetrics,
  listProviderSync,
  listSearchMetrics,
  listWebsitePages,
} from "@/data/supabase/website-analytics-service";
import { withFreshness } from "@/data/website/freshness";
import { buildPageRows, providerReadiness, type WebsiteAnalyticsInput } from "@/data/website/pages";

import { CLASSIFICATION_LABELS, buildContentRows } from "@/data/website/content";
import { healthFindings, pageReadiness } from "@/data/website/health";
import { queriesForPath } from "@/data/website/search";
import { formatKnown, isQualified } from "@/data/website/projection";
import { UNKNOWN, decimal, percent, seconds } from "@/data/website/format";
import { normalizePath } from "@/data/website/url";
import type { KnownNumber } from "@/domain/website";
import { WEBSITE_INTAKE_LABEL } from "@/domain/website";
import type { PageRow } from "@/domain/website-analytics";
import type { WorkspaceIdentity } from "@/lib/workspace";

const TITLE = "Page performance · Website · Trust Tai OS";
const DESCRIPTION =
  "One public TrustTai.com page in full: the traffic it draws, the searches it answers, how people behave on it, the conversations it starts and its health.";

const WINDOW_DAYS = 30;

export const Route = createFileRoute("/modules/website_/page")({
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
  validateSearch: (search: Record<string, unknown>) => ({
    path: normalizePath(typeof search["path"] === "string" ? (search["path"] as string) : "/"),
  }),
  component: PageDetailRoute,
});

function PageDetailRoute() {
  return (
    <WorkspaceGate appId="website">
      {(identity) => (
        <AppShell identity={identity}>
          <PageDetail identity={identity} />
        </AppShell>
      )}
    </WorkspaceGate>
  );
}

function PageDetail({ identity }: { identity: WorkspaceIdentity }) {
  const { path } = Route.useSearch();
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
  const providerSync = useQuery({
    queryKey: ["website", "provider-sync", organizationId],
    queryFn: () => listProviderSync(organizationId),
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

  const readiness = useMemo(
    () => withFreshness(providerReadiness(input), providerSync.data?.value ?? []),
    [input, providerSync.data],
  );

  const row = useMemo(
    () => buildPageRows(input).find((entry) => entry.path === path) ?? null,
    [input, path],
  );
  const page = input.pages.find((entry) => normalizePath(entry.path) === path);
  const content = useMemo(() => {
    if (!row) return null;
    return (
      buildContentRows({
        pageRows: [row],
        pages: input.pages,
        pageMetrics: input.pageMetrics,
        searchMetrics: input.searchMetrics,
      })[0] ?? null
    );
  }, [row, input]);
  const queries = useMemo(
    () => queriesForPath(input.searchMetrics, path).slice(0, 10),
    [input.searchMetrics, path],
  );
  const findings = useMemo(
    () => healthFindings(row ? [row] : [], input.pages).filter((entry) => entry.paths.length === 0 || entry.paths.some((entry2) => normalizePath(entry2) === path)),
    [row, input.pages, path],
  );
  const conversations = input.submissions.filter(
    (submission) => normalizePath(submission.attribution.landingPath) === path,
  );

  const back = (
    <Link
      to="/modules/website"
      className="inline-flex items-center gap-1.5 text-[13px] text-royal hover:underline"
    >
      <ArrowLeft className="size-3.5" aria-hidden />
      Back to Website
    </Link>
  );

  if (loading) {
    return (
      <div className="space-y-4">
        {back}
        <div className="tt-surface p-5 text-sm text-muted-foreground">Loading…</div>
      </div>
    );
  }

  if (!row) {
    return (
      <div className="space-y-4">
        {back}
        <EmptyState
          title="No page at this address"
          belongsHere={`Nothing in the page inventory or in provider data matches ${path}.`}
          whyItMatters="Rather than invent a row, the room says plainly that this address has not been seen."
        />
      </div>
    );
  }

  const gaOn = readiness.find((entry) => entry.id === "ga4")?.connected ?? false;
  const searchOn = readiness.find((entry) => entry.id === "search_console")?.connected ?? false;
  const eventsOn = readiness.find((entry) => entry.id === "first_party_events")?.connected ?? false;

  const groups: MetricGroup[] = [
    {
      title: "Traffic",
      source: "GA4",
      measured: gaOn,
      unknownNote: "GA4 is not reporting, so how many people arrived here stays unknown.",
      entries: [
        { label: "Views", value: formatKnown(row.views) },
        { label: "Visitors", value: formatKnown(row.users) },
        { label: "Landing sessions", value: formatKnown(row.landingSessions) },
        {
          label: "Share of site views",
          value: percent(shareOfViews(row, input)),
        },
      ],
    },
    {
      title: "Search",
      source: "Search Console",
      measured: searchOn,
      unknownNote: "Search Console is not reporting, so discovery for this page stays unknown.",
      entries: [
        { label: "Clicks", value: formatKnown(row.clicks) },
        { label: "Impressions", value: formatKnown(row.impressions) },
        { label: "Click through rate", value: percent(row.ctr) },
        { label: "Average position", value: decimal(row.averagePosition) },
      ],
    },
    {
      title: "Behavior",
      source: "GA4 and first party events",
      measured: gaOn || eventsOn,
      unknownNote:
        "Neither GA4 nor first party events are reporting, so what people did here stays unknown.",
      entries: [
        { label: "Engaged sessions", value: formatKnown(row.engagedSessions) },
        { label: "Engagement rate", value: percent(row.engagementRate) },
        { label: "Average engagement", value: seconds(row.averageEngagementSeconds) },
        { label: "Content reads", value: formatKnown(row.contentReads) },
      ],
    },
    {
      title: "Conversion",
      source: "First party events and Core",
      measured: true,
      unknownNote: "",
      entries: [
        { label: "Intake starts", value: formatKnown(row.intakeStarts) },
        { label: "Conversations", value: formatKnown(row.intakeSubmissions) },
        { label: "Qualified in Scout", value: formatKnown(row.qualified) },
        { label: "Primary next step", value: row.primaryCta ?? UNKNOWN },
      ],
    },
  ];

  return (
    <div className="space-y-5">
      {back}

      <header className="tt-surface p-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          {row.path}
        </p>
        <h1 className="mt-2 font-display text-[30px] leading-tight text-foreground">{row.title}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <MetaPill>{row.pageType.replace("_", " ")}</MetaPill>
          {row.unlisted ? <MetaPill>Not in the page inventory</MetaPill> : null}
          {row.publishedAt ? (
            <MetaPill>Published {new Date(row.publishedAt).toLocaleDateString()}</MetaPill>
          ) : null}
          {row.lastUpdatedAt ? (
            <MetaPill>Updated {new Date(row.lastUpdatedAt).toLocaleDateString()}</MetaPill>
          ) : null}
          {content?.classifications.map((label) => (
            <MetaPill key={label}>{CLASSIFICATION_LABELS[label]}</MetaPill>
          ))}
        </div>
        <p className="mt-3 max-w-reading text-sm text-muted-foreground">
          Last {WINDOW_DAYS} days. A dash means the source behind that figure has not told us,
          which is different from zero.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {groups.map((group) => (
          <section key={group.title} className="tt-surface p-5">
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              {group.title}
            </p>
            <ul className="mt-3 space-y-1.5 text-[13px]">
              {group.entries.map((entry) => (
                <li key={entry.label} className="flex items-baseline justify-between gap-3">
                  <span className="text-muted-foreground">{entry.label}</span>
                  <span className="font-mono text-foreground">{entry.value}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[11px] text-muted-foreground">
              {group.measured ? `Source · ${group.source}` : group.unknownNote}
            </p>
          </section>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="tt-surface p-5">
          <SectionHeading
            eyebrow="Search"
            title="Queries this page answers"
            description="The queries Search Console attributes to this address."
          />
          {!searchOn ? (
            <p className="text-sm text-muted-foreground">
              Search Console is not reporting, so the queries behind this page stay unknown.
            </p>
          ) : queries.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No query was attributed to this page in the window.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {queries.map((query) => (
                <li key={query.query} className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate text-foreground">{query.query}</span>
                  <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                    {query.clicks}c · {query.impressions}i · {percent(query.ctr)} · p
                    {decimal(query.averagePosition)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="tt-surface p-5">
          <SectionHeading
            eyebrow="Health"
            title="Can this page be found and understood"
            description="Presence or absence of the things that decide it. No score."
          />
          <ul className="space-y-1.5 text-sm">
            {pageReadiness(page, row).map((field) => (
              <li key={field.label} className="flex items-baseline justify-between gap-3">
                <span className="text-foreground">{field.label}</span>
                <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                  {field.present === null ? "Not told" : field.present ? "Yes" : "No"}
                </span>
              </li>
            ))}
          </ul>
          {findings.length > 0 ? (
            <ul className="mt-4 space-y-2 border-t border-border pt-3">
              {findings.map((finding) => (
                <li key={finding.id}>
                  <p className="text-sm text-foreground">{finding.title}</p>
                  <p className="text-[12px] text-muted-foreground">{finding.detail}</p>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>

      <section className="tt-surface p-5">
        <SectionHeading
          eyebrow="Conversion"
          title="Conversations that started here"
          description="Website hands these to Scout. Qualification is Scout's decision, never this room's."
        />
        {conversations.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No completed intake in Core names this page as its landing page.
          </p>
        ) : (
          <ul className="space-y-2">
            {conversations.map((submission) => (
              <li key={submission.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <Link
                  to="/modules/website/submissions/$submissionId"
                  params={{ submissionId: submission.id }}
                  className="text-sm text-royal hover:underline"
                >
                  {submission.company.name || submission.person.name || "Inbound founder"}
                </Link>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {WEBSITE_INTAKE_LABEL} · {new Date(submission.submittedAt).toLocaleDateString()}
                </span>
                <span className="text-[12px] text-muted-foreground">
                  {submission.scoutProspectId
                    ? isQualified(submission.scoutStatus)
                      ? "Qualified in Scout"
                      : `In Scout · ${submission.scoutStatus ?? "under review"}`
                    : "Held as an unlinked signal"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ProviderReadinessPanel readiness={readiness} compact />
    </div>
  );
}

interface MetricGroup {
  title: string;
  source: string;
  measured: boolean;
  unknownNote: string;
  entries: { label: string; value: string }[];
}

/** Share of measured site views, or unknown when GA4 is silent. */
function shareOfViews(row: PageRow, input: WebsiteAnalyticsInput): KnownNumber {
  if (row.views === null) return null;
  const total = input.pageMetrics.reduce((sum, metric) => sum + metric.views, 0);
  return total > 0 ? row.views / total : null;
}

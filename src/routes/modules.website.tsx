/**
 * The Website room.
 *
 * TrustTai.com owns attention and intake. This room is the awareness surface
 * for that: what arrived, from where, how far people got, and what Scout has
 * since decided. It is read-only by architecture. Nothing here creates a
 * roadmap, a project, or a qualification.
 */

import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Globe, Inbox, MousePointerClick, Sparkles } from "lucide-react";

import { AppShell } from "@/components/tt/app-shell";
import { RoomHero } from "@/components/tt/room-hero";
import { EmptyState, MetaPill, SectionHeading } from "@/components/tt/primitives";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { listWebsiteEvents, listWebsiteSubmissions } from "@/data/supabase/website-service";
import {
  deviceSplit,
  formatKnown,
  intakeFunnel,
  isQualified,
  modalityUsage,
  questionDropOff,
  sourceToQualified,
  topPaths,
  topReferrers,
  websiteHeadline,
} from "@/data/website/projection";
import { WEBSITE_INTAKE_LABEL, type WebsiteSubmission } from "@/domain/website";
import type { WorkspaceIdentity } from "@/lib/workspace";
import { cn } from "@/lib/utils";

const TITLE = "Website · Trust Tai OS";
const DESCRIPTION =
  "Attention and adaptive intake on TrustTai.com, and the inbound signals that reached Scout because of it.";

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

type Tab = "attention" | "funnel" | "submissions" | "sources";

const TABS: { key: Tab; label: string }[] = [
  { key: "attention", label: "Traffic & attention" },
  { key: "funnel", label: "Intake funnel" },
  { key: "submissions", label: "Submissions" },
  { key: "sources", label: "Source → qualified" },
];

function WebsiteRoute() {
  return (
    <WorkspaceGate appId="website">
      {(identity) => (
        <AppShell appId="website">
          <WebsiteRoom identity={identity} />
        </AppShell>
      )}
    </WorkspaceGate>
  );
}

const WINDOW_DAYS = 30;

function WebsiteRoom({ identity }: { identity: WorkspaceIdentity }) {
  const [tab, setTab] = useState<Tab>("submissions");

  const since = useMemo(
    () => new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    [],
  );

  const submissions = useQuery({
    queryKey: ["website", "submissions", identity.organizationId],
    queryFn: () => listWebsiteSubmissions(identity.organizationId),
  });
  const events = useQuery({
    queryKey: ["website", "events", identity.organizationId, since],
    queryFn: () => listWebsiteEvents(identity.organizationId, since),
  });

  const rows = submissions.data?.value ?? [];
  const eventRows = events.data?.value ?? [];
  const provisioned = (submissions.data?.provisioned ?? true) && (events.data?.provisioned ?? true);
  const headline = websiteHeadline(eventRows, rows);
  const loading = submissions.isPending || events.isPending;

  return (
    <div className="space-y-6">
      <RoomHero
        eyebrow="Website"
        title="What the website is bringing in"
        supporting="TrustTai.com is a signal source. It owns attention and intake, hands completed conversations to Scout, and never creates delivery work on its own."
        metrics={[
          {
            icon: <MousePointerClick className="size-4 text-royal" aria-hidden />,
            value: loading ? "…" : formatKnown(headline.visits),
            label: "Sessions",
            note: `Last ${WINDOW_DAYS} days`,
          },
          {
            icon: <Inbox className="size-4 text-royal" aria-hidden />,
            value: loading ? "…" : headline.submissions,
            label: "Intake submissions",
          },
          {
            icon: <Sparkles className="size-4 text-royal" aria-hidden />,
            value: loading ? "…" : headline.awaitingReview,
            label: "Awaiting Scout review",
            note: "Identity was ambiguous",
          },
          {
            icon: <Globe className="size-4 text-royal" aria-hidden />,
            value: loading ? "…" : headline.qualified,
            label: "Qualified in Scout",
          },
        ]}
      />

      {provisioned ? null : (
        <div className="tt-surface p-5">
          <p className="text-sm text-foreground">The website signal tables are not applied yet.</p>
          <p className="mt-1 max-w-reading text-xs text-muted-foreground">
            Apply <span className="font-mono">docs/website-signals-schema.sql</span> to the Trust
            Tai database. Until then this room shows nothing rather than inventing numbers.
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

      {tab === "attention" ? <Attention events={eventRows} /> : null}
      {tab === "funnel" ? <Funnel events={eventRows} submissions={rows} /> : null}
      {tab === "submissions" ? <Submissions submissions={rows} loading={loading} /> : null}
      {tab === "sources" ? <Sources events={eventRows} submissions={rows} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ pieces */

function Bare({ children }: { children: string }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

function Attention({ events }: { events: ReturnType<typeof Object> & any[] }) {
  const paths = topPaths(events);
  const referrers = topReferrers(events);
  const devices = deviceSplit(events);

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="tt-surface p-5">
        <SectionHeading eyebrow="Attention" title="Top landing pages" />
        {paths.length === 0 ? (
          <Bare>No page-view events have been received from TrustTai.com yet.</Bare>
        ) : (
          <ul className="space-y-2">
            {paths.map((entry) => (
              <li key={entry.path} className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate font-mono text-[12px] text-foreground">{entry.path}</span>
                <span className="font-mono text-[12px] text-muted-foreground">{entry.views}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="tt-surface p-5">
        <SectionHeading eyebrow="Attention" title="Referrers & campaigns" />
        {referrers.length === 0 ? (
          <Bare>No referrer data yet.</Bare>
        ) : (
          <ul className="space-y-2">
            {referrers.map((entry) => (
              <li key={entry.referrer} className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate text-foreground">{entry.referrer}</span>
                <span className="font-mono text-[12px] text-muted-foreground">{entry.visits}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="tt-surface p-5">
        <SectionHeading eyebrow="Attention" title="Devices" />
        {devices.length === 0 ? (
          <Bare>Device is only shown when the website reports it.</Bare>
        ) : (
          <ul className="space-y-2">
            {devices.map((entry) => (
              <li key={entry.device} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-foreground">{entry.device}</span>
                <span className="font-mono text-[12px] text-muted-foreground">{entry.visits}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Funnel({ events, submissions }: { events: any[]; submissions: WebsiteSubmission[] }) {
  const stages = intakeFunnel(events, submissions);
  const modality = modalityUsage(events);
  const dropOff = questionDropOff(events);

  return (
    <div className="space-y-4">
      <div className="tt-surface p-5">
        <SectionHeading
          eyebrow="Intake"
          title="From attention to a qualified company"
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

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="tt-surface p-5">
          <SectionHeading eyebrow="Intake" title="Text, voice and resume" />
          <div className="flex flex-wrap gap-2">
            <MetaPill>Text answers · {formatKnown(modality.text)}</MetaPill>
            <MetaPill>Voice answers · {formatKnown(modality.voice)}</MetaPill>
            <MetaPill>Resumed · {formatKnown(modality.resumed)}</MetaPill>
          </div>
        </div>

        <div className="tt-surface p-5">
          <SectionHeading eyebrow="Intake" title="Where people stop" />
          {dropOff.length === 0 ? (
            <Bare>Per-question abandonment appears once question-level events arrive.</Bare>
          ) : (
            <ul className="space-y-2">
              {dropOff.slice(0, 8).map((entry) => (
                <li key={entry.questionId} className="text-sm">
                  <span className="text-foreground">{entry.questionText}</span>
                  <span className="ml-2 font-mono text-[12px] text-muted-foreground">
                    {entry.abandoned} left · {entry.answered} answered
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function Submissions({
  submissions,
  loading,
}: {
  submissions: WebsiteSubmission[];
  loading: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (loading) return <div className="tt-surface p-5 text-sm text-muted-foreground">Loading…</div>;
  if (submissions.length === 0) {
    return (
      <EmptyState
        title="No website submissions yet"
        description="Completed adaptive intakes from TrustTai.com appear here the moment they are received, with their verbatim answers preserved."
      />
    );
  }

  return (
    <div className="space-y-3">
      {submissions.map((submission) => {
        const open = openId === submission.id;
        const utm = submission.attribution.utm ?? {};
        return (
          <article key={submission.id} className="tt-surface p-5">
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
                {submission.signals.completeness !== null &&
                submission.signals.completeness !== undefined ? (
                  <MetaPill>
                    Completeness · {Math.round((submission.signals.completeness ?? 0) * 100)}%
                  </MetaPill>
                ) : null}
                {submission.signals.frame ? <MetaPill>Frame · {submission.signals.frame}</MetaPill> : null}
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
              <button
                type="button"
                className="text-royal hover:underline"
                onClick={() => setOpenId(open ? null : submission.id)}
              >
                {open ? "Hide the conversation" : "Read the conversation"}
              </button>
            </div>

            {open ? (
              <div className="mt-4 space-y-4 border-t border-border pt-4">
                <Lists submission={submission} />
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
                    Verbatim
                  </p>
                  <ol className="mt-2 space-y-3">
                    {submission.verbatim.map((answer, index) => (
                      <li key={`${answer.questionId}-${index}`}>
                        <p className="text-[13px] text-foreground">{answer.questionText}</p>
                        <p className="mt-0.5 whitespace-pre-wrap text-sm text-muted-foreground">
                          {answer.skipped ? "Skipped." : answer.answerText}
                        </p>
                        <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                          {answer.modality}
                        </p>
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

function Lists({ submission }: { submission: WebsiteSubmission }) {
  const groups: { label: string; values: string[] }[] = [
    { label: "Current state", values: submission.structured.currentState },
    { label: "Desired future", values: submission.structured.desiredFuture },
    { label: "Pains", values: submission.structured.pains },
    { label: "Goals", values: submission.structured.goals },
    { label: "Constraints", values: submission.structured.constraints },
    { label: "Existing assets", values: submission.structured.existingAssets },
    { label: "Ideas", values: submission.structured.ideas },
    { label: "Open questions", values: submission.structured.openQuestions },
  ].filter((group) => group.values.length > 0);

  if (groups.length === 0) return null;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {groups.map((group) => (
        <div key={group.label} className="rounded-xl border border-border bg-card px-4 py-3">
          <p className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
            {group.label}
          </p>
          <ul className="mt-1.5 space-y-1 text-sm text-foreground">
            {group.values.map((value, index) => (
              <li key={index}>{value}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function Sources({ events, submissions }: { events: any[]; submissions: WebsiteSubmission[] }) {
  const rows = sourceToQualified(events, submissions);
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No attributed sources yet"
        description="Sources appear once website events or attributed submissions have been received."
      />
    );
  }

  return (
    <div className="tt-surface overflow-x-auto p-5">
      <SectionHeading
        eyebrow="Attribution"
        title="Source → qualified"
        description="Only measured columns are filled. A dash means Core has not been told."
      />
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-[12px] text-muted-foreground">
            <th className="py-2 pr-4 font-normal">Source</th>
            <th className="py-2 pr-4 font-normal">Campaign</th>
            <th className="py-2 pr-4 font-normal">Visits</th>
            <th className="py-2 pr-4 font-normal">Starts</th>
            <th className="py-2 pr-4 font-normal">Submissions</th>
            <th className="py-2 font-normal">Qualified</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.source}-${row.campaign ?? ""}`} className="border-b border-border/60">
              <td className="py-2 pr-4 text-foreground">{row.source}</td>
              <td className="py-2 pr-4 text-muted-foreground">{row.campaign ?? "—"}</td>
              <td className="py-2 pr-4 font-mono text-[12px]">{formatKnown(row.visits)}</td>
              <td className="py-2 pr-4 font-mono text-[12px]">{formatKnown(row.starts)}</td>
              <td className="py-2 pr-4 font-mono text-[12px]">{formatKnown(row.submissions)}</td>
              <td className="py-2 font-mono text-[12px]">{formatKnown(row.qualified)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Website submission detail.
 *
 * One inbound conversation, whole. This is the evidence page behind every
 * inbound company in Scout: what they were asked, what they said, where they
 * came from, and whether the submission reached a company. It asserts nothing
 * and decides nothing — the Website room reports, Scout judges.
 */

import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowUpRight } from "lucide-react";

import { AppShell } from "@/components/tt/app-shell";
import { EmptyState, MetaPill, SectionHeading, TTButton } from "@/components/tt/primitives";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { InboundBadge, InboundWash } from "@/components/tt/scout/inbound";
import { getWebsiteSubmission } from "@/data/supabase/website-service";
import { STATED_LANE_LABEL, STATED_LANE_ORDER, packetFromSubmission } from "@/domain/stated";
import { claimsInLane } from "@/domain/stated";
import { WEBSITE_INTAKE_LABEL, type WebsiteSubmission } from "@/domain/website";
import type { WorkspaceIdentity } from "@/lib/workspace";

const TITLE = "Inbound submission · Website · Trust Tai OS";
const DESCRIPTION =
  "One completed roadmap intake from TrustTai.com, in full, with where it came from and where it went.";

export const Route = createFileRoute("/modules/website_/submissions/$submissionId")({
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
  component: SubmissionRoute,
});

function SubmissionRoute() {
  return (
    <WorkspaceGate appId="website">
      {(identity) => (
        <AppShell identity={identity}>
          <SubmissionDetail identity={identity} />
        </AppShell>
      )}
    </WorkspaceGate>
  );
}

function percent(value?: number | null): string {
  return typeof value === "number" ? `${Math.round(value * 100)}%` : "—";
}

function SubmissionDetail({ identity }: { identity: WorkspaceIdentity }) {
  const { submissionId } = useParams({ from: "/modules/website_/submissions/$submissionId" });

  const query = useQuery({
    queryKey: ["website", "submission", identity.organizationId, submissionId],
    queryFn: () => getWebsiteSubmission(identity.organizationId, submissionId),
  });

  if (query.isPending) {
    return <p className="text-sm text-muted-foreground">Opening the conversation…</p>;
  }

  if (query.error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {(query.error as Error).message}
      </p>
    );
  }

  if (!query.data) {
    return (
      <EmptyState
        title="This submission is not here"
        belongsHere="Completed roadmap intakes from TrustTai.com live here, in full."
        whyItMatters="It may have been removed, or it belongs to another workspace. Nothing was changed."
        action={
          <Link to="/modules/website">
            <TTButton variant="secondary">Back to the Website room</TTButton>
          </Link>
        }
      />
    );
  }

  const { submission, prospectName } = query.data;
  return <SubmissionBody submission={submission} prospectName={prospectName} />;
}

function SubmissionBody({
  submission,
  prospectName,
}: {
  submission: WebsiteSubmission;
  prospectName: string | null;
}) {
  const packet = packetFromSubmission(submission, submission.id);
  const lanes = STATED_LANE_ORDER.map((lane) => ({
    lane,
    statements: claimsInLane(packet, lane),
  })).filter((entry) => entry.statements.length > 0);
  const answered = submission.verbatim.filter((turn) => !turn.skipped && turn.answerText.trim());
  const utm = submission.attribution.utm ?? {};

  return (
    <div className="space-y-6">
      <Link
        to="/modules/website"
        className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        Website
      </Link>

      <InboundWash>
        <div className="p-6">
          <div className="flex flex-wrap items-center gap-2">
            <InboundBadge />
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {WEBSITE_INTAKE_LABEL}
            </span>
          </div>

          <h1 className="mt-3 font-display text-[34px] leading-tight text-foreground">
            {submission.company.name || prospectName || "An inbound founder"}
          </h1>
          <p className="mt-2 max-w-reading text-[15px] text-muted-foreground">
            {submission.person.name ? `${submission.person.name} ` : "Someone "}
            completed the roadmap conversation on TrustTai.com on{" "}
            {new Date(submission.submittedAt).toLocaleDateString(undefined, {
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
            . {submission.linkReason}
          </p>

          <dl className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Source", value: utm.source || "Direct" },
              { label: "Campaign", value: utm.campaign || "—" },
              { label: "Landed on", value: submission.attribution.landingPath || "—" },
              { label: "Coverage", value: percent(submission.signals.objectiveCoverage) },
            ].map((item) => (
              <div key={item.label}>
                <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  {item.label}
                </dt>
                <dd className="mt-1 truncate text-[13px] text-foreground">{item.value}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <MetaPill>
              {submission.linkState === "linked" ? "Reached Scout" : "Waiting for a person"}
            </MetaPill>
            {submission.scoutStatus ? <MetaPill>Scout · {submission.scoutStatus}</MetaPill> : null}
            {submission.scoutProspectId ? (
              <Link
                to="/modules/scout/prospects/$prospectId"
                params={{ prospectId: submission.scoutProspectId }}
                search={{ section: "scout" as const, fit: "all" as const }}
                className="inline-flex items-center gap-1.5 text-[13px] text-royal hover:underline"
              >
                Open the company in Scout
                <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            ) : null}
          </div>
        </div>
      </InboundWash>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-6">
          <div className="tt-surface p-5">
            <SectionHeading
              eyebrow="Conversation"
              title="The intake, in full"
              description="Every question the website asked, and every answer given, unedited."
            />
            {answered.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No answers were recorded for this submission.
              </p>
            ) : (
              <ol className="space-y-4">
                {answered.map((turn) => (
                  <li
                    key={turn.questionId}
                    className="rounded-xl border border-border bg-card px-4 py-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <MetaPill>{turn.modality === "voice" ? "Spoken" : "Typed"}</MetaPill>
                      <p className="text-[13px] text-muted-foreground">{turn.questionText}</p>
                    </div>
                    <p className="mt-2 border-l-2 border-royal/25 pl-3 text-[15px] text-foreground">
                      {turn.answerText}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="tt-surface p-5">
            <SectionHeading
              eyebrow="Stated"
              title="What the conversation says they need"
              description="Extracted from their own words. Testimony, not evidence: nothing here has been verified."
            />
            {lanes.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing structured was extracted from this conversation.
              </p>
            ) : (
              <div className="space-y-4">
                {lanes.map(({ lane, statements }) => (
                  <div key={lane}>
                    <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      {STATED_LANE_LABEL[lane]}
                    </p>
                    <ul className="mt-2 space-y-1.5">
                      {statements.map((statement, index) => (
                        <li
                          key={`${lane}-${index}`}
                          className="border-l-2 border-royal/25 pl-3 text-[14px] text-foreground"
                        >
                          {statement}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <aside className="space-y-6">
          <div className="tt-surface p-5">
            <SectionHeading eyebrow="Who" title="The person" />
            <dl className="space-y-3 text-[13px]">
              {[
                { label: "Name", value: submission.person.name },
                { label: "Role", value: submission.person.role },
                { label: "Email", value: submission.person.email },
                { label: "Phone", value: submission.person.phone },
                { label: "Company website", value: submission.company.website },
                { label: "Industry stated", value: submission.company.industryStated },
                { label: "Size stated", value: submission.company.sizeStated },
                { label: "Location stated", value: submission.company.locationStated },
              ].map((item) => (
                <div key={item.label}>
                  <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    {item.label}
                  </dt>
                  <dd className="mt-0.5 break-words text-foreground">{item.value || "—"}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="tt-surface p-5">
            <SectionHeading
              eyebrow="Understanding"
              title="How complete this is"
              description="The website's own read of the conversation. Shown, never trusted as fact."
            />
            <dl className="space-y-3 text-[13px]">
              {[
                { label: "Frame", value: submission.signals.frame || "—" },
                { label: "Frame confidence", value: percent(submission.signals.frameConfidence) },
                { label: "Completeness", value: percent(submission.signals.completeness) },
                {
                  label: "Research consent",
                  value:
                    submission.signals.authorizesResearch === true
                      ? "Given"
                      : submission.signals.authorizesResearch === false
                        ? "Withheld"
                        : "Not asked",
                },
              ].map((item) => (
                <div key={item.label}>
                  <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    {item.label}
                  </dt>
                  <dd className="mt-0.5 text-foreground">{item.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </aside>
      </div>
    </div>
  );
}

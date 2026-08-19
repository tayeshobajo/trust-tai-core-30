/**
 * Website submission detail — the canonical source record.
 *
 * One inbound conversation, whole and addressable. This is the evidence page
 * behind every inbound company in Scout: what they were asked, what they said,
 * where they came from, and whether the submission reached a company. It
 * asserts nothing and decides nothing — the Website room reports, Scout judges.
 *
 * TODO(stated-lane): when the canonical `stated` evidence lane lands, the
 * "What they told us" block below becomes its rendering surface; the shape of
 * `packetFromSubmission` is deliberately the only bridge.
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
  return typeof value === "number" ? `${Math.round(value * 100)}%` : "Not stated";
}

function stated(value?: string | null): string {
  return value && value.trim() ? value : "Not stated";
}

function shortId(value: string): string {
  return value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
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

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 break-words text-[13px] text-foreground">{value}</dd>
    </div>
  );
}

function SubmissionBody({
  submission,
  prospectName,
}: {
  submission: WebsiteSubmission;
  prospectName: string | null;
}) {
  const packet = packetFromSubmission(submission, submission.id);
  /** Every lane, always — an unanswered lane is itself a fact. */
  const lanes = STATED_LANE_ORDER.map((lane) => ({
    lane,
    statements: claimsInLane(packet, lane),
  }));
  const utm = submission.attribution.utm ?? {};
  const linked = Boolean(submission.scoutProspectId);

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
        <div className="border-l-2 border-royal/50 p-6">
          <div className="flex flex-wrap items-center gap-2">
            <InboundBadge />
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              TrustTai.com · {WEBSITE_INTAKE_LABEL}
            </span>
          </div>

          <h1 className="mt-3 font-display text-[34px] leading-tight text-foreground">
            {submission.company.name || prospectName || submission.person.name || "An inbound founder"}
          </h1>
          <p className="mt-2 max-w-reading text-[15px] text-muted-foreground">
            {submission.person.name ? `${submission.person.name} ` : "Someone "}
            completed the roadmap conversation on TrustTai.com on{" "}
            {new Date(submission.submittedAt).toLocaleString(undefined, {
              month: "long",
              day: "numeric",
              year: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
            . {submission.linkReason}
          </p>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <MetaPill>
              {linked
                ? "Linked to a Scout company"
                : submission.processingStateLabel || "Not linked to a Scout prospect yet"}
            </MetaPill>
            {submission.scoutStatus ? <MetaPill>Scout · {submission.scoutStatus}</MetaPill> : null}
            {linked ? (
              <Link
                to="/modules/scout/prospects/$prospectId"
                params={{ prospectId: submission.scoutProspectId as string }}
                search={{ section: "scout" as const, fit: "all" as const }}
                className="inline-flex items-center gap-1.5 text-[13px] text-royal hover:underline"
              >
                Open in Scout
                <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            ) : null}
          </div>
        </div>
      </InboundWash>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-6">
          {/* 1. What they told us */}
          <div className="tt-surface p-5">
            <SectionHeading
              eyebrow="Stated"
              title="What they told us"
              description="Their own account, lane by lane. Testimony, not evidence: nothing here has been verified."
            />
            <div className="space-y-4">
              {lanes.map(({ lane, statements }) => (
                <div key={lane}>
                  <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    {STATED_LANE_LABEL[lane]}
                  </p>
                  {statements.length === 0 ? (
                    <p className="mt-1 text-[14px] text-muted-foreground">Not stated</p>
                  ) : (
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
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* 2. In their words */}
          <div className="tt-surface p-5">
            <SectionHeading
              eyebrow="Conversation"
              title="In their words"
              description="Every question the website asked, and every answer given, unedited and in sequence."
            />
            {submission.verbatim.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No answers were recorded for this submission.
              </p>
            ) : (
              <ol className="space-y-4">
                {submission.verbatim.map((turn, index) => (
                  <li
                    key={`${turn.questionId}-${index}`}
                    className="rounded-xl border border-border bg-card px-4 py-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <MetaPill>{turn.modality === "voice" ? "Spoken" : "Typed"}</MetaPill>
                      {turn.skipped ? <MetaPill>Skipped</MetaPill> : null}
                      {turn.answeredAt ? (
                        <MetaPill>{new Date(turn.answeredAt).toLocaleTimeString()}</MetaPill>
                      ) : null}
                      <p className="text-[13px] text-muted-foreground">{turn.questionText}</p>
                    </div>
                    {turn.skipped || !turn.answerText.trim() ? (
                      <p className="mt-2 pl-3 text-[14px] italic text-muted-foreground">
                        No answer given.
                      </p>
                    ) : (
                      <p className="mt-2 border-l-2 border-royal/25 pl-3 text-[15px] text-foreground">
                        {turn.answerText}
                      </p>
                    )}
                    {turn.mediaUrl ? (
                      <a
                        href={turn.mediaUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="mt-2 inline-block text-[13px] text-royal hover:underline"
                      >
                        Open the recording
                      </a>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>

        <aside className="space-y-6">
          {/* 5. Scout connection */}
          <div className="tt-surface p-5">
            <SectionHeading eyebrow="Scout" title="Scout connection" />
            <dl className="space-y-3">
              <Field
                label="State"
                value={linked ? "Linked" : submission.linkState === "unlinked" ? "Unlinked" : "Held"}
              />
              <Field label="Company in Scout" value={stated(prospectName)} />
              <Field label="Reason" value={stated(submission.linkReason)} />
              <Field label="Scout status" value={stated(submission.scoutStatus)} />
            </dl>
            {linked ? (
              <Link
                to="/modules/scout/prospects/$prospectId"
                params={{ prospectId: submission.scoutProspectId as string }}
                search={{ section: "scout" as const, fit: "all" as const }}
                className="mt-4 inline-flex items-center gap-1.5 text-[13px] text-royal hover:underline"
              >
                Open in Scout
                <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            ) : (
              <p className="mt-4 text-[13px] text-muted-foreground">
                Not linked to a Scout prospect yet. Linking is a person's decision and happens in
                Scout; nothing is connected from this page.
              </p>
            )}
          </div>

          {/* 4. Source */}
          <div className="tt-surface p-5">
            <SectionHeading eyebrow="Source" title="Where this came from" />
            <dl className="space-y-3">
              <Field label="Source" value="TrustTai.com" />
              <Field label="Intake type" value="Build My Roadmap" />
              <Field label="Landing page" value={stated(submission.attribution.landingPath)} />
              <Field label="Referrer" value={stated(submission.attribution.entryReferrer)} />
              <Field label="UTM source" value={stated(utm.source)} />
              <Field label="UTM medium" value={stated(utm.medium)} />
              <Field label="UTM campaign" value={stated(utm.campaign)} />
              <Field label="UTM content" value={stated(utm.content)} />
              <Field
                label="Page views before start"
                value={
                  typeof submission.attribution.pageViewsBeforeStart === "number"
                    ? String(submission.attribution.pageViewsBeforeStart)
                    : "Not stated"
                }
              />
              <Field label="Device" value={stated(submission.attribution.device)} />
              <Field label="Locale" value={stated(submission.attribution.locale)} />
              <Field
                label="Session"
                value={
                  submission.attribution.sessionId
                    ? shortId(submission.attribution.sessionId)
                    : "Not stated"
                }
              />
              <Field label="Submission" value={shortId(submission.submissionId)} />
              <Field
                label="Research authorization"
                value={
                  submission.signals.authorizesResearch === true
                    ? "Given"
                    : submission.signals.authorizesResearch === false
                      ? "Withheld"
                      : "Not asked"
                }
              />
              <Field
                label="Marketing consent"
                value={
                  submission.consent.marketingOptIn === true
                    ? "Given"
                    : submission.consent.marketingOptIn === false
                      ? "Declined"
                      : "Not asked"
                }
              />
              <Field label="Privacy version" value={stated(submission.consent.privacyVersion)} />
            </dl>
          </div>

          <div className="tt-surface p-5">
            <SectionHeading eyebrow="Who" title="The person" />
            <dl className="space-y-3">
              <Field label="Name" value={stated(submission.person.name)} />
              <Field label="Role" value={stated(submission.person.role)} />
              <Field label="Email" value={stated(submission.person.email)} />
              <Field label="Phone" value={stated(submission.person.phone)} />
              <Field label="Company website" value={stated(submission.company.website)} />
              <Field label="Industry stated" value={stated(submission.company.industryStated)} />
              <Field label="Size stated" value={stated(submission.company.sizeStated)} />
              <Field label="Location stated" value={stated(submission.company.locationStated)} />
            </dl>
          </div>

          {/* 3. Understanding — only what the intake actually stored */}
          <div className="tt-surface p-5">
            <SectionHeading
              eyebrow="Understanding"
              title="What the intake recorded"
              description="The website's own read of the conversation. Shown, never treated as fact."
            />
            <dl className="space-y-3">
              <Field label="Frame" value={stated(submission.signals.frame)} />
              <Field
                label="Frame confidence"
                value={percent(submission.signals.frameConfidence)}
              />
              <Field
                label="Objective coverage"
                value={percent(submission.signals.objectiveCoverage)}
              />
              <Field label="Completeness" value={percent(submission.signals.completeness)} />
            </dl>
          </div>
        </aside>
      </div>
    </div>
  );
}

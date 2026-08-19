/**
 * The Website submission behind a Scout company.
 *
 * Read-only evidence. Scout owns qualification; the Website room owns the
 * submission. This card is the link back to the source, so every assertion
 * about an inbound company is traceable to the conversation that produced it.
 */

import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { MetaPill, SectionHeading } from "@/components/tt/primitives";
import { submissionsForProspect } from "@/data/supabase/website-service";
import { WEBSITE_INTAKE_LABEL } from "@/domain/website";

export function InboundSourceCard({
  organizationId,
  prospectId,
}: {
  organizationId: string;
  prospectId: string;
}) {
  const submissions = useQuery({
    queryKey: ["website", "submissions", "prospect", organizationId, prospectId],
    queryFn: () => submissionsForProspect(organizationId, prospectId),
  });

  const rows = submissions.data ?? [];
  if (rows.length === 0) return null;

  return (
    <div className="tt-surface p-5">
      <SectionHeading
        eyebrow="Inbound · TrustTai.com"
        title={WEBSITE_INTAKE_LABEL}
        description="This company reached Scout through the adaptive intake on the website. The full conversation is preserved."
      />
      <ul className="space-y-3">
        {rows.map((submission) => {
          const utm = submission.attribution.utm ?? {};
          return (
            <li key={submission.id} className="rounded-xl border border-border bg-card px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <MetaPill>{new Date(submission.submittedAt).toLocaleDateString()}</MetaPill>
                <MetaPill>{utm.source ? `Source · ${utm.source}` : "Source · Direct"}</MetaPill>
                {utm.campaign ? <MetaPill>Campaign · {utm.campaign}</MetaPill> : null}
                {submission.attribution.landingPath ? (
                  <MetaPill>Landed on {submission.attribution.landingPath}</MetaPill>
                ) : null}
              </div>
              {submission.structured.desiredFuture[0] ? (
                <p className="mt-2 max-w-reading text-sm text-muted-foreground">
                  Wants: {submission.structured.desiredFuture[0]}
                </p>
              ) : null}
              <Link
                to="/modules/website/submissions/$submissionId"
                params={{ submissionId: submission.id }}
                className="mt-2 inline-block text-[13px] text-royal hover:underline"
              >
                Open the original conversation
              </Link>

            </li>
          );
        })}
      </ul>
    </div>
  );
}

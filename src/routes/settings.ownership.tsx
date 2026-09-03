/**
 * Settings, Execution ownership.
 *
 * A QA surface for the ownership law: what every persisted milestone would be
 * classified as today, the words that decided it, and the rows still storing
 * the wrong room. Correcting them is a human action, taken here.
 */

import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { MetaPill, SectionHeading, TTButton } from "@/components/tt/primitives";
import { OwnershipDecision } from "@/components/tt/roadmap/ownership-inspector";
import { useSettingsIdentity } from "@/components/tt/settings/shell";
import { EXECUTION_ROOM_LABEL, EXECUTION_ROOM_LAW } from "@/domain/execution-ownership";
import { describeBackfillPlan } from "@/domain/execution-ownership-backfill";
import { ownershipBackfill } from "@/data/supabase/ownership-backfill-service";

export const Route = createFileRoute("/settings/ownership")({
  component: OwnershipSettings,
});

function OwnershipSettings() {
  const identity = useSettingsIdentity();
  const queryClient = useQueryClient();
  const key = ["settings", "ownership", identity.organizationId];

  const plan = useQuery({
    queryKey: key,
    queryFn: () =>
      ownershipBackfill.plan({ organizationId: identity.organizationId, userId: identity.userId }),
    retry: false,
  });

  const backfill = useMutation({
    mutationFn: () =>
      ownershipBackfill.apply({
        organizationId: identity.organizationId,
        userId: identity.userId,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  const data = plan.data;

  return (
    <div className="space-y-6">
      <section className="tt-surface p-6">
        <SectionHeading
          eyebrow="Organization"
          title="Execution ownership"
          description="Roadmap proposes. Rooms execute. This page shows how every persisted milestone reads under the ownership law, and corrects any row that still names the wrong room."
        />

        <dl className="grid gap-3 sm:grid-cols-3">
          {(["projects", "ops", "studio"] as const).map((room) => (
            <div key={room} className="rounded-xl border border-border p-4">
              <dt className="tt-eyebrow">{EXECUTION_ROOM_LABEL[room]}</dt>
              <dd className="mt-1 text-sm text-muted-foreground">{EXECUTION_ROOM_LAW[room]}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="tt-surface p-6">
        {plan.isPending ? (
          <p className="text-sm text-muted-foreground">Reading every milestone…</p>
        ) : plan.isError ? (
          <p className="text-sm text-danger">
            {plan.error instanceof Error ? plan.error.message : "The milestones could not be read."}
          </p>
        ) : data ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="tt-eyebrow">Backfill</p>
                <p className="mt-1 max-w-reading text-sm text-foreground">
                  {describeBackfillPlan(data)}
                </p>
              </div>
              <TTButton
                disabled={data.changes.length === 0 || backfill.isPending}
                onClick={() => backfill.mutate()}
              >
                {backfill.isPending
                  ? "Correcting…"
                  : data.changes.length === 0
                    ? "Nothing to correct"
                    : `Correct ${data.changes.length} row${data.changes.length === 1 ? "" : "s"}`}
              </TTButton>
            </div>

            {backfill.isError ? (
              <p className="mt-3 text-sm text-danger">
                {backfill.error instanceof Error
                  ? backfill.error.message
                  : "The correction did not complete."}
              </p>
            ) : null}
            {backfill.data ? (
              <p className="mt-3 text-sm text-muted-foreground">
                Rewrote {backfill.data.boundariesWritten} boundary sentence
                {backfill.data.boundariesWritten === 1 ? "" : "s"} and re-pointed{" "}
                {backfill.data.linksWritten} handoff
                {backfill.data.linksWritten === 1 ? "" : "s"}.
              </p>
            ) : null}

            <div className="mt-6 flex flex-wrap gap-2">
              <MetaPill>{data.counts.milestones} milestones</MetaPill>
              <MetaPill>{data.counts.boundaries} boundaries to fix</MetaPill>
              <MetaPill>{data.counts.links} handoffs to re-point</MetaPill>
              <MetaPill>{data.counts.frozen} settled, left as history</MetaPill>
            </div>
          </>
        ) : null}
      </section>

      {data && data.corrections.length > 0 ? (
        <section className="tt-surface p-6">
          <SectionHeading
            eyebrow="Inspector"
            title="Ownership decision, milestone by milestone"
            description="The vocabulary each decision was made on, and what the row currently stores."
          />
          <ul className="space-y-4">
            {data.corrections.map((entry) => (
              <li key={entry.milestoneId} className="rounded-xl border border-border p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-display text-xl text-foreground">
                    {entry.name || "Untitled milestone"}
                  </h3>
                  {entry.boundaryChanged ? (
                    <MetaPill>Boundary names the wrong room</MetaPill>
                  ) : null}
                  {entry.linkChanged ? (
                    <MetaPill>
                      Handoff moves{" "}
                      {entry.linkOwnerBefore ? EXECUTION_ROOM_LABEL[entry.linkOwnerBefore] : ", "} →{" "}
                      {entry.linkOwnerAfter ? EXECUTION_ROOM_LABEL[entry.linkOwnerAfter] : ", "}
                    </MetaPill>
                  ) : null}
                </div>

                <div className="mt-3">
                  <OwnershipDecision read={entry.owner} />
                </div>

                {entry.boundaryChanged ? (
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <div>
                      <p className="tt-eyebrow">Stored today</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {entry.boundaryBefore || ", "}
                      </p>
                    </div>
                    <div>
                      <p className="tt-eyebrow">After the correction</p>
                      <p className="mt-1 text-sm text-foreground">{entry.boundaryAfter}</p>
                    </div>
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-muted-foreground">
                    {entry.boundaryBefore || "No boundary sentence stored."}
                  </p>
                )}

                {entry.frozenBecause ? (
                  <p className="mt-3 text-sm text-warning">{entry.frozenBecause}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

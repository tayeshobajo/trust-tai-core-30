/**
 * The Comms dashboard: what needs action, and why.
 *
 * Every line rests on a record that already exists — a reply owed, a promise
 * someone made, a date a person put on the calendar, a draft held at the human
 * boundary, a review nobody has approved. Nothing is inferred from silence, no
 * deadline is invented, and each line opens the exact record it names.
 *
 * A section whose read failed says so. It never shows an empty success.
 */

import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { AppShell } from "@/components/tt/app-shell";
import { CommsTabs } from "@/components/tt/comms/comms-tabs";
import { PageHeader, TTButton } from "@/components/tt/primitives";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { commsService } from "@/data/supabase/comms-service";
import { listReviews } from "@/data/supabase/comms-review-client";
import { supabase } from "@/integrations/trust-tai/supabase";
import { buildPlan, dueLabel, type PlanItem } from "@/domain/comms-plan";
import { buildWorkBoard, showingNote, type Bucket } from "@/domain/comms-work-board";
import { draftSearch, readFailureMessage, sectionState } from "@/domain/comms-section-state";
import type { ReviewSession } from "@/domain/comms-review";
import type { WorkspaceIdentity } from "@/lib/workspace";

const TITLE = "Dashboard · Comms · Trust Tai OS";
const DESCRIPTION =
  "What needs action in Comms right now: replies owed, drafts waiting on review, dates that have passed and follow-ups someone scheduled.";

const SHOWN = 10;

export const Route = createFileRoute("/modules/comms/")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: CommsDashboardRoute,
});

function CommsDashboardRoute() {
  return (
    <WorkspaceGate appId="comms">
      {(identity) => (
        <AppShell identity={identity}>
          <CommsDashboard identity={identity} />
        </AppShell>
      )}
    </WorkspaceGate>
  );
}

interface WaitingDraft {
  id: string;
  subject: string | null;
  createdAt: string;
}

/**
 * Drafts held at the human boundary, and how many there are in total.
 *
 * The count is a real count, taken from the database, not the length of the
 * page we happened to read.
 */
async function waitingDrafts(
  organizationId: string,
): Promise<{ rows: WaitingDraft[]; total: number }> {
  const { data, error, count } = await supabase
    .from("comms_drafts")
    .select("id, subject, created_at", { count: "exact" })
    .eq("organization_id", organizationId)
    .in("review_state", ["needs_human_review"])
    .order("created_at", { ascending: false })
    .limit(SHOWN);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { id: string; subject: string | null; created_at: string }[];
  return {
    rows: rows.map((row) => ({ id: row.id, subject: row.subject, createdAt: row.created_at })),
    total: count ?? rows.length,
  };
}

function Section({
  title,
  note,
  count,
  query,
  empty,
  children,
  footer,
}: {
  title: string;
  note: string;
  count: number | null;
  query: UseQueryResult<unknown, unknown>;
  empty: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const state = sectionState({ isError: query.isError, isPending: query.isPending, count });
  return (
    <section className="rounded-xl border border-border p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] text-foreground">
          {title}
          {state === "error" || count === null ? null : (
            <span className="text-muted-foreground"> · {count}</span>
          )}
        </h2>
        <p className="text-[12px] text-muted-foreground">{note}</p>
      </header>
      <div className="mt-3">
        {state === "error" ? (
          <div className="space-y-2">
            <p className="text-[13px] text-destructive">{readFailureMessage(query.error)}</p>
            <TTButton size="sm" variant="quiet" onClick={() => void query.refetch()}>
              Try again
            </TTButton>
          </div>
        ) : state === "loading" ? (
          <p className="text-[13px] text-muted-foreground">Reading…</p>
        ) : state === "empty" ? (
          <p className="text-[13px] text-muted-foreground">{empty}</p>
        ) : (
          <>
            {children}
            {footer}
          </>
        )}
      </div>
    </section>
  );
}

function PlanList({ bucket, now }: { bucket: Bucket; now: Date }) {
  const shown = bucket.items.slice(0, SHOWN);
  const note = showingNote(shown.length, bucket.total);
  return (
    <>
      <ul className="space-y-2">
        {shown.map((item: PlanItem) => (
          <li key={item.id}>
            <Link
              to="/modules/comms/relationships"
              search={{ relationship: item.relationshipId }}
              className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg bg-secondary/40 px-3 py-2 hover:bg-secondary/70"
            >
              <span className="text-[13px] text-foreground">
                {item.personName}
                {item.companyName ? (
                  <span className="text-muted-foreground"> · {item.companyName}</span>
                ) : null}
                <span className="block text-[12px] text-muted-foreground">
                  {item.title} — {item.reason}
                </span>
              </span>
              <span
                className={
                  item.dueAt && new Date(item.dueAt).getTime() < now.getTime()
                    ? "text-[12px] text-destructive"
                    : "text-[12px] text-muted-foreground"
                }
              >
                {dueLabel(item.dueAt, now)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {note ? (
        <p className="mt-2 text-[12px] text-muted-foreground">
          {note}{" "}
          <Link to="/modules/comms/plan" className="underline">
            See all dated work
          </Link>
        </p>
      ) : null}
    </>
  );
}

function CommsDashboard({ identity }: { identity: WorkspaceIdentity }) {
  /* Overdue is a fact about the clock, not about the data. The clock is kept
     in state and stepped every minute so a page left open does not keep
     calling a passed date "due soon". */
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const relationships = useQuery({
    queryKey: ["comms", "relationships", identity.organizationId],
    queryFn: () => commsService.list(identity.organizationId),
  });

  /* A narrow read with its own shape, so it cannot poison the full queue read
     that Drafts & Reviews makes under ["comms", "queue", …]. */
  const drafts = useQuery({
    queryKey: ["comms", "drafts-waiting-summary", identity.organizationId],
    queryFn: () => waitingDrafts(identity.organizationId),
  });

  const reviews = useQuery({
    queryKey: ["comms", "reviews", identity.organizationId],
    queryFn: () => listReviews(identity.organizationId),
  });

  const plans = useMemo(
    () => buildPlan(relationships.data ?? [], now),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [relationships.data, Math.floor(now.getTime() / 60_000)],
  );
  const board = useMemo(
    () => buildWorkBoard(plans.flatMap((plan) => plan.items), now),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plans, Math.floor(now.getTime() / 60_000)],
  );

  /* "Not approved" is read from the record, not assumed from a status word:
     a session is unapproved when its status is not approved and it is not
     closed. Anything else would label approved work as outstanding. */
  const awaitingApproval: ReviewSession[] = (reviews.data ?? []).filter(
    (session) => session.status === "open",
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Comms"
        title="Dashboard"
        supporting="What needs action, and the record it rests on. Every line opens the place the work is done."
        appId="comms"
      />
      <CommsTabs active="dashboard" />

      <div className="grid gap-4 lg:grid-cols-2">
        <Section
          title="Replies owed"
          note="A reply was marked owed on the conversation."
          count={relationships.isSuccess ? board.repliesOwed.total : null}
          query={relationships}
          empty="No reply is recorded as owed."
        >
          <PlanList bucket={board.repliesOwed} now={now} />
        </Section>

        <Section
          title="Drafts waiting on review"
          note="Held at the human boundary."
          count={drafts.data?.total ?? null}
          query={drafts}
          empty="No draft is waiting."
        >
          <ul className="space-y-2">
            {(drafts.data?.rows ?? []).map((draft) => (
              <li key={draft.id}>
                <Link
                  to="/modules/comms/drafts"
                  search={draftSearch(draft.id)}
                  className="block rounded-lg bg-secondary/40 px-3 py-2 text-[13px] text-foreground hover:bg-secondary/70"
                >
                  {draft.subject ?? "(no subject)"}
                  <span className="block text-[12px] text-muted-foreground">
                    Drafted {new Date(draft.createdAt).toLocaleDateString()}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {showingNote(drafts.data?.rows.length ?? 0, drafts.data?.total ?? 0) ? (
            <p className="mt-2 text-[12px] text-muted-foreground">
              {showingNote(drafts.data?.rows.length ?? 0, drafts.data?.total ?? 0)}{" "}
              <Link to="/modules/comms/drafts" search={{ filter: "waiting" }} className="underline">
                See every waiting draft
              </Link>
            </p>
          ) : null}
        </Section>

        <Section
          title="Reviews not yet approved"
          note="One record per message. Approval is a separate, role-checked act."
          count={reviews.isSuccess ? awaitingApproval.length : null}
          query={reviews}
          empty="No review is waiting on an approval."
        >
          <ul className="space-y-2">
            {awaitingApproval.slice(0, SHOWN).map((session) => (
              <li key={session.id}>
                <Link
                  to="/modules/comms/drafts"
                  search={{ session: session.id }}
                  className="block rounded-lg bg-secondary/40 px-3 py-2 text-[13px] text-foreground hover:bg-secondary/70"
                >
                  {session.title}
                  <span className="block text-[12px] text-muted-foreground">
                    {session.recipientName ?? session.recipientEmail ?? "No recipient named"} ·
                    revision {session.contextRevision}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {showingNote(Math.min(SHOWN, awaitingApproval.length), awaitingApproval.length) ? (
            <p className="mt-2 text-[12px] text-muted-foreground">
              {showingNote(Math.min(SHOWN, awaitingApproval.length), awaitingApproval.length)}{" "}
              <Link to="/modules/comms/drafts" search={{ filter: "review" }} className="underline">
                See every open review
              </Link>
            </p>
          ) : null}
        </Section>

        <Section
          title="Past their date"
          note="Promises and follow-ups someone dated, now in the past."
          count={relationships.isSuccess ? board.pastDue.total : null}
          query={relationships}
          empty="Nothing dated has slipped."
        >
          <PlanList bucket={board.pastDue} now={now} />
        </Section>

        <Section
          title="Meetings needing a record"
          note="The date has passed. Whether it happened is not recorded either way."
          count={relationships.isSuccess ? board.meetingsNeedingRecord.total : null}
          query={relationships}
          empty="No meeting is missing a record."
        >
          <PlanList bucket={board.meetingsNeedingRecord} now={now} />
        </Section>

        <Section
          title="Coming up"
          note="Dates a person set. Change them on the conversation."
          count={relationships.isSuccess ? board.upcoming.total : null}
          query={relationships}
          empty="Nothing is scheduled."
        >
          <PlanList bucket={board.upcoming} now={now} />
        </Section>
      </div>

      <p className="text-[12px] text-muted-foreground">
        Silence alone is not on this list: a quiet conversation is not evidence that anything is
        wrong. Dated work in full lives on the{" "}
        <Link to="/modules/comms/plan" className="underline">
          plan calendar
        </Link>
        .
      </p>
    </div>
  );
}

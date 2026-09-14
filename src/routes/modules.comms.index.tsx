/**
 * The Comms dashboard: what needs action, and why.
 *
 * Every line here rests on a record that already exists — a reply owed on a
 * relationship, a promise someone made, a date a person put on the calendar,
 * a draft held at the human boundary, a review that has not been approved.
 * Nothing is inferred from silence, no deadline is invented, and each item
 * opens the exact place the work is done.
 */

import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "@/components/tt/app-shell";
import { CommsTabs } from "@/components/tt/comms/comms-tabs";
import { PageHeader } from "@/components/tt/primitives";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { commsService } from "@/data/supabase/comms-service";
import { listReviews } from "@/data/supabase/comms-review-client";
import { supabase } from "@/integrations/trust-tai/supabase";
import { buildPlan, dueLabel, type PlanItem } from "@/domain/comms-plan";
import type { WorkspaceIdentity } from "@/lib/workspace";

const TITLE = "Dashboard · Comms · Trust Tai OS";
const DESCRIPTION =
  "What needs action in Comms right now: replies owed, drafts waiting on review, promises past their date and follow-ups someone scheduled.";

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

/** Drafts held at the human boundary. The same read the Drafts tab makes. */
async function waitingDrafts(organizationId: string) {
  const { data, error } = await supabase
    .from("comms_drafts")
    .select("id, subject, relationship_id, created_at")
    .eq("organization_id", organizationId)
    .in("review_state", ["needs_human_review"])
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return (data ?? []) as { id: string; subject: string | null; created_at: string }[];
}

function Section({
  title,
  note,
  count,
  children,
}: {
  title: string;
  note: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] text-foreground">
          {title} <span className="text-muted-foreground">· {count}</span>
        </h2>
        <p className="text-[12px] text-muted-foreground">{note}</p>
      </header>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Nothing({ words }: { words: string }) {
  return <p className="text-[13px] text-muted-foreground">{words}</p>;
}

function PlanList({ items, now }: { items: PlanItem[]; now: Date }) {
  return (
    <ul className="space-y-2">
      {items.map((item) => (
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
                item.overdue ? "text-[12px] text-destructive" : "text-[12px] text-muted-foreground"
              }
            >
              {dueLabel(item.dueAt, now)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function CommsDashboard({ identity }: { identity: WorkspaceIdentity }) {
  const relationships = useQuery({
    queryKey: ["comms", "relationships", identity.organizationId],
    queryFn: () => commsService.list(identity.organizationId),
  });

  const drafts = useQuery({
    queryKey: ["comms", "queue", identity.organizationId],
    queryFn: () => waitingDrafts(identity.organizationId),
  });

  const reviews = useQuery({
    queryKey: ["comms", "reviews", identity.organizationId],
    queryFn: () => listReviews(identity.organizationId),
  });

  const now = new Date();
  const plans = useMemo(
    () => buildPlan(relationships.data ?? [], now),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [relationships.data],
  );

  const items = useMemo(() => plans.flatMap((plan) => plan.items), [plans]);
  const repliesOwed = items.filter((item) => item.kind === "reply_due");
  const overdue = items.filter(
    (item) => item.overdue && (item.kind === "commitment" || item.kind === "meeting"),
  );
  const upcoming = items
    .filter((item) => item.kind === "follow_up" && !item.overdue && item.dueAt)
    .slice(0, 10);

  const openReviews = (reviews.data ?? []).filter((session) => session.status === "open");

  const failed = [relationships.error, drafts.error, reviews.error].find(Boolean);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Comms"
        title="Dashboard"
        supporting="What needs action, and the record it rests on. Every line opens the place the work is actually done."
        appId="comms"
      />
      <CommsTabs active="dashboard" />

      {failed ? (
        <p className="text-sm text-destructive">
          {failed instanceof Error ? failed.message : "Part of this read failed."}
        </p>
      ) : null}

      {relationships.isLoading || drafts.isLoading || reviews.isLoading ? (
        <p className="text-sm text-muted-foreground">Reading your workspace…</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Section
            title="Replies owed"
            count={repliesOwed.length}
            note="A reply was marked owed on the conversation."
          >
            {repliesOwed.length === 0 ? (
              <Nothing words="No reply is recorded as owed." />
            ) : (
              <PlanList items={repliesOwed} now={now} />
            )}
          </Section>

          <Section
            title="Drafts waiting on review"
            count={(drafts.data ?? []).length}
            note="Held at the human boundary."
          >
            {(drafts.data ?? []).length === 0 ? (
              <Nothing words="No draft is waiting." />
            ) : (
              <ul className="space-y-2">
                {(drafts.data ?? []).slice(0, 10).map((draft) => (
                  <li key={draft.id}>
                    <Link
                      to="/modules/comms/drafts"
                      className="block rounded-lg bg-secondary/40 px-3 py-2 text-[13px] text-foreground hover:bg-secondary/70"
                    >
                      {draft.subject ?? "(no subject)"}
                      <span className="block text-[12px] text-muted-foreground">
                        Drafted {new Date(draft.created_at).toLocaleDateString()}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section
            title="Reviews not yet approved"
            count={openReviews.length}
            note="One record per message. Approval is a separate, role-checked act."
          >
            {openReviews.length === 0 ? (
              <Nothing words="No review is open." />
            ) : (
              <ul className="space-y-2">
                {openReviews.slice(0, 10).map((session) => (
                  <li key={session.id}>
                    <Link
                      to="/modules/comms/review"
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
            )}
          </Section>

          <Section
            title="Past their date"
            count={overdue.length}
            note="Promises and meetings someone dated, now in the past."
          >
            {overdue.length === 0 ? (
              <Nothing words="Nothing dated has slipped." />
            ) : (
              <PlanList items={overdue} now={now} />
            )}
          </Section>

          <Section
            title="Follow-ups scheduled"
            count={upcoming.length}
            note="Dates a person set. Change them on the conversation."
          >
            {upcoming.length === 0 ? (
              <Nothing words="No follow-up is scheduled." />
            ) : (
              <PlanList items={upcoming} now={now} />
            )}
          </Section>
        </div>
      )}

      <p className="text-[12px] text-muted-foreground">
        Silence alone is not on this list: a quiet conversation is not evidence that anything is
        wrong. Dated follow-ups live on the{" "}
        <Link to="/modules/comms/plan" className="underline">
          plan calendar
        </Link>
        .
      </p>
    </div>
  );
}

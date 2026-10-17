/**
 * Steward meeting workroom: the approved three-column layout on real data.
 *
 * Reads only stored conversations and person-confirmed commitments through
 * the member's own session (RLS applies). It writes nothing; confirming and
 * completing happen on the existing meeting review page and its gates.
 */

import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, CircleDashed, ExternalLink } from "lucide-react";
import { useMemo, useState } from "react";

import { AppShell } from "@/components/tt/app-shell";
import { StewardTabs } from "@/components/tt/steward/steward-tabs";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { stewardService } from "@/data/supabase/steward-service";
import { buildWorkroom, type WorkroomMeeting } from "@/domain/steward-workroom";
import type { WorkspaceIdentity } from "@/lib/workspace";

const TITLE = "Steward · Meeting workroom · Trust Tai OS";
const DESCRIPTION = "Confirmed promises from stored Fathom meetings, with honest owners, dates and coverage.";

export const Route = createFileRoute("/modules/steward/meetings/workroom")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => (
    <WorkspaceGate appId="steward">
      {(identity) => (
        <AppShell identity={identity}>
          <StewardTabs />
          <Workroom identity={identity} />
        </AppShell>
      )}
    </WorkspaceGate>
  ),
});

function Workroom({ identity }: { identity: WorkspaceIdentity }) {
  const org = identity.organizationId;
  const conversations = useQuery({
    queryKey: ["steward", "workroom", "conversations", org],
    queryFn: () => stewardService.conversations(org, 40),
  });
  const commitments = useQuery({
    queryKey: ["steward", "commitments", org],
    queryFn: () => stewardService.commitments(org),
  });
  const [selectedMeeting, setSelectedMeeting] = useState<string | null>(null);
  const [selectedRow, setSelectedRow] = useState<string | null>(null);

  const meetings = useMemo<WorkroomMeeting[]>(() => {
    if (!conversations.data || !commitments.data) return [];
    return buildWorkroom(
      conversations.data
        .filter((c) => c.provider === "fathom")
        .map((c) => {
          const segments = Array.isArray(c.conversation?.segments) ? c.conversation.segments : [];
          return {
            id: c.id,
            title: c.title || "Untitled meeting",
            occurredAt: c.occurredAt,
            provider: c.provider,
            sourceUrl: c.sourceUrl,
            participantCount: c.participants.length,
            segmentCount: segments.length,
            lastSegmentAt: segments.length ? (segments[segments.length - 1]?.at ?? null) : null,
          };
        }),
      commitments.data,
    );
  }, [conversations.data, commitments.data]);

  if (conversations.isPending || commitments.isPending) {
    return <p className="p-6 text-sm text-muted-foreground">Reading stored meetings…</p>;
  }
  if (conversations.isError || commitments.isError) {
    return (
      <p className="p-6 text-sm text-destructive">
        Couldn’t read stored meetings. Nothing is shown rather than a guess.
      </p>
    );
  }
  if (meetings.length === 0) {
    return (
      <p className="p-6 text-sm text-muted-foreground">
        No Fathom meeting has been stored in this workspace yet.{" "}
        <Link to="/modules/steward/meetings" className="text-primary underline">
          Read a call
        </Link>
        .
      </p>
    );
  }

  const meeting = meetings.find((m) => m.id === selectedMeeting) ?? meetings[0]!;
  const row = meeting.rows.find((r) => r.id === selectedRow) ?? meeting.rows[0] ?? null;

  return (
    <div className="grid gap-4 py-4 lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,1fr)_300px]">
      <nav aria-label="Meetings" className="rounded-lg border border-border bg-secondary/40 p-2">
        <ul className="space-y-1">
          {meetings.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => {
                  setSelectedMeeting(m.id);
                  setSelectedRow(null);
                }}
                aria-current={m.id === meeting.id}
                className={`w-full rounded-md px-3 py-2 text-left text-sm ${
                  m.id === meeting.id ? "bg-card font-semibold shadow-sm" : "hover:bg-card/60"
                }`}
              >
                <span className="block truncate">{m.title}</span>
                <span className="text-xs text-muted-foreground">
                  {m.occurredAt.slice(0, 10)} · {m.done}/{m.agreed} kept
                </span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <section className="min-w-0 rounded-lg border border-border bg-card">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-4">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold">{meeting.title}</h1>
            <p className="text-xs text-muted-foreground">
              {meeting.occurredAt.slice(0, 10)} · {meeting.participantCount} participants ·{" "}
              {meeting.segmentCount} transcript segments
              {meeting.lastSegmentAt ? ` to ${meeting.lastSegmentAt}` : ""}
            </p>
          </div>
          <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-right">
            <p className="text-lg font-semibold">
              {meeting.score === null ? `${meeting.done}/${meeting.agreed}` : `${meeting.score}/100`}
            </p>
            <p className="text-xs text-muted-foreground">
              {meeting.coverage === "complete" ? "Score" : "Coverage not confirmed"}
            </p>
          </div>
        </header>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Task</th>
              <th className="px-2 py-2 font-medium">Owner</th>
              <th className="px-2 py-2 font-medium">Due</th>
              <th className="px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {meeting.rows.map((r) => (
              <tr
                key={r.id}
                onClick={() => setSelectedRow(r.id)}
                aria-selected={row?.id === r.id}
                className={`cursor-pointer border-t border-border ${
                  r.done ? "bg-success/10" : row?.id === r.id ? "bg-primary/5" : ""
                }`}
              >
                <td className="px-4 py-2.5">{r.what}</td>
                <td className="px-2 py-2.5">{r.owner.label}</td>
                <td className="px-2 py-2.5">{r.due.label}</td>
                <td className="px-4 py-2.5">
                  {r.done ? (
                    <span className="inline-flex items-center gap-1 text-success">
                      <Check aria-hidden className="size-3.5" /> Kept
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1">
                      <CircleDashed aria-hidden className="size-3.5" /> {r.status}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <footer className="border-t border-border p-4 text-sm text-muted-foreground">
          {meeting.remark}
        </footer>
      </section>

      <aside className="rounded-lg border border-border bg-card p-4 text-sm lg:col-span-2 xl:col-span-1">
        {row ? (
          <div className="space-y-3">
            <h2 className="font-semibold">{row.what}</h2>
            <p>
              Owner: {row.owner.label}
              {row.owner.verified ? "" : " · not linked to a teammate"}
            </p>
            <p>
              Due: {row.due.label}
              {row.due.exact ? "" : " · not an exact date"}
            </p>
            <p>Source references: {row.evidenceCount}</p>
          </div>
        ) : (
          <p className="text-muted-foreground">No confirmed promise selected.</p>
        )}
        <div className="mt-4 flex flex-col gap-2 border-t border-border pt-3">
          <Link
            to="/modules/steward/meetings/$conversationId"
            params={{ conversationId: meeting.id }}
            className="text-primary underline"
          >
            Review and confirm in the meeting page
          </Link>
          {meeting.sourceUrl ? (
            <a
              href={meeting.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-primary underline"
            >
              Open in Fathom <ExternalLink aria-hidden className="size-3.5" />
            </a>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

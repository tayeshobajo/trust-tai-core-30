/**
 * The six tabs of a client page. Each one reads a room and says which.
 *
 * Overview composes one honest line per room. Roadmap, Projects and
 * Relationship list what their owning room recorded and deep-link into it.
 * Site and Files state, in plain words, that nothing is linked yet: there is
 * no client link on website records and no file store, and neither absence is
 * drawn as health.
 */

import { Link } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";

import { Absent, Fact, OpenIn, ReadOrSay, RoomSection, Unreadable } from "@/components/tt/clients/shell";
import { TTCard } from "@/components/tt/primitives";
import type { ClientApprovalsRead } from "@/data/clients/shell-reads";
import type { ActivityEvent } from "@/domain/activity";
import type { ApprovalRequest } from "@/domain/approvals";
import {
  approvalStatusLabel,
  FILES_NONE,
  FILES_NONE_BECAUSE,
  isOpenApproval,
  isOpenProject,
  lastTouchLine,
  projectStateLabel,
  SITE_UNLINKED,
  SITE_UNLINKED_BECAUSE,
  type RelationshipSnapshot,
  type ReviewCadence,
  type RoadmapOutcome,
  type RoomRead,
} from "@/domain/client-shell";
import { formatDay } from "@/domain/clients-book";
import type { ExecutionProject } from "@/domain/projects";
import { cn } from "@/lib/utils";

/* ---------------------------------------------------------------- overview */

export interface OverviewReads {
  roadmap: RoomRead<RoadmapOutcome | null> | null;
  projects: RoomRead<ExecutionProject[]> | null;
  approvals: RoomRead<ClientApprovalsRead> | null;
  relationship: RoomRead<RelationshipSnapshot> | null;
  history: RoomRead<ActivityEvent[]> | null;
  loading: {
    roadmap: boolean;
    projects: boolean;
    approvals: boolean;
    relationship: boolean;
    history: boolean;
  };
}

export function OverviewTab({
  reads,
  cadence,
  now,
  timeZone,
}: {
  reads: OverviewReads;
  cadence: ReviewCadence;
  now: Date;
  timeZone: string;
}) {
  return (
    <div className="space-y-10">
      <div className="grid gap-8 lg:grid-cols-2">
        <RoomSection
          eyebrow="Owned by Roadmap"
          title="Where this company is going"
          openTo={
            <Link to="/modules/roadmap">
              <OpenIn>Open in Roadmap</OpenIn>
            </Link>
          }
        >
          <ReadOrSay read={reads.roadmap} loading={reads.loading.roadmap} what="Roadmap">
            {(outcome) =>
              outcome ? (
                <RoadmapOutcomeCard outcome={outcome} compact />
              ) : (
                <Absent
                  line="No roadmap yet"
                  because="Nothing has been mapped for this company. A roadmap starts in the Roadmap room."
                />
              )
            }
          </ReadOrSay>
        </RoomSection>

        <RoomSection
          eyebrow="Owned by Projects"
          title="What delivery is doing"
          openTo={
            <Link to="/modules/projects">
              <OpenIn>Open in Projects</OpenIn>
            </Link>
          }
        >
          <ReadOrSay read={reads.projects} loading={reads.loading.projects} what="Delivery">
            {(projects) => {
              const open = projects.filter(isOpenProject);
              if (projects.length === 0) {
                return (
                  <Absent
                    line="No delivery work recorded"
                    because="No project names this company yet."
                  />
                );
              }
              if (open.length === 0) {
                return (
                  <Absent
                    line={`Nothing in flight · ${projects.length} delivered or closed`}
                    because="Every project for this company has left delivery."
                  />
                );
              }
              return (
                <ul className="space-y-3">
                  {open.slice(0, 3).map((project) => (
                    <li key={project.id}>
                      <ProjectRow project={project} timeZone={timeZone} />
                    </li>
                  ))}
                  {open.length > 3 ? (
                    <li className="text-[13px] text-muted-foreground">
                      {open.length - 3} more in the Projects tab.
                    </li>
                  ) : null}
                </ul>
              );
            }}
          </ReadOrSay>
        </RoomSection>
      </div>

      <div className="grid gap-8 lg:grid-cols-3">
        <RoomSection eyebrow="Owned by Clients" title="Review cadence">
          <div className="space-y-3">
            <Fact
              label="Review"
              value={cadence.line}
              emphasis={cadence.state === "overdue" || cadence.state === "due"}
              note={
                cadence.state === "none"
                  ? "Add a review date when one is agreed; nothing is assumed."
                  : null
              }
            />
            <Fact label="Renewal" value={cadence.renewalLine} />
          </div>
        </RoomSection>

        <RoomSection
          eyebrow="Owned by Comms"
          title="Relationship"
          openTo={
            <Link to="/modules/comms">
              <OpenIn>Open in Comms</OpenIn>
            </Link>
          }
        >
          <ReadOrSay read={reads.relationship} loading={reads.loading.relationship} what="Relationships">
            {(snapshot) =>
              snapshot.people.length === 0 ? (
                <Absent
                  line="No one tracked here yet"
                  because="Comms has no relationship at this company."
                />
              ) : (
                <TTCard className="p-4">
                  <p className="text-sm text-foreground">
                    {snapshot.people.length} {snapshot.people.length === 1 ? "person" : "people"}
                    {" · "}
                    {lastTouchLine(snapshot.lastTouchAt, now, timeZone)}
                  </p>
                  {snapshot.lead ? (
                    <p className="mt-1 text-[13px] text-muted-foreground">
                      Most recent: {snapshot.lead.fullName} · {snapshot.lead.stageLabel}
                    </p>
                  ) : null}
                  {snapshot.overdue > 0 ? (
                    <p className="mt-2 flex items-center gap-2 text-[13px] font-medium text-foreground">
                      <AlertTriangle className="size-4 text-warning" aria-hidden />
                      {snapshot.overdue} follow-up{snapshot.overdue === 1 ? "" : "s"} past due
                    </p>
                  ) : null}
                </TTCard>
              )
            }
          </ReadOrSay>
        </RoomSection>

        <RoomSection
          eyebrow="Owned by Website"
          title="Site health"
          openTo={
            <Link to="/modules/website">
              <OpenIn>Open in Website</OpenIn>
            </Link>
          }
        >
          <Absent line={SITE_UNLINKED} because={SITE_UNLINKED_BECAUSE} />
        </RoomSection>
      </div>

      <RoomSection
        eyebrow="Owned by Approvals"
        title="Decisions about this company"
        description="Read-only. Deciding happens in Approvals."
        openTo={
          <Link to="/modules/approvals">
            <OpenIn>Open in Approvals</OpenIn>
          </Link>
        }
      >
        <ReadOrSay read={reads.approvals} loading={reads.loading.approvals} what="Approvals">
          {(ledger) =>
            !ledger.ready ? (
              <Unreadable
                what="The approvals ledger"
                because="It is not set up in this workspace yet, so no decision can be shown or counted."
              />
            ) : ledger.requests.length === 0 ? (
              <Absent
                line="No decisions recorded"
                because="Nothing about this company has been sent to Approvals."
              />
            ) : (
              <ApprovalList requests={ledger.requests} timeZone={timeZone} />
            )
          }
        </ReadOrSay>
      </RoomSection>

      <RoomSection
        eyebrow="The shared stream"
        title="What has actually happened"
        description="Events that name this company or its roadmaps, projects and people."
      >
        <ReadOrSay read={reads.history} loading={reads.loading.history} what="History">
          {(events) =>
            events.length === 0 ? (
              <Absent line="Nothing recorded here yet" />
            ) : (
              <ol className="space-y-2">
                {events.slice(0, 8).map((event) => (
                  <li key={event.id} className="flex gap-3 text-sm">
                    <span className="w-16 shrink-0 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                      {formatDay(event.occurredAt, timeZone) ?? ""}
                    </span>
                    <span className="text-muted-foreground">{event.summary}</span>
                  </li>
                ))}
              </ol>
            )
          }
        </ReadOrSay>
      </RoomSection>
    </div>
  );
}

/* ----------------------------------------------------------------- roadmap */

export function RoadmapTab({
  read,
  loading,
}: {
  read: RoomRead<RoadmapOutcome[]> | null;
  loading: boolean;
}) {
  return (
    <RoomSection
      eyebrow="Owned by Roadmap"
      title="Roadmaps for this company"
      description="Point B, the stage moving now, and the next move, in Roadmap's own words."
      openTo={
        <Link to="/modules/roadmap">
          <OpenIn>Open in Roadmap</OpenIn>
        </Link>
      }
    >
      <ReadOrSay read={read} loading={loading} what="Roadmap">
        {(outcomes) =>
          outcomes.length === 0 ? (
            <Absent
              line="No roadmap yet"
              because="Nothing has been mapped for this company. A roadmap starts in the Roadmap room."
            />
          ) : (
            <ul className="space-y-4">
              {outcomes.map((outcome) => (
                <li key={outcome.roadmapId}>
                  <RoadmapOutcomeCard outcome={outcome} />
                </li>
              ))}
            </ul>
          )
        }
      </ReadOrSay>
    </RoomSection>
  );
}

function RoadmapOutcomeCard({ outcome, compact = false }: { outcome: RoadmapOutcome; compact?: boolean }) {
  return (
    <TTCard className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{outcome.title}</p>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            {outcome.statusLabel}
            {outcome.stagesTotal > 0
              ? ` · ${outcome.stagesLive} of ${outcome.stagesTotal} stages live`
              : ""}
            {outcome.openDecisions > 0
              ? ` · ${outcome.openDecisions} open decision${outcome.openDecisions === 1 ? "" : "s"}`
              : ""}
          </p>
        </div>
        <Link
          to="/modules/roadmap/$roadmapId"
          params={{ roadmapId: outcome.roadmapId }}
          className="shrink-0 text-[13px] font-medium text-royal"
        >
          <OpenIn>Open in Roadmap</OpenIn>
        </Link>
      </div>
      <dl className="mt-3 space-y-2 text-[13px]">
        <div>
          <dt className="text-muted-foreground">
            Point B{outcome.destinationTier === "inferred" ? " · inferred, not yet approved" : ""}
          </dt>
          <dd className="text-foreground">{outcome.destination ?? "Not written yet"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Milestone</dt>
          <dd className={cn("flex items-center gap-2 text-foreground", outcome.milestoneBlocked && "font-medium")}>
            {outcome.milestoneBlocked ? (
              <AlertTriangle className="size-4 text-warning" aria-hidden />
            ) : null}
            {outcome.milestone
              ? `${outcome.milestone} · ${outcome.milestoneStateLabel}`
              : outcome.stagesTotal > 0
                ? "Every stage is live"
                : "No stages mapped yet"}
          </dd>
        </div>
        {!compact || outcome.nextMove ? (
          <div>
            <dt className="text-muted-foreground">Next move</dt>
            <dd className="text-foreground">{outcome.nextMove ?? "None recorded"}</dd>
          </div>
        ) : null}
      </dl>
    </TTCard>
  );
}

/* ---------------------------------------------------------------- projects */

export function ProjectsTab({
  read,
  loading,
  timeZone,
}: {
  read: RoomRead<ExecutionProject[]> | null;
  loading: boolean;
  timeZone: string;
}) {
  return (
    <RoomSection
      eyebrow="Owned by Projects"
      title="Delivery for this company"
      description="Blocked work first, then whatever moved last. State and words are Projects' own."
      openTo={
        <Link to="/modules/projects">
          <OpenIn>Open in Projects</OpenIn>
        </Link>
      }
    >
      <ReadOrSay read={read} loading={loading} what="Delivery">
        {(projects) =>
          projects.length === 0 ? (
            <Absent line="No delivery work recorded" because="No project names this company yet." />
          ) : (
            <ul className="space-y-3">
              {projects.map((project) => (
                <li key={project.id}>
                  <ProjectRow project={project} timeZone={timeZone} />
                </li>
              ))}
            </ul>
          )
        }
      </ReadOrSay>
    </RoomSection>
  );
}

function ProjectRow({ project, timeZone }: { project: ExecutionProject; timeZone: string }) {
  const blocked = project.state === "blocked";
  const detail = project.currentWork || project.nextMove || project.pointB || null;
  return (
    <TTCard className={cn("p-4", blocked && "border-warning/40")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{project.name}</p>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            {projectStateLabel(project)} · moved {formatDay(project.lastMovedAt, timeZone) ?? "on an unknown day"}
          </p>
        </div>
        <Link
          to="/modules/projects/$projectId"
          params={{ projectId: project.id }}
          className="shrink-0 text-[13px] font-medium text-royal"
        >
          <OpenIn>Open in Projects</OpenIn>
        </Link>
      </div>
      {detail ? <p className="mt-2 text-[13px] text-muted-foreground">{detail}</p> : null}
      {blocked ? (
        <p className="mt-2 flex items-center gap-2 text-[13px] font-medium text-foreground">
          <AlertTriangle className="size-4 text-warning" aria-hidden />
          {project.blockedBecause ? `Blocked: ${project.blockedBecause}` : "Blocked"}
        </p>
      ) : null}
    </TTCard>
  );
}

/* ------------------------------------------------------------ relationship */

export function RelationshipTab({
  read,
  loading,
  now,
  timeZone,
}: {
  read: RoomRead<RelationshipSnapshot> | null;
  loading: boolean;
  now: Date;
  timeZone: string;
}) {
  return (
    <RoomSection
      eyebrow="Owned by Comms"
      title="Who we know here"
      description="One person, one memory. Follow-ups past due come first."
      openTo={
        <Link to="/modules/comms">
          <OpenIn>Open in Comms</OpenIn>
        </Link>
      }
    >
      <ReadOrSay read={read} loading={loading} what="Relationships">
        {(snapshot) =>
          snapshot.people.length === 0 ? (
            <Absent
              line="No one tracked here yet"
              because="Comms has no relationship at this company."
            />
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {snapshot.people.map((person) => (
                <li key={person.id}>
                  <TTCard className={cn("p-4", person.overdue && "border-warning/40")}>
                    <p className="text-sm font-medium text-foreground">{person.fullName}</p>
                    <p className="mt-0.5 text-[12px] text-muted-foreground">
                      {person.stageLabel} · {lastTouchLine(person.lastTouchAt, now, timeZone)}
                    </p>
                    <p className="mt-2 text-[13px] text-muted-foreground">
                      {person.nextAction ?? "No next move recorded."}
                    </p>
                    {person.overdue ? (
                      <p className="mt-2 flex items-center gap-2 text-[13px] font-medium text-foreground">
                        <AlertTriangle className="size-4 text-warning" aria-hidden />
                        Follow-up past due
                      </p>
                    ) : null}
                  </TTCard>
                </li>
              ))}
            </ul>
          )
        }
      </ReadOrSay>
    </RoomSection>
  );
}

/* ------------------------------------------------------------- site, files */

export function SiteTab() {
  return (
    <RoomSection
      eyebrow="Owned by Website"
      title="This company's site"
      openTo={
        <Link to="/modules/website">
          <OpenIn>Open in Website</OpenIn>
        </Link>
      }
    >
      <Absent line={SITE_UNLINKED} because={SITE_UNLINKED_BECAUSE} />
    </RoomSection>
  );
}

export function FilesTab() {
  return (
    <RoomSection eyebrow="Owned by Clients" title="Files">
      <Absent line={FILES_NONE} because={FILES_NONE_BECAUSE} />
    </RoomSection>
  );
}

/* --------------------------------------------------------------- approvals */

function ApprovalList({ requests, timeZone }: { requests: ApprovalRequest[]; timeZone: string }) {
  const open = requests.filter(isOpenApproval);
  const settled = requests.filter((request) => !isOpenApproval(request));
  return (
    <div className="space-y-3">
      <p className="text-[13px] text-muted-foreground">
        {open.length} open · {settled.length} decided
      </p>
      <ul className="space-y-2">
        {requests.slice(0, 6).map((request) => (
          <li key={request.id}>
            <TTCard className="flex items-start justify-between gap-3 p-3">
              <div className="min-w-0">
                <p className="truncate text-sm text-foreground">{request.title}</p>
                <p className="mt-0.5 text-[12px] text-muted-foreground">
                  {approvalStatusLabel(request)} ·{" "}
                  {formatDay(request.decision?.decidedAt ?? request.createdAt, timeZone) ?? ""}
                </p>
              </div>
              <span
                className={cn(
                  "shrink-0 rounded-full px-2 py-0.5 text-[11px]",
                  isOpenApproval(request)
                    ? "bg-royal/10 text-royal"
                    : "bg-secondary text-muted-foreground",
                )}
              >
                {isOpenApproval(request) ? "Open" : "Decided"}
              </span>
            </TTCard>
          </li>
        ))}
      </ul>
      {requests.length > 6 ? (
        <p className="text-[13px] text-muted-foreground">
          {requests.length - 6} more in Approvals.
        </p>
      ) : null}
    </div>
  );
}

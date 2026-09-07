/**
 * The reading surfaces of a client page. Each one reads a room and says which.
 *
 * Product rule, locked in canon: Clients summarizes the company. Projects is
 * the operating surface for project-scoped work. Roadmap is the planning
 * engine. Client Chat reasons over account context but never becomes a second
 * source of truth.
 *
 * So milestones, work items, blockers and project decisions are never edited
 * here: a project card is a door into the project workspace, and direction and
 * site are read on Overview and operated in their own rooms. Absence is stated
 * plainly and never drawn as health.
 */

import { Link } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";

import { Absent, OpenIn, ReadOrSay, RoomSection } from "@/components/tt/clients/shell";
import { TTCard } from "@/components/tt/primitives";
import type { ClientApprovalsRead } from "@/data/clients/shell-reads";
import type {
  RelationshipWindow,
  RelationshipWindowPerson,
} from "@/data/clients/relationship-window";

import type { ActivityEvent } from "@/domain/activity";
import type { ClientLinkedSource } from "@/domain/client-linked-sources";
import type { ApprovalRequest } from "@/domain/approvals";
import {
  approvalStatusLabel,
  FILES_NO_PROJECTS,
  FILES_NO_PROJECTS_BECAUSE,
  FILES_NONE,
  FILES_NONE_BECAUSE,
  isOpenApproval,
  lastTouchLine,
  projectStateLabel,
  type RelationshipSnapshot,
  type RoomRead,
} from "@/domain/client-shell";
import { formatDay } from "@/domain/clients-book";
import { FILE_KIND_LABEL, type ProjectFile } from "@/domain/project-delivery";
import type { ExecutionProject } from "@/domain/projects";
import { cn } from "@/lib/utils";

/* ---------------------------------------------------------------- projects */

export function ProjectRow({
  project,
  timeZone,
  flat = false,
  clientId,
}: {
  project: ExecutionProject;
  timeZone: string;
  /** Render without its own card chrome when nested inside a parent card. */
  flat?: boolean;
  /**
   * When the row is shown inside a client workspace, the door stays inside
   * that workspace: the project opens on this client's Projects surface
   * instead of sending the person out to the portfolio room.
   */
  clientId?: string;
}) {
  const blocked = project.state === "blocked";
  const detail = project.currentWork || project.nextMove || project.pointB || null;
  const Wrapper = flat ? "div" : TTCard;
  return (
    <Wrapper className={cn("p-4", flat && "px-0 py-4", blocked && !flat && "border-warning/40")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {/* The name itself is the door into the project workroom. */}
          <p className="truncate text-sm font-medium text-foreground">
            {clientId ? (
              <Link
                to="/modules/clients/$clientId"
                params={{ clientId }}
                search={{ tab: "work", project: project.id }}
                className="underline-offset-4 hover:underline"
              >
                {project.name}
              </Link>
            ) : (
              <Link
                to="/modules/projects/$projectId"
                params={{ projectId: project.id }}
                className="underline-offset-4 hover:underline"
              >
                {project.name}
              </Link>
            )}
          </p>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            {projectStateLabel(project)} · moved{" "}
            {formatDay(project.lastMovedAt, timeZone) ?? "on an unknown day"}
          </p>
        </div>
        {clientId ? (
          <Link
            to="/modules/clients/$clientId"
            params={{ clientId }}
            search={{ tab: "work", project: project.id }}
            className="shrink-0 text-[13px] font-medium text-royal"
          >
            <OpenIn>Open project workspace</OpenIn>
          </Link>
        ) : (
          <Link
            to="/modules/projects/$projectId"
            params={{ projectId: project.id }}
            className="shrink-0 text-[13px] font-medium text-royal"
          >
            <OpenIn>Open project workspace</OpenIn>
          </Link>
        )}
      </div>
      {detail ? <p className="mt-2 text-[13px] text-muted-foreground">{detail}</p> : null}
      {blocked ? (
        <p className="mt-2 flex items-center gap-2 text-[13px] font-medium text-foreground">
          <AlertTriangle className="size-4 text-warning" aria-hidden />
          {project.blockedBecause ? `Blocked: ${project.blockedBecause}` : "Blocked"}
        </p>
      ) : null}
    </Wrapper>
  );
}

/* ------------------------------------------------------------ relationship */

/**
 * What has actually been exchanged with this person, read from Comms. When
 * Comms has no messages stored, this says exactly that rather than implying
 * the relationship is silent.
 */
function ExchangeLines({
  person,
  now,
  timeZone,
}: {
  person: RelationshipWindowPerson | null;
  now: Date;
  timeZone: string;
}) {
  if (!person) return null;
  if (person.messageCount === 0) {
    return (
      <p className="mt-2 text-[12px] text-muted-foreground">No messages synced from Comms yet.</p>
    );
  }
  return (
    <div className="mt-2 space-y-1 text-[12px] text-muted-foreground">
      <p>
        {person.messageCount} message{person.messageCount === 1 ? "" : "s"} in {person.threadCount}{" "}
        thread{person.threadCount === 1 ? "" : "s"} · {person.inboundCount} in ·{" "}
        {person.outboundCount} out
      </p>
      {person.latestInbound ? (
        <p>
          They last wrote{" "}
          {lastTouchLine(person.latestInbound.at, now, timeZone)
            .toLowerCase()
            .replace("last touch ", "")}
          : {person.latestInbound.subject}
        </p>
      ) : null}
      {person.latestOutbound ? (
        <p>
          You last wrote{" "}
          {lastTouchLine(person.latestOutbound.at, now, timeZone)
            .toLowerCase()
            .replace("last touch ", "")}
          : {person.latestOutbound.subject}
        </p>
      ) : null}
    </div>
  );
}

export function RelationshipTab({
  read,
  loading,
  now,
  timeZone,
  window: exchange,
}: {
  read: RoomRead<RelationshipSnapshot> | null;
  loading: boolean;
  now: Date;
  timeZone: string;
  /**
   * What has actually been exchanged, read from Comms. Null while Comms has
   * not answered; we say nothing rather than imply silence.
   */
  window?: RelationshipWindow | null;
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
                    <ExchangeLines
                      person={
                        exchange?.people.find((entry) => entry.relationshipId === person.id) ?? null
                      }
                      now={now}
                      timeZone={timeZone}
                    />

                    {/* Comms' own obligation, repeated. Clients derives none. */}
                    {(() => {
                      const owed =
                        exchange?.people.find((entry) => entry.relationshipId === person.id)
                          ?.obligation ?? null;
                      return owed ? (
                        <p className="mt-2 text-[13px] text-foreground">
                          {owed.action}
                          <span className="text-muted-foreground"> · {owed.whyNow}</span>
                        </p>
                      ) : null;
                    })()}

                    {person.overdue ? (
                      <p className="mt-2 flex items-center gap-2 text-[13px] font-medium text-foreground">
                        <AlertTriangle className="size-4 text-warning" aria-hidden />
                        Follow-up past due
                      </p>
                    ) : null}

                    {/* Acting on this conversation happens in Comms, never here. */}
                    <Link
                      to="/modules/comms"
                      search={{ relationship: person.id }}
                      className="mt-3 inline-flex text-[13px] text-foreground underline underline-offset-4"
                    >
                      Open this conversation in Comms
                    </Link>
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

/* ------------------------------------------------------------------- files */

export function FilesTab({
  read,
  linkedRead,
  loading,
  linkedLoading,
  hasProjects,
  projectNames,
  timeZone,
  onOpen,
}: {
  read: RoomRead<ProjectFile[]> | null;
  linkedRead: RoomRead<ClientLinkedSource[]> | null;
  loading: boolean;
  linkedLoading: boolean;
  hasProjects: boolean;
  projectNames: Record<string, string>;
  timeZone: string;
  onOpen: (file: ProjectFile) => void;
}) {
  return (
    <>
      {hasProjects ? (
        <RoomSection
          eyebrow="Owned by Projects"
          title="Linked working sources"
          description="Documents that live outside Trust Tai and are linked from the projects on this company: Google Docs and Sheets, prototypes, staging sites. These are links, not uploaded files."
          openTo={
            <Link to="/modules/projects">
              <OpenIn>Open in Projects</OpenIn>
            </Link>
          }
        >
          <ReadOrSay read={linkedRead} loading={linkedLoading} what="Linked sources">
            {(sources) =>
              sources.length === 0 ? (
                <Absent
                  line="No external document is linked yet."
                  because="A link is saved on the project in Projects, so it stays owned there."
                />
              ) : (
                <ul className="space-y-2">
                  {sources.map((source) => (
                    <li key={`${source.store}-${source.id}`}>
                      <TTCard className="flex items-start justify-between gap-3 p-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm text-foreground">{source.title}</p>
                          <p className="mt-0.5 text-[12px] text-muted-foreground">
                            External link · {source.kindLabel} · {source.stateLabel} ·{" "}
                            {projectNames[source.projectId] ?? "A project"} ·{" "}
                            {formatDay(source.addedAt, timeZone) ?? "on an unknown day"}
                          </p>
                        </div>
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0 text-[13px] font-medium text-royal"
                        >
                          Open link
                        </a>
                      </TTCard>
                    </li>
                  ))}
                </ul>
              )
            }
          </ReadOrSay>
        </RoomSection>
      ) : null}
      <RoomSection
        eyebrow="Owned by Projects"
        title="Files on this company's work"
        description="Everything uploaded to the projects that name this company. Files are private and opened through a short-lived link."
        openTo={
          <Link to="/modules/projects">
            <OpenIn>Open in Projects</OpenIn>
          </Link>
        }
      >
        {!hasProjects ? (
          <Absent line={FILES_NO_PROJECTS} because={FILES_NO_PROJECTS_BECAUSE} />
        ) : (
          <ReadOrSay read={read} loading={loading} what="Files">
            {(files) =>
              files.length === 0 ? (
                <Absent line={FILES_NONE} because={FILES_NONE_BECAUSE} />
              ) : (
                <ul className="space-y-2">
                  {files.map((file) => (
                    <li key={file.id}>
                      <TTCard className="flex items-start justify-between gap-3 p-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm text-foreground">{file.name}</p>
                          <p className="mt-0.5 text-[12px] text-muted-foreground">
                            {FILE_KIND_LABEL[file.kind]} ·{" "}
                            {projectNames[file.projectId] ?? "A project"} ·{" "}
                            {formatDay(file.createdAt, timeZone) ?? "on an unknown day"}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => onOpen(file)}
                          className="shrink-0 text-[13px] font-medium text-royal"
                        >
                          Open
                        </button>
                      </TTCard>
                    </li>
                  ))}
                </ul>
              )
            }
          </ReadOrSay>
        )}
      </RoomSection>
    </>
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

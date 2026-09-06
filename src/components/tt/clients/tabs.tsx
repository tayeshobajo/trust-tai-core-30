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

import {
  Absent,
  Fact,
  OpenIn,
  ReadOrSay,
  RoomSection,
  Unreadable,
} from "@/components/tt/clients/shell";
import { TTCard } from "@/components/tt/primitives";
import type { ClientApprovalsRead, ClientSiteRead } from "@/data/clients/shell-reads";
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
  isOpenProject,
  lastTouchLine,
  projectStateLabel,
  siteHost,
  siteSubmissionsFor,
  SITE_NO_ADDRESS,
  SITE_NO_ADDRESS_BECAUSE,
  SITE_NO_SUBMISSIONS,
  SITE_NO_SUBMISSIONS_BECAUSE,
  SITE_UNPROVISIONED,
  SITE_UNPROVISIONED_BECAUSE,
  type ClientSiteIdentity,
  type RelationshipSnapshot,
  type ReviewCadence,
  type RoadmapOutcome,
  type RoomRead,
} from "@/domain/client-shell";
import { formatDay } from "@/domain/clients-book";
import { FILE_KIND_LABEL, type ProjectFile } from "@/domain/project-delivery";
import type { ExecutionProject } from "@/domain/projects";
import { cn } from "@/lib/utils";

/* ---------------------------------------------------------------- overview */

export interface OverviewReads {
  roadmap: RoomRead<RoadmapOutcome | null> | null;
  projects: RoomRead<ExecutionProject[]> | null;
  approvals: RoomRead<ClientApprovalsRead> | null;
  relationship: RoomRead<RelationshipSnapshot> | null;
  history: RoomRead<ActivityEvent[]> | null;
  site: RoomRead<ClientSiteRead> | null;
  loading: {
    roadmap: boolean;
    projects: boolean;
    approvals: boolean;
    relationship: boolean;
    history: boolean;
    site: boolean;
  };
}

export function OverviewTab({
  reads,
  cadence,
  client,
  now,
  timeZone,
}: {
  reads: OverviewReads;
  cadence: ReviewCadence;
  client: ClientSiteIdentity;
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
          <ReadOrSay
            read={reads.relationship}
            loading={reads.loading.relationship}
            what="Relationships"
          >
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
          <ReadOrSay read={reads.site} loading={reads.loading.site} what="Site records">
            {(site) => {
              if (!site.provisioned) {
                return <Unreadable what="The Website room" because={SITE_UNPROVISIONED_BECAUSE} />;
              }
              const matched = siteSubmissionsFor(site.submissions, client);
              return matched.length === 0 ? (
                <Absent line={SITE_NO_SUBMISSIONS} because={SITE_NO_SUBMISSIONS_BECAUSE} />
              ) : (
                <Fact
                  label="Intake from this company"
                  value={`${matched.length} recorded`}
                  note={`Last on ${formatDay(matched[0]!.submittedAt, timeZone) ?? "an unknown day"}.`}
                />
              );
            }}
          </ReadOrSay>
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

function RoadmapOutcomeCard({
  outcome,
  compact = false,
}: {
  outcome: RoadmapOutcome;
  compact?: boolean;
}) {
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
          search={{ view: "overview" as const }}
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
          <dd
            className={cn(
              "flex items-center gap-2 text-foreground",
              outcome.milestoneBlocked && "font-medium",
            )}
          >
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
            {projectStateLabel(project)} · moved{" "}
            {formatDay(project.lastMovedAt, timeZone) ?? "on an unknown day"}
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

/* -------------------------------------------------------------------- site */

export function SiteTab({
  read,
  loading,
  client,
  timeZone,
}: {
  read: RoomRead<ClientSiteRead> | null;
  loading: boolean;
  client: ClientSiteIdentity;
  timeZone: string;
}) {
  const host = siteHost(client.websiteUrl);
  return (
    <RoomSection
      eyebrow="Owned by Website"
      title="This company's site"
      description="Matched only by the address or company name a person recorded. Nothing is matched by resemblance."
      openTo={
        <Link to="/modules/website">
          <OpenIn>Open in Website</OpenIn>
        </Link>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Fact
            label="Recorded address"
            value={host ?? "None recorded"}
            note={client.websiteUrl ?? "Add a website on this client to match its site records."}
          />
          <ReadOrSay read={read} loading={loading} what="Site records">
            {(site) => (
              <Fact
                label="Intake from this company"
                value={
                  site.provisioned
                    ? `${siteSubmissionsFor(site.submissions, client).length} recorded`
                    : "Cannot be counted"
                }
                note={site.provisioned ? "From the Website room." : SITE_UNPROVISIONED}
              />
            )}
          </ReadOrSay>
        </div>

        <ReadOrSay read={read} loading={loading} what="Site records">
          {(site) => {
            if (!site.provisioned) {
              return <Unreadable what="The Website room" because={SITE_UNPROVISIONED_BECAUSE} />;
            }
            if (!host && !client.name.trim()) {
              return <Absent line={SITE_NO_ADDRESS} because={SITE_NO_ADDRESS_BECAUSE} />;
            }
            const matched = siteSubmissionsFor(site.submissions, client);
            if (matched.length === 0) {
              return <Absent line={SITE_NO_SUBMISSIONS} because={SITE_NO_SUBMISSIONS_BECAUSE} />;
            }
            return (
              <ul className="space-y-2">
                {matched.slice(0, 8).map((submission) => (
                  <li key={submission.id}>
                    <TTCard className="p-4">
                      <p className="text-sm font-medium text-foreground">
                        {submission.person.name ?? "Someone"}
                        {submission.person.role ? ` · ${submission.person.role}` : ""}
                      </p>
                      <p className="mt-0.5 text-[12px] text-muted-foreground">
                        {formatDay(submission.submittedAt, timeZone) ?? "On an unknown day"} ·{" "}
                        {submission.sourceType.replace(/_/g, " ")} ·{" "}
                        {submission.linkState === "linked" ? "Linked in Scout" : "Not linked"}
                      </p>
                      {submission.structured.goals[0] ? (
                        <p className="mt-2 text-[13px] text-muted-foreground">
                          {submission.structured.goals[0]}
                        </p>
                      ) : null}
                    </TTCard>
                  </li>
                ))}
              </ul>
            );
          }}
        </ReadOrSay>
      </div>
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

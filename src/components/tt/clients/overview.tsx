/**
 * The client Overview.
 *
 * It answers six questions in the order a person asks them: what needs me
 * now, what is moving, where are we taking this company, what is happening in
 * the relationship, what commercial truth should I remember, and what has
 * actually changed. Every line is read from the room that owns it; Overview
 * composes and never creates a second copy of any state.
 *
 * Absence is stated, not amplified. A room that could not be read says so.
 *
 * Visual system: white cards float on the soft-blue page canvas. The canvas
 * is atmosphere; cards are the content surfaces. Fewer, larger blocks with
 * generous padding, hairline borders and restrained shadow.
 */

import { Link } from "@tanstack/react-router";
import { AlertTriangle, ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";

import { ProjectRow } from "@/components/tt/clients/tabs";
import type { RelationshipWindow } from "@/data/clients/relationship-window";
import type { ClientApprovalsRead, ClientSiteRead } from "@/data/clients/shell-reads";
import type { ActivityEvent } from "@/domain/activity";
import {
  attentionItems,
  NOTHING_TO_DECIDE,
  overviewSignals,
  type AttentionItem,
  type OverviewComposeInput,
  type OverviewSignal,
} from "@/domain/client-overview";
import {
  isOpenProject,
  lastTouchLine,
  siteSubmissionsFor,
  type ClientSiteIdentity,
  type RelationshipSnapshot,
  type ReviewCadence,
  type RoadmapOutcome,
  type RoomRead,
} from "@/domain/client-shell";
import { formatDay } from "@/domain/clients-book";
import type { ExecutionProject } from "@/domain/projects";
import { cn } from "@/lib/utils";

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

export interface CommercialReadLines {
  /** `Run · $3,500/mo`, already composed by the client book. */
  headline: string;
  review: string;
  renewal: string;
  provenance: string;
}

export function OverviewTab({
  reads,
  cadence,
  client,
  now,
  timeZone,
  exchange,
  commercial,
  commercialForm,
  roadmapProject = null,
}: {
  reads: OverviewReads;
  cadence: ReviewCadence;
  client: ClientSiteIdentity;
  now: Date;
  timeZone: string;
  exchange: RelationshipWindow | null;
  commercial: CommercialReadLines;
  /** The existing commercial form, revealed only when a person asks to edit. */
  commercialForm: ReactNode;
  /**
   * The project a person linked to the shown roadmap, when one exists.
   * Never inferred; null means no handoff line is drawn.
   */
  roadmapProject?: Pick<ExecutionProject, "id" | "name"> | null;
}) {
  const compose: OverviewComposeInput = {
    projects: reads.projects,
    relationship: reads.relationship,
    roadmap: reads.roadmap,
    approvals: reads.approvals,
    exchange,
    cadence,
    commercialLine: commercial.headline,
    now,
    timeZone,
  };
  const signals = overviewSignals(compose);
  const attention = attentionItems(compose);

  return (
    <div className="space-y-6 lg:space-y-8">
      <NowBand signals={signals} />

      <div className="grid gap-6 lg:grid-cols-3 lg:gap-8">
        <div className="lg:col-span-2">
          <InMotion read={reads.projects} loading={reads.loading.projects} timeZone={timeZone} />
        </div>
        <NeedsAttention items={attention} loading={reads.loading.approvals} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2 lg:gap-8">
        <Direction
          read={reads.roadmap}
          loading={reads.loading.roadmap}
          linkedProject={roadmapProject}
        />
        <RelationshipContext
          read={reads.relationship}
          loading={reads.loading.relationship}
          exchange={exchange}
          now={now}
          timeZone={timeZone}
        />
      </div>

      <Commercial lines={commercial} form={commercialForm} />

      <SiteLine
        read={reads.site}
        loading={reads.loading.site}
        client={client}
        timeZone={timeZone}
      />

      <Activity read={reads.history} loading={reads.loading.history} timeZone={timeZone} />
    </div>
  );
}

/* -------------------------------------------------------------- primitives */

/** The one content surface of this page: a quiet white card. */
const CARD = "tt-surface rounded-2xl";

function CardHeader({
  id,
  title,
  explain,
  source,
  action,
}: {
  id: string;
  title: string;
  explain?: string;
  source?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border px-6 py-5">
      <div className="min-w-0">
        <h2 id={id} className="text-lg font-semibold tracking-tight text-foreground">
          {title}
        </h2>
        {explain ? <p className="mt-0.5 text-[13px] text-muted-foreground">{explain}</p> : null}
      </div>
      {action ??
        (source ? (
          <div className="shrink-0 text-[13px] text-muted-foreground">{source}</div>
        ) : null)}
    </div>
  );
}

/* --------------------------------------------------------------- now band */

function NowBand({ signals }: { signals: OverviewSignal[] }) {
  return (
    <section aria-label="Right now" className={cn(CARD, "overflow-hidden")}>
      <dl className="grid divide-y divide-border sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
        {signals.map((signal) => (
          <div key={signal.key} className="px-6 py-5 sm:border-b sm:border-border lg:border-b-0">
            <dt className="tt-eyebrow">{signal.label}</dt>
            <dd
              className={cn(
                "mt-2 flex items-start gap-1.5 text-[14px] leading-snug",
                signal.tone === "attention" ? "font-medium text-foreground" : "text-foreground",
                signal.tone === "unknown" && "text-muted-foreground",
              )}
            >
              {signal.tone === "attention" ? (
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
              ) : null}
              <span>{signal.line}</span>
            </dd>
            {signal.note ? (
              <p className="mt-1 text-[12px] leading-snug text-muted-foreground">{signal.note}</p>
            ) : null}
          </div>
        ))}
      </dl>
    </section>
  );
}

/* -------------------------------------------------------------- in motion */

/** A quiet source attribution with the door into the owning room. */
function Source({
  room,
  to,
}: {
  room: string;
  to: "/modules/roadmap" | "/modules/projects" | "/modules/comms" | "/modules/website";
}) {
  return (
    <Link to={to} className="text-[12px] text-muted-foreground underline-offset-4 hover:underline">
      {room}
    </Link>
  );
}

function InMotion({
  read,
  loading,
  timeZone,
}: {
  read: RoomRead<ExecutionProject[]> | null;
  loading: boolean;
  timeZone: string;
}) {
  return (
    <section aria-labelledby="overview-in-motion" className={CARD}>
      <CardHeader
        id="overview-in-motion"
        title="In motion"
        source={<Source room="Projects" to="/modules/projects" />}
      />
      <div className="px-6 py-2">
        {loading || read === null ? (
          <p className="py-4 text-sm text-muted-foreground">Reading delivery.</p>
        ) : !read.available ? (
          <p className="py-4 text-sm text-foreground">
            Delivery could not be read just now.{" "}
            <span className="text-muted-foreground">{read.because}</span>
          </p>
        ) : (
          (() => {
            const open = read.value.filter(isOpenProject);
            if (read.value.length === 0) {
              return (
                <p className="py-4 text-sm text-muted-foreground">
                  No project names this company yet, so nothing is in motion.
                </p>
              );
            }
            if (open.length === 0) {
              return (
                <p className="py-4 text-sm text-muted-foreground">
                  Nothing in flight. {read.value.length} delivered or closed.
                </p>
              );
            }
            return (
              <ul className="divide-y divide-border">
                {open.map((project) => (
                  <li key={project.id}>
                    <ProjectRow project={project} timeZone={timeZone} flat />
                  </li>
                ))}
              </ul>
            );
          })()
        )}
      </div>
    </section>
  );
}

/* -------------------------------------------------------- needs attention */

function NeedsAttention({ items, loading }: { items: AttentionItem[]; loading: boolean }) {
  return (
    <aside aria-labelledby="overview-attention" className={CARD}>
      <CardHeader
        id="overview-attention"
        title="Needs attention"
        explain="What only a person can move."
      />
      <div className="px-6 py-5">
        {items.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            {loading ? "Still checking." : NOTHING_TO_DECIDE}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((item) => (
              <li key={item.key} className="flex gap-2.5 py-3.5 first:pt-0 last:pb-0">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                <div className="min-w-0">
                  <p className="text-[13px] font-medium leading-snug text-foreground">
                    {item.line}
                  </p>
                  {item.because ? (
                    <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">
                      {item.because}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

/* -------------------------------------------------- direction, relationship */

function Direction({
  read,
  loading,
}: {
  read: RoomRead<RoadmapOutcome | null> | null;
  loading: boolean;
}) {
  return (
    <section aria-labelledby="overview-direction" className={CARD}>
      <CardHeader
        id="overview-direction"
        title="Direction"
        explain="Where we are taking this company."
        source={<Source room="Roadmap" to="/modules/roadmap" />}
      />
      <div className="max-w-reading px-6 py-5">
        {loading || read === null ? (
          <p className="text-sm text-muted-foreground">Reading the roadmap.</p>
        ) : !read.available ? (
          <p className="text-sm text-foreground">
            The roadmap could not be read just now.{" "}
            <span className="text-muted-foreground">{read.because}</span>
          </p>
        ) : !read.value ? (
          <p className="text-sm text-muted-foreground">
            No roadmap yet. Nothing has been mapped for this company.
          </p>
        ) : (
          <dl className="space-y-3 text-[13px]">
            <Line
              term={`Point B${read.value.destinationTier === "inferred" ? " · not yet approved" : ""}`}
              detail={read.value.destination ?? "Not written yet"}
            />
            <Line
              term="Milestone"
              detail={
                read.value.milestone
                  ? `${read.value.milestone} · ${read.value.milestoneStateLabel ?? ""}`.trim()
                  : read.value.stagesTotal > 0
                    ? "Every stage is live"
                    : "No stages mapped yet"
              }
              warn={read.value.milestoneBlocked}
            />
            <Line term="Next move" detail={read.value.nextMove ?? "None recorded"} />
            <Link
              to="/modules/roadmap/$roadmapId"
              params={{ roadmapId: read.value.roadmapId }}
              search={{ view: "overview" as const }}
              className="inline-flex pt-1 text-[13px] font-medium text-royal"
            >
              Open in Roadmap
            </Link>
          </dl>
        )}
      </div>
    </section>
  );
}

function Line({ term, detail, warn = false }: { term: string; detail: string; warn?: boolean }) {
  return (
    <div>
      <dt className="text-[12px] text-muted-foreground">{term}</dt>
      <dd className={cn("mt-0.5 flex items-start gap-1.5 text-foreground", warn && "font-medium")}>
        {warn ? (
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
        ) : null}
        <span>{detail}</span>
      </dd>
    </div>
  );
}

function RelationshipContext({
  read,
  loading,
  exchange,
  now,
  timeZone,
}: {
  read: RoomRead<RelationshipSnapshot> | null;
  loading: boolean;
  exchange: RelationshipWindow | null;
  now: Date;
  timeZone: string;
}) {
  return (
    <section aria-labelledby="overview-relationship" className={CARD}>
      <CardHeader
        id="overview-relationship"
        title="Relationship"
        explain="What has actually been exchanged. Replying happens in Comms."
        source={<Source room="Comms" to="/modules/comms" />}
      />
      <div className="max-w-reading px-6 py-5">
        {loading || read === null ? (
          <p className="text-sm text-muted-foreground">Reading relationships.</p>
        ) : !read.available ? (
          <p className="text-sm text-foreground">
            Relationships could not be read just now.{" "}
            <span className="text-muted-foreground">{read.because}</span>
          </p>
        ) : read.value.people.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Comms has no relationship at this company yet.
          </p>
        ) : (
          (() => {
            const person = read.value.lead ?? read.value.people[0]!;
            const window = exchange?.people.find((entry) => entry.relationshipId === person.id);
            return (
              <div className="space-y-2 text-[13px]">
                <p className="text-[15px] font-medium text-foreground">{person.fullName}</p>
                <p className="text-muted-foreground">
                  {person.stageLabel} · {lastTouchLine(person.lastTouchAt, now, timeZone)}
                </p>
                {window && window.messageCount > 0 ? (
                  <p className="text-muted-foreground">
                    {window.messageCount} messages in {window.threadCount} thread
                    {window.threadCount === 1 ? "" : "s"} · {window.inboundCount} in ·{" "}
                    {window.outboundCount} out
                  </p>
                ) : (
                  <p className="text-muted-foreground">No messages synced from Comms yet.</p>
                )}
                {window?.obligation ? (
                  <p className="text-foreground">
                    {window.obligation.action}
                    <span className="text-muted-foreground"> · {window.obligation.whyNow}</span>
                  </p>
                ) : null}
                {read.value.people.length > 1 ? (
                  <p className="text-muted-foreground">
                    {read.value.people.length - 1} other{read.value.people.length === 2 ? "" : "s"}{" "}
                    in the Relationship tab.
                  </p>
                ) : null}
                <Link
                  to="/modules/comms"
                  search={{ relationship: person.id }}
                  className="inline-flex pt-1 text-[13px] font-medium text-royal"
                >
                  Open this conversation in Comms
                </Link>
              </div>
            );
          })()
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- commercial */

/**
 * Commercial truth reads first. The existing form, with its existing
 * validation and write path, is revealed only when a person asks to edit.
 */
function Commercial({ lines, form }: { lines: CommercialReadLines; form: ReactNode }) {
  const [editing, setEditing] = useState(false);
  return (
    <section aria-labelledby="overview-commercial" className={CARD}>
      <CardHeader
        id="overview-commercial"
        title="Commercial"
        explain="Entered by a person. Nothing here is inferred."
        action={
          <button
            type="button"
            aria-expanded={editing}
            aria-controls="overview-commercial-form"
            onClick={() => setEditing((open) => !open)}
            className="inline-flex shrink-0 items-center gap-1.5 text-[13px] font-medium text-royal"
          >
            {editing ? "Close" : "Update commercial state"}
            <ChevronDown
              className={cn("size-3.5 transition-transform", editing && "rotate-180")}
              aria-hidden
            />
          </button>
        }
      />
      <div className="px-6 py-5">
        <p className="text-[15px] font-medium text-foreground">{lines.headline}</p>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {lines.review} · {lines.renewal}
        </p>
        <p className="mt-2 text-[12px] text-muted-foreground">{lines.provenance}</p>
      </div>

      <div
        id="overview-commercial-form"
        hidden={!editing}
        className="border-t border-border px-6 py-5"
      >
        {editing ? form : null}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------- site line */

/** Site earns a line only when this company actually appears in Website. */
function SiteLine({
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
  if (loading || read === null) return null;
  if (!read.available) {
    return (
      <p className="text-[13px] text-muted-foreground">
        Site records could not be read just now. {read.because}
      </p>
    );
  }
  if (!read.value.provisioned) return null;
  const matched = siteSubmissionsFor(read.value.submissions, client);
  if (matched.length === 0) return null;
  return (
    <section aria-label="Site intake" className={cn(CARD, "px-6 py-4")}>
      <p className="text-[13px] text-muted-foreground">
        {matched.length} intake{matched.length === 1 ? "" : "s"} from this company on the site, last
        on {formatDay(matched[0]!.submittedAt, timeZone) ?? "an unknown day"}.{" "}
        <Link to="/modules/website" className="text-royal underline-offset-4 hover:underline">
          Open in Website
        </Link>
      </p>
    </section>
  );
}

/* ---------------------------------------------------------------- activity */

function Activity({
  read,
  loading,
  timeZone,
}: {
  read: RoomRead<ActivityEvent[]> | null;
  loading: boolean;
  timeZone: string;
}) {
  return (
    <section aria-labelledby="overview-activity" className={CARD}>
      <CardHeader
        id="overview-activity"
        title="Recent activity"
        explain="Events that name this company or its roadmaps, projects and people."
      />
      <div className="px-6 py-5">
        {loading || read === null ? (
          <p className="text-sm text-muted-foreground">Reading history.</p>
        ) : !read.available ? (
          <p className="text-sm text-foreground">
            History could not be read. <span className="text-muted-foreground">{read.because}</span>
          </p>
        ) : read.value.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing recorded here yet.</p>
        ) : (
          <ol className="divide-y divide-border">
            {read.value.slice(0, 8).map((event) => (
              <li key={event.id} className="flex gap-4 py-3 text-[13px] first:pt-0 last:pb-0">
                <span className="w-16 shrink-0 font-mono text-[11px] uppercase leading-relaxed tracking-[0.12em] text-muted-foreground">
                  {formatDay(event.occurredAt, timeZone) ?? ""}
                </span>
                <span className="min-w-0 text-muted-foreground">{event.summary}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

/**
 * Scout — prospect workspace.
 *
 * This component composes; it does not decide. Which surfaces appear comes
 * from `composeProspectPage`, so the page adapts to the evidence actually held
 * for a company instead of rendering a fixed template with empty cards.
 *
 * Two zones: a decision column carrying the move, and a quieter context rail.
 */

import { ArrowLeft } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useMemo } from "react";

import { TTButton } from "@/components/tt/primitives";
import { composeProspectPage, emphasisOf, hasModule } from "@/data/prospect-modules";
import type { HandoffDraft } from "@/domain/comms-handoff";
import type { ActivityEvent } from "@/domain/activity";
import type { PeopleProviderInfo, Person } from "@/domain/people";

import type { ProspectCandidate } from "@/domain/scout";
import type { FitLight } from "@/domain/scout-fit";

import { CoverageCard } from "./prospect/coverage";
import { FitReadPanel } from "./prospect/fit-read";
import { HandoffPanel } from "./prospect/handoff";
import { IdentityBand } from "./prospect/identity-band";
import { NextMovePanel } from "./prospect/next-move";
import { ObservedPanel } from "./prospect/observed";
import { OpportunityMap } from "./prospect/opportunity-map";
import { PeoplePanel, type ManualPersonForm } from "./prospect/people-panel";
import { SignalPulseCard } from "./prospect/signal-pulse";
import { TimelineCard } from "./prospect/timeline";
import { UnknownStrip } from "./prospect/unknown-strip";

const OPPORTUNITY_KEYS = ["limiting_system", "first_milestone", "roadmap_depth"];

export function ProspectWorkspace({
  candidate,
  activeIcpVersion,
  backSearch,
  events = [],
  people = [],
  providers = [],
  availableProviders = [],
  peopleNote,
  onIngest,
  onAddManual,
  onConfirmEmail,
  onRouteToComms,
  onQualify,
  onPass,
  onResearch,
  onOverride,
  busy,
}: {
  candidate: ProspectCandidate;
  activeIcpVersion: number | null;
  backSearch: { section: "scout" | "qualified" | "research"; fit: "all" | FitLight };
  /** Recorded events for this prospect, newest first. */
  events?: ActivityEvent[];
  /** People on record for this company. */
  people?: Person[];
  /** Approved people sources, and which of them can run right now. */
  providers?: PeopleProviderInfo[];
  availableProviders?: string[];
  peopleNote?: string | undefined;
  onIngest: (providerId: string) => void;
  onAddManual: (form: ManualPersonForm) => void;
  onConfirmEmail: (person: Person) => void;
  onRouteToComms: (draft: HandoffDraft) => void;
  onQualify: (id: string) => void;
  onPass: (id: string) => void;
  onResearch: (websiteUrl: string) => void;
  onOverride: (id: string, light: FitLight | null) => void;
  busy?: boolean | undefined;
}) {
  const { prospect, evaluation } = candidate;
  const contactCount = people.length;


  const composition = useMemo(
    () =>
      composeProspectPage({
        candidate,
        activeIcpVersion,
        activityCount: events.length,
        contactCount,
      }),
    [candidate, activeIcpVersion, events.length, contactCount],
  );

  const research = () => {
    if (prospect.websiteUrl) onResearch(prospect.websiteUrl);
  };

  return (
    <div className="space-y-6">
      <TTButton asChild variant="quiet" size="sm" className="-ml-4">
        <Link to="/modules/scout" search={backSearch}>
          <ArrowLeft aria-hidden />
          Back to the board
        </Link>
      </TTButton>

      <IdentityBand
        candidate={candidate}
        activeIcpVersion={activeIcpVersion}
        needsRescore={composition.needsRescore}
        staleDays={composition.staleDays}
        onQualify={() => onQualify(prospect.id)}
        onPass={() => onPass(prospect.id)}
        onResearch={research}
        onOverride={(light) => onOverride(prospect.id, light)}
        busy={busy}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <NextMovePanel
            move={composition.nextMove}
            onQualify={() => onQualify(prospect.id)}
            onPass={() => onPass(prospect.id)}
            onResearch={research}
            canResearch={Boolean(prospect.websiteUrl)}
            busy={busy}
          />

          {hasModule(composition, "fit_read") ? (
            <FitReadPanel
              evaluation={evaluation}
              coverage={composition.coverage}
              confidence={composition.confidence}
              emphasis={emphasisOf(composition, "fit_read")}
            />
          ) : null}

          {hasModule(composition, "opportunity") ? (
            <OpportunityMap
              criteria={evaluation.criteria.filter((c) => OPPORTUNITY_KEYS.includes(c.key))}
              fit={candidate.fit}
            />
          ) : null}

          <PeoplePanel
            criteria={evaluation.criteria.filter((c) => c.key === "decision_maker")}
            people={people}
            providers={providers}
            availableProviders={availableProviders}
            onIngest={onIngest}
            onAddManual={onAddManual}
            onConfirmEmail={onConfirmEmail}
            busy={busy}
            note={peopleNote}
          />


          {hasModule(composition, "handoff") ? (
            <HandoffPanel
              candidate={candidate}
              coverage={composition.coverage}
              people={people}
              fitConfidence={composition.confidence}
              onRoute={onRouteToComms}
              routed={prospect.status === "ready_for_comms"}
              emphasis={emphasisOf(composition, "handoff")}
              busy={busy}
            />
          ) : null}

          {hasModule(composition, "observed") ? <ObservedPanel candidate={candidate} /> : null}

          {composition.unknown.some((n) => n.id !== "people") ? (
            <UnknownStrip notes={composition.unknown.filter((n) => n.id !== "people")} />
          ) : null}
        </div>

        <aside className="space-y-6">
          {composition.pulse ? (
            <SignalPulseCard pulse={composition.pulse} history={composition.history} />
          ) : null}
          {hasModule(composition, "coverage") ? (
            <CoverageCard coverage={composition.coverage} />
          ) : null}
          {hasModule(composition, "timeline") ? <TimelineCard events={events} /> : null}
        </aside>
      </div>
    </div>
  );
}

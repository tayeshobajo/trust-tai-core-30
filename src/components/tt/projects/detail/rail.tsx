/**
 * The right rail: what needs a person, what the health word is made of, who is
 * on the work, and the few moves worth making from here.
 */

import { Link } from "@tanstack/react-router";
import { ArrowRight, Check } from "lucide-react";

import { TTButton } from "@/components/tt/primitives";
import type { AttentionItem, PersonOnProject } from "@/data/projects/detail-projection";
import type { ProjectLineage } from "@/data/projects/index-projection";

function RailCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="tt-surface p-5">
      <h2 className="tt-eyebrow">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export interface AssignableMember {
  userId: string;
  name: string;
}

export function DetailRail({
  ownerLabel,
  owner,
  members,
  unassignRefusal,
  onAssign,
  attention,
  signals,
  people,
  lineage,
  busy,
  onOpenTab,
  onAddWork,
  onRaiseBlocker,
  onAskDecision,
  onComplete,
}: {
  ownerLabel: string;
  owner: { userId: string | null; label: string };
  members: AssignableMember[];
  /** Set when taking the last person off this work would be refused. */
  unassignRefusal: string | null;
  onAssign: (next: { ownerUserId: string; ownerLabel: string }) => void;
  attention: AttentionItem[];
  signals: string[];
  people: PersonOnProject[];
  lineage: ProjectLineage;
  busy: boolean;
  onOpenTab: (tab: "work" | "blockers" | "decisions") => void;
  onAddWork: () => void;
  onRaiseBlocker: () => void;
  onAskDecision: () => void;
  onComplete: () => void;
}) {
  return (
    <aside className="space-y-5">
      <RailCard title={`Needs ${ownerLabel || "a person"}`}>
        {attention.length === 0 ? (
          <p className="text-[14px] text-muted-foreground">
            Nothing here needs your judgment right now.
          </p>
        ) : (
          <ul className="space-y-3">
            {attention.map((item) => (
              <li key={`${item.tab}-${item.title}`}>
                <button
                  type="button"
                  onClick={() =>
                    item.tab === "overview"
                      ? undefined
                      : onOpenTab(item.tab as "work" | "blockers" | "decisions")
                  }
                  className="w-full rounded-lg border border-border bg-card p-3 text-left transition-colors hover:bg-secondary"
                >
                  <p className="text-[14px] text-foreground">{item.title}</p>
                  <p className="mt-1 text-[13px] text-muted-foreground">{item.because}</p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </RailCard>

      <RailCard title="Project health">
        <ul className="space-y-2">
          {signals.map((signal) => (
            <li key={signal} className="flex items-start gap-2 text-[14px] text-foreground">
              <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              {signal}
            </li>
          ))}
        </ul>
      </RailCard>

      <RailCard title="Who carries this">
        <select
          aria-label="Project owner"
          className="h-11 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground"
          value={owner.userId ?? ""}
          disabled={busy || members.length === 0}
          onChange={(event) => {
            const userId = event.target.value;
            const picked = members.find((member) => member.userId === userId);
            onAssign({ ownerUserId: userId, ownerLabel: picked?.name ?? "" });
          }}
        >
          <option value="" disabled={unassignRefusal !== null}>
            No one yet
          </option>
          {members.map((member) => (
            <option key={member.userId} value={member.userId}>
              {member.name}
            </option>
          ))}
        </select>
        <p className="mt-2 text-[13px] text-muted-foreground">
          {members.length === 0
            ? "No workspace members are readable, so this cannot be handed over here."
            : (unassignRefusal ??
              (owner.userId ? `Carried by ${owner.label}.` : "Nobody is carrying this yet."))}
        </p>
      </RailCard>

      <RailCard title="People">
        {people.length === 0 ? (
          <p className="text-[14px] text-muted-foreground">Nobody is on the record yet.</p>
        ) : (
          <ul className="space-y-2">
            {people.map((person) => (
              <li key={person.label} className="flex items-baseline justify-between gap-3">
                <span className="text-[14px] text-foreground">{person.label}</span>
                <span className="text-[13px] text-muted-foreground">{person.role}</span>
              </li>
            ))}
          </ul>
        )}
      </RailCard>

      <RailCard title="Quick actions">
        <div className="flex flex-col gap-2">
          <TTButton variant="secondary" size="sm" onClick={onAddWork} disabled={busy}>
            Add work item
          </TTButton>
          <TTButton variant="secondary" size="sm" onClick={onRaiseBlocker} disabled={busy}>
            Record a blocker
          </TTButton>
          <TTButton variant="secondary" size="sm" onClick={onAskDecision} disabled={busy}>
            Ask for a decision
          </TTButton>
          <TTButton variant="secondary" size="sm" onClick={onComplete} disabled={busy}>
            Mark project complete
          </TTButton>
          {lineage.roadmapId ? (
            <TTButton asChild variant="quiet" size="sm">
              <Link
                to="/modules/roadmap/$roadmapId"
                params={{ roadmapId: lineage.roadmapId }}
                search={{ view: "overview" as const }}
              >
                Return outcome to roadmap
                <ArrowRight aria-hidden />
              </Link>
            </TTButton>
          ) : null}
        </div>
      </RailCard>
    </aside>
  );
}

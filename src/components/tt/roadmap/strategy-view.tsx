/**
 * Strategy view.
 *
 * The point of view: where the business stands, what it has already proved,
 * where the category is going, and what it could become. Every item is a
 * proposal a person approves, rejects, or defers. Nothing promotes itself.
 */

import { EvidenceList, TierChip } from "@/components/tt/roadmap/tier";
import { EmptyState, MetaPill, SectionHeading, TTButton } from "@/components/tt/primitives";
import { CONFIDENCE_LEVEL_LABEL } from "@/domain/confidence";
import type { ApprovalState, RoadmapStrategy, StrategyItem } from "@/domain/roadmap-intel";
import { APPROVAL_LABEL, UNKNOWN } from "@/domain/roadmap-intel";

function ItemCard({
  item,
  busyKey,
  onApproval,
}: {
  item: StrategyItem;
  busyKey: string | null;
  onApproval: (key: string, approval: ApprovalState) => void;
}) {
  const busy = busyKey === item.key;
  return (
    <li className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-center gap-2">
        <TierChip tier={item.tier} />
        <MetaPill>{APPROVAL_LABEL[item.approval]}</MetaPill>
        <MetaPill>{CONFIDENCE_LEVEL_LABEL[item.confidence]}</MetaPill>
      </div>
      <p className="mt-3 max-w-reading text-base text-foreground">{item.statement}</p>
      <p className="mt-1 max-w-reading text-sm text-muted-foreground">{item.because}</p>
      <EvidenceList
        evidence={item.sources.map((ref) => ({
          label: ref.label,
          url: ref.url,
          kind: "page" as const,
        }))}
      />
      <div className="mt-4 flex flex-wrap gap-2">
        <TTButton
          size="sm"
          variant={item.approval === "approved" ? "primary" : "secondary"}
          disabled={busy}
          onClick={() => onApproval(item.key, "approved")}
        >
          Approve
        </TTButton>
        <TTButton
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() => onApproval(item.key, "deferred")}
        >
          Defer
        </TTButton>
        <TTButton
          size="sm"
          variant="quiet"
          disabled={busy}
          onClick={() => onApproval(item.key, "rejected")}
        >
          Reject
        </TTButton>
      </div>
    </li>
  );
}

function Group({
  title,
  description,
  items,
  busyKey,
  onApproval,
}: {
  title: string;
  description: string;
  items: (StrategyItem | null)[];
  busyKey: string | null;
  onApproval: (key: string, approval: ApprovalState) => void;
}) {
  const present = items.filter((item): item is StrategyItem => item !== null);
  return (
    <section className="space-y-4">
      <SectionHeading title={title} description={description} />
      {present.length === 0 ? (
        <p className="text-sm text-muted-foreground">{UNKNOWN}.</p>
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {present.map((item) => (
            <ItemCard key={item.key} item={item} busyKey={busyKey} onApproval={onApproval} />
          ))}
        </ul>
      )}
    </section>
  );
}

export function StrategyView({
  strategy,
  busyKey,
  onApproval,
  onGenerate,
  generating,
}: {
  strategy: RoadmapStrategy | null;
  busyKey: string | null;
  onApproval: (key: string, approval: ApprovalState) => void;
  onGenerate: () => void;
  generating: boolean;
}) {
  if (!strategy) {
    return (
      <EmptyState
        title="No point of view has been formed yet."
        belongsHere="Strategy is proposed from the research pass: Point A, anchor proof, the horizon, and where this could go."
        whyItMatters="A roadmap without a point of view is a task list."
        action={
          <TTButton onClick={onGenerate} disabled={generating}>
            {generating ? "Researching…" : "Research and propose"}
          </TTButton>
        }
      />
    );
  }

  return (
    <div className="space-y-10">
      <Group
        title="Point A"
        description="Where the business actually stands today."
        items={strategy.pointA}
        busyKey={busyKey}
        onApproval={onApproval}
      />
      <Group
        title="Anchor proof"
        description="One to three things this company has already proved it can do."
        items={strategy.anchorProof}
        busyKey={busyKey}
        onApproval={onApproval}
      />

      <section>
        <SectionHeading
          title="Industry horizon"
          description="Where the category is heading over two, five and ten years."
        />
        {strategy.horizon.length === 0 ? (
          <p className="text-sm text-muted-foreground">{UNKNOWN}.</p>
        ) : (
          <ul className="grid gap-4 lg:grid-cols-3">
            {strategy.horizon.map((band) => (
              <li key={band.years} className="rounded-xl border border-border bg-card p-5">
                <div className="flex items-center gap-2">
                  <TierChip tier={band.tier} />
                  <MetaPill>{band.years} years</MetaPill>
                </div>
                <p className="mt-3 max-w-reading text-sm text-foreground">{band.statement}</p>
                <EvidenceList
                  evidence={band.sources.map((ref) => ({
                    label: ref.label,
                    url: ref.url,
                    kind: "page" as const,
                  }))}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <Group
        title="Central business truth"
        description="The one sentence the whole roadmap turns on."
        items={[strategy.centralTruth]}
        busyKey={busyKey}
        onApproval={onApproval}
      />
      <Group
        title="Point B and Point C"
        description="Where this goes next, and where it compounds."
        items={[strategy.pointB, strategy.pointC]}
        busyKey={busyKey}
        onApproval={onApproval}
      />
      <Group
        title="Gaps and leverage"
        description="What is missing in the market, and the shortest way in."
        items={[...strategy.gaps, strategy.leveragePoint]}
        busyKey={busyKey}
        onApproval={onApproval}
      />
    </div>
  );
}

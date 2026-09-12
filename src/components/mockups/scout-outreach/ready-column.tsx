import { TTButton, TonePill } from "@/components/tt/primitives";
import type { ReadyProspect } from "./types";

interface ReadyColumnProps {
  prospects: ReadyProspect[];
  onDraft: (prospect: ReadyProspect) => void;
}

function fitTone(score: ReadyProspect["fitScore"]) {
  if (score === "strong") return "good" as const;
  if (score === "good") return "active" as const;
  return "neutral" as const;
}

function fitLabel(score: ReadyProspect["fitScore"]) {
  if (score === "strong") return "Strong fit";
  if (score === "good") return "Good fit";
  return "Medium fit";
}

export function ReadyColumn({ prospects, onDraft }: ReadyColumnProps) {
  return (
    <section className="tt-surface p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="tt-title-card text-base">Ready for intro</h2>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {prospects.length}
        </span>
      </div>

      <div className="space-y-3">
        {prospects.map((prospect) => (
          <article
            key={prospect.id}
            className="rounded-xl border border-border bg-card p-4 transition-colors hover:border-royal/25"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-medium text-foreground">{prospect.company}</h3>
                <p className="text-xs text-muted-foreground">
                  {prospect.contact} · {prospect.title}
                </p>
              </div>
              <TonePill tone={fitTone(prospect.fitScore)} dot>
                {fitLabel(prospect.fitScore)}
              </TonePill>
            </div>

            <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
              {prospect.fitReason}
            </p>

            <div className="mt-4">
              <TTButton size="sm" onClick={() => onDraft(prospect)}>
                Draft intro
              </TTButton>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

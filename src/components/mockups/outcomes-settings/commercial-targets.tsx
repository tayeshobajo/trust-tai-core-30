import { useState } from "react";

import { TTInput } from "@/components/tt/primitives";
import { cn } from "@/lib/utils";

export interface CommercialTarget {
  id: string;
  label: string;
  low: number | null;
  high: number | null;
  actual: number | null;
  actualLabel: string;
  prefix?: string;
}

const INITIAL_TARGETS: CommercialTarget[] = [
  {
    id: "first-touches",
    label: "First touches",
    low: 10,
    high: 12,
    actual: 7,
    actualLabel: "7 this week",
  },
  {
    id: "discovery-calls",
    label: "Discovery calls",
    low: 2,
    high: 3,
    actual: 1,
    actualLabel: "1 this week",
  },
  {
    id: "proposals",
    label: "Proposals",
    low: 1,
    high: 2,
    actual: 0,
    actualLabel: "0 this week",
  },
  {
    id: "run-clients",
    label: "Run clients",
    low: 20,
    high: null,
    actual: 18,
    actualLabel: "18 this week",
  },
  {
    id: "monthly-revenue",
    label: "Monthly revenue target",
    low: 24000,
    high: null,
    actual: null,
    actualLabel: "Not tracked",
    prefix: "$",
  },
];

function ProgressBar({ value, max }: { value: number; max: number }) {
  const ratio = max > 0 ? Math.min(value / max, 1) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
      <div
        className={cn("h-full rounded-full transition-all", ratio >= 1 ? "bg-success" : "bg-royal")}
        style={{ width: `${ratio * 100}%` }}
      />
    </div>
  );
}

export function CommercialTargetsSection() {
  const [targets, setTargets] = useState<CommercialTarget[]>(INITIAL_TARGETS);

  const update = (id: string, patch: Partial<CommercialTarget>) => {
    setTargets((current) =>
      current.map((target) => (target.id === id ? { ...target, ...patch } : target)),
    );
  };

  return (
    <div className="space-y-5">
      {targets.map((target) => {
        const max = target.high ?? target.low ?? 1;
        const value = target.actual ?? 0;
        return (
          <div key={target.id} className="grid gap-4 sm:grid-cols-[1fr_auto_180px] sm:items-center">
            <div>
              <p className="text-sm font-medium text-foreground">{target.label}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{target.actualLabel}</p>
            </div>

            <div className="flex items-center gap-2">
              {target.low !== null ? (
                <TTInput
                  type="number"
                  value={target.low}
                  onChange={(event) => update(target.id, { low: Number(event.target.value) })}
                  className="h-9 w-20 px-3 text-center"
                />
              ) : null}
              {target.high !== null ? (
                <>
                  <span className="text-sm text-muted-foreground">–</span>
                  <TTInput
                    type="number"
                    value={target.high}
                    onChange={(event) => update(target.id, { high: Number(event.target.value) })}
                    className="h-9 w-20 px-3 text-center"
                  />
                </>
              ) : null}
            </div>

            <div className="w-full sm:w-44">
              <ProgressBar value={value} max={max} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

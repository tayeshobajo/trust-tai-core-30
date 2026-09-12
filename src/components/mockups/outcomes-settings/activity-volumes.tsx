import { useState } from "react";

import { TTInput } from "@/components/tt/primitives";
import { TTSelect } from "@/components/tt/settings/pieces";
import { cn } from "@/lib/utils";

type Cadence = "day" | "week" | "month";

export interface ActivityVolume {
  id: string;
  label: string;
  target: number;
  cadence: Cadence;
  actualToday: number | null;
  actualThisWeek: number | null;
}

const INITIAL_VOLUMES: ActivityVolume[] = [
  {
    id: "linkedin-invites",
    label: "LinkedIn connection invitations",
    target: 10,
    cadence: "day",
    actualToday: 8,
    actualThisWeek: null,
  },
  {
    id: "blog-posts",
    label: "Blog posts published",
    target: 2,
    cadence: "day",
    actualToday: 0,
    actualThisWeek: null,
  },
  {
    id: "scout-intro-emails",
    label: "Scout intro emails",
    target: 15,
    cadence: "week",
    actualToday: null,
    actualThisWeek: 0,
  },
];

function cadenceLabel(cadence: Cadence) {
  if (cadence === "day") return "per day";
  if (cadence === "week") return "per week";
  return "per month";
}

function actualLabel(volume: ActivityVolume) {
  if (volume.actualToday !== null) return `${volume.actualToday} today`;
  if (volume.actualThisWeek !== null) return `${volume.actualThisWeek} this week`;
  return "No actual";
}

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

export function ActivityVolumesSection() {
  const [volumes, setVolumes] = useState<ActivityVolume[]>(INITIAL_VOLUMES);

  const update = (id: string, patch: Partial<ActivityVolume>) => {
    setVolumes((current) =>
      current.map((volume) => (volume.id === id ? { ...volume, ...patch } : volume)),
    );
  };

  return (
    <div className="space-y-5">
      {volumes.map((volume) => {
        const actual = volume.actualToday ?? volume.actualThisWeek ?? 0;
        return (
          <div
            key={volume.id}
            className="grid gap-4 sm:grid-cols-[1fr_auto_auto_180px] sm:items-center"
          >
            <div>
              <p className="text-sm font-medium text-foreground">{volume.label}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{actualLabel(volume)}</p>
            </div>

            <TTInput
              type="number"
              value={volume.target}
              onChange={(event) => update(volume.id, { target: Number(event.target.value) })}
              className="h-9 w-20 px-3 text-center"
            />

            <TTSelect
              value={volume.cadence}
              onChange={(event) => update(volume.id, { cadence: event.target.value as Cadence })}
              className="h-9 w-36"
            >
              <option value="day">per day</option>
              <option value="week">per week</option>
              <option value="month">per month</option>
            </TTSelect>

            <div className="w-full sm:w-44">
              <ProgressBar value={actual} max={volume.target} />
            </div>
          </div>
        );
      })}

      <p className="text-xs text-muted-foreground">
        Caps are ceilings. Quality gates decide what actually goes out.
      </p>
    </div>
  );
}

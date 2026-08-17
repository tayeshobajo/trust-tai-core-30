import {
  Activity,
  Compass,
  HeartHandshake,
  MessagesSquare,
  PenTool,
  Route as RouteIcon,
  Search,
  ShieldCheck,
  SquareStack,
  type LucideIcon,
} from "lucide-react";

import { AppLink } from "@/components/tt/app-link";
import { getRoomFeature } from "@/domain/home-imagery";
import type { AppRegistration } from "@/domain/registry";

const ICONS: Record<string, LucideIcon> = {
  Compass,
  Search,
  MessagesSquare,
  HeartHandshake,
  Route: RouteIcon,
  SquareStack,
  ShieldCheck,
  PenTool,
  Activity,
};

/** Build state, said quietly. Live rooms need no chip at all. */
function chip(app: AppRegistration) {
  if (app.status === "in_build") return "In build";
  if (app.status === "mapped") return "Coming soon";
  if (app.status === "external") return "Existing product";
  return null;
}

/** One inviting door: featured image, icon, name, one human sentence. */
export function SuiteRoomCard({ app }: { app: AppRegistration }) {
  const feature = getRoomFeature(app.id);
  const Icon = ICONS[app.icon] ?? Compass;
  const label = chip(app);

  return (
    <AppLink
      app={app}
      className="group block h-full overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="relative aspect-[16/9] overflow-hidden bg-cloud">
        {feature ? (
          <img
            src={feature.image}
            alt={feature.alt}
            width={1200}
            height={800}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
        ) : null}
      </div>
      <div className="flex items-start gap-4 px-6 py-5">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-cloud-strong text-royal">
          <Icon className="size-[18px]" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h3 className="font-display text-xl text-foreground">{app.name}</h3>
            {label ? (
              <span className="rounded-full border border-border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
                {label}
              </span>
            ) : null}
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">{feature?.line ?? app.description}</p>
        </div>
      </div>
    </AppLink>
  );
}

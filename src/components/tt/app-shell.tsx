import { Link, useRouterState } from "@tanstack/react-router";

import { AppLink } from "@/components/tt/app-link";
import {
  Activity,
  Compass,
  MessagesSquare,
  PenTool,
  Route as RouteIcon,
  Search,
  ShieldCheck,
  SquareStack,
  Menu,
  X,
  type LucideIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { APP_REGISTRY, type AppRegistration } from "@/domain/registry";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  Compass,
  Search,
  MessagesSquare,
  Route: RouteIcon,
  SquareStack,
  ShieldCheck,
  PenTool,
  Activity,
};

function statusNote(app: AppRegistration) {
  if (app.status === "live") return null;
  if (app.status === "external") return "Existing product";
  return "Upcoming";
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <nav aria-label="Trust Tai suite" className="space-y-1">
      {APP_REGISTRY.map((app) => {
        const Icon = ICONS[app.icon] ?? Compass;
        const active = pathname === app.route;
        const note = statusNote(app);
        return (
          <AppLink
            key={app.id}
            app={app}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors duration-200",
              active
                ? "bg-secondary font-medium text-foreground"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            <span className="flex-1">{app.name}</span>
            {note ? (
              <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
                {note}
              </span>
            ) : (
              <span className="size-1.5 rounded-full bg-royal" aria-hidden />
            )}
          </AppLink>
        );
      })}
    </nav>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background/90 px-4 backdrop-blur lg:px-8">
        <button
          type="button"
          aria-label={open ? "Close navigation" : "Open navigation"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="-ml-1 flex size-11 items-center justify-center rounded-lg text-foreground lg:hidden"
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>

        <Link to="/" className="flex items-baseline gap-2">
          <span className="font-display text-xl font-semibold tracking-tight text-foreground">
            Trust Tai
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            OS Foundation
          </span>
        </Link>

        <div className="ml-auto flex items-center gap-3">
          <span className="hidden font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground sm:inline">
            Trust Tai
          </span>
          <span
            className="flex size-9 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground"
            aria-label="Signed in as Tai"
          >
            T
          </span>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-canvas">
        <aside className="hidden w-60 shrink-0 border-r border-border p-4 lg:block">
          <p className="tt-eyebrow mb-3 px-3">Suite</p>
          <NavList />
        </aside>

        {open ? (
          <div className="fixed inset-x-0 top-16 z-20 border-b border-border bg-card p-4 lg:hidden">
            <NavList onNavigate={() => setOpen(false)} />
          </div>
        ) : null}

        <main className="min-w-0 flex-1 px-4 py-10 sm:px-6 lg:px-10 lg:py-14">{children}</main>
      </div>
    </div>
  );
}

import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";

import { AppLink } from "@/components/tt/app-link";
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
  Menu,
  X,
  type LucideIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { APP_REGISTRY, type AppRegistration } from "@/domain/registry";
import { cn } from "@/lib/utils";
import { signOut, type WorkspaceIdentity } from "@/lib/workspace";
import { AmbientDot } from "@/components/tt/ambient";

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

function statusNote(app: AppRegistration) {
  if (app.status === "live") return null;
  if (app.status === "external") return "Existing product";
  if (app.status === "in_build") return "In build";
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
              "relative flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors duration-200",
              active
                ? "bg-cloud font-medium text-foreground"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground",
            )}
          >
            {active ? (
              <span
                aria-hidden
                className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-royal"
              />
            ) : null}
            <Icon
              className={cn("size-4 shrink-0", active ? "text-royal" : undefined)}
              aria-hidden
            />
            <span className="flex-1">{app.name}</span>
            {note ? (
              <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
                {note}
              </span>
            ) : (
              /* The room's own ambient accent — place recognition, not status. */
              <AmbientDot appId={app.id} />
            )}
          </AppLink>
        );
      })}
    </nav>
  );
}

export function AppShell({
  children,
  identity,
  sidebar,
}: {
  children: ReactNode;
  identity?: WorkspaceIdentity;
  /** Room-specific panels rendered below the suite navigation. */
  sidebar?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  async function handleSignOut() {
    await signOut(queryClient);
    void navigate({ to: "/auth", replace: true });
  }

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
            {identity?.organizationName ?? "Trust Tai"}
          </span>
          {identity ? (
            <>
              <span
                className="flex size-9 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground"
                aria-label={`Signed in as ${identity.name}`}
                title={identity.email}
              >
                {identity.firstName.charAt(0).toUpperCase()}
              </span>
              <button
                type="button"
                onClick={() => void handleSignOut()}
                className="rounded-full px-3 py-2 text-[13px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Sign out
              </button>
            </>
          ) : null}
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-canvas">
        <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-[292px] shrink-0 flex-col overflow-y-auto border-r border-border bg-sidebar p-4 lg:flex xl:w-[308px]">
          <p className="tt-eyebrow mb-3 px-3">Suite</p>
          <NavList />
          {sidebar ? <div className="mt-6 space-y-3">{sidebar}</div> : null}
          <div className="mt-auto pt-6">
            <p className="px-3 font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
              {identity?.organizationName ?? "Trust Tai"}
            </p>
          </div>
        </aside>

        {open ? (
          <div className="fixed inset-x-0 top-16 z-20 max-h-[calc(100vh-4rem)] overflow-y-auto border-b border-border bg-card p-4 lg:hidden">
            <NavList onNavigate={() => setOpen(false)} />
            {sidebar ? <div className="mt-5 space-y-3">{sidebar}</div> : null}
          </div>
        ) : null}

        <main className="min-w-0 flex-1 px-4 py-8 sm:px-6 lg:px-10 lg:py-10">{children}</main>
      </div>

    </div>
  );
}

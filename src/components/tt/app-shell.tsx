import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";

import { AppLink } from "@/components/tt/app-link";
import { BrandLogo } from "@/components/tt/brand-logo";
import {
  Activity,
  Compass,
  HeartHandshake,
  MessagesSquare,
  PenTool,
  Route as RouteIcon,
  Search,
  ShieldCheck,
  Settings,
  SquareStack,
  Menu,
  X,
  type LucideIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { usePresence } from "@/hooks/use-presence";


import { APP_REGISTRY, type AppRegistration } from "@/domain/registry";
import { initialsOf } from "@/domain/steward-accountability";
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

/** The room's build state, said quietly. Live rooms say nothing at all. */
function statusNote(app: AppRegistration) {
  if (app.status === "live") return null;
  if (app.status === "external") return "Existing product";
  if (app.status === "in_build") return "In build";
  return "Upcoming";
}

/** A room is current when you are anywhere inside it, not only on its index. */
function isCurrent(pathname: string, route: string) {
  if (route === "/") return pathname === "/";
  return pathname === route || pathname.startsWith(`${route}/`);
}

function NavList({
  onNavigate,
  allowed,
}: {
  onNavigate?: () => void;
  /** App ids this person may see. Undefined means "not yet resolved". */
  allowed?: string[];
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  /* The rail is derived, never a static list: an app the organization has
     switched off, or one hidden for this person, is simply not here. */
  const rooms = allowed ? APP_REGISTRY.filter((app) => allowed.includes(app.id)) : APP_REGISTRY;

  return (
    <nav aria-label="Trust Tai suite" className="space-y-0.5">
      {rooms.map((app) => {
        const Icon = ICONS[app.icon] ?? Compass;
        const active = isCurrent(pathname, app.route);
        const note = statusNote(app);
        return (
          <AppLink
            key={app.id}
            app={app}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex min-h-12 items-center gap-3 rounded-lg pl-4 pr-3 py-2.5 text-[15px] transition-colors duration-200",
              active
                ? "bg-cloud-strong font-medium text-foreground"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground",
            )}
          >
            {active ? (
              <span
                aria-hidden
                className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-royal"
              />
            ) : null}
            <Icon
              className={cn("size-[18px] shrink-0", active ? "text-royal" : "text-muted-foreground")}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate">{app.name}</span>
            {note ? (
              <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground/70">
                {note}
              </span>
            ) : (
              /* The room's own ambient accent, place recognition, not status. */
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
  const allowedApps = identity?.apps.map((app) => app.appId) ?? [];
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  /* Presence: which room this person is actually working in, recorded once
     per room per few minutes. Never blocks and never gates anything. */
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const currentApp = APP_REGISTRY.find((app) => isCurrent(pathname, app.route));
  usePresence({
    organizationId: identity?.organizationId,
    userId: identity?.userId,
    appKey: currentApp?.id ?? (pathname.startsWith("/settings") ? "settings" : null),
  });


  async function handleSignOut() {
    await signOut(queryClient);
    void navigate({ to: "/auth", search: { redirect: "/" }, replace: true });
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

        <Link to="/" className="flex items-center gap-3" aria-label="Trust Tai OS · home">
          <BrandLogo height={26} className="sm:h-[30px] sm:w-auto" />
          <span className="hidden font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground sm:inline">
            OS
          </span>
        </Link>

        <div className="ml-auto flex items-center gap-3">
          <span className="hidden font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground sm:inline">
            {identity?.organizationName ?? "Trust Tai"}
          </span>
          {identity ? (
            <>
              <Link
                to="/settings"
                aria-label="Settings"
                className="flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <Settings className="size-[18px]" aria-hidden />
              </Link>
              {identity.avatarUrl ? (
                <img
                  src={identity.avatarUrl}
                  alt={`${identity.name}, profile photo`}
                  className="size-9 rounded-full object-cover"
                />
              ) : (
              <span
                className="flex size-9 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground"
                aria-label={`Signed in as ${identity.name}`}
                title={identity.email}
              >
                {initialsOf(identity.name)}
              </span>
              )}
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

      {/* One continuous shell: full-bleed rail directly beneath the header, fluid canvas beside it. */}
      <div className="flex w-full">
        <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-[248px] shrink-0 flex-col overflow-y-auto border-r border-border bg-sidebar px-3 py-5 lg:flex xl:w-[276px]">
          <p className="tt-eyebrow mb-2 px-4">Suite</p>

          <NavList allowed={allowedApps} />
          {sidebar ? <div className="mt-6 space-y-3">{sidebar}</div> : null}
          <div className="mt-auto pt-6">
            <p className="px-3 font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
              {identity?.organizationName ?? "Trust Tai"}
            </p>
          </div>
        </aside>

        {open ? (
          <div className="fixed inset-x-0 top-16 z-20 max-h-[calc(100vh-4rem)] overflow-y-auto border-b border-border bg-card p-4 lg:hidden">
            <NavList allowed={allowedApps} onNavigate={() => setOpen(false)} />
            {sidebar ? <div className="mt-5 space-y-3">{sidebar}</div> : null}
          </div>
        ) : null}

        <main className="mx-auto min-w-0 flex-1 px-4 py-8 sm:px-6 lg:px-8 lg:py-10 2xl:px-10">
          {/* One calm reading canvas for every room, never edge to edge. */}
          <div className="mx-auto w-full max-w-canvas">{children}</div>
        </main>
      </div>

    </div>
  );
}

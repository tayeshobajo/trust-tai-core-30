/**
 * Settings shell: one calm frame for every settings surface.
 *
 * The sub-navigation is grouped the way a person thinks about the question
 * they came to answer: myself, my workspace, our organization.
 */

import { Link, useRouterState } from "@tanstack/react-router";
import { createContext, useContext, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import type { WorkspaceIdentity } from "@/lib/workspace";

const IdentityContext = createContext<WorkspaceIdentity | null>(null);

export function SettingsIdentityProvider({
  identity,
  children,
}: {
  identity: WorkspaceIdentity;
  children: ReactNode;
}) {
  return <IdentityContext.Provider value={identity}>{children}</IdentityContext.Provider>;
}

/** The verified identity for this settings surface. Never optional. */
export function useSettingsIdentity(): WorkspaceIdentity {
  const identity = useContext(IdentityContext);
  if (!identity) throw new Error("Settings surfaces render inside the workspace boundary.");
  return identity;
}

interface NavItem {
  to: string;
  label: string;
  /** Owners and admins only. */
  managing?: boolean;
}

const GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: "Personal",
    items: [
      { to: "/settings/profile", label: "My profile" },
      { to: "/settings/notifications", label: "Notifications" },
    ],
  },
  {
    title: "Workspace",
    items: [
      { to: "/settings/people", label: "People & access" },
      { to: "/settings/apps", label: "Apps" },
      { to: "/settings/integrations", label: "Integrations" },
    ],
  },
  {
    title: "Organization",
    items: [
      { to: "/settings/organization", label: "Organization profile", managing: true },
      { to: "/settings/security", label: "Security" },
      { to: "/settings/diagnostics", label: "Diagnostics" },
    ],
  },
];

export function SettingsNav({ canManage }: { canManage: boolean }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <nav aria-label="Settings" className="tt-surface p-3 lg:sticky lg:top-24">
      <Link
        to="/settings"
        className={cn(
          "mb-2 block rounded-lg px-3 py-2 text-sm transition-colors",
          pathname === "/settings"
            ? "bg-cloud-strong font-medium text-foreground"
            : "text-muted-foreground hover:bg-secondary hover:text-foreground",
        )}
      >
        Overview
      </Link>
      <div className="space-y-4">
        {GROUPS.map((group) => {
          const items = group.items.filter((item) => !item.managing || canManage);
          if (items.length === 0) return null;
          return (
            <div key={group.title}>
              <p className="tt-eyebrow px-3 pb-1">{group.title}</p>
              <div className="space-y-0.5">
                {items.map((item) => {
                  const active = pathname === item.to;
                  return (
                    <Link
                      key={item.to}
                      to={item.to}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "block rounded-lg px-3 py-2 text-sm transition-colors",
                        active
                          ? "bg-cloud-strong font-medium text-foreground"
                          : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                      )}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </nav>
  );
}

/** Two-column settings canvas. Collapses to a stacked page on narrow screens. */
export function SettingsCanvas({
  canManage,
  children,
}: {
  canManage: boolean;
  children: ReactNode;
}) {
  return (
    <div className="mt-8 grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
      <SettingsNav canManage={canManage} />
      <div className="min-w-0 space-y-6">{children}</div>
    </div>
  );
}

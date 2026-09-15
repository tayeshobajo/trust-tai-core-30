/**
 * MOCKUP ONLY — the workspace shell for Comms v2.
 *
 * A faithful mockup-local replica of the suite rail (collapsed by default so
 * the work has room, expandable on demand) plus a compact Comms toolbar.
 * Nothing here reads a production record or navigates the live app.
 */

import { useState, type ReactNode } from "react";
import {
  Activity,
  CalendarRange,
  ChevronRight,
  Info,
  MessagesSquare,
  PanelLeftClose,
  Plus,
  Radar,
  Search,
  Settings,
  SquareKanban,
  Users,
} from "lucide-react";

import { BrandLogo } from "@/components/tt/brand-logo";
import { V2_PROTOTYPE_NOTES } from "@/data/mockups/comms-workspace-v2";
import { cn } from "@/lib/utils";

const ROOMS = [
  { id: "pulse", label: "Pulse", icon: Activity },
  { id: "scout", label: "Scout", icon: Radar },
  { id: "comms", label: "Comms", icon: MessagesSquare },
  { id: "roadmap", label: "Roadmap", icon: CalendarRange },
  { id: "projects", label: "Projects", icon: SquareKanban },
  { id: "people", label: "People", icon: Users },
];

export function MockCommsShell({
  onNewReview,
  search,
  onSearch,
  children,
}: {
  onNewReview: () => void;
  search: string;
  onSearch: (value: string) => void;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-[var(--cloud)] text-foreground">
      {/* Suite rail: collapsed 64px replica, expandable. Never a blank column. */}
      <nav
        aria-label="Trust Tai OS rooms"
        className={cn(
          "hidden shrink-0 flex-col border-r border-[var(--cloud-line)] bg-card py-3 transition-[width] duration-150 motion-reduce:transition-none md:flex",
          expanded ? "w-[220px] px-3" : "w-16 items-center px-2",
        )}
      >
        <div className={cn("mb-4 flex h-9 items-center", expanded ? "px-1" : "justify-center")}>
          <BrandLogo height={expanded ? 22 : 20} />
        </div>
        <ul className="flex w-full flex-col gap-1">
          {ROOMS.map((room) => {
            const Icon = room.icon;
            const active = room.id === "comms";
            return (
              <li key={room.id}>
                <button
                  type="button"
                  title={room.label}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-10 w-full items-center gap-3 rounded-lg text-[13px] transition-colors duration-150 motion-reduce:transition-none",
                    expanded ? "px-3" : "justify-center px-0",
                    active
                      ? "bg-[var(--royal-wash-strong)] font-medium text-foreground"
                      : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                  )}
                >
                  <Icon aria-hidden className="size-[18px]" />
                  {/* Collapsed, the icon is the only thing on screen, so the
                      name still has to be readable by a screen reader. */}
                  {expanded ? (
                    <span>{room.label}</span>
                  ) : (
                    <span className="sr-only">{room.label}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className={cn(
            "mt-auto flex h-10 items-center gap-3 rounded-lg text-[12px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground",
            expanded ? "px-3" : "justify-center",
          )}
        >
          {expanded ? (
            <PanelLeftClose aria-hidden className="size-[18px]" />
          ) : (
            <ChevronRight aria-hidden className="size-[18px]" />
          )}
          {expanded ? <span>Collapse</span> : <span className="sr-only">Expand navigation</span>}
        </button>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Comms toolbar: 56px, no hero, no destination tabs. */}
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--cloud-line)] bg-card px-4 md:px-6">
          <h1 className="font-display text-[15px] font-semibold tracking-tight">Comms</h1>
          <div className="relative ml-2 hidden min-w-0 flex-1 items-center sm:flex">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-3 size-[18px] text-muted-foreground"
            />
            <input
              value={search}
              onChange={(event) => onSearch(event.target.value)}
              placeholder="Search people, companies or messages"
              aria-label="Search Comms"
              className="h-9 w-full max-w-md rounded-lg border border-border bg-[var(--cloud)] pl-10 pr-3 text-[13px] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={onNewReview}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-[var(--royal)] px-3.5 text-[13px] font-medium text-primary-foreground transition-colors duration-150 hover:opacity-90 motion-reduce:transition-none"
            >
              <Plus aria-hidden className="size-[18px]" />
              New review
            </button>
            <button
              type="button"
              title="Settings — Voice DNA and connections live here"
              className="inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <Settings aria-hidden className="size-[18px]" />
              <span className="sr-only">Settings</span>
            </button>
          </div>
        </header>

        {/* Prototype marker: small, with disclosure. Not a full-width alarm. */}
        <div className="flex shrink-0 items-center gap-2 border-b border-[var(--cloud-line)] bg-card px-4 py-1.5 md:px-6">
          <button
            type="button"
            onClick={() => setNotesOpen((value) => !value)}
            aria-expanded={notesOpen}
            className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <Info aria-hidden className="size-3.5" />
            Prototype · sample data
          </button>
          {notesOpen ? (
            <ul className="ml-2 hidden list-disc gap-4 pl-4 text-[12px] text-muted-foreground lg:flex lg:list-none lg:pl-0">
              {V2_PROTOTYPE_NOTES.slice(0, 2).map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : null}
        </div>
        {notesOpen ? (
          <ul className="shrink-0 space-y-1 border-b border-[var(--cloud-line)] bg-card px-6 pb-2 text-[12px] text-muted-foreground lg:hidden">
            {V2_PROTOTYPE_NOTES.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        ) : null}

        <main className="min-h-0 flex-1 overflow-hidden p-0 md:px-6 md:py-4">{children}</main>
      </div>
    </div>
  );
}

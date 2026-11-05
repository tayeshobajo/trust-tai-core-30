import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronDown, MessageSquare, Link2, AudioLines } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

import { TTButton } from "@/components/tt/primitives";
import { cn } from "@/lib/utils";

export type CommsSection = "conversations" | "drafts" | "history" | "voice" | "integrations";

/** What a new piece of writing is. Carried into the intake as its kind. */
export type NewDraftKind = "message" | "email" | "proposal";

export const NEW_DRAFT_LABEL: Record<NewDraftKind, string> = {
  message: "Message",
  email: "Email",
  proposal: "Proposal",
};

function tabClass(active: boolean) {
  return cn(
    "inline-flex h-11 shrink-0 items-center border-b-2 px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    active
      ? "border-[var(--royal)] font-medium text-foreground"
      : "border-transparent text-muted-foreground hover:border-[var(--cloud-line)] hover:text-foreground",
  );
}

const TABS: { to: string; section: CommsSection; label: string }[] = [
  { to: "/modules/comms/relationships", section: "conversations", label: "Conversations" },
  { to: "/modules/comms/integrations", section: "integrations", label: "Accounts & Connections" },
  { to: "/modules/comms/voice", section: "voice", label: "Voice DNA" },
];

const RECORDS = [
  { to: "/modules/comms/drafts", section: "drafts", label: "Saved writing" },
  { to: "/modules/comms/history", section: "history", label: "Communication records" },
];

function NewDraftMenu({ label = "New Message" }: { label?: string }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const holder = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (!holder.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const start = (kind: NewDraftKind) => {
    setOpen(false);
    void navigate({ to: "/modules/comms/drafts", search: { new: kind } });
  };

  return (
    <div ref={holder} className="relative ml-auto shrink-0 pl-2">
      <TTButton
        size="sm"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {label}
        <ChevronDown className="ml-1 h-4 w-4" aria-hidden />
      </TTButton>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 w-[180px] overflow-hidden rounded-xl border border-border bg-card"
        >
          {(Object.keys(NEW_DRAFT_LABEL) as NewDraftKind[]).map((kind) => (
            <button
              key={kind}
              type="button"
              role="menuitem"
              onClick={() => start(kind)}
              className="block w-full px-3 py-2 text-left text-[13px] text-foreground hover:bg-secondary/60 focus-visible:bg-secondary/60 focus-visible:outline-none"
            >
              {NEW_DRAFT_LABEL[kind]}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** One navigation contract for every Comms route, including legacy links. */
export function CommsTabs({ active }: { active: CommsSection; workspace?: boolean }) {
  const icons = { conversations: MessageSquare, integrations: Link2, voice: AudioLines };
  return (
    <div className="comms-workspace-navigation comms-shared-navigation">
      <nav
        aria-label="Comms sections"
        className="grid grid-cols-[minmax(0,1fr)_auto] items-end border-b border-border"
      >
        <div className="min-w-0 overflow-x-auto">
          <div className="flex w-max min-w-full items-end gap-1 sm:gap-3">
            {TABS.map((tab) => {
              const Icon = icons[tab.section as keyof typeof icons];
              return (
                <Link
                  key={tab.section}
                  to={tab.to}
                  activeOptions={{ exact: true }}
                  aria-current={active === tab.section ? "page" : undefined}
                  className={tabClass(active === tab.section)}
                >
                  <Icon className="mr-2 h-4 w-4" aria-hidden />
                  {tab.label}
                </Link>
              );
            })}
          </div>
        </div>
        <div className="flex items-center gap-2 py-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <TTButton variant="quiet" size="sm" aria-label="More Comms options">
                More
                <ChevronDown className="ml-1 h-4 w-4" aria-hidden />
              </TTButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {RECORDS.map((record) => (
                <DropdownMenuItem key={record.section} asChild>
                  <Link
                    to={record.to}
                    aria-current={active === record.section ? "page" : undefined}
                  >
                    {record.label}
                  </Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <NewDraftMenu />
        </div>
      </nav>
    </div>
  );
}

export function CommsPageHeader({
  title,
  supporting,
  action,
}: {
  title: string;
  supporting?: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="comms-workspace-hero grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4">
      <div className="min-w-0">
        <p className="tt-eyebrow">Comms</p>
        <h1 className="tt-title-page mt-2 text-[28px] sm:text-[32px]">{title}</h1>
        {supporting ? (
          <p className="mt-2 max-w-reading text-sm leading-relaxed text-muted-foreground">
            {supporting}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}

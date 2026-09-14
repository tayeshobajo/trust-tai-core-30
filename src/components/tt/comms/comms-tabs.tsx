/**
 * Comms navigation.
 *
 * Five destinations, agreed with Tai: what needs action, the conversations
 * themselves, the drafts waiting on a review, how we sound, and what we are
 * connected to. Everything else in Comms is reached from inside the work it
 * belongs to, not from a tenth tab.
 *
 * The persistent "New draft" action starts a piece of writing of a stated
 * kind. It never sends anything.
 */

import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";

import { TTButton } from "@/components/tt/primitives";
import { cn } from "@/lib/utils";

export type CommsSection = "dashboard" | "conversations" | "drafts" | "voice" | "integrations";

/** What a new piece of writing is. Carried into the intake as its kind. */
export type NewDraftKind = "message" | "email" | "proposal";

export const NEW_DRAFT_LABEL: Record<NewDraftKind, string> = {
  message: "Message",
  email: "Email",
  proposal: "Proposal",
};

function tabClass(active: boolean) {
  return cn(
    "-mb-px inline-flex h-10 items-center border-b-2 px-3 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    active
      ? "border-[var(--royal)] font-medium text-foreground"
      : "border-transparent text-muted-foreground hover:border-[var(--cloud-line)] hover:text-foreground",
  );
}

const TABS: { to: string; section: CommsSection; label: string }[] = [
  { to: "/modules/comms", section: "dashboard", label: "Dashboard" },
  { to: "/modules/comms/relationships", section: "conversations", label: "Conversations" },
  { to: "/modules/comms/drafts", section: "drafts", label: "Drafts & Reviews" },
  { to: "/modules/comms/voice", section: "voice", label: "Voice DNA" },
  { to: "/modules/comms/integrations", section: "integrations", label: "Connections" },
];

function NewDraftMenu() {
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
    <div ref={holder} className="relative ml-auto">
      <TTButton
        size="sm"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        New draft
        <ChevronDown className="ml-1 h-4 w-4" aria-hidden />
      </TTButton>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 w-[180px] overflow-hidden rounded-lg border border-border bg-background shadow-sm"
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

export function CommsTabs({ active }: { active: CommsSection }) {
  return (
    <nav
      aria-label="Comms sections"
      className="flex flex-wrap items-center gap-5 border-b border-border pb-px"
    >
      {TABS.map((tab) => (
        <Link
          key={tab.section}
          to={tab.to}
          aria-current={active === tab.section ? "page" : undefined}
          className={tabClass(active === tab.section)}
        >
          {tab.label}
        </Link>
      ))}
      <NewDraftMenu />
    </nav>
  );
}

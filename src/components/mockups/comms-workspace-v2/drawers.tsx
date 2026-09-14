/**
 * MOCKUP ONLY — right-hand drawers: relationship memory and source context.
 * Local state only; nothing is fetched, written or sent.
 */

import { X } from "lucide-react";
import type { ReactNode } from "react";

import type { V2SourceFile, V2Thread } from "@/data/mockups/comms-workspace-v2";

function Drawer({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <aside
      aria-label={title}
      className="absolute inset-y-0 right-0 z-20 flex w-full max-w-[380px] flex-col border-l border-border bg-card shadow-card"
    >
      <div className="flex items-start gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <h2 className="font-display text-[15px] font-semibold">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-[12px] text-muted-foreground">{subtitle}</p> : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <X aria-hidden className="size-[18px]" />
          <span className="sr-only">Close</span>
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
    </aside>
  );
}

export function RelationshipDrawer({
  thread,
  onClose,
  onKeepForLater,
  opportunityKept,
}: {
  thread: V2Thread;
  onClose: () => void;
  onKeepForLater: () => void;
  opportunityKept: boolean;
}) {
  return (
    <Drawer title={thread.person} subtitle={`${thread.title} · ${thread.company}`} onClose={onClose}>
      <p className="text-[13px] text-muted-foreground">{thread.email}</p>

      <h3 className="mt-5 text-[12px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        What we know
      </h3>
      <ul className="mt-2 space-y-3">
        {thread.memory.map((entry) => (
          <li key={entry.fact} className="border-b border-border pb-3 last:border-0">
            <p className="text-[14px] leading-relaxed">{entry.fact}</p>
            <p className="mt-1 text-[12px] text-muted-foreground">
              {entry.source} · {entry.at}
            </p>
          </li>
        ))}
      </ul>

      {thread.opportunity ? (
        <div className="mt-5">
          <h3 className="text-[12px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
            Private opportunity · not in the client draft
          </h3>
          <p className="mt-2 text-[14px] leading-relaxed">{thread.opportunity.observation}</p>
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">Hypothesis.</span>{" "}
            {thread.opportunity.hypothesis}
          </p>
          <p className="mt-1 text-[12px] text-muted-foreground">{thread.opportunity.timing}</p>
          <button
            type="button"
            onClick={onKeepForLater}
            disabled={opportunityKept}
            className="mt-3 inline-flex h-9 items-center rounded-lg border border-border px-3.5 text-[13px] transition-colors hover:border-[var(--royal)] disabled:opacity-60"
          >
            {opportunityKept ? "Kept for later" : "Keep for later"}
          </button>
        </div>
      ) : null}

      <div className="mt-6 border-t border-border pt-4">
        <button
          type="button"
          className="text-[13px] text-muted-foreground transition-colors hover:text-foreground"
        >
          Save to Scout
        </button>
        <p className="mt-1 text-[12px] text-muted-foreground">
          A contextual action on this person. Simulated here.
        </p>
      </div>
    </Drawer>
  );
}

export function ContextDrawer({
  thread,
  files,
  onClose,
}: {
  thread: V2Thread;
  files: V2SourceFile[];
  onClose: () => void;
}) {
  return (
    <Drawer title="Source material" subtitle="What this review was judged against" onClose={onClose}>
      {thread.messages.map((message) => (
        <article key={message.id} className="border-b border-border pb-4 last:border-0">
          <p className="text-[12px] text-muted-foreground">
            {message.author} · {message.at}
          </p>
          <p className="mt-1.5 whitespace-pre-line text-[15px] leading-relaxed">{message.body}</p>
        </article>
      ))}

      {files.length ? (
        <>
          <h3 className="mt-5 text-[12px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
            Context files · never sent
          </h3>
          <ul className="mt-2 space-y-2">
            {files.map((file) => (
              <li key={file.id} className="border-b border-border pb-2 last:border-0">
                <p className="text-[13px] font-medium">
                  {file.name}{" "}
                  <span className="font-normal text-muted-foreground">· {file.size}</span>
                </p>
                <p
                  className={
                    file.status === "unread"
                      ? "mt-0.5 text-[12px] text-[var(--danger)]"
                      : "mt-0.5 text-[12px] text-muted-foreground"
                  }
                >
                  {file.note}
                </p>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </Drawer>
  );
}

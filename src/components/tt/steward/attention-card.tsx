/**
 * One thing that earned a person's attention.
 *
 * The card leads with the work and the reason, and keeps everything else
 * behind "Why this?" — evidence, who is waiting, and which canonical record it
 * rests on. No scores, no colour theatre, no counters.
 */

import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { MetaPill, TTButton } from "@/components/tt/primitives";
import { TRUTH_TIER_LABEL } from "@/domain/signals";
import { JUDGMENT_STATE_LABEL, type AttentionItem } from "@/domain/steward-judgment";

const APP_LABEL: Record<string, string> = {
  steward: "Steward",
  projects: "Projects",
  comms: "Comms",
  ops: "Ops",
};

export function AttentionCard({
  item,
  actions,
}: {
  item: AttentionItem;
  actions?: ReactNode;
}) {
  return (
    <li className="tt-surface p-6">
      <div className="flex flex-wrap items-center gap-2">
        <MetaPill>{JUDGMENT_STATE_LABEL[item.state]}</MetaPill>
        {item.waitingOn ? <MetaPill>Waiting: {item.waitingOn.name}</MetaPill> : null}
        {item.sourceApps.map((appId) => (
          <MetaPill key={appId}>{APP_LABEL[appId] ?? appId}</MetaPill>
        ))}
      </div>

      <p className="mt-3 max-w-reading text-[15px] text-foreground">{item.headline}</p>
      <p className="mt-2 max-w-reading text-sm text-muted-foreground">
        <span className="text-foreground">Why now.</span> {item.whyNow}
      </p>
      {item.nextMove ? (
        <p className="mt-2 max-w-reading text-sm text-muted-foreground">
          <span className="text-foreground">Next move.</span> {item.nextMove}
        </p>
      ) : null}

      <details className="group mt-3">
        <summary className="cursor-pointer list-none font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground transition-colors hover:text-foreground">
          <span className="group-open:hidden">Why this? →</span>
          <span className="hidden group-open:inline">Hide</span>
        </summary>
        <div className="mt-3 space-y-3 border-l border-border pl-4">
          <p className="text-[13px] text-muted-foreground">
            {TRUTH_TIER_LABEL[item.tier]} truth
            {item.changedAt ? ` · last change ${item.changedAt.slice(0, 10)}` : ""}.
            {item.waitingOn ? ` ${item.waitingOn.name} is affected.` : ""}
          </p>
          <ul className="space-y-1">
            {item.evidence.map((ref, index) => (
              <li key={index} className="text-[13px] text-muted-foreground">
                {ref.url ? (
                  <a
                    href={ref.url}
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-4 hover:text-foreground"
                  >
                    {ref.label}
                  </a>
                ) : (
                  ref.label
                )}
              </li>
            ))}
          </ul>
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {[
              item.refs.commitmentId ? "Commitment" : null,
              item.refs.projectId ? "Project" : null,
              item.refs.conversationId ? "Conversation" : null,
              item.refs.relationshipId ? "Relationship" : null,
              item.refs.opsChainKey ? "Ops run" : null,
            ]
              .filter(Boolean)
              .join(" · ") || "Canonical record"}
          </p>
        </div>
      </details>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
        {item.refs.conversationId ? (
          <TTButton asChild variant="secondary">
            <Link
              to="/modules/steward/meetings/$conversationId"
              params={{ conversationId: item.refs.conversationId }}
            >
              Read the conversation
            </Link>
          </TTButton>
        ) : null}
        <TTButton asChild variant="secondary">
          <Link to={item.destination.route}>{item.destination.label}</Link>
        </TTButton>
        {actions}
      </div>
    </li>
  );
}

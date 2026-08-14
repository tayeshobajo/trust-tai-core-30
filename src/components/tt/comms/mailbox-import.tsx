/**
 * Mailbox import.
 *
 * One quiet list of people you already correspond with, so a real relationship
 * can exist in Comms without typing it out. Reading is explicit, nothing is
 * imported until you choose a person, and anyone already tracked is shown as
 * such rather than hidden.
 */

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";

import { TTButton } from "@/components/tt/primitives";
import { gmailCandidates, type MailboxCandidate } from "@/data/supabase/comms-gmail";
import type { RelationshipInput } from "@/data/supabase/comms-service";

function domainOf(email: string): string | undefined {
  const host = email.split("@")[1];
  if (!host) return undefined;
  const base = host.replace(/^www\./, "").split(".")[0];
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : undefined;
}

export function MailboxImport({
  organizationId,
  onImport,
  busy,
}: {
  organizationId: string;
  onImport: (input: RelationshipInput) => void;
  busy?: boolean;
}) {
  const [candidates, setCandidates] = useState<MailboxCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const read = useMutation({
    mutationFn: () => gmailCandidates(organizationId),
    onSuccess: (result) => {
      setError(null);
      setCandidates(result.candidates);
    },
    onError: (failure: unknown) =>
      setError(failure instanceof Error ? failure.message : "That read failed."),
  });

  return (
    <div className="border-t border-border pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="tt-eyebrow">Or import from your mailbox</p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Reads recent message metadata only. Nothing is imported until you pick someone.
          </p>
        </div>
        <TTButton
          type="button"
          variant="quiet"
          onClick={() => read.mutate()}
          disabled={read.isPending}
        >
          {read.isPending ? "Reading" : candidates ? "Read again" : "Show people"}
        </TTButton>
      </div>

      {error ? <p className="mt-3 text-[13px] text-destructive">{error}</p> : null}

      {candidates && candidates.length === 0 ? (
        <p className="mt-3 text-[13px] text-muted-foreground">
          No recent correspondents were found in that window.
        </p>
      ) : null}

      {candidates && candidates.length > 0 ? (
        <ul className="mt-4 divide-y divide-border border-y border-border">
          {candidates.map((candidate) => (
            <li
              key={candidate.email}
              className="flex flex-wrap items-center justify-between gap-3 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-[14px] text-foreground">
                  {candidate.name || candidate.email}
                </p>
                <p className="truncate font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  {candidate.email} · {candidate.messageCount} message
                  {candidate.messageCount === 1 ? "" : "s"}
                </p>
              </div>
              {candidate.alreadyTracked ? (
                <span className="tt-eyebrow text-muted-foreground">Already in Comms</span>
              ) : (
                <TTButton
                  type="button"
                  variant="quiet"
                  disabled={busy}
                  onClick={() =>
                    onImport({
                      fullName: candidate.name || candidate.email,
                      email: candidate.email,
                      ...(domainOf(candidate.email)
                        ? { companyName: domainOf(candidate.email) }
                        : {}),
                      ...(candidate.lastSubject
                        ? { note: `Last thread: ${candidate.lastSubject}` }
                        : {}),
                      source: "inbound",
                      stage: "new",
                    })
                  }
                >
                  Add to Comms
                </TTButton>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

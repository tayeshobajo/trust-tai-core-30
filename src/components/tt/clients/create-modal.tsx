/**
 * Add a client, by hand.
 *
 * Small input: a name. Everything else is optional, and no amount is ever
 * guessed. A company can be added with no tier at all. A client created in
 * Build must carry the phase amount a person actually agreed, because that
 * amount is recognised revenue on the day it is entered; only a Run client
 * carries a recurring monthly value.
 *
 * Nothing else is started here. No roadmap, no project, no message. Those
 * begin in their own rooms, from the client's page, when a person decides.
 */

import { useState } from "react";

import { TTButton, TTField, TTInput } from "@/components/tt/primitives";
import { localDayStart } from "@/domain/business-week";
import { CLIENT_TIER_LABELS, type ClientTier } from "@/domain/commercial";
import { validateNewClient, type NewClientInput } from "@/domain/clients-book";

/** Neutral first, then the commercial tiers in the order an engagement grows. */
const TIER_CHOICES: ClientTier[] = ["none", "diagnose", "build", "run"];

function dollarsToCents(value: string): number | null {
  const cleaned = value.replace(/[$,\s]/g, "");
  if (!cleaned) return null;
  const amount = Number(cleaned);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return Math.round(amount * 100);
}

export function CreateClientModal({
  open,
  pending,
  timeZone,
  onClose,
  onCreate,
}: {
  open: boolean;
  pending: boolean;
  /** The organization's zone. A date typed here is a day in that zone. */
  timeZone: string;
  onClose: () => void;
  onCreate: (input: NewClientInput) => void;
}) {
  const [name, setName] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [tier, setTier] = useState<ClientTier>("none");
  const [mrr, setMrr] = useState("");
  const [phaseAmount, setPhaseAmount] = useState("");
  const [nextReview, setNextReview] = useState("");
  const [renewal, setRenewal] = useState("");
  const [problems, setProblems] = useState<string[]>([]);

  if (!open) return null;

  function submit() {
    const found: string[] = [];
    const reviewIso = nextReview ? localDayStart(nextReview, timeZone) : null;
    const renewalIso = renewal ? localDayStart(renewal, timeZone) : null;
    if (nextReview && !reviewIso) found.push("The next review date could not be read.");
    if (renewal && !renewalIso) found.push("The renewal date could not be read.");

    const input: NewClientInput = {
      name,
      websiteUrl: websiteUrl.trim() || null,
      logoUrl: logoUrl.trim() || null,
      tier,
      mrrCents: tier === "run" ? dollarsToCents(mrr) : null,
      buildPhaseAmountCents: tier === "build" ? dollarsToCents(phaseAmount) : null,
      nextReviewAt: reviewIso,
      renewalAt: renewalIso,
    };
    found.push(...validateNewClient(input));
    setProblems(found);
    if (found.length === 0) onCreate(input);
  }

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-ink/40 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add a client"
        className="tt-surface tt-rise mt-16 w-full max-w-lg p-6"
      >
        <h2 className="text-lg font-semibold tracking-tight text-foreground">Add client</h2>
        <p className="mt-1 max-w-reading text-sm text-muted-foreground">
          Only what you already know. Nothing here is inferred, and every amount is the one you
          type.
        </p>

        <div className="mt-5 space-y-4">
          <TTField label="Company name">
            <TTInput
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Northlight Systems"
              autoFocus
            />
          </TTField>

          <div className="grid gap-4 sm:grid-cols-2">
            <TTField label="Website" optional>
              <TTInput
                value={websiteUrl}
                onChange={(event) => setWebsiteUrl(event.target.value)}
                placeholder="https://"
                inputMode="url"
              />
            </TTField>
            <TTField label="Logo" optional hint="A full image address. Otherwise initials are shown.">
              <TTInput
                value={logoUrl}
                onChange={(event) => setLogoUrl(event.target.value)}
                placeholder="https://"
                inputMode="url"
              />
            </TTField>
          </div>

          <TTField label="Tier" hint="Leave as No tier until an engagement is agreed.">
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Tier">
              {TIER_CHOICES.map((candidate) => (
                <button
                  key={candidate}
                  type="button"
                  role="radio"
                  onClick={() => setTier(candidate)}
                  aria-checked={tier === candidate}
                  className={
                    tier === candidate
                      ? "rounded-full bg-royal px-4 py-2 text-[13px] text-primary-foreground"
                      : "rounded-full border border-border px-4 py-2 text-[13px] text-muted-foreground hover:text-foreground"
                  }
                >
                  {CLIENT_TIER_LABELS[candidate]}
                </button>
              ))}
            </div>
          </TTField>

          {tier === "run" ? (
            <TTField label="Monthly value" hint="Recurring, in dollars. Leave empty if not agreed yet.">
              <TTInput
                value={mrr}
                onChange={(event) => setMrr(event.target.value)}
                placeholder="3,500"
                inputMode="decimal"
              />
            </TTField>
          ) : null}

          {tier === "build" ? (
            <TTField
              label="Agreed phase amount"
              hint="One-off, in dollars. Required: it is recognised as revenue on today's date."
            >
              <TTInput
                value={phaseAmount}
                onChange={(event) => setPhaseAmount(event.target.value)}
                placeholder="12,000"
                inputMode="decimal"
              />
            </TTField>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <TTField label="Next review" optional>
              <TTInput
                type="date"
                value={nextReview}
                onChange={(event) => setNextReview(event.target.value)}
              />
            </TTField>
            <TTField label="Renews" optional>
              <TTInput
                type="date"
                value={renewal}
                onChange={(event) => setRenewal(event.target.value)}
              />
            </TTField>
          </div>
        </div>

        {problems.length > 0 ? (
          <ul className="mt-4 space-y-1 rounded-lg border border-warning/30 bg-warning/8 p-3 text-[13px] text-foreground">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        ) : null}

        <p className="mt-5 text-[13px] text-muted-foreground">
          This records the company only. A roadmap, a project or a first message starts from the
          client's page, when you choose.
        </p>

        <div className="mt-4 flex justify-end gap-2">
          <TTButton variant="quiet" onClick={onClose} type="button">
            Cancel
          </TTButton>
          <TTButton onClick={submit} type="button" pending={pending} pendingLabel="Adding">
            Add client
          </TTButton>
        </div>
      </div>
    </div>
  );
}

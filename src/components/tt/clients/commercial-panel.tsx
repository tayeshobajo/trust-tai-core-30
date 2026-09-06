/**
 * The human path into a company's commercial state.
 *
 * A person types the tier, the recurring amount, the dates and the reason.
 * Nothing here is derived, suggested or filled in by the system: a blank field
 * is blank, and the reason is kept with the record so the fact can be traced
 * back to the person who said it.
 */

import { useEffect, useState } from "react";

import { SectionHeading, TTButton, TTCard, TTField, TTInput } from "@/components/tt/primitives";
import {
  commercialFormFrom,
  readCommercialForm,
  type CommercialFormCurrent,
  type CommercialFormInput,
  type CommercialFormPatch,
} from "@/domain/client-commercial-form";
import { CLIENT_TIERS, CLIENT_TIER_LABELS } from "@/domain/commercial";

export interface CommercialPanelProps {
  current: CommercialFormCurrent;
  /** Who last said this, already resolved, so nothing is guessed here. */
  provenance: { by: string | null; at: string | null; because: string | null };
  pending: boolean;
  problem: string | null;
  saved: boolean;
  onSave: (patch: CommercialFormPatch) => void;
}

export function CommercialPanel({
  current,
  provenance,
  pending,
  problem,
  saved,
  onSave,
}: CommercialPanelProps) {
  const [form, setForm] = useState<CommercialFormInput>(() => commercialFormFrom(current));
  const [refusal, setRefusal] = useState<string | null>(null);

  /* When the stored truth changes, the form follows it rather than the other way round. */
  useEffect(() => {
    setForm(commercialFormFrom(current));
    setRefusal(null);
  }, [current.tier, current.mrrCents, current.renewalAt, current.nextReviewAt]);

  const movingIntoBuild = form.tier === "build" && current.tier !== "build";
  const set = (key: keyof CommercialFormInput) => (value: string) =>
    setForm((previous) => ({ ...previous, [key]: value }));

  return (
    <TTCard className="p-6">
      <SectionHeading
        title="Commercial state"
        description="Entered by a person. Nothing here is inferred from a document, a message or a model."
      />

      <form
        className="mt-5 space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          const result = readCommercialForm(form, current);
          if (!result.ok) {
            setRefusal(result.because);
            return;
          }
          setRefusal(null);
          onSave(result.patch);
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <TTField label="Tier">
            <select
              value={form.tier}
              onChange={(event) => set("tier")(event.target.value)}
              className="h-12 w-full rounded-lg border border-input bg-card px-4 text-sm text-foreground"
            >
              {CLIENT_TIERS.map((tier) => (
                <option key={tier} value={tier}>
                  {CLIENT_TIER_LABELS[tier]}
                </option>
              ))}
            </select>
          </TTField>

          <TTField label="Monthly recurring" hint="In whole currency, like 3500. Leave blank if none." optional>
            <TTInput
              inputMode="decimal"
              value={form.mrr}
              placeholder="Not set"
              onChange={(event) => set("mrr")(event.target.value)}
            />
          </TTField>

          <TTField label="Renewal date" optional>
            <TTInput
              type="date"
              value={form.renewalAt}
              onChange={(event) => set("renewalAt")(event.target.value)}
            />
          </TTField>

          <TTField label="Next review date" optional>
            <TTInput
              type="date"
              value={form.nextReviewAt}
              onChange={(event) => set("nextReviewAt")(event.target.value)}
            />
          </TTField>

          {movingIntoBuild ? (
            <TTField
              label="Build phase amount"
              hint="The one-off amount a person actually agreed. Required to move into Build."
            >
              <TTInput
                inputMode="decimal"
                value={form.buildPhaseAmount}
                onChange={(event) => set("buildPhaseAmount")(event.target.value)}
              />
            </TTField>
          ) : null}
        </div>

        <TTField label="Why this is true" hint="Kept with the record as the reason a person gave.">
          <TTInput
            value={form.because}
            placeholder="Signed retainer agreed on the call"
            onChange={(event) => set("because")(event.target.value)}
          />
        </TTField>

        {refusal ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {refusal}
          </p>
        ) : null}
        {problem ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {problem}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <TTButton type="submit" pending={pending} pendingLabel="Recording">
            Record commercial state
          </TTButton>
          {saved && !pending ? (
            <span className="text-sm text-muted-foreground">Recorded.</span>
          ) : null}
        </div>
      </form>

      <p className="mt-5 text-xs text-muted-foreground">
        {provenance.at
          ? `Last recorded ${provenance.at.slice(0, 10)}${provenance.by ? ` by ${provenance.by}` : ""}${
              provenance.because ? `. Reason given: ${provenance.because}` : "."
            }`
          : "No commercial state has been recorded for this company yet."}
      </p>
    </TTCard>
  );
}

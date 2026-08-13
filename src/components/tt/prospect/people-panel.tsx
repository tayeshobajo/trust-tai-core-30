/**
 * People — who carries this company, and can we reach them.
 *
 * Three things are kept visually apart and never blended: what a public page
 * said, what a provider asserted, and what a Trust Tai member confirmed. An
 * unverified address is never shown as reachable.
 */

import { useState } from "react";

import { TTButton } from "@/components/tt/primitives";
import {
  CONFIDENCE_LABEL,
  EMAIL_STATUS_LABEL,
  SENIORITY_LABEL,
  isCommsReady,
  isDecisionMaker,
  type Person,
  type PeopleProviderInfo,
  type Seniority,
} from "@/domain/people";
import type { FitCriterion } from "@/domain/scout-fit";
import type { PersonPlan } from "@/domain/scout-intel";
import { cn } from "@/lib/utils";

import { CriterionRow, Disclosure, Panel, TierTag } from "./panel";
import { PersonProvenance } from "./person-provenance";

export interface ManualPersonForm {
  fullName: string;
  roleTitle: string;
  seniority: Seniority;
  email: string;
  linkedinUrl: string;
}

const EMPTY_FORM: ManualPersonForm = {
  fullName: "",
  roleTitle: "",
  seniority: "other",
  email: "",
  linkedinUrl: "",
};

function EmailLine({ person }: { person: Person }) {
  if (!person.email) {
    return (
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        No business email on record
      </p>
    );
  }
  const verified = person.emailStatus === "verified";
  const bad = person.emailStatus === "invalid" || person.emailStatus === "bounced";
  return (
    <p className="flex flex-wrap items-baseline gap-2 text-[13px]">
      <span className="text-foreground">{person.email}</span>
      <span
        className={cn(
          "font-mono text-[10px] uppercase tracking-[0.14em]",
          verified ? "text-success" : bad ? "text-destructive" : "text-warning",
        )}
      >
        {EMAIL_STATUS_LABEL[person.emailStatus]}
      </span>
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {person.emailCheckedAt
          ? `checked ${checkedAgo(person.emailCheckedAt)}${person.emailCheckedBy ? ` by ${person.emailCheckedBy}` : ""}`
          : "never checked"}
      </span>
    </p>
  );
}

/** Plain-language age of the last check. Precision nobody needs is noise. */
function checkedAgo(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (Number.isNaN(days)) return "at an unknown time";
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? "" : "s"} ago`;
}

function PersonRow({
  person,
  onConfirmEmail,
  busy,
}: {
  person: Person;
  onConfirmEmail: (person: Person) => void;
  busy?: boolean | undefined;
}) {
  return (
    <li className="border-b border-border pb-4 last:border-b-0 last:pb-0">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-foreground">
            {person.fullName}
            {isDecisionMaker(person) ? (
              <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.14em] text-royal">
                decides
              </span>
            ) : null}
          </p>
          <p className="text-[13px] text-muted-foreground">
            {person.roleTitle ?? "Role not stated"} · {SENIORITY_LABEL[person.seniority]}
          </p>
        </div>
        <TierTag
          tier={
            person.confidence === "human_confirmed"
              ? "decision"
              : person.confidence === "inferred"
                ? "inference"
                : "fact"
          }
        />
      </div>

      <div className="mt-2 space-y-1.5">
        <EmailLine person={person} />
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {CONFIDENCE_LABEL[person.confidence]} · {person.sourceId.replace(/-/g, " ")}
          {isCommsReady(person) ? " · comms ready" : ""}
        </p>
        {person.sourceUrl ? (
          <a
            href={person.sourceUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground underline decoration-border underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            why we think this
          </a>
        ) : null}
        {person.linkedinUrl ? (
          <a
            href={person.linkedinUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground underline decoration-border underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            profile link
          </a>
        ) : null}
        <PersonProvenance person={person} />
      </div>

      {person.email && person.emailStatus !== "verified" ? (
        <TTButton
          variant="quiet"
          size="sm"
          className="mt-2 -ml-3"
          disabled={busy}
          onClick={() => onConfirmEmail(person)}
        >
          Confirm this address
        </TTButton>
      ) : null}
    </li>
  );
}

export function PeoplePanel({
  criteria,
  people,
  providers,
  availableProviders,
  onIngest,
  onAddManual,
  onConfirmEmail,
  busy,
  note,
  plan,
}: {
  criteria: FitCriterion[];
  people: Person[];
  providers: PeopleProviderInfo[];
  availableProviders: string[];
  onIngest: (providerId: string) => void;
  onAddManual: (form: ManualPersonForm) => void;
  onConfirmEmail: (person: Person) => void;
  busy?: boolean | undefined;
  note?: string | undefined;
  /** Who to approach first, and why. Computed, never provider-ordered. */
  plan?: PersonPlan | undefined;
}) {
  const [form, setForm] = useState<ManualPersonForm>(EMPTY_FORM);
  const reachable = people.some((person) => isCommsReady(person));

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.fullName.trim()) return;
    onAddManual(form);
    setForm(EMPTY_FORM);
  };

  return (
    <Panel
      eyebrow="Who carries what"
      title="People and reachability"
      description="Only what an approved source returned or a person entered. Nothing here is invented, and an unverified address is never treated as reachable."
      aside={<TierTag tier={reachable ? "decision" : "fact"} />}
    >
      <div className="space-y-6">
        {plan?.primary ? (
          <div className="rounded-lg border border-royal/30 bg-background px-4 py-3">
            <p className="tt-eyebrow">Approach first</p>
            <p className="mt-1 text-[13px] font-medium text-foreground">
              {plan.primary.fullName}
              {plan.primary.roleTitle ? `, ${plan.primary.roleTitle}` : ""}
            </p>
            <p className="mt-1 text-[13px] text-muted-foreground">{plan.primary.why}</p>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {plan.primary.routeNote}
            </p>
            {plan.gap ? (
              <p className="mt-2 text-[13px] text-muted-foreground">{plan.gap}</p>
            ) : null}
          </div>
        ) : null}

        {people.length > 0 ? (
          <ul className="space-y-4">
            {people.map((person) => (
              <PersonRow
                key={person.id}
                person={person}
                onConfirmEmail={onConfirmEmail}
                busy={busy}
              />
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-muted-foreground">
            No people are on record for this company yet. Ingest from an approved source, or
            add the person you already know.
          </p>
        )}

        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {reachable
            ? "A named decision maker with a verified address is on record."
            : "No verified business email is on record yet."}
        </p>

        <div className="flex flex-wrap gap-2">
          {providers
            .filter((provider) => provider.approved && provider.kind !== "manual")
            .map((provider) => {
              const ready = availableProviders.includes(provider.id);
              return (
                <TTButton
                  key={provider.id}
                  variant="secondary"
                  size="sm"
                  disabled={busy || !ready}
                  title={ready ? provider.description : `${provider.label} is not connected yet.`}
                  onClick={() => onIngest(provider.id)}
                >
                  {ready ? `Ingest from ${provider.label}` : `${provider.label} — not connected`}
                </TTButton>
              );
            })}
        </div>

        {note ? <p className="text-[13px] text-muted-foreground">{note}</p> : null}

        <Disclosure summary="Add a person by hand">
          <form className="space-y-3" onSubmit={submit}>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-[13px]">
                <span className="tt-eyebrow">Full name</span>
                <input
                  required
                  value={form.fullName}
                  onChange={(event) => setForm({ ...form, fullName: event.target.value })}
                  className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>
              <label className="block text-[13px]">
                <span className="tt-eyebrow">Role</span>
                <input
                  value={form.roleTitle}
                  onChange={(event) => setForm({ ...form, roleTitle: event.target.value })}
                  className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>
              <label className="block text-[13px]">
                <span className="tt-eyebrow">Seniority</span>
                <select
                  value={form.seniority}
                  onChange={(event) =>
                    setForm({ ...form, seniority: event.target.value as Seniority })
                  }
                  className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {Object.entries(SENIORITY_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-[13px]">
                <span className="tt-eyebrow">Business email</span>
                <input
                  type="email"
                  value={form.email}
                  onChange={(event) => setForm({ ...form, email: event.target.value })}
                  className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>
              <label className="block text-[13px] sm:col-span-2">
                <span className="tt-eyebrow">Profile link (optional)</span>
                <input
                  type="url"
                  value={form.linkedinUrl}
                  onChange={(event) => setForm({ ...form, linkedinUrl: event.target.value })}
                  className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>
            </div>
            <p className="text-[13px] text-muted-foreground">
              A person you add is treated as confirmed by a human, and no later provider run
              overwrites it.
            </p>
            <TTButton type="submit" size="sm" disabled={busy}>
              Save person
            </TTButton>
          </form>
        </Disclosure>

        {criteria.length > 0 ? (
          <Disclosure summary="What the website said about decision makers">
            <ul className="space-y-4">
              {criteria.map((criterion) => (
                <CriterionRow key={criterion.key} criterion={criterion} />
              ))}
            </ul>
          </Disclosure>
        ) : null}
      </div>
    </Panel>
  );
}

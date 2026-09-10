/**
 * People, who carries this company, and can we reach them.
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
  isReachable,
  isCommsReady,
  isDecisionMaker,
  type Person,
  type PeopleProviderInfo,
  type Seniority,
} from "@/domain/people";
import type { KnownAddress } from "@/domain/email-pattern";
import type { FitCriterion } from "@/domain/scout-fit";
import type { PersonPlan } from "@/domain/scout-intel";
import type { RouteInput, RouteLookupCandidate } from "@/data/supabase/people-service";
import { cn } from "@/lib/utils";

import { CriterionRow, Disclosure, Panel, TierTag } from "./panel";
import { PersonProvenance } from "./person-provenance";
import { suggestRouteEmail } from "./route-email-suggestion";

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

/** What a member types to put a route on somebody already on record. */
interface RouteForm {
  personId: string;
  email: string;
  emailConfirmed: boolean;
  linkedinUrl: string;
  linkedinConfirmed: boolean;
}

const EMPTY_ROUTE: RouteForm = {
  personId: "",
  email: "",
  emailConfirmed: false,
  linkedinUrl: "",
  linkedinConfirmed: false,
};

const FIELD_CLASS =
  "mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

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
  onConfirmLinkedin,
  busy,
}: {
  person: Person;
  onConfirmEmail: (person: Person) => void;
  onConfirmLinkedin?: ((person: Person) => void) | undefined;
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
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={person.linkedinUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground underline decoration-border underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {person.linkedinConfirmed ? "confirmed LinkedIn route" : "LinkedIn link on record"}
            </a>
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {person.linkedinCheckedAt
                ? `checked ${checkedAgo(person.linkedinCheckedAt)}`
                : person.linkedinConfirmed
                  ? "confirmed"
                  : "unconfirmed"}
            </span>
          </div>
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

      {person.linkedinUrl && !person.linkedinConfirmed && onConfirmLinkedin ? (
        <TTButton
          variant="quiet"
          size="sm"
          className="mt-2 -ml-3"
          disabled={busy}
          onClick={() => onConfirmLinkedin(person)}
        >
          Confirm this LinkedIn route
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
  onConfirmLinkedin,
  onLookupLinkedin,
  onSetRoute,
  routeError,
  addedNotice,
  busy,
  note,
  plan,
  lookupTarget,
  lookupCandidates,
  lookupPending,
  lookupError,
  lookupNoMatchReason,
  companyDomain,
  knownAddresses,
}: {
  criteria: FitCriterion[];
  people: Person[];
  providers: PeopleProviderInfo[];
  availableProviders: string[];
  onIngest: (providerId: string) => void;
  onAddManual: (form: ManualPersonForm) => void;
  onConfirmEmail: (person: Person) => void;
  onConfirmLinkedin?: ((person: Person, candidate?: RouteLookupCandidate) => void) | undefined;
  onLookupLinkedin?: ((person: Person) => void) | undefined;
  /** Put an address or a LinkedIn profile on somebody already on record. */
  onSetRoute?: ((person: Person, input: RouteInput) => void) | undefined;
  routeError?: string | null | undefined;
  /** Said after an add lands, so filling gaps on an existing record never
   * looks like a form that did nothing. */
  addedNotice?: string | null | undefined;
  busy?: boolean | undefined;
  note?: string | undefined;
  /** Who to approach first, and why. Computed, never provider-ordered. */
  plan?: PersonPlan | undefined;
  lookupTarget?: Person | null | undefined;
  lookupCandidates?: RouteLookupCandidate[] | undefined;
  lookupPending?: boolean | undefined;
  lookupError?: string | null | undefined;
  /** Fail-closed signal: no candidate cleared the confidence bar. */
  lookupNoMatchReason?: string | null | undefined;
  /** The prospect's own domain, for suggesting an address by naming convention. */
  companyDomain?: string | undefined;
  /** Addresses a human has verified, org-wide. Verified only: an inference
   * built on earlier guesses would launder a guess into corroboration. */
  knownAddresses?: KnownAddress[] | undefined;
}) {
  const [form, setForm] = useState<ManualPersonForm>(EMPTY_FORM);
  const [route, setRoute] = useState<RouteForm>(EMPTY_ROUTE);
  const reachable = people.some((person) => isReachable(person));

  // Only somebody who cannot be reached yet needs a route added by hand.
  const unreachable = people.filter((person) => !isReachable(person));
  const routeTarget = unreachable.find((person) => person.id === route.personId) ?? unreachable[0];
  const routeReady = Boolean(route.email.trim() || route.linkedinUrl.trim());

  // Suggest an address only while the email field is still empty: once a
  // member starts typing, their entry is the one that matters. Never
  // auto-filled, never pre-confirmed.
  const emailSuggestion =
    routeTarget && !route.email.trim()
      ? suggestRouteEmail({
          fullName: routeTarget.fullName,
          companyDomain,
          knownAddresses: knownAddresses ?? [],
        })
      : { kind: "none" as const };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.fullName.trim()) return;
    onAddManual(form);
    setForm(EMPTY_FORM);
  };

  const submitRoute = (event: React.FormEvent) => {
    event.preventDefault();
    if (!onSetRoute || !routeTarget || !routeReady) return;
    onSetRoute(routeTarget, {
      ...(route.email.trim()
        ? { email: route.email.trim(), emailConfirmed: route.emailConfirmed }
        : {}),
      ...(route.linkedinUrl.trim()
        ? { linkedinUrl: route.linkedinUrl.trim(), linkedinConfirmed: route.linkedinConfirmed }
        : {}),
    });
    setRoute(EMPTY_ROUTE);
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
            {plan.gap ? <p className="mt-2 text-[13px] text-muted-foreground">{plan.gap}</p> : null}
          </div>
        ) : null}

        <section
          id="scout-people-discovery"
          tabIndex={-1}
          className="scroll-mt-24 rounded-lg focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-4"
          aria-label="People on record"
        >
          {people.length > 0 ? (
            <ul id="scout-people-role" tabIndex={-1} className="space-y-4 focus:outline-none">
              {people.map((person) => (
                <PersonRow
                  key={person.id}
                  person={person}
                  onConfirmEmail={onConfirmEmail}
                  onConfirmLinkedin={
                    onConfirmLinkedin ? (target) => onConfirmLinkedin(target) : undefined
                  }
                  busy={busy}
                />
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-muted-foreground">
              No people are on record for this company yet. Ingest from an approved source, or add
              the person you already know.
            </p>
          )}
        </section>

        <section
          id="scout-people-blockers"
          tabIndex={-1}
          className="scroll-mt-24 rounded-lg focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-4"
          aria-label="Blockers to resolve"
        >
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {reachable
              ? "A named decision maker with a legitimate route is on record."
              : "No confirmed email or LinkedIn route is on record yet."}
          </p>

          {onSetRoute && routeTarget ? (
            <form
              className="mt-4 space-y-3 rounded-lg border border-border bg-surface-tertiary px-4 py-4"
              onSubmit={submitRoute}
            >
              <div>
                <p className="tt-eyebrow">Add a route</p>
                <p className="mt-1 text-[13px] text-muted-foreground">
                  An address saved without being confirmed stays on record, and cannot be messaged
                  until somebody says it is right. Tick a box below only when you have actually
                  checked.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {unreachable.length > 1 ? (
                  <label className="block text-[13px] sm:col-span-2">
                    <span className="tt-eyebrow">Who this is for</span>
                    <select
                      value={routeTarget.id}
                      onChange={(event) => setRoute({ ...route, personId: event.target.value })}
                      className={FIELD_CLASS}
                    >
                      {unreachable.map((person) => (
                        <option key={person.id} value={person.id}>
                          {person.fullName}
                          {person.roleTitle ? `, ${person.roleTitle}` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <p className="text-[13px] text-foreground sm:col-span-2">
                    For {routeTarget.fullName}
                    {routeTarget.roleTitle ? `, ${routeTarget.roleTitle}` : ""}.
                  </p>
                )}
                <div>
                  <label className="block text-[13px]">
                    <span className="tt-eyebrow">Business email</span>
                    <input
                      type="email"
                      value={route.email}
                      onChange={(event) => setRoute({ ...route, email: event.target.value })}
                      className={FIELD_CLASS}
                    />
                  </label>
                  {emailSuggestion.kind === "suggestion" ? (
                    <div className="mt-2 rounded-md border border-border bg-card p-2.5">
                      <p className="tt-eyebrow">Suggested, not confirmed</p>
                      <p className="mt-1 text-[13px] text-foreground">
                        {emailSuggestion.candidate.email}
                      </p>
                      <p className="mt-1 text-[12px] text-muted-foreground">
                        {emailSuggestion.candidate.rationale}
                      </p>
                      <TTButton
                        type="button"
                        variant="quiet"
                        size="sm"
                        className="mt-1 -ml-3"
                        disabled={busy}
                        onClick={() =>
                          setRoute({
                            ...route,
                            email: emailSuggestion.candidate.email,
                            emailConfirmed: false,
                          })
                        }
                      >
                        Use this guess
                      </TTButton>
                    </div>
                  ) : null}
                  {emailSuggestion.kind === "conflict" ? (
                    <p className="mt-2 text-[12px] text-muted-foreground">
                      No address to suggest: {emailSuggestion.because}
                    </p>
                  ) : null}
                </div>
                <label className="block text-[13px]">
                  <span className="tt-eyebrow">LinkedIn profile URL</span>
                  <input
                    type="url"
                    value={route.linkedinUrl}
                    onChange={(event) => setRoute({ ...route, linkedinUrl: event.target.value })}
                    className={FIELD_CLASS}
                  />
                </label>
              </div>

              <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border bg-card p-2.5">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={route.emailConfirmed}
                  onChange={(event) => setRoute({ ...route, emailConfirmed: event.target.checked })}
                />
                <span>
                  <span className="block text-[13px] text-foreground">
                    I&rsquo;ve checked this address is right
                  </span>
                  <span className="mt-0.5 block text-[12px] text-muted-foreground">
                    Leave this clear and the address is kept, marked unverified, and nothing is sent
                    to it. Guessing here is what gets a sending domain blocked.
                  </span>
                </span>
              </label>

              <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border bg-card p-2.5">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={route.linkedinConfirmed}
                  onChange={(event) =>
                    setRoute({ ...route, linkedinConfirmed: event.target.checked })
                  }
                />
                <span>
                  <span className="block text-[13px] text-foreground">
                    I&rsquo;ve checked this is the right person
                  </span>
                  <span className="mt-0.5 block text-[12px] text-muted-foreground">
                    Leave this clear and the link is kept as a link, not as a route anyone can be
                    approached through.
                  </span>
                </span>
              </label>

              <TTButton type="submit" size="sm" disabled={busy || !routeReady}>
                Save route
              </TTButton>

              {routeError ? <p className="text-[13px] text-destructive">{routeError}</p> : null}
            </form>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
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
                    {ready ? `Ingest from ${provider.label}` : `${provider.label} · not connected`}
                  </TTButton>
                );
              })}
          </div>

          {note ? <p className="mt-4 text-[13px] text-muted-foreground">{note}</p> : null}

          {lookupTarget && onLookupLinkedin ? (
            <div
              id="scout-people-route-lookup"
              tabIndex={-1}
              className="mt-4 scroll-mt-24 rounded-lg border border-border bg-surface-tertiary px-4 py-4 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-4"
            >
              <p className="tt-eyebrow">Contact route search</p>
              <p className="mt-1 text-[13px] text-foreground">
                Look for {lookupTarget.fullName}
                {lookupTarget.roleTitle ? `, ${lookupTarget.roleTitle}` : ""} among the leads
                ZenMode has already found.
              </p>
              <p className="mt-1 text-[13px] text-muted-foreground">
                This searches leads we already hold — it does not go out to LinkedIn, so it only
                finds people a ZenMode campaign has picked up. It suggests candidates only; a person
                still confirms the real profile before it becomes a route.
              </p>
              <div className="mt-3">
                <TTButton
                  size="sm"
                  disabled={busy || lookupPending}
                  onClick={() => onLookupLinkedin(lookupTarget)}
                >
                  {lookupPending ? "Searching leads…" : "Find contact route"}
                </TTButton>
              </div>

              {lookupError ? (
                <p className="mt-3 text-[13px] text-destructive">{lookupError}</p>
              ) : null}

              {lookupNoMatchReason ? (
                <p className="mt-3 rounded-lg border border-border bg-background px-4 py-3 text-[13px] text-foreground">
                  {lookupNoMatchReason}
                </p>
              ) : null}

              {lookupCandidates && lookupCandidates.length > 0 ? (
                <ul className="mt-4 space-y-3">
                  {lookupCandidates.map((candidate, index) => (
                    <li
                      key={candidate.linkedinUrl}
                      className="rounded-lg border border-border bg-background px-4 py-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[13px] font-medium text-foreground">
                            {candidate.fullName}
                            {index === 0 ? (
                              <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.14em] text-royal">
                                best match
                              </span>
                            ) : null}
                            {candidate.degree ? (
                              <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                                {candidate.degree}
                              </span>
                            ) : null}
                          </p>
                          {candidate.headline ? (
                            <p className="text-[13px] text-muted-foreground">
                              {candidate.headline}
                            </p>
                          ) : null}
                          {candidate.company ? (
                            <p className="text-[13px] text-muted-foreground">
                              Current company: {candidate.company}
                            </p>
                          ) : null}
                          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                            {candidate.location ?? "Location unknown"}
                          </p>
                          <a
                            href={candidate.linkedinUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-1 block break-all text-[12px] text-royal underline"
                          >
                            {candidate.linkedinUrl}
                          </a>
                          {candidate.why && candidate.why.length > 0 ? (
                            <p className="mt-2 text-[12px] text-muted-foreground">
                              <span className="font-medium text-foreground">
                                Why this may be the person:
                              </span>{" "}
                              {candidate.why.join(" · ")}
                            </p>
                          ) : null}
                        </div>
                        {onConfirmLinkedin ? (
                          <TTButton
                            size="sm"
                            variant="secondary"
                            disabled={busy}
                            onClick={() => onConfirmLinkedin(lookupTarget, candidate)}
                          >
                            Confirm this profile
                          </TTButton>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </section>

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
            {addedNotice ? (
              <p role="status" aria-live="polite" className="text-[13px] text-foreground">
                {addedNotice}
              </p>
            ) : null}
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

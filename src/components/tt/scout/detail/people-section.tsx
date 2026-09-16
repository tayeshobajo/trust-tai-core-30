/**
 * "People" on a Scout company.
 *
 * Four questions, one compact card: who owns or influences this problem, why
 * each of them matters here, whether there is a professional address we can
 * stand behind, and who should move into Comms.
 *
 * What it never does: show a personal address, show a phone number, or dress
 * up a missing integration as a result.
 */

import { TTButton } from "@/components/tt/primitives";
import {
  BUYING_ROLE_LABEL,
  EMAIL_STALE_AFTER_DAYS,
  EMAIL_STATE_LABEL,
  NOT_CONNECTED_MESSAGE,
  PROVIDER_LABEL,
  canPrepareOutreach,
  forDisplay,
  nextAction,
  planBulkEnrichment,
  recommendPeople,
  workEmailState,
  type ProviderConfigRead,
  type ScoutPerson,
  type WorkEmailState,
} from "@/domain/scout-people";
import { cn } from "@/lib/utils";

import { DetailSection, Empty } from "./parts";

const STATE_TONE: Record<WorkEmailState, string> = {
  verified: "text-success",
  found_unverified: "text-warning",
  stale: "text-warning",
  not_found: "text-muted-foreground",
  not_checked: "text-muted-foreground",
};

function when(value: string | undefined): string {
  if (!value) return "no date recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "no date recorded";
  return date.toLocaleDateString(undefined, { dateStyle: "medium" });
}

export function PeopleSection({
  people,
  config,
  now,
  busyKey,
  error,
  onFindPeople,
  onFindEmail,
  onPrepareOutreach,
  searching,
}: {
  people: ScoutPerson[];
  config: ProviderConfigRead;
  now: string;
  /** The person currently being looked up, if any. */
  busyKey: string | null;
  error: string | null;
  onFindPeople: () => void;
  onFindEmail: (person: ScoutPerson) => void;
  onPrepareOutreach: (person: ScoutPerson) => void;
  searching: boolean;
}) {
  const connected = planBulkEnrichment(1, config).provider !== null;
  const { recommended, others } = recommendPeople(people.map(forDisplay));

  return (
    <DetailSection
      title="People"
      meta={recommended.length > 0 ? `${recommended.length} recommended` : "not researched"}
    >
      {!connected ? (
        <div className="rounded-lg border border-border bg-secondary/40 p-4">
          <p className="text-[13px] text-foreground">{NOT_CONNECTED_MESSAGE}</p>
          <TTButton asChild variant="secondary" size="sm" className="mt-3">
            <a href="/settings/integrations">Open integration settings</a>
          </TTButton>
        </div>
      ) : recommended.length === 0 ? (
        <div>
          <p className="text-[13px] text-muted-foreground">
            Scout looks for the people most likely to own or influence this problem.
          </p>
          <TTButton className="mt-3" disabled={searching} onClick={onFindPeople}>
            {searching ? "Looking…" : "Find the right people"}
          </TTButton>
        </div>
      ) : (
        <ul className="space-y-3">
          {recommended.map((person) => {
            const state = workEmailState(person, now);
            const action = nextAction(state);
            const busy = busyKey === person.key;
            return (
              <li key={person.key} className="rounded-lg border border-border bg-background p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[14px] font-medium text-foreground">{person.fullName}</p>
                    <p className="text-[13px] text-muted-foreground">
                      {person.title ?? "Title not recorded"}
                    </p>
                  </div>
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    {BUYING_ROLE_LABEL[person.buyingRole]}
                  </span>
                </div>

                <p className="mt-2 text-[13px] text-foreground">{person.whyThisPerson}</p>

                {person.thoughtLeadership?.summary ? (
                  <p className="mt-2 text-[13px] text-muted-foreground">
                    Publishes on this area · {person.thoughtLeadership.summary}
                    {person.thoughtLeadership.sourceUrl ? (
                      <>
                        {" "}
                        <a
                          className="text-royal underline-offset-4 hover:underline"
                          href={person.thoughtLeadership.sourceUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                        >
                          Source
                        </a>
                      </>
                    ) : null}
                  </p>
                ) : null}

                <p className="mt-2 flex flex-wrap items-baseline gap-2 text-[13px]">
                  {person.workEmail ? (
                    <span className="text-foreground">{person.workEmail}</span>
                  ) : null}
                  <span
                    className={cn(
                      "font-mono text-[10px] uppercase tracking-[0.14em]",
                      STATE_TONE[state],
                    )}
                  >
                    {EMAIL_STATE_LABEL[state]}
                  </span>
                </p>

                <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  {PROVIDER_LABEL[person.provider]} ·{" "}
                  {person.emailVerifiedAt
                    ? `verified ${when(person.emailVerifiedAt)}`
                    : person.emailFetchedAt
                      ? `fetched ${when(person.emailFetchedAt)}`
                      : `found ${when(person.discoveredAt)}`}
                </p>

                {state === "stale" ? (
                  <p className="mt-2 text-[13px] text-warning">
                    Last checked over {EMAIL_STALE_AFTER_DAYS} days ago. The address is kept, and a
                    refresh confirms it is still current.
                  </p>
                ) : null}

                {(person.ambiguousWith ?? []).length > 0 ? (
                  <p className="mt-2 text-[13px] text-muted-foreground">
                    Another record shares this name at this company. They were not merged, so
                    somebody can decide.
                  </p>
                ) : null}

                <div className="mt-3 flex flex-wrap gap-2">
                  {action === "find_email" ? (
                    <TTButton size="sm" disabled={busy} onClick={() => onFindEmail(person)}>
                      {busy ? "Looking…" : "Find email"}
                    </TTButton>
                  ) : null}
                  {action === "refresh" ? (
                    <TTButton
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => onFindEmail(person)}
                    >
                      {busy ? "Checking…" : "Refresh"}
                    </TTButton>
                  ) : null}
                  {canPrepareOutreach(state) ? (
                    <TTButton
                      size="sm"
                      variant={action === "prepare_outreach" ? "primary" : "secondary"}
                      onClick={() => onPrepareOutreach(person)}
                    >
                      Prepare outreach
                    </TTButton>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {others.length > 0 ? (
        <p className="mt-3 text-[13px] text-muted-foreground">
          {others.length} more {others.length === 1 ? "person was" : "people were"} found and kept
          out of the way. The four above are the best supported.
        </p>
      ) : null}

      {recommended.length === 0 && connected && searching ? (
        <Empty>Scout is reading the company for the people who own this problem.</Empty>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 text-[13px] text-destructive">
          {error}
        </p>
      ) : null}
    </DetailSection>
  );
}

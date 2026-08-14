/**
 * Steward — Team.
 *
 * Who carries what, and how each person is standing, derived only from their
 * confirmed promises. No scores, no rankings, no judgement of people.
 */

import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { AppHero } from "@/components/tt/app-hero";
import { AppShell } from "@/components/tt/app-shell";
import { EmptyState, MetaPill } from "@/components/tt/primitives";
import { StewardTabs } from "@/components/tt/steward/steward-tabs";
import { StewardUnavailable } from "@/components/tt/steward/unavailable";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { standingFor } from "@/data/steward/today";
import { stewardService } from "@/data/supabase/steward-service";
import {
  COMMITMENT_STATUS_LABEL,
  PERSON_STANDING_LABEL,
  personKeyOf,
  type Commitment,
} from "@/domain/steward";
import type { WorkspaceIdentity } from "@/lib/workspace";

const TITLE = "Steward — Team — Trust Tai OS";
const DESCRIPTION =
  "Who carries what across Trust Tai, with each person's standing read from their own confirmed promises.";

export const Route = createFileRoute("/modules/steward/team")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: TeamRoute,
});

function TeamRoute() {
  return (
    <WorkspaceGate>
      {(identity) => (
        <AppShell identity={identity}>
          <Team identity={identity} />
        </AppShell>
      )}
    </WorkspaceGate>
  );
}

function Team({ identity }: { identity: WorkspaceIdentity }) {
  const commitments = useQuery({
    queryKey: ["steward", "commitments", identity.organizationId],
    queryFn: () => stewardService.commitments(identity.organizationId),
  });
  const roles = useQuery({
    queryKey: ["steward", "roles", identity.organizationId],
    queryFn: () => stewardService.roleMemory(identity.organizationId),
  });

  const now = new Date().toISOString();
  const byPerson = new Map<string, { name: string; rows: Commitment[] }>();
  for (const commitment of commitments.data ?? []) {
    const key = personKeyOf({ email: commitment.ownerEmail ?? null, name: commitment.ownerName });
    const entry = byPerson.get(key) ?? { name: commitment.ownerName, rows: [] };
    entry.rows.push(commitment);
    byPerson.set(key, entry);
  }
  const people = Array.from(byPerson.entries()).sort((a, b) => a[1].name.localeCompare(b[1].name));

  return (
    <div className="space-y-8">
      <AppHero
        appId="steward"
        eyebrow="Steward · Team"
        title="Who carries what."
        supporting="Standing is read from open promises alone. It describes the work, never the person."
      />

      <StewardTabs active="team" />

      {commitments.isError ? (
        <StewardUnavailable error={commitments.error} />
      ) : commitments.isLoading ? (
        <p className="text-sm text-muted-foreground">Reading who carries what…</p>
      ) : people.length === 0 ? (
        <EmptyState
          title="Nobody is carrying anything yet."
          belongsHere="Once a promise is confirmed from a conversation, the person who made it appears here."
          whyItMatters="Stewardship starts with knowing who holds each thread."
        />
      ) : (
        <ul className="space-y-3">
          {people.map(([key, person]) => {
            const open = person.rows.filter((row) => row.status === "open" || row.status === "waiting");
            const standing = standingFor(open, now);
            const role = (roles.data ?? []).find((entry) => entry.personKey === key);
            return (
              <li key={key} className="tt-surface p-6">
                <div className="flex flex-wrap items-center gap-2">
                  <MetaPill>{PERSON_STANDING_LABEL[standing]}</MetaPill>
                  <MetaPill>{open.length} open</MetaPill>
                  {role?.title ? <MetaPill>{role.title}</MetaPill> : null}
                </div>
                <h2 className="mt-3 font-display text-xl text-foreground">{person.name}</h2>
                {role && role.responsibilities.length > 0 ? (
                  <p className="mt-2 max-w-reading text-sm text-muted-foreground">
                    Carries {role.responsibilities.join(", ")}.
                  </p>
                ) : null}
                <ul className="mt-4 space-y-2 border-t border-border pt-4">
                  {person.rows.slice(0, 6).map((row) => (
                    <li key={row.id} className="text-sm text-foreground">
                      {row.what}
                      <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                        {COMMITMENT_STATUS_LABEL[row.status]}
                        {row.dueAt ? ` · due ${row.dueAt.slice(0, 10)}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

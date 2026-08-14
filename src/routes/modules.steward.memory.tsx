/**
 * Steward — Memory.
 *
 * What Steward believes, where each belief came from, and every correction a
 * person has made. Corrections supersede; nothing is ever deleted.
 */

import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { AppHero } from "@/components/tt/app-hero";
import { AppShell } from "@/components/tt/app-shell";
import { EmptyState, MetaPill } from "@/components/tt/primitives";
import { StewardTabs } from "@/components/tt/steward/steward-tabs";
import { StewardUnavailable } from "@/components/tt/steward/unavailable";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { stewardService } from "@/data/supabase/steward-service";
import { TRUTH_TIER_LABEL } from "@/domain/signals";
import type { WorkspaceIdentity } from "@/lib/workspace";

const TITLE = "Steward — Memory — Trust Tai OS";
const DESCRIPTION =
  "What Steward believes about Trust Tai, what each belief rests on, and every human correction on the record.";

export const Route = createFileRoute("/modules/steward/memory")({
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
  component: MemoryRoute,
});

function MemoryRoute() {
  return (
    <WorkspaceGate>
      {(identity) => (
        <AppShell identity={identity}>
          <Memory identity={identity} />
        </AppShell>
      )}
    </WorkspaceGate>
  );
}

function Memory({ identity }: { identity: WorkspaceIdentity }) {
  const beliefs = useQuery({
    queryKey: ["steward", "beliefs", identity.organizationId],
    queryFn: () => stewardService.beliefs(identity.organizationId),
  });

  const rows = beliefs.data ?? [];
  const superseded = new Set(rows.map((row) => row.supersedesId).filter(Boolean) as string[]);

  return (
    <div className="space-y-8">
      <AppHero
        appId="steward"
        eyebrow="Steward · Memory"
        title="What Steward believes, and why."
        supporting="A human correction always outranks a source. The original stays on the record so the change is visible."
      />

      <StewardTabs active="memory" />

      {beliefs.isError ? (
        <StewardUnavailable error={beliefs.error} />
      ) : beliefs.isLoading ? (
        <p className="text-sm text-muted-foreground">Reading the record…</p>
      ) : rows.length === 0 ? (
        <EmptyState
          title="Steward has not recorded a belief yet."
          belongsHere="Beliefs about people, projects and cadence build up as conversations are read and confirmed."
          whyItMatters="Memory is what lets Steward recommend a next move without asking you to explain the business again."
        />
      ) : (
        <ul className="space-y-3">
          {rows.map((belief) => (
            <li key={belief.id} className="tt-surface p-6">
              <div className="flex flex-wrap items-center gap-2">
                <MetaPill>{TRUTH_TIER_LABEL[belief.tier]}</MetaPill>
                <MetaPill>
                  {belief.authority === "human" ? "Corrected by a person" : "Read from a source"}
                </MetaPill>
                <MetaPill>{belief.subjectLabel}</MetaPill>
                {superseded.has(belief.id) ? <MetaPill>Superseded</MetaPill> : null}
              </div>
              <p className="mt-3 max-w-reading text-[15px] text-foreground">{belief.statement}</p>
              <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {belief.recordedBy} · {belief.recordedAt.slice(0, 10)}
              </p>
              {belief.evidence.length > 0 ? (
                <ul className="mt-3 space-y-1 border-t border-border pt-3">
                  {belief.evidence.map((item, index) => (
                    <li key={index} className="text-[13px] text-muted-foreground">
                      {item.url ? (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                          className="underline underline-offset-4 hover:text-foreground"
                        >
                          {item.label}
                        </a>
                      ) : (
                        item.label
                      )}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

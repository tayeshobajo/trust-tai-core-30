/**
 * Comms → Scout.
 *
 * Sometimes the company arrives through a conversation. A member names the
 * company, the person's title and the role they play, and Scout gets a
 * profile of its own, with provenance saying plainly that a human entered it.
 *
 * The conversation stays where it is. One person, one memory.
 */

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { AppShell } from "@/components/tt/app-shell";
import { CommsTabs } from "@/components/tt/comms/comms-tabs";
import { PageHeader, TTButton, TTInput } from "@/components/tt/primitives";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { saveRelationshipAsProspect } from "@/data/comms-to-scout";
import { commsService } from "@/data/supabase/comms-service";
import type { Relationship } from "@/domain/comms";
import type { WorkspaceIdentity } from "@/lib/workspace";

const TITLE = "Save to Scout · Comms · Trust Tai OS";
const DESCRIPTION =
  "Turn a Comms relationship into a Scout company profile: company, title and role, entered by a person.";

export const Route = createFileRoute("/modules/comms/to-scout")({
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
  component: ToScoutRoute,
});

function ToScoutRoute() {
  return (
    <WorkspaceGate appId="comms">
      {(identity) => (
        <AppShell identity={identity}>
          <ToScout identity={identity} />
        </AppShell>
      )}
    </WorkspaceGate>
  );
}

function ToScout({ identity }: { identity: WorkspaceIdentity }) {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<string>("");
  const [companyName, setCompanyName] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [roleTitle, setRoleTitle] = useState("");
  const [role, setRole] = useState("");

  const relationshipsQuery = useQuery({
    queryKey: ["comms", "relationships", identity.organizationId],
    queryFn: () => commsService.list(identity.organizationId),
  });

  const relationships: Relationship[] = relationshipsQuery.data ?? [];
  const relationship = relationships.find((row) => row.id === selected) ?? null;

  const save = useMutation({
    mutationFn: () => {
      if (!relationship) throw new Error("Choose the person this company belongs to.");
      return saveRelationshipAsProspect({
        organizationId: identity.organizationId,
        userId: identity.userId,
        relationshipId: relationship.id,
        companyName,
        websiteUrl,
        roleTitle,
        role,
      });
    },
    onSuccess: (result) => {
      void navigate({
        to: "/modules/scout/prospects/$prospectId",
        params: { prospectId: result.prospect.id },
        search: { section: "scout" as const, fit: "all" as const },
      });
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Comms"
        title="Save a conversation as a company"
        supporting="Scout holds the company. Comms keeps the conversation. Nothing is duplicated."
      />
      <CommsTabs active="to_scout" />

      <div className="max-w-2xl space-y-5 rounded-xl border border-border bg-background p-5">
        <div>
          <label className="tt-eyebrow" htmlFor="to-scout-person">
            The person
          </label>
          <select
            id="to-scout-person"
            value={selected}
            onChange={(event) => {
              const next = event.target.value;
              setSelected(next);
              const match = relationships.find((row) => row.id === next);
              if (match) {
                setCompanyName(match.companyName ?? "");
              }
            }}
            className="mt-2 h-9 w-full rounded-md border border-border bg-background px-3 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">
              {relationshipsQuery.isLoading ? "Reading Comms…" : "Choose a relationship"}
            </option>
            {relationships.map((row) => (
              <option key={row.id} value={row.id}>
                {row.fullName}
                {row.companyName ? ` · ${row.companyName}` : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="tt-eyebrow" htmlFor="to-scout-company">
              Company
            </label>
            <TTInput
              id="to-scout-company"
              className="mt-2 h-9"
              value={companyName}
              onChange={(event) => setCompanyName(event.target.value)}
              placeholder="Company name"
            />
          </div>
          <div>
            <label className="tt-eyebrow" htmlFor="to-scout-website">
              Website
            </label>
            <TTInput
              id="to-scout-website"
              className="mt-2 h-9"
              value={websiteUrl}
              onChange={(event) => setWebsiteUrl(event.target.value)}
              placeholder="Optional"
            />
          </div>
          <div>
            <label className="tt-eyebrow" htmlFor="to-scout-title">
              Title
            </label>
            <TTInput
              id="to-scout-title"
              className="mt-2 h-9"
              value={roleTitle}
              onChange={(event) => setRoleTitle(event.target.value)}
              placeholder="Founder, Head of Ops…"
            />
          </div>
          <div>
            <label className="tt-eyebrow" htmlFor="to-scout-role">
              Role in the company
            </label>
            <TTInput
              id="to-scout-role"
              className="mt-2 h-9"
              value={role}
              onChange={(event) => setRole(event.target.value)}
              placeholder="What they decide or own"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
          <TTButton
            pending={save.isPending}
            pendingLabel="Saving to Scout…"
            disabled={!relationship || !companyName.trim() || save.isPending}
            onClick={() => save.mutate()}
          >
            Save to Scout
          </TTButton>
          <p className="text-[13px] text-muted-foreground">
            Entered by a person. Scout records it as such, no sourcing is implied.
          </p>
        </div>

        {save.isError ? (
          <p role="alert" className="text-[13px] text-destructive">
            {save.error instanceof Error ? save.error.message : "That could not be saved."}
          </p>
        ) : null}
      </div>
    </div>
  );
}

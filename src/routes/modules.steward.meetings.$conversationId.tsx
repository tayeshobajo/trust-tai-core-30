/**
 * Steward — one conversation.
 *
 * Everything Steward heard, line-referenced, with a person deciding which
 * proposals become commitments the organization actually carries.
 */

import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { AppHero } from "@/components/tt/app-hero";
import { AppShell } from "@/components/tt/app-shell";
import { MetaPill, TTButton } from "@/components/tt/primitives";
import { ProposalReview } from "@/components/tt/steward/proposal-review";
import { StewardTabs } from "@/components/tt/steward/steward-tabs";
import { StewardUnavailable } from "@/components/tt/steward/unavailable";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { extractProposals } from "@/data/steward/extract";
import { stewardService } from "@/data/supabase/steward-service";
import type { CommitmentProposal } from "@/domain/steward";
import type { WorkspaceIdentity } from "@/lib/workspace";

const TITLE = "Steward — Conversation review — Trust Tai OS";
const DESCRIPTION =
  "Review what was said, confirm the promises that were really made, and give each one an owner.";

export const Route = createFileRoute("/modules/steward/meetings/$conversationId")({
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
  component: ConversationRoute,
});

function ConversationRoute() {
  return (
    <WorkspaceGate>
      {(identity) => (
        <AppShell identity={identity}>
          <ConversationReview identity={identity} />
        </AppShell>
      )}
    </WorkspaceGate>
  );
}

function ConversationReview({ identity }: { identity: WorkspaceIdentity }) {
  const { conversationId } = useParams({ from: "/modules/steward/meetings/$conversationId" });
  const queryClient = useQueryClient();

  const conversation = useQuery({
    queryKey: ["steward", "conversation", conversationId],
    queryFn: () => stewardService.conversation(conversationId),
  });

  const commitments = useQuery({
    queryKey: ["steward", "commitments", identity.organizationId],
    queryFn: () => stewardService.commitments(identity.organizationId),
  });

  const confirm = useMutation({
    mutationFn: (proposal: CommitmentProposal) =>
      stewardService.confirmCommitment({
        organizationId: identity.organizationId,
        userId: identity.userId,
        proposal,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["steward", "commitments", identity.organizationId],
      });
    },
  });

  if (conversation.isError) return <StewardUnavailable error={conversation.error} />;
  if (conversation.isLoading || !conversation.data) {
    return <p className="text-sm text-muted-foreground">Opening the conversation…</p>;
  }

  const record = conversation.data;
  const proposals = extractProposals(record);
  const confirmedKeys = new Set(
    (commitments.data ?? [])
      .filter((commitment) => commitment.conversationId === record.id)
      .map((commitment) => commitment.sourceKey),
  );

  return (
    <div className="space-y-8">
      <AppHero
        appId="steward"
        eyebrow="Steward · Conversation"
        title={record.title}
        supporting={`${record.occurredAt.slice(0, 10)} · ${record.participants
          .map((person) => person.name)
          .join(", ")}`}
        action={
          <TTButton asChild variant="secondary">
            <Link to="/modules/steward/meetings">Back to meetings</Link>
          </TTButton>
        }
      />

      <StewardTabs active="meetings" />

      <div className="flex flex-wrap gap-2">
        <MetaPill>{record.provider}</MetaPill>
        <MetaPill>{proposals.length} heard</MetaPill>
        <MetaPill>{confirmedKeys.size} confirmed</MetaPill>
      </div>

      <ProposalReview
        conversation={record}
        proposals={proposals}
        confirmedKeys={confirmedKeys}
        onConfirm={(proposal) => confirm.mutate(proposal)}
        pending={confirm.isPending}
      />
    </div>
  );
}

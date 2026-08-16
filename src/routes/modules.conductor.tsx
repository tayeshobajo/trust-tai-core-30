/**
 * The Conductor — the command layer over the whole factory.
 *
 * Not a peer business room: it owns no entity and writes no room's truth. It
 * reads Scout, Comms, Roadmap, Projects, Ops, Studio, the shared activity
 * stream, Steward and Pulse, answers in plain language, and hands every piece
 * of consequential work back to the room and the person who own it.
 */

import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { AppHero } from "@/components/tt/app-hero";
import { AppShell } from "@/components/tt/app-shell";
import { ConductorConsole } from "@/components/tt/conductor/conductor-console";
import { FiguresPanel } from "@/components/tt/conductor/figures-panel";
import type { CorrectionDraft } from "@/components/tt/conductor/correct-answer";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { answerQuestion } from "@/data/intelligence/conductor";
import { loadSuiteSnapshot } from "@/data/intelligence/service";
import {
  loadBusinessFigures,
  loadBusinessIntents,
  loadCorrections,
  recordCorrection,
  recordFigure,
} from "@/data/supabase/conductor-service";
import type { ConductorAnswer } from "@/domain/conductor";
import type { WorkspaceIdentity } from "@/lib/workspace";


const TITLE = "Ask Trust Tai — the Conductor — Trust Tai OS";
const DESCRIPTION =
  "Ask the Trust Tai factory a question and get a grounded answer: vital signs, upstream causes, what is missing, and bounded next steps that only you can authorise.";

export const Route = createFileRoute("/modules/conductor")({
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
  component: ConductorRoute,
});

function ConductorRoute() {
  return (
    <WorkspaceGate>
      {(identity) => (
        <AppShell identity={identity}>
          <Conductor identity={identity} />
        </AppShell>
      )}
    </WorkspaceGate>
  );
}

function Conductor({ identity }: { identity: WorkspaceIdentity }) {
  const [answer, setAnswer] = useState<ConductorAnswer | undefined>(undefined);

  /*
   * Reading is a deliberate act, not a background poll: the suite is read when
   * a person asks, and the answer is derived from that one snapshot so every
   * number on screen belongs to the same moment.
   */
  const ask = useMutation({
    mutationFn: async (question: string) => {
      const snapshot = await loadSuiteSnapshot(identity.organizationId);
      return answerQuestion({ snapshot, question });
    },
    onSuccess: (result) => setAnswer(result),
  });

  return (
    <div className="space-y-12">
      <AppHero
        appId="conductor"
        eyebrow="Steward / Intelligence · Conductor"
        title="Ask Trust Tai."
        supporting="One question, one grounded answer. What is observed, what you decided, what follows from it, and what nobody can see yet."
      />

      <ConductorConsole
        {...(answer ? { answer } : {})}
        thinking={ask.isPending}
        onAsk={(question) => ask.mutateAsync(question).then(() => undefined)}
      />

      {ask.isError ? (
        <p className="text-sm text-[var(--tt-ink-muted)]">
          The suite could not be read just now. Nothing was changed; try again.
        </p>
      ) : null}
    </div>
  );
}

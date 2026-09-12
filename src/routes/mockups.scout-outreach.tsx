/**
 * MOCKUP ONLY — Scout outreach flow (draft → approve → sent).
 *
 * An isolated visual prototype for approval. No production data, no service
 * calls, nothing saved. Deliberately not linked from navigation.
 */

import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { AppShell } from "@/components/tt/app-shell";
import type { DraftEmail, ReadyProspect, SentEmail } from "@/components/mockups/scout-outreach";
import {
  ApprovalColumn,
  INITIAL_DRAFTS,
  INITIAL_READY,
  INITIAL_SENT,
  ReadyColumn,
  SentColumn,
} from "@/components/mockups/scout-outreach";

const TITLE = "Mockup · Scout Outreach · Trust Tai OS";
const DESCRIPTION =
  "An isolated visual prototype of the Scout outreach pipeline: ready prospects, draft approval, and sent emails. Demo data only.";

export const Route = createFileRoute("/mockups/scout-outreach")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ScoutOutreachMockup,
});

function ScoutOutreachMockup() {
  const [ready, setReady] = useState<ReadyProspect[]>(INITIAL_READY);
  const [drafts, setDrafts] = useState<DraftEmail[]>(INITIAL_DRAFTS);
  const [sent, setSent] = useState<SentEmail[]>(INITIAL_SENT);

  const handleDraft = (prospect: ReadyProspect) => {
    const newDraft: DraftEmail = {
      id: `d-${Date.now()}`,
      prospectId: prospect.id,
      recipient: prospect.contact,
      company: prospect.company,
      email: `${prospect.contact.split(" ")[0]?.toLowerCase()}@${prospect.company.toLowerCase().replace(/\s+/g, "")}.com`,
      template: "Roadmap opener",
      subject: `A quiet question about ${prospect.company}'s next chapter`,
      body: `Hi ${prospect.contact.split(" ")[0]},\n\nI noticed ${prospect.company} ${prospect.fitReason.toLowerCase()}. That is often the moment founder-led practices feel the gap between growth and the operating system underneath it.\n\nI help founders build a decision and sequencing rhythm so the next stage does not depend on memory and instinct. I would welcome a short conversation about what is working and where the friction is showing up.\n\nTrust,\nTai`,
    };

    setDrafts((current) => [newDraft, ...current]);
    setReady((current) => current.filter((item) => item.id !== prospect.id));
  };

  const handleApprove = (draft: DraftEmail) => {
    const newSent: SentEmail = {
      id: `s-${Date.now()}`,
      prospectId: draft.prospectId,
      recipient: draft.recipient,
      company: draft.company,
      email: draft.email,
      sentDate: "Today",
      statuses: ["sent"],
    };

    setSent((current) => [newSent, ...current]);
    setDrafts((current) => current.filter((item) => item.id !== draft.id));
  };

  const handleReject = (draft: DraftEmail) => {
    setDrafts((current) => current.filter((item) => item.id !== draft.id));
  };

  const handleEdit = (updated: DraftEmail) => {
    setDrafts((current) => current.map((item) => (item.id === updated.id ? updated : item)));
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-canvas px-1 pb-24">
        <header className="border-b border-border pb-8">
          <p className="tt-eyebrow">Mockup · not wired</p>
          <div className="mt-4 flex flex-wrap items-end justify-between gap-6">
            <div>
              <h1 className="tt-title-page text-4xl sm:text-5xl">Scout Outreach</h1>
              <p className="mt-2 max-w-reading text-base text-muted-foreground">
                Found by Scout. Written in your voice. Sent by your hand.
              </p>
            </div>
            <div className="rounded-full border border-border bg-card px-4 py-2">
              <p className="text-sm text-muted-foreground">
                This week: <span className="font-medium text-foreground">3 of 15</span>
              </p>
            </div>
          </div>
        </header>

        <div className="mt-8 grid gap-6 lg:grid-cols-3">
          <ReadyColumn prospects={ready} onDraft={handleDraft} />
          <ApprovalColumn
            drafts={drafts}
            onApprove={handleApprove}
            onReject={handleReject}
            onEdit={handleEdit}
          />
          <SentColumn sent={sent} />
        </div>
      </div>
    </AppShell>
  );
}

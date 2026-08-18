/**
 * The rehearsal transcript.
 *
 * A fixed, obviously-labelled conversation so a person can walk the whole
 * Steward loop before any recording source is connected. It is never written
 * to the workspace and never described as a real meeting.
 */

import type { NormalizedConversation } from "@/domain/steward";

const OCCURRED_AT = "2026-01-14T15:00:00.000Z";

export const REHEARSAL_NOTICE =
  "Rehearsal transcript. Nothing here is real workspace truth, and nothing can be confirmed into the workspace from it.";

export function rehearsalConversation(): NormalizedConversation {
  const lines: [string, string, string][] = [
    ["00:00:12", "Tai", "Thanks for making time. Let's walk the Northwind rollout and see where it actually stands."],
    ["00:01:04", "Dana", "Short version, the migration is blocked on their DNS access. We're waiting on their IT lead."],
    ["00:02:20", "Tai", "Can you chase that today, Dana? I'd rather we name the dependency than let it drift."],
    ["00:02:38", "Dana", "Yes. I'll email their IT lead this afternoon and copy you."],
    ["00:04:11", "Marcus", "On the content side, we agreed to lead with the operations story rather than the brand refresh."],
    ["00:05:02", "Marcus", "I'll send the revised outline by Friday so Studio has something to work from."],
    ["00:06:30", "Dana", "One open question. Not sure who owns the analytics handover after go-live."],
    ["00:08:05", "Tai", "Let's decide that next week once we see the launch plan. I'll bring it back to this group."],
    ["00:09:41", "Marcus", "Last thing, the client asked about training. Could you share the stewardship plan with them, Tai?"],
    ["00:10:02", "Tai", "I can do that. I'll share the stewardship plan after the outline lands."],
  ];

  return {
    sourceRef: {
      provider: "fixture",
      externalId: "rehearsal-northwind",
      url: "",
    },
    title: "Rehearsal, Northwind rollout check-in",
    occurredAt: OCCURRED_AT,
    participants: [
      { name: "Tai" },
      { name: "Dana" },
      { name: "Marcus" },
    ],
    segments: lines.map(([at, speaker, text], index) => ({ index, at, speaker, text })),
    sourceSummary:
      "Team reviewed the Northwind rollout. Migration is waiting on client DNS access, content direction changed, analytics ownership is unresolved.",
    sourceActionItems: [],
    rehearsal: true,
  };
}

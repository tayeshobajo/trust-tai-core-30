/**
 * Scout — in-memory preview source.
 *
 * This is a demo set, not a sourcing engine. No external service is contacted.
 * Status changes persist for the session only. When Lovable Cloud is connected,
 * replace this module with a backed implementation of `ScoutProvider`.
 */

import type { ActivityStream } from "@/domain/activity";
import type { ID, Prospect } from "@/domain/entities";
import type {
  ProspectCandidate,
  ScoutProvider,
  ScoutSearchRequest,
  ScoutSearchResult,
} from "@/domain/scout";

const ORG_ID = "org_trusttai";
const NOW = "2026-08-12T09:00:00.000Z";

const base = { organizationId: ORG_ID, createdAt: NOW, updatedAt: NOW };

function prospect(id: string, name: string, domain: string): Prospect {
  return { ...base, id, name, domain, websiteUrl: `https://${domain}`, status: "discovered" };
}

export const PREVIEW_CANDIDATES: ProspectCandidate[] = [
  {
    prospect: prospect("pro_meridian", "Meridian Law Partners", "meridianlaw.co.uk"),
    signals: [
      {
        id: "sig_meridian_1",
        statement: "Website runs WordPress 5.4, last theme update in 2021.",
        provenance: {
          appId: "scout",
          actor: { type: "system", id: "scout.demo" },
          observedAt: NOW,
          confidence: "observed",
        },
      },
      {
        id: "sig_meridian_2",
        statement: "Nine fee earners listed, up from five on the 2023 team page.",
        provenance: {
          appId: "scout",
          actor: { type: "system", id: "scout.demo" },
          observedAt: NOW,
          confidence: "observed",
        },
      },
      {
        id: "sig_meridian_3",
        statement: "No enquiry form; the only contact route is a mailto link.",
        provenance: {
          appId: "scout",
          actor: { type: "system", id: "scout.demo" },
          observedAt: NOW,
          confidence: "observed",
        },
      },
    ],
    fit: {
      whyItFits:
        "A growing professional-services firm whose site has not kept pace with the team behind it.",
      recommendation: "Qualify and open with the enquiry gap, not a redesign pitch.",
    },
  },
  {
    prospect: prospect("pro_calder", "Calder Foundation", "calderfoundation.org"),
    signals: [
      {
        id: "sig_calder_1",
        statement: "Two new programmes announced in the last quarter.",
        provenance: {
          appId: "scout",
          actor: { type: "system", id: "scout.demo" },
          observedAt: NOW,
          confidence: "observed",
        },
      },
      {
        id: "sig_calder_2",
        statement: "Donation flow hands off to a third-party page with no branding.",
        provenance: {
          appId: "scout",
          actor: { type: "system", id: "scout.demo" },
          observedAt: NOW,
          confidence: "observed",
        },
      },
    ],
    fit: {
      whyItFits:
        "A nonprofit growing faster than its website, with money leaking at the donation step.",
      recommendation: "Qualify. Lead with the donation handoff, which is measurable.",
    },
  },
  {
    prospect: prospect("pro_harlow", "Harlow & Reed Accountants", "harlowreed.com"),
    signals: [
      {
        id: "sig_harlow_1",
        statement: "Site structure closely mirrors two retained Trust Tai clients.",
        provenance: {
          appId: "scout",
          actor: { type: "system", id: "scout.demo" },
          observedAt: NOW,
          confidence: "observed",
        },
      },
      {
        id: "sig_harlow_2",
        statement: "Three office locations, one shared contact page.",
        provenance: {
          appId: "scout",
          actor: { type: "system", id: "scout.demo" },
          observedAt: NOW,
          confidence: "observed",
        },
      },
    ],
    fit: {
      whyItFits:
        "Shaped like the retained clients we serve best, so the work is familiar and the value is easy to show.",
      recommendation: "Qualify only if we have steward capacity this quarter.",
    },
  },
  {
    prospect: prospect("pro_westbay", "Westbay Surveyors", "westbaysurveyors.co.uk"),
    signals: [
      {
        id: "sig_westbay_1",
        statement: "Certificate expired eleven days ago; browsers show a warning.",
        provenance: {
          appId: "scout",
          actor: { type: "system", id: "scout.demo" },
          observedAt: NOW,
          confidence: "observed",
        },
      },
      {
        id: "sig_westbay_2",
        statement: "No published work or case studies since 2022.",
        provenance: {
          appId: "scout",
          actor: { type: "system", id: "scout.demo" },
          observedAt: NOW,
          confidence: "observed",
        },
      },
    ],
    fit: {
      whyItFits:
        "Real neglect, but no visible sign of growth — the need is clear and the budget is not.",
      recommendation: "Pass for now. Revisit if a growth signal appears.",
    },
  },
];

/** Plain-language matching over the demo set. No search is performed. */
export function rankPreviewCandidates(query: string): ProspectCandidate[] {
  const q = query.toLowerCase();
  const score = (c: ProspectCandidate) => {
    const hay = `${c.prospect.name} ${c.fit.whyItFits} ${c.signals
      .map((s) => s.statement)
      .join(" ")}`.toLowerCase();
    return q
      .split(/\W+/)
      .filter((word) => word.length > 3)
      .reduce((total, word) => (hay.includes(word) ? total + 1 : total), 0);
  };
  return [...PREVIEW_CANDIDATES].sort((a, b) => score(b) - score(a));
}

export function createScoutSource(activity: ActivityStream): ScoutProvider {
  return {
    async search(request: ScoutSearchRequest): Promise<ScoutSearchResult> {
      return {
        request,
        candidates: rankPreviewCandidates(request.query),
        source: {
          kind: "preview_demo",
          label: "Preview demo source",
          note: "A fixed in-memory set. No external service was searched.",
        },
        generatedAt: new Date().toISOString(),
      };
    },

    async setStatus(id, status, context) {
      const entry = PREVIEW_CANDIDATES.find((c) => c.prospect.id === id);
      if (!entry) return null;
      entry.prospect.status = status;
      entry.prospect.updatedAt = new Date().toISOString();
      if (status === "qualified") {
        entry.prospect.stewardUserId = context.userId;
        await activity.record({
          organizationId: context.organizationId,
          name: "prospect.status_changed",
          subject: { type: "prospect", id, label: entry.prospect.name },
          summary: `${entry.prospect.name} is qualified and ready for Comms.`,
          provenance: {
            appId: "scout",
            actor: { type: "user", id: context.userId },
            observedAt: new Date().toISOString(),
            confidence: "observed",
          },
          occurredAt: new Date().toISOString(),
        });
      }
      return entry.prospect;
    },

    async list(organizationId: ID) {
      return PREVIEW_CANDIDATES.filter((c) => c.prospect.organizationId === organizationId);
    },
  };
}

/**
 * Research permission for an inbound company.
 *
 * Research is something we do *to* a company that came to us in good faith.
 * The founder either authorised public research in the intake, refused it, or
 * was never asked. Those are three different states and the third one is not
 * a yes. Marketing opt-in is a different question entirely and is never read
 * here.
 *
 * When the intake never asked, a person in the workspace may take the
 * decision themselves. That decision is recorded with who made it and when,
 * and it never rewrites what the founder said.
 */

import type { ID, ISODateTime } from "@/domain/entities";
import type { ProspectCandidate } from "@/domain/scout";
import type { FounderSignalPacket } from "@/domain/stated";

/** A decision a person in the workspace took about researching this company. */
export interface ResearchConsentRecord {
  decision: "granted" | "withheld";
  by: ID;
  byLabel?: string | null;
  at: ISODateTime;
  note?: string | null;
}

/** The metadata key the decision lives under on `prospects.metadata`. */
export const RESEARCH_CONSENT_METADATA_KEY = "scout_research_consent";

export function readResearchConsent(metadata: unknown): ResearchConsentRecord | null {
  const bag = metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>) : {};
  const raw = bag[RESEARCH_CONSENT_METADATA_KEY];
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Partial<ResearchConsentRecord>;
  if (record.decision !== "granted" && record.decision !== "withheld") return null;
  return {
    decision: record.decision,
    by: String(record.by ?? ""),
    byLabel: record.byLabel ?? null,
    at: String(record.at ?? ""),
    note: record.note ?? null,
  };
}

export type ResearchPermissionState =
  /** The founder authorised public research in the intake. */
  | "granted"
  /** The founder explicitly declined. Nothing gets researched. */
  | "withheld"
  /** The intake never asked. Fail closed until a person resolves it. */
  | "unknown"
  /** Not an inbound company: no testimony, no permission question. */
  | "not_required";

export interface ResearchPermission {
  state: ResearchPermissionState;
  /** Plain language, shown next to the gate. */
  because: string;
  /** True only when Scout may read public pages right now. */
  canResearch: boolean;
  /** Present when a person, not the intake, settled the question. */
  resolvedBy?: ResearchConsentRecord;
}

/**
 * The intake's own answer. `null` means the question was never asked, which is
 * deliberately not the same as a no.
 */
function statedAnswer(packet: FounderSignalPacket | undefined): boolean | null {
  const value = packet?.understanding.authorizesResearch;
  return typeof value === "boolean" ? value : null;
}

export function researchPermission(candidate: ProspectCandidate): ResearchPermission {
  const packet = candidate.stated;
  if (!packet) {
    return {
      state: "not_required",
      because:
        "This company did not come through the website intake, so there is no founder permission to honour. Scout reads public pages only.",
      canResearch: true,
    };
  }

  const answer = statedAnswer(packet);
  if (answer === false) {
    return {
      state: "withheld",
      because:
        "They declined public research in the intake. Scout will not read anything about them until they say otherwise.",
      canResearch: false,
    };
  }
  if (answer === true) {
    return {
      state: "granted",
      because: "They authorised public research when they completed the intake on TrustTai.com.",
      canResearch: true,
    };
  }

  const resolved = candidate.researchConsent ?? undefined;
  if (resolved) {
    return {
      state: resolved.decision,
      because:
        resolved.decision === "granted"
          ? `The intake never asked. ${resolved.byLabel ?? "Someone here"} decided public research is appropriate.`
          : `The intake never asked. ${resolved.byLabel ?? "Someone here"} decided not to research this company.`,
      canResearch: resolved.decision === "granted",
      resolvedBy: resolved,
    };
  }

  return {
    state: "unknown",
    because:
      "The intake never asked whether we may research them, and marketing consent is not research consent. Nothing runs until you decide.",
    canResearch: false,
  };
}

export const RESEARCH_PERMISSION_LABEL: Record<ResearchPermissionState, string> = {
  granted: "Research permission · Given",
  withheld: "Research permission · Withheld",
  unknown: "Research permission · Unknown",
  not_required: "Research permission · Not applicable",
};

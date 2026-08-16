/**
 * Bounded action input resolution (Conductor V3.1).
 *
 * A recommendation can say "source against the current ICP", but Scout's
 * discovery adapter needs a concrete brief before it will route anything —
 * without one it refuses with `missing_input`, and the loop can never start
 * from a question alone.
 *
 * This module closes that gap using only what already exists: the
 * organisation's saved `icp_profiles` row. The brief is *composed
 * deterministically* from the targeting fields a person wrote, and the ICP's
 * identifiers travel with it so the run is traceable back to the version it
 * targeted.
 *
 * Four rules, deliberately narrow:
 *
 *   1. Nothing is invented. No company, no criteria, no identifier that is not
 *      already stored. With no usable ICP the proposal stays look-only and
 *      names exactly what is missing.
 *   2. Only the discovery proposal is upgraded. Every other operation passes
 *      through untouched.
 *   3. Approval is unaffected. The filled action still requires a person, in
 *      the owning room, with `scout.write`.
 *   4. Resolved inputs are labelled as resolved. A recommendation is a model
 *      or rule opinion; an execution input is decided/observed state, and the
 *      payload keeps the provenance that says which is which.
 */

import type { ActionProposal } from "@/domain/intelligence-engine";

/** The saved ICP, read from `icp_profiles`. Never constructed here. */
export interface IcpContext {
  profileId: string;
  version: number;
  title: string;
  contentMarkdown: string;
  updatedAt?: string | null;
}

/** The look-only proposal this resolution upgrades. */
export const DISCOVERY_PROPOSAL_OPERATION = "scout.open_discovery";
/** The executable operation Scout's adapter claims. */
export const DISCOVERY_RUN_OPERATION = "scout.start_discovery_run";

/** How much of the ICP is carried into the brief. */
const MAX_BRIEF_CHARS = 900;

/* --------------------------------------------------- deterministic parsing */

type IcpField = "target" | "industries" | "size" | "geography" | "roles" | "exclusions";

interface FieldRule {
  field: IcpField;
  /** Heading or label wording that marks this field in a saved ICP. */
  pattern: RegExp;
}

/**
 * Which saved ICP wording maps to which targeting field. Order matters: the
 * first match wins, so "company size" is a size line rather than a company
 * line.
 */
const FIELD_RULES: FieldRule[] = [
  { field: "exclusions", pattern: /\b(exclu(de|sion)|not a fit|avoid|disqualif|out of scope)\b/i },
  { field: "size", pattern: /\b(size|headcount|employees|team size|revenue|stage|company type)\b/i },
  { field: "geography", pattern: /\b(geograph|location|region|countr|market|territor)\b/i },
  { field: "industries", pattern: /\b(industr|sector|vertical|niche)\b/i },
  { field: "roles", pattern: /\b(role|job title|decision maker|buyer|persona|contact)\b/i },
  { field: "target", pattern: /\b(who we serve|target|ideal|profile|fit|customer|client)\b/i },
];

const FIELD_LABEL: Record<IcpField, string> = {
  target: "Target",
  industries: "Industries",
  size: "Company size",
  geography: "Geography",
  roles: "Roles",
  exclusions: "Exclude",
};

/** Composition order of the brief. Fixed, so the same ICP always composes the same brief. */
const FIELD_ORDER: IcpField[] = ["target", "industries", "size", "geography", "roles", "exclusions"];

function classify(text: string): IcpField | null {
  for (const rule of FIELD_RULES) {
    if (rule.pattern.test(text)) return rule.field;
  }
  return null;
}

function clean(line: string): string {
  return line
    .replace(/^\s*[#>]+\s*/, "")
    .replace(/^\s*[-*+]\s+/, "")
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .trim();
}

function isMeaningful(line: string): boolean {
  const text = line.trim();
  if (text.length === 0) return false;
  /* Headings, rules and bare bullets alone carry no criteria. */
  if (/^[#>*\-_=\s]+$/.test(text)) return false;
  return true;
}

/** One targeting field found in the saved ICP, with the lines it came from. */
export interface ResolvedIcpField {
  field: IcpField;
  label: string;
  values: string[];
}

/**
 * The targeting fields a saved ICP actually states.
 *
 * Deterministic: headings and `Label: value` lines set the current field, and
 * every following line belongs to it. Nothing is inferred beyond that mapping,
 * and nothing is added.
 */
export function readIcpFields(icp: IcpContext | null | undefined): ResolvedIcpField[] {
  if (!icp) return [];
  const found = new Map<IcpField, string[]>();
  const push = (field: IcpField, value: string) => {
    const text = value.trim();
    if (text.length === 0) return;
    const list = found.get(field) ?? [];
    if (!list.includes(text)) list.push(text);
    found.set(field, list);
  };

  let current: IcpField = "target";
  for (const raw of icp.contentMarkdown.split(/\r?\n/)) {
    if (!isMeaningful(raw)) continue;
    const isHeading = /^\s*#{1,6}\s+/.test(raw) || /^\s*\*\*[^*]+\*\*\s*:?\s*$/.test(raw);
    const text = clean(raw);
    if (text.length === 0) continue;

    if (isHeading) {
      current = classify(text) ?? "target";
      continue;
    }

    /* An inline "Label: value" line names its own field. */
    const labelled = /^([A-Za-z][A-Za-z /&-]{2,40}):\s*(.+)$/.exec(text);
    if (labelled) {
      const field = classify(labelled[1]!);
      if (field) {
        for (const value of labelled[2]!.split(/[,;]/)) push(field, value);
        continue;
      }
    }

    push(current, text);
  }

  return FIELD_ORDER.filter((field) => (found.get(field) ?? []).length > 0).map((field) => ({
    field,
    label: FIELD_LABEL[field],
    values: found.get(field)!,
  }));
}

/** Fields that, on their own, are enough to search on. Exclusions alone are not. */
const SUFFICIENT_FIELDS: IcpField[] = ["target", "industries", "size", "geography", "roles"];

/**
 * The plain-English brief a saved ICP already states, composed from its
 * targeting fields in a fixed order. Returns null when the ICP holds nothing
 * to search on — silence is the honest answer, not a generic brief.
 */
export function deriveDiscoveryBrief(icp: IcpContext | null | undefined): string | null {
  const fields = readIcpFields(icp);
  if (!fields.some((row) => SUFFICIENT_FIELDS.includes(row.field))) return null;

  const brief = fields
    .map((row) =>
      row.field === "target" ? row.values.join(". ") : `${row.label}: ${row.values.join(", ")}`,
    )
    .join(". ")
    .replace(/\.\.+/g, ".")
    .trim();

  if (brief.length === 0) return null;
  return brief.length > MAX_BRIEF_CHARS ? `${brief.slice(0, MAX_BRIEF_CHARS).trimEnd()}…` : brief;
}

/* -------------------------------------------------------------- resolution */

/** What the resolver managed to hydrate, and where each input came from. */
export interface InputResolution {
  operation: string;
  status: "resolved" | "missing_input" | "not_applicable";
  /** Human sentence for the action row. */
  because: string;
  /** Named inputs that could not be resolved from trusted state. */
  missing: string[];
  /** Provenance for every hydrated input. */
  source?: {
    /** Which stored record the input came from: `icp_profiles`, `roadmaps`, … */
    kind: string;
    recordId: string;
    /** Present when the source record is versioned. */
    version?: number;
    fields: string[];
  };
}

/**
 * Resolve Scout's discovery inputs from decided/observed state only.
 *
 * Returns the resolution alongside the proposal so the control surface can
 * distinguish a model recommendation from a deterministic execution input.
 */
export function resolveDiscoveryInputs(
  proposal: ActionProposal,
  icp: IcpContext | null | undefined,
): { proposal: ActionProposal; resolution: InputResolution } {
  if (
    proposal.operation !== DISCOVERY_PROPOSAL_OPERATION &&
    proposal.operation !== DISCOVERY_RUN_OPERATION
  ) {
    return {
      proposal,
      resolution: {
        operation: proposal.operation,
        status: "not_applicable",
        because: "This step needs no resolved execution input.",
        missing: [],
      },
    };
  }

  const fields = readIcpFields(icp);
  const brief = deriveDiscoveryBrief(icp);

  if (!icp || !brief) {
    return {
      proposal,
      resolution: {
        operation: proposal.operation,
        status: "missing_input",
        because: icp
          ? "Needs Scout targeting details before this can be routed: target industries, company size or geography."
          : "Needs Scout targeting details before this can be routed: a saved ICP.",
        missing: icp ? ["target industries", "company size", "geography"] : ["saved ICP profile"],
      },
    };
  }

  const usedFields = fields.map((row) => row.label);

  return {
    proposal: {
      ...proposal,
      operation: DISCOVERY_RUN_OPERATION,
      title: "Run one sourcing pass against the saved ICP",
      summary: `Scout runs a single sourcing pass using the ICP this organisation already saved ("${icp.title}", version ${icp.version}). Nothing is contacted and the ICP is not changed.`,
      willDo: [
        "Run one sourcing pass in Scout against the saved ICP",
        "Save only the companies Scout can verify",
      ],
      willNotDo: ["Contact anyone", "Change the ICP", "Qualify or pass any company for you"],
      payload: {
        ...proposal.payload,
        brief,
        icpProfileId: icp.profileId,
        icpVersion: icp.version,
        icpTitle: icp.title,
        ...(icp.updatedAt ? { icpUpdatedAt: icp.updatedAt } : {}),
        /* Derived, never invented: the brief is the saved ICP's own fields. */
        briefSource: "icp_profiles",
        briefFields: usedFields,
        inputResolution: "resolved",
        inputProvenance: {
          kind: "icp_profiles",
          recordId: icp.profileId,
          version: icp.version,
          fields: usedFields,
          basis: "decided",
        },
      },
      /* Approval law is untouched by resolution. */
      requiresApproval: true,
    },
    resolution: {
      operation: DISCOVERY_RUN_OPERATION,
      status: "resolved",
      because: "Search brief prepared from your saved Scout ICP.",
      missing: [],
      source: {
        kind: "icp_profiles",
        recordId: icp.profileId,
        version: icp.version,
        fields: usedFields,
      },
    },
  };
}

/**
 * Upgrade the discovery proposal into a routable sourcing run when — and only
 * when — the organisation's saved ICP supplies the brief.
 */
export function fillDiscoveryPayload(
  proposal: ActionProposal,
  icp: IcpContext | null | undefined,
): ActionProposal {
  return fillWithResolution(proposal, icp).proposal;
}

function fillWithResolution(
  proposal: ActionProposal,
  icp: IcpContext | null | undefined,
): { proposal: ActionProposal; resolution: InputResolution } {
  const resolved = resolveDiscoveryInputs(proposal, icp);
  if (resolved.resolution.status !== "missing_input") return resolved;
  /* Non-routable, and honest about why. Nothing is fabricated. */
  return {
    proposal: {
      ...proposal,
      payload: {
        ...proposal.payload,
        inputResolution: "missing_input",
        missingInputs: resolved.resolution.missing,
        inputResolutionNote: resolved.resolution.because,
      },
    },
    resolution: resolved.resolution,
  };
}

/** Apply every available input resolution across a set of proposals. */
export function fillProposalPayloads(
  proposals: ActionProposal[],
  icp: IcpContext | null | undefined,
): ActionProposal[] {
  return proposals.map((proposal) => fillDiscoveryPayload(proposal, icp));
}

/** Resolutions for a set of proposals, keyed by proposal id (for the UI). */
export function resolveProposalInputs(
  proposals: ActionProposal[],
  icp: IcpContext | null | undefined,
): Record<string, InputResolution> {
  const out: Record<string, InputResolution> = {};
  for (const proposal of proposals) {
    const { resolution } = fillWithResolution(proposal, icp);
    if (resolution.status !== "not_applicable") out[proposal.id] = resolution;
  }
  return out;
}

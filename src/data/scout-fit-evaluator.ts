/**
 * Scout — conservative ICP fit evaluator (trust-tai-icp-v2).
 *
 * Deterministic and explainable. It reads only what is already stored on the
 * prospect (`observed`, `inferred`, `suggested`, `provenance`) and maps it onto
 * the active Trust Tai ICP. No AI call, no invented facts.
 *
 * v2 adds explicit, key-aware rules for the structured observations returned by
 * `scout-research` v3 (`active_business_signals`, `proof_signals`,
 * `decision_maker_signals`, `contact_routes`, `milestone_opportunities`, …).
 * When those keys are absent — v1/v2 rows — the original keyword rules are used
 * unchanged, so older prospects keep working.
 *
 * Conservatism rules, in order:
 *  - Unknown is never a mismatch. Missing evidence lowers confidence, not trust.
 *  - Fewer than three clearly met criteria can never be green.
 *  - WordPress alone is never evidence of a limiting system.
 *  - Red requires positive evidence of a disqualifier, or a low score that is
 *    itself backed by enough evidence.
 *  - Preview/demo rows are neutral: they cannot honestly be scored.
 */

import {
  SCOUT_EVALUATOR_VERSION,
  type FitCriterion,
  type FitCriterionState,
  type FitLight,
  type ScoutFitEvaluation,
} from "@/domain/scout-fit";

type Row = Record<string, unknown>;

interface Observation {
  key: string;
  label: string;
  text: string;
  value: unknown;
  evidence: string;
  sourceUrl?: string;
  /** true / false / unknown for the underlying value. */
  truth: boolean | null;
}

/**
 * Generic backend fallbacks that must never count as a real opportunity.
 * `WordPress support or modernization path` is capability alignment, not a
 * observed problem, so v4 treats it exactly like the human-review fallback.
 */
const GENERIC_MILESTONE =
  /(deeper human review before proposing a milestone|wordpress (support|modernization|modernisation)[^.]*)/i;

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function truthOf(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;
  if (Array.isArray(value)) return value.length > 0;
  const text = str(value).toLowerCase();
  if (!text) return null;
  if (["yes", "true", "present", "found", "detected"].includes(text)) return true;
  if (["no", "false", "none", "absent", "not found", "unknown", "n/a", "—"].includes(text)) {
    return text === "unknown" || text === "n/a" || text === "—" ? null : false;
  }
  return true;
}

function valueText(value: unknown): string {
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map((v) => valueText(v)).filter(Boolean).join(", ");
  if (value && typeof value === "object") {
    const obj = value as Row;
    return str(obj["value"]) || str(obj["text"]) || str(obj["label"]);
  }
  return str(value);
}

function normalizeObservations(observed: unknown): Observation[] {
  if (!Array.isArray(observed)) return [];
  return observed.map((item, index) => {
    if (typeof item === "string") {
      return {
        key: `obs_${index}`,
        label: "",
        text: item.toLowerCase(),
        value: item,
        evidence: item,
        truth: true,
      };
    }
    const entry = (item ?? {}) as Row;
    const key = str(entry["key"]) || str(entry["id"]) || `obs_${index}`;
    const label = str(entry["label"]);
    const evidence = str(entry["evidence"]) || str(entry["statement"]) || str(entry["fact"]);
    const value = entry["value"];
    const sourceUrl = str(entry["source_url"]) || str(entry["sourceUrl"]);
    const text = [key, label, evidence, valueText(value)].join(" ").toLowerCase();
    return {
      key,
      label,
      text,
      value,
      evidence,
      ...(sourceUrl ? { sourceUrl } : {}),
      truth: truthOf(value),
    };
  });
}

/** Free text Scout already inferred, used only as weak supporting context. */
function inferredText(inferred: unknown, suggested: unknown): string {
  const parts: string[] = [];
  const walk = (value: unknown, depth = 0) => {
    if (depth > 3) return;
    if (typeof value === "string") parts.push(value);
    else if (Array.isArray(value)) value.forEach((v) => walk(v, depth + 1));
    else if (value && typeof value === "object") {
      Object.values(value as Row).forEach((v) => walk(v, depth + 1));
    }
  };
  walk(inferred);
  walk(suggested);
  return parts.join(" \n ").toLowerCase();
}

function matches(observation: Observation, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(observation.text));
}

/* ------------------------------------------------------------------ *
 * Structured (v3) reading helpers
 * ------------------------------------------------------------------ */

/** Human-readable rendering of any observation value. Never "[object Object]". */
export function renderValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value.trim() || "—";
  if (Array.isArray(value)) {
    const parts = value.map((v) => renderValue(v)).filter((v) => v && v !== "—");
    return parts.length > 0 ? parts.join(", ") : "—";
  }
  const obj = value as Row;
  const nested = str(obj["value"]) || str(obj["text"]) || str(obj["label"]);
  return nested || "—";
}

class Structured {
  private readonly map = new Map<string, Observation>();

  constructor(observations: Observation[]) {
    for (const observation of observations) {
      if (!this.map.has(observation.key)) this.map.set(observation.key, observation);
    }
  }

  has(key: string): boolean {
    const observation = this.map.get(key);
    return Boolean(observation) && observation?.value !== undefined && observation?.value !== null;
  }

  hasAny(keys: string[]): boolean {
    return keys.some((key) => this.has(key));
  }

  get(key: string): Observation | undefined {
    return this.map.get(key);
  }

  /** Numeric reading of a count key. Null when absent or not a number. */
  count(key: string): number | null {
    const observation = this.map.get(key);
    if (!observation) return null;
    const value = observation.value;
    if (typeof value === "number") return value;
    if (Array.isArray(value)) return value.length;
    if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value.trim());
    return null;
  }

  /** Boolean reading of a flag key. Null when absent or not decidable. */
  flag(key: string): boolean | null {
    const observation = this.map.get(key);
    if (!observation) return null;
    return truthOf(observation.value);
  }

  /** String list reading, with the generic backend fallback removed. */
  list(key: string): string[] {
    const observation = this.map.get(key);
    if (!observation) return [];
    const value = observation.value;
    const items = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
    return items
      .map((item) => (typeof item === "string" ? item.trim() : renderValue(item)))
      .filter((item) => Boolean(item) && item !== "—" && !GENERIC_MILESTONE.test(item));
  }

  evidence(key: string): string {
    return this.map.get(key)?.evidence ?? "";
  }

  sources(keys: string[]): string[] {
    const urls = keys
      .map((key) => this.map.get(key)?.sourceUrl)
      .filter((url): url is string => Boolean(url));
    return Array.from(new Set(urls));
  }
}

/* ------------------------------------------------------------------ *
 * Criterion specifications
 * ------------------------------------------------------------------ */

interface StructuredResult {
  state: FitCriterionState;
  reason: string;
  sourceUrls?: string[];
}

interface CriterionSpec {
  key: string;
  label: string;
  maxScore: number;
  patterns: RegExp[];
  /** Context words that count as weak (partial) support from inference text. */
  contextPatterns?: RegExp[];
  metReason: string;
  partialReason: string;
  missingReason: string;
  /** When true, a confirmed-false observation is a mismatch, not just missing. */
  falseIsMismatch?: boolean;
  mismatchReason?: string;
  /** When true, a confirmed-false observation supports the criterion instead. */
  invert?: boolean;
  /** Structured keys this criterion owns. Presence switches off keyword mode. */
  structuredKeys?: string[];
  /** Explicit v3 rule. Returning null defers to the keyword rule. */
  structured?: (s: Structured, milestones: string[]) => StructuredResult | null;
}

function withDetail(reason: string, detail: string): string {
  return detail ? `${reason} ${detail}` : reason;
}

const SPECS: CriterionSpec[] = [
  {
    key: "active_operating",
    label: "Active and already serving people",
    maxScore: 16,
    structuredKeys: ["active_business_signals"],
    structured: (s) => {
      const count = s.count("active_business_signals");
      if (count === null) return null;
      const detail = s.evidence("active_business_signals");
      const sourceUrls = s.sources(["active_business_signals"]);
      if (count >= 3) {
        return {
          state: "met",
          reason: withDetail(
            `${count} independent signals of live activity were read on the public site. No revenue is inferred.`,
            detail,
          ),
          sourceUrls,
        };
      }
      if (count >= 1) {
        return {
          state: "partial",
          reason: withDetail(
            `${count} signal${count === 1 ? "" : "s"} of activity — enough to suggest the business is operating, not enough to confirm it.`,
            detail,
          ),
          sourceUrls,
        };
      }
      return {
        state: "missing",
        reason:
          "No activity signals were read on the public pages. Treated as unknown, not as inactivity.",
      };
    },
    patterns: [
      /\b(service|services|clients?|customers?|booking|appointment|hours|open|shop|store|programs?)\b/,
      /\b(active|operating|trading)\b/,
    ],
    contextPatterns: [/\b(currently serving|working with clients|existing clients)\b/],
    metReason: "The public site shows work being delivered to people today.",
    partialReason: "There are hints of activity, but nothing that clearly confirms live delivery.",
    missingReason: "Nothing on the public pages confirms the business is actively serving people.",
    falseIsMismatch: true,
    mismatchReason: "The site reads as idea-stage or not yet trading.",
  },
  {
    key: "proven",
    label: "Proven rather than idea-stage",
    maxScore: 14,
    structuredKeys: ["proof_signals", "testimonial_signals", "case_study_signals"],
    structured: (s) => {
      const proof = s.count("proof_signals");
      const testimonials = s.flag("testimonial_signals");
      const caseStudies = s.flag("case_study_signals") ?? (s.count("case_study_signals") ?? 0) > 0;
      const supporting = [
        testimonials === true ? "testimonials are published" : "",
        caseStudies === true ? "case studies are published" : "",
      ].filter(Boolean);
      const support = supporting.length > 0 ? ` Supporting evidence: ${supporting.join(" and ")}.` : "";
      const detail = s.evidence("proof_signals");
      const sourceUrls = s.sources(["proof_signals", "testimonial_signals", "case_study_signals"]);

      if (proof !== null && proof >= 2) {
        return {
          state: "met",
          reason: withDetail(
            `${proof} distinct proof points of delivered work are published.${support}`,
            detail,
          ),
          sourceUrls,
        };
      }
      if ((proof !== null && proof === 1) || supporting.length > 0) {
        return {
          state: "partial",
          reason: withDetail(
            `Proof exists but is thin.${support || " Only one proof point was read."}`,
            detail,
          ),
          sourceUrls,
        };
      }
      if (proof === null && testimonials === null && caseStudies !== true) return null;
      return {
        state: "missing",
        reason:
          "No published proof of delivered work was found. Treated as unknown, not as a mismatch.",
      };
    },
    patterns: [
      /\b(testimonial|review|case stud|results|portfolio|clients? logo|press|award|years? in business|since \d{4})\b/,
    ],
    metReason: "Proof of past work is published — testimonials, results, or case studies.",
    partialReason: "Some proof language appears, but it is thin or unattributed.",
    missingReason: "No published proof of delivered work was found. Treated as unknown, not negative.",
  },
  {
    key: "decision_maker",
    label: "Founder / owner reachable",
    maxScore: 12,
    structuredKeys: ["decision_maker_signals", "contact_routes", "team_signals"],
    structured: (s) => {
      const people = s.count("decision_maker_signals");
      const routes = s.count("contact_routes");
      if (people === null && routes === null) return null;
      const detail = s.evidence("decision_maker_signals");
      const routeDetail = s.evidence("contact_routes");
      const sourceUrls = s.sources(["decision_maker_signals", "contact_routes"]);
      const reachability = "Reachability still requires human confirmation.";

      if ((people ?? 0) >= 1 && (routes ?? 0) >= 1) {
        return {
          state: "met",
          reason: withDetail(
            `A named decision maker is public and ${routes} contact route${routes === 1 ? "" : "s"} exist. ${reachability}`,
            [detail, routeDetail].filter(Boolean).join(" "),
          ),
          sourceUrls,
        };
      }
      if ((people ?? 0) >= 1) {
        return {
          state: "partial",
          reason: withDetail(
            `A name or title is published, but a name on a website does not prove reachability. ${reachability}`,
            detail,
          ),
          sourceUrls,
        };
      }
      if ((routes ?? 0) >= 1) {
        return {
          state: "partial",
          reason: withDetail(
            `There is a contact route, but no named decision maker was read. ${reachability}`,
            routeDetail,
          ),
          sourceUrls,
        };
      }
      return {
        state: "missing",
        reason: "No named decision maker and no contact route were found on the public site.",
      };
    },
    patterns: [/\b(founder|owner|ceo|director|principal|about (us|the)|our team|leadership)\b/],
    contextPatterns: [/\b(founder|owner|named contact)\b/],
    metReason: "A named owner, founder, or leader is visible with a way to reach them.",
    partialReason: "There is a contact route, but no named decision maker.",
    missingReason: "No named decision maker was found on the public site.",
  },
  {
    key: "clear_offer",
    label: "Clear offer, service, or process",
    maxScore: 14,
    structuredKeys: ["clear_offer_signals", "pricing_signal"],
    structured: (s) => {
      const offer = s.flag("clear_offer_signals");
      const pricing = s.flag("pricing_signal");
      if (offer === null && pricing === null) return null;
      const detail = s.evidence("clear_offer_signals");
      const sourceUrls = s.sources(["clear_offer_signals", "pricing_signal"]);
      const priced = pricing === true ? " Pricing is also published, which supports this." : "";

      if (offer === true) {
        return {
          state: "met",
          reason: withDetail(`The offer and how it is delivered are stated plainly.${priced}`, detail),
          sourceUrls,
        };
      }
      if (pricing === true) {
        return {
          state: "partial",
          reason:
            "Pricing is published, but the offer itself is not described clearly. Pricing supports the offer, it does not replace it.",
          sourceUrls,
        };
      }
      return {
        state: "missing",
        reason: "No clear offer or service description was read. Treated as unknown.",
      };
    },
    patterns: [/\b(offer|services?|programs?|packages?|pricing|process|how it works|what we do)\b/],
    metReason: "The offer and how it is delivered are stated plainly.",
    partialReason: "The offer is implied but not clearly described.",
    missingReason: "No clear offer or service description was found.",
  },
  {
    key: "limiting_system",
    label: "Current site or system limiting growth",
    maxScore: 18,
    structuredKeys: [
      "contact_routes",
      "booking_signal",
      "clear_offer_signals",
      "proof_signals",
      "active_business_signals",
      "latest_visible_year",
      "milestone_opportunities",
    ],
    structured: (s, milestones) => {
      const routes = s.count("contact_routes");
      const booking = s.flag("booking_signal");
      const offer = s.flag("clear_offer_signals");
      const proof = s.count("proof_signals");
      const active = s.count("active_business_signals");
      const year = s.count("latest_visible_year");
      const currentYear = new Date().getUTCFullYear();

      const gaps: string[] = [];
      if (routes === 0) gaps.push("no lead-capture route was found on the public pages");
      if (booking === false && offer === true) {
        gaps.push("services are described but there is no booking path");
      }
      if (proof === 0 && (active ?? 0) >= 3) {
        gaps.push("the business looks established but publishes no proof");
      }
      if (year !== null && year > 1900 && year < currentYear - 2) {
        gaps.push(`the newest visible date is ${year}, which reads as stale`);
      }
      if (milestones.length > 0) {
        gaps.push(`a concrete opportunity was recorded: ${milestones[0]}`);
      }

      const structuredPresent =
        routes !== null || booking !== null || offer !== null || proof !== null || year !== null;
      if (!structuredPresent && milestones.length === 0) return null;

      const sourceUrls = s.sources(["contact_routes", "booking_signal", "milestone_opportunities"]);
      if (gaps.length >= 2) {
        return {
          state: "met",
          reason: `The current presentation is visibly holding the business back: ${gaps.slice(0, 3).join("; ")}. WordPress alone is not treated as a problem.`,
          sourceUrls,
        };
      }
      if (gaps.length === 1) {
        return {
          state: "partial",
          reason: `One constraint was observed: ${gaps[0]}. Not yet enough to call the system limiting.`,
          sourceUrls,
        };
      }
      return {
        state: "missing",
        reason:
          "No constraint was observed in the current site or tooling. The platform in use, WordPress included, is not itself evidence of a gap.",
      };
    },
    patterns: [
      /\b(outdated|dated|legacy|slow|load time|no https|insecure|not mobile|mobile friendly|responsive|broken|missing|no analytics|no booking|no cms|page speed|accessib)\b/,
    ],
    invert: true,
    metReason: "The current presentation or tooling is visibly holding the business back.",
    partialReason: "There are minor weaknesses, but nothing clearly limiting.",
    missingReason: "No clear constraint was observed in the current site or tooling.",
  },
  {
    key: "first_milestone",
    label: "One first milestone worth selling",
    maxScore: 12,
    structuredKeys: ["milestone_opportunities"],
    structured: (s, milestones) => {
      if (!s.has("milestone_opportunities") && milestones.length === 0) return null;
      if (milestones.length === 0) {
        return {
          state: "missing",
          reason:
            "Only the generic fallback was returned, so no sellable first milestone is identifiable yet.",
        };
      }
      const supported =
        (s.count("contact_routes") ?? null) === 0 ||
        s.flag("booking_signal") === false ||
        (s.count("proof_signals") ?? null) === 0 ||
        Boolean(s.evidence("milestone_opportunities"));
      const detail = s.evidence("milestone_opportunities");
      const sourceUrls = s.sources(["milestone_opportunities"]);
      if (supported) {
        return {
          state: "met",
          reason: withDetail(`A specific first piece of work is supported by evidence: ${milestones[0]}.`, detail),
          sourceUrls,
        };
      }
      return {
        state: "partial",
        reason: `An opportunity is visible — ${milestones[0]} — but nothing observed yet backs it up.`,
        sourceUrls,
      };
    },
    patterns: [/\b(gap|opportunity|recommend|next move|milestone|quick win|fix|improve|rebuild)\b/],
    contextPatterns: [/\b(recommend|first milestone|start with|next move)\b/],
    metReason: "A specific first piece of work is identifiable from the evidence.",
    partialReason: "A direction is visible, but not yet a sellable first milestone.",
    missingReason: "No first milestone is identifiable from what was read.",
  },
  {
    key: "roadmap_depth",
    label: "At least two roadmap possibilities",
    maxScore: 8,
    structuredKeys: ["milestone_opportunities"],
    structured: (s, milestones) => {
      if (!s.has("milestone_opportunities") && milestones.length === 0) return null;
      if (milestones.length >= 2) {
        return {
          state: "met",
          reason: `More than one concrete opportunity is visible: ${milestones.slice(0, 3).join("; ")}.`,
          sourceUrls: s.sources(["milestone_opportunities"]),
        };
      }
      if (milestones.length === 1) {
        return {
          state: "partial",
          reason: `Only one concrete opportunity is visible: ${milestones[0]}.`,
        };
      }
      return {
        state: "missing",
        reason: "No concrete roadmap possibility was recorded beyond the generic fallback.",
      };
    },
    patterns: [/\b(gap|opportunity|roadmap|phase|later|future|then)\b/],
    metReason: "More than one future improvement is visible beyond the first milestone.",
    partialReason: "Only one future possibility is visible.",
    missingReason: "No second roadmap possibility is visible yet.",
  },
  {
    key: "funding_capacity",
    label: "Appears able to fund meaningful work",
    maxScore: 6,
    structuredKeys: ["pricing_signal", "organization_schema", "team_signals"],
    structured: (s) => {
      const pricing = s.flag("pricing_signal");
      if (!s.hasAny(["pricing_signal", "organization_schema", "team_signals"])) return null;
      if (pricing === true) {
        return {
          state: "partial",
          reason:
            "Published pricing is weak evidence of capacity to fund work. Budget is never inferred from schema markup, platform, or generic services.",
          sourceUrls: s.sources(["pricing_signal"]),
        };
      }
      return {
        state: "missing",
        reason:
          "Public pages do not show revenue, budget, or scale. Left unknown rather than assumed.",
      };
    },
    patterns: [/\b(pricing|from \$|per month|packages?|retainer|team of|staff|locations?|enterprise)\b/],
    metReason: "Published pricing, team size, or scale suggests capacity to fund work.",
    partialReason: "There are weak signs of scale, not enough to judge capacity.",
    missingReason:
      "Public pages do not show revenue, budget, or scale. Left unknown rather than assumed.",
  },
];

/** Positive disqualifiers. Only a confirmed reading, never an absence. */
const DISQUALIFIERS: { patterns: RegExp[]; reason: string }[] = [
  {
    patterns: [/\b(coming soon|under construction|parked domain|domain for sale|site not found)\b/],
    reason: "The site is a placeholder rather than a working business presence.",
  },
  {
    patterns: [/\b(pre-?launch|idea stage|concept only|waitlist only)\b/],
    reason: "The business reads as idea-stage rather than already serving people.",
  },
];

function stateScore(state: FitCriterionState, maxScore: number): number {
  if (state === "met") return maxScore;
  if (state === "partial") return Math.round(maxScore * 0.5);
  return 0;
}

/** Concrete opportunities from observations and suggested output, deduped. */
function collectMilestones(structured: Structured, suggested: unknown): string[] {
  const items = [...structured.list("milestone_opportunities")];
  const suggestedRow = (suggested ?? {}) as Row;
  const opportunity = suggestedRow["opportunity_signals"];
  if (Array.isArray(opportunity)) {
    for (const entry of opportunity) {
      const text = typeof entry === "string" ? entry.trim() : renderValue(entry);
      if (text && text !== "—" && !GENERIC_MILESTONE.test(text)) items.push(text);
    }
  }
  return Array.from(new Set(items));
}

/** Pages read for this prospect. Confidence context only, never fit points. */
function readPageCount(structured: Structured, explicit?: number | null): number | null {
  if (typeof explicit === "number" && explicit >= 0) return explicit;
  const observation = structured.get("pages_researched");
  if (!observation) return null;
  const value = observation.value;
  if (typeof value === "number") return value;
  if (Array.isArray(value)) return value.length;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

interface EvaluateInput {
  observed: unknown;
  inferred: unknown;
  suggested: unknown;
  /** Preview/demo rows are neutral by contract. */
  scoreable: boolean;
  icpVersion: number | null;
  /** Timestamp used for `evaluatedAt`. Defaults to now. */
  at?: string;
  /** Number of public pages read. Confidence context only. */
  pagesResearched?: number | null;
  /** `provenance.research_version` when the backend reported one. */
  researchVersion?: number | null;
}

export function evaluateScoutFit(input: EvaluateInput): ScoutFitEvaluation {
  const evaluatedAt = input.at ?? new Date().toISOString();
  const observations = normalizeObservations(input.observed);
  const context = inferredText(input.inferred, input.suggested);
  const structured = new Structured(observations);
  const milestones = collectMilestones(structured, input.suggested);
  const pages = readPageCount(structured, input.pagesResearched ?? null);
  const researchVersion = input.researchVersion ?? null;
  const depthNote =
    pages === null
      ? null
      : pages < 3
        ? "Research depth is thin"
        : `${pages} public page${pages === 1 ? "" : "s"} checked`;

  if (!input.scoreable || observations.length === 0) {
    return {
      score: 0,
      light: "neutral",
      evidenceCount: 0,
      strongestSignal: input.scoreable
        ? "No evidence has been read for this company yet."
        : "Preview demo candidate — not scored against live evidence.",
      criteria: [],
      icpVersion: input.icpVersion,
      evaluatorVersion: SCOUT_EVALUATOR_VERSION,
      evaluatedAt,
      explanation: input.scoreable
        ? "Nothing has been observed yet, so no honest fit can be stated. Research the website to score it."
        : "This is a preview demo row. It is deliberately not scored against the live evidence model.",
      scoreable: false,
      ...(pages !== null ? { pagesResearched: pages } : {}),
      ...(depthNote ? { researchDepthNote: depthNote } : {}),
      ...(researchVersion !== null ? { researchVersion } : {}),
    };
  }

  const criteria: FitCriterion[] = [];
  let evidenceCount = 0;
  let strongest: { criterion: FitCriterion; weight: number } | null = null;

  for (const spec of SPECS) {
    let state: FitCriterionState;
    let reason: string;
    let sourceUrls: string[] = [];

    const structuredResult = spec.structured ? spec.structured(structured, milestones) : null;

    if (structuredResult) {
      state = structuredResult.state;
      reason = structuredResult.reason;
      sourceUrls = structuredResult.sourceUrls ?? [];
    } else {
      const hits = observations.filter((o) => matches(o, spec.patterns));
      const positive = hits.filter((o) => (spec.invert ? o.truth === false : o.truth !== false));
      const negative = hits.filter((o) => (spec.invert ? o.truth === true : o.truth === false));
      const withEvidence = positive.filter((o) => o.evidence || o.sourceUrl);
      const contextHit = spec.contextPatterns?.some((p) => p.test(context)) ?? false;

      if (withEvidence.length >= 2 || (withEvidence.length === 1 && positive.length >= 2)) {
        state = "met";
        reason = spec.metReason;
      } else if (positive.length >= 1 || contextHit) {
        state = "partial";
        reason = spec.partialReason;
      } else if (spec.falseIsMismatch && negative.length >= 2) {
        state = "mismatch";
        reason = spec.mismatchReason ?? spec.missingReason;
      } else {
        state = "missing";
        reason = spec.missingReason;
      }

      const detail = positive.find((o) => o.evidence)?.evidence;
      if (detail && state !== "missing") reason = `${reason} ${detail}`;
      sourceUrls = Array.from(
        new Set(positive.map((o) => o.sourceUrl).filter((u): u is string => Boolean(u))),
      );
    }

    const criterion: FitCriterion = {
      key: spec.key,
      label: spec.label,
      score: stateScore(state, spec.maxScore),
      maxScore: spec.maxScore,
      state,
      reason,
      ...(sourceUrls.length > 0 ? { sourceUrls } : {}),
    };
    criteria.push(criterion);

    if (state === "met") {
      evidenceCount += 1;
      if (!strongest || spec.maxScore > strongest.weight) {
        strongest = { criterion, weight: spec.maxScore };
      }
    }
  }

  const disqualifier = DISQUALIFIERS.find((d) =>
    observations.some((o) => d.patterns.some((p) => p.test(o.text))),
  );
  if (disqualifier) {
    criteria.push({
      key: "disqualifier",
      label: "Material mismatch",
      score: 0,
      maxScore: 0,
      state: "mismatch",
      reason: disqualifier.reason,
    });
  }

  const maxTotal = SPECS.reduce((sum, spec) => sum + spec.maxScore, 0);
  const raw = criteria.reduce((sum, c) => sum + c.score, 0);
  const score = Math.round((raw / maxTotal) * 100);

  const partials = criteria.filter((c) => c.state === "partial").length;
  const hasSufficientEvidence = evidenceCount >= 3;

  let light: FitLight;
  let explanation: string;

  if (disqualifier) {
    light = "red";
    explanation = disqualifier.reason;
  } else if (score >= 75 && hasSufficientEvidence) {
    light = "green";
    explanation = `${evidenceCount} ICP criteria are clearly met with supporting evidence and no disqualifier was found.`;
  } else if (score < 35 && evidenceCount + partials >= 4) {
    light = "red";
    explanation =
      "Enough of the site was read to judge, and the evidence points away from the current ICP.";
  } else if (!hasSufficientEvidence) {
    light = "yellow";
    explanation = `Only ${evidenceCount} ICP criteria are clearly met. Three are required before a company can read green.`;
  } else {
    light = "yellow";
    explanation = "The picture is mixed: real signals are present, but the fit is not yet convincing.";
  }

  const strongestSignal =
    strongest?.criterion.reason ??
    criteria.find((c) => c.state === "partial")?.reason ??
    "No strong signal was observed on the public site.";

  return {
    score,
    light,
    evidenceCount,
    strongestSignal,
    criteria,
    icpVersion: input.icpVersion,
    evaluatorVersion: SCOUT_EVALUATOR_VERSION,
    evaluatedAt,
    explanation,
    scoreable: true,
    ...(pages !== null ? { pagesResearched: pages } : {}),
    ...(depthNote ? { researchDepthNote: depthNote } : {}),
    ...(researchVersion !== null ? { researchVersion } : {}),
  };
}

/** Read a previously persisted evaluation from `metadata.scout_fit`. */
export function storedEvaluation(metadata: unknown): ScoutFitEvaluation | null {
  if (!metadata || typeof metadata !== "object") return null;
  const stored = (metadata as Row)["scout_fit"];
  if (!stored || typeof stored !== "object") return null;
  const candidate = stored as Partial<ScoutFitEvaluation>;
  if (typeof candidate.score !== "number" || !Array.isArray(candidate.criteria)) return null;
  return candidate as ScoutFitEvaluation;
}

export interface FitOverride {
  light: FitLight;
  by: string | null;
  at: string;
}

/** A manual fit override always wins over the evaluator. */
export function fitOverride(metadata: unknown): FitOverride | null {
  if (!metadata || typeof metadata !== "object") return null;
  const stored = (metadata as Row)["scout_fit_override"];
  if (!stored || typeof stored !== "object") return null;
  const light = str((stored as Row)["light"]) as FitLight;
  if (!["green", "yellow", "red", "neutral"].includes(light)) return null;
  return {
    light,
    by: str((stored as Row)["by"]) || null,
    at: str((stored as Row)["at"]) || "",
  };
}

/** Apply a stored manual override to an evaluation, keeping the score honest. */
export function withOverride(
  evaluation: ScoutFitEvaluation,
  metadata: unknown,
): ScoutFitEvaluation {
  const override = fitOverride(metadata);
  if (!override || override.light === evaluation.light) return evaluation;
  return {
    ...evaluation,
    light: override.light,
    explanation: `Fit set manually by a Trust Tai member. The evaluator read this as ${evaluation.light}: ${evaluation.explanation}`,
  };
}

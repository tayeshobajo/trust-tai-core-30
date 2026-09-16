/**
 * The strategic judgment gate.
 *
 * Before a draft is judged as writing, two questions have to be asked about
 * the moment it belongs to:
 *
 *   1. Does this message keep the relationship where the evidence says it
 *      sits? A teammate can coordinate, schedule and support without making
 *      the client feel handed to somebody downstream.
 *   2. Is this a consequential commercial decision being made on autopilot? A
 *      routine rate applied to a non-routine contract is a decision nobody
 *      made.
 *
 * This module is the deterministic half of that gate. The reviewer's
 * instructions ask the model for the same judgment; what is written here is
 * the floor beneath it, so a quiet model cannot let a handoff or an
 * unconsidered price through unremarked.
 *
 * Two laws hold throughout:
 *
 *   - Unknown stays unknown. No relationship lead is inferred where the
 *     packet does not name one, and no commercial signal is imagined.
 *   - No price is ever suggested. These findings say a decision is missing.
 *     They never say what the number should be, and public-sector work is
 *     never treated as automatically worth more.
 */

export type StrategicFindingKind = "relationship" | "commercial";

export interface StrategicFinding {
  kind: StrategicFindingKind;
  /** Both gates block approval: they change whether this draft is fit to send. */
  severity: "must_fix";
  /** Exact words copied from the draft. */
  excerpt: string;
  why: string;
  suggestion: string | null;
}

export interface StrategicPacket {
  draftBody: string;
  draftSubject?: string | null;
  /** The text of every source that could be read. */
  sourceTexts?: string[];
  situation?: string | null;
  goal?: string | null;
  /** The person who actually wrote it. Their identity always wins. */
  authorName?: string | null;
}

/* ------------------------------------------------------------- utilities */

const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function contextOf(packet: StrategicPacket): string {
  return [
    ...(packet.sourceTexts ?? []),
    packet.situation ?? "",
    packet.goal ?? "",
    packet.draftSubject ?? "",
  ]
    .filter(Boolean)
    .join("\n");
}

const firstName = (value: string | null | undefined): string =>
  (value ?? "").trim().split(/[\s,]+/)[0]?.toLowerCase() ?? "";

/* -------------------------------------------------- relationship continuity */

/** Wording that puts somebody else at the far end of a handover. */
const HANDOFF_TAIL =
  /\b(?:walk you through|take you through|talk you through|finali[sz]e|finalize|handle (?:it|the|this)|take (?:it )?(?:over|from here)|be (?:your|the) (?:main )?(?:point of contact|contact)|pick (?:this|it) up|look after)/i;

interface NamedHandoff {
  name: string;
  excerpt: string;
}

/** Sentences in the draft that hand the client to a named person. */
function namedHandoffs(body: string): NamedHandoff[] {
  const found: NamedHandoff[] = [];

  const willPattern = /([A-Z][a-z]+)\s+will\s+(?:also\s+)?([^.\n]+)/g;
  for (const match of body.matchAll(willPattern)) {
    if (HANDOFF_TAIL.test(match[2] ?? "")) {
      found.push({ name: match[1] ?? "", excerpt: match[0].trim() });
    }
  }

  const passPattern =
    /(?:hand(?:ing|ed)?\s+(?:you\s+)?(?:over|off)\s+to|introduce\s+you\s+to|pass(?:ing)?\s+you\s+(?:over\s+)?to|connect\s+you\s+with)\s+([A-Z][a-z]+)[^.\n]*/g;
  for (const match of body.matchAll(passPattern)) {
    found.push({ name: match[1] ?? "", excerpt: match[0].trim() });
  }

  return found.filter((entry) => entry.name.length > 0);
}

/**
 * Whether the packet actually shows this person leading the relationship.
 * Nothing is inferred from a name appearing once: the evidence has to place
 * them with the client, in charge of the work or the conversation.
 */
export function leadsRelationship(name: string, context: string): boolean {
  const who = escape(name);
  const markers = [
    `working (?:directly |closely )?with ${who}`,
    `worked (?:directly |closely )?with ${who}`,
    `(?:call|calls|meeting|meetings|session|sessions|conversation|conversations) with ${who}`,
    `${who} (?:has been |is )?(?:leading|leads|led)`,
    `led by ${who}`,
    `${who} (?:walked|took) (?:us|them|me|the team)`,
    `${who} (?:is|has been) (?:our|the|their) (?:main |primary |usual )?(?:contact|point of contact|adviser|advisor|strategist)`,
    `${who}'s (?:client|account|relationship)`,
    `relationship (?:with|is) (?:led by )?${who}`,
  ];
  return new RegExp(markers.join("|"), "i").test(context);
}

function relationshipFinding(packet: StrategicPacket): StrategicFinding | null {
  const context = contextOf(packet);
  const author = firstName(packet.authorName);

  for (const handoff of namedHandoffs(packet.draftBody)) {
    /* The author writing about their own next step is not a handoff. */
    if (author && firstName(handoff.name) === author) continue;
    if (!leadsRelationship(handoff.name, context)) continue;

    return {
      kind: "relationship",
      severity: "must_fix",
      excerpt: handoff.excerpt,
      why: `The packet shows ${handoff.name} leading this relationship, so these words read as passing the client to a downstream specialist rather than ${handoff.name} staying with them. It changes who the client feels owns the relationship.`,
      suggestion: `Keep your own name as the sender and write the next conversation as ${handoff.name} continuing work they are already leading, with you coordinating it. Do not add anything the packet does not already commit to.`,
    };
  }

  return null;
}

/* ------------------------------------------------- commercial judgment */

/** A price, rate or term the outgoing message is committing to. */
const COMMITMENT_PATTERNS: RegExp[] = [
  /[$£€]\s?\d[\d,]*(?:\.\d{2})?(?:\s*(?:per|\/)\s*(?:hour|hr|day|week|month|milestone))?/i,
  /\b\d[\d,]*(?:\.\d{2})?\s*(?:usd|gbp|eur|dollars|pounds)\b(?:\s*(?:per|\/)\s*(?:hour|hr|day|week|month))?/i,
  /\b(?:standard|usual|default|normal|hourly|day)\s+rate\b[^.\n]*/i,
  /\bfixed(?:\s|-)fee\b[^.\n]*/i,
];

/** A concession, which is a commercial decision whatever else is going on. */
const CONCESSION_PATTERNS: RegExp[] = [
  /\b\d{1,2}\s?%\s*(?:discount|off|reduction)\b[^.\n]*/i,
  /\bdiscount(?:ed)?\b[^.\n]*/i,
  /\breduced rate\b[^.\n]*/i,
  /\bwaiv(?:e|ing|ed)\b[^.\n]*/i,
  /\bfree of charge\b[^.\n]*/i,
  /\bnet\s?(?:30|45|60|90)\b[^.\n]*/i,
  /\bpayment terms\b[^.\n]*/i,
];

/** Words that make an opportunity non-routine. Each is quoted back as evidence. */
const SIGNAL_PATTERNS: [string, RegExp][] = [
  ["public sector", /\b(?:government|public(?:\s|-)sector|municipal(?:ity)?|city council|county|federal|state agency)\b/i],
  ["procurement", /\b(?:rfp|rfq|tender|procurement|solicitation|bid package)\b/i],
  ["invited", /\b(?:invitation to|invited you|invite to (?:apply|bid|submit)|direct invitation|upwork invit)/i],
  ["enterprise buyer", /\b(?:enterprise|multi(?:\s|-)year|nationwide|statewide)\b/i],
  ["compliance burden", /\b(?:compliance|security review|accessibility standard|insurance|background check|reporting requirement|audit)\b/i],
  ["contract burden", /\b(?:master services agreement|contract term|legal review|liability|indemnit)/i],
];

const ALREADY_SETTLED =
  /\b(?:already agreed|as agreed|the agreed rate|agreed rate|agreed terms|approved discount|previously approved|signed off|per (?:our|the) contract|existing retainer|same terms)\b/i;

function firstMatch(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match && match[0].trim()) return match[0].trim();
  }
  return null;
}

/** The non-routine signals the packet actually contains. */
export function commercialSignals(text: string): string[] {
  return SIGNAL_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([label]) => label);
}

const CONSIDERATIONS =
  "scope, procurement and admin burden, reporting and compliance, staffing, contract duration, payment cycle, platform fees, contingency and risk, team compensation, sustainable margin and strategic value";

function commercialFinding(packet: StrategicPacket): StrategicFinding | null {
  const body = packet.draftBody;
  const context = contextOf(packet);
  const settled = ALREADY_SETTLED.test(context) || ALREADY_SETTLED.test(body);

  const concession = firstMatch(body, CONCESSION_PATTERNS);
  if (concession && !settled) {
    return {
      kind: "commercial",
      severity: "must_fix",
      excerpt: concession,
      why: "This offers a concession on price or payment terms that nothing in the packet shows as already approved. A human commercial review is required before approval.",
      suggestion: `Have the person accountable for pricing confirm this concession before approval, or record in the packet what it is being traded for. Consider ${CONSIDERATIONS}. No replacement figure is proposed here.`,
    };
  }

  const commitment = firstMatch(body, COMMITMENT_PATTERNS);
  if (!commitment || settled) return null;

  const signals = [...new Set([...commercialSignals(context), ...commercialSignals(body)])];
  if (signals.length === 0) return null;

  return {
    kind: "commercial",
    severity: "must_fix",
    excerpt: commitment,
    why: `The packet reads as a non-routine commercial decision (${signals.join(", ")}), and nothing in it shows the pricing was decided for this contract rather than carried over from ordinary work. A human commercial review is required before approval.`,
    suggestion: `Confirm the pricing decision, or add the reasoning to the packet, covering ${CONSIDERATIONS} as the evidence makes relevant. This is not a judgment that the figure is wrong, and no replacement figure is proposed here.`,
  };
}

/* ------------------------------------------------------------------ gate */

/**
 * The deterministic findings for one draft. Empty is the normal answer: a
 * routine reply, an acknowledgement with no commitment in it, or repeat work
 * on terms the packet shows as already agreed raises nothing at all.
 */
export function strategicFindings(packet: StrategicPacket): StrategicFinding[] {
  const findings: StrategicFinding[] = [];
  const relationship = relationshipFinding(packet);
  if (relationship) findings.push(relationship);
  const commercial = commercialFinding(packet);
  if (commercial) findings.push(commercial);
  return findings.filter((finding) => packet.draftBody.includes(finding.excerpt));
}

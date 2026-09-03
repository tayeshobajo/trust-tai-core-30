/**
 * Tai's Voice DNA, a drafting policy, not a prompt string.
 *
 * Spirit first. See the human before the transaction. Warmth through
 * specificity, authority through brevity, stewardship through attention.
 *
 * The rules here are enforceable and deterministic. Anything a model writes is
 * checked against them before a person ever sees it, and a heavy moment is
 * always held for human review rather than sent through the same pipe as a
 * logistics note.
 */

export type VoiceRegister = "warm_intro" | "follow_up" | "reconnect" | "logistics" | "sensitive";

export const REGISTER_LABEL: Record<VoiceRegister, string> = {
  warm_intro: "Warm introduction",
  follow_up: "Follow up",
  reconnect: "Reconnect",
  logistics: "Logistics",
  sensitive: "Sensitive or personal",
};

export const REGISTER_GUIDE: Record<VoiceRegister, string> = {
  warm_intro:
    "First contact. One real, seen detail. Say why you are writing and make one small ask.",
  follow_up: "A thread already exists. Add something useful. Do not restate the last message.",
  reconnect: "Time has passed. Lead with the true reason to write now, not with the silence.",
  logistics: "Short, plain, and specific. Times, links, next steps. No warmth performance.",
  sensitive: "Slow down. Fewer words. Never automated. A person writes and approves this one.",
};

/** Registers that a person must read before anything leaves the room. */
export const HUMAN_REVIEW_REGISTERS: VoiceRegister[] = ["sensitive"];

export type VoiceRuleId =
  | "no_em_dash"
  | "no_exclamation"
  | "no_generic_check_in"
  | "no_needy_phrasing"
  | "no_fabricated_familiarity"
  | "no_unconfirmed_promise"
  | "short_cadence"
  | "signoff"
  | "no_corporate_filler";

export type VoiceSeverity = "block" | "flag";

export interface VoiceRule {
  id: VoiceRuleId;
  /** What the rule protects, in Tai's words. */
  because: string;
  severity: VoiceSeverity;
}

export const VOICE_RULES: Record<VoiceRuleId, VoiceRule> = {
  no_em_dash: {
    id: "no_em_dash",
    because: "Tai does not use em dashes. Use a full stop or a comma.",
    severity: "block",
  },
  no_exclamation: {
    id: "no_exclamation",
    because: "Warmth comes from specificity, not from volume.",
    severity: "block",
  },
  no_generic_check_in: {
    id: "no_generic_check_in",
    because: "Checking in says nothing. Say the real reason you are writing.",
    severity: "block",
  },
  no_needy_phrasing: {
    id: "no_needy_phrasing",
    because: "Apologetic or needy phrasing gives away the relationship.",
    severity: "block",
  },
  no_fabricated_familiarity: {
    id: "no_fabricated_familiarity",
    because: "Never claim closeness or knowledge that is not on record.",
    severity: "block",
  },
  no_unconfirmed_promise: {
    id: "no_unconfirmed_promise",
    because: "No promise unless a person has confirmed it.",
    severity: "block",
  },
  short_cadence: {
    id: "short_cadence",
    because: "Short declarative sentences. Authority through brevity.",
    severity: "flag",
  },
  signoff: {
    id: "signoff",
    because: "Email closes with Trust, then Tai.",
    severity: "flag",
  },
  no_corporate_filler: {
    id: "no_corporate_filler",
    because: "Everyday language. No leverage, synergy, or circling back.",
    severity: "flag",
  },
};

/** The professional email signoff. Exact, every time. */
export const EMAIL_SIGNOFF = "Trust,\nTai";

/**
 * Tai's Relationship Voice, the canonical baseline for every message.
 *
 * This is deliberately distinct from Brand Voice. The Voice DNA document
 * below is the organization's editable brand expression; website and content
 * rules (roadmap language, proprietary frameworks, declarative headlines,
 * positioning) belong to that surface and enter an ordinary email only when
 * the actual conversation calls for them. Relationship email is governed by
 * this baseline first. Approved examples and Tai's edits influence style on
 * top of it, they never replace it.
 */
export const TAI_RELATIONSHIP_VOICE: readonly string[] = [
  "Spirit first: see the person before the transaction.",
  "Make them feel specifically seen; honor what they have built or carried when the evidence supports it.",
  "Recognize what matters to them; create spaciousness, never pressure.",
  "Warm, calm, concise, human, specific. Quiet confidence, no performance.",
  "Natural contractions. Short paragraphs. Everyday words.",
  "No corporate language and no generic networking language.",
  "No manufactured urgency and no fake familiarity.",
  "No invented personalization, if it is not in the evidence, it does not exist.",
  "No forced call to action. A natural question is welcome; an ask appears only when the judgment names one.",
  "No em dashes. Close with Trust, then Tai.",
];

/** The default Voice DNA document seeded into a new organization. */
export const DEFAULT_VOICE_DOCUMENT = `# Tai's Voice DNA

## Spirit first
See the human before the transaction. A message is a small act of stewardship,
not a step in a funnel.

## How it sounds
- Warmth through specificity. One real, seen detail beats three compliments.
- Authority through brevity. Short declarative sentences.
- Stewardship through attention. Reference what actually happened.

## Never
- Em dashes.
- Exclamation marks.
- "Just checking in", "touching base", "circling back".
- Needy or apologetic openings.
- Familiarity we have not earned or recorded.
- Any promise a person has not confirmed.

## Always
- Everyday language.
- One clear reason for writing.
- One small, easy next step.
- Close with: Trust, Tai.

## Registers
Warm introduction, follow up, reconnect, logistics, sensitive. Sensitive is
always written and approved by a person.
`;

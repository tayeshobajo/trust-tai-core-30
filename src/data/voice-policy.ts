/**
 * The deterministic Voice DNA pass.
 *
 * Every draft, whether a model wrote it or a person did, goes through here.
 * The checker is pure: the same text always produces the same verdict, so a
 * draft that passes is defensible and a draft that fails names the rule.
 *
 * The model is never trusted to police itself. It proposes; this decides.
 */

import {
  EMAIL_SIGNOFF,
  HUMAN_REVIEW_REGISTERS,
  VOICE_RULES,
  type VoiceRegister,
  type VoiceRuleId,
  type VoiceSeverity,
} from "@/domain/voice";

export interface VoiceViolation {
  ruleId: VoiceRuleId;
  severity: VoiceSeverity;
  /** The phrase that tripped the rule, so a person can see it. */
  excerpt: string;
  because: string;
}

export interface VoiceVerdict {
  /** The text after safe, mechanical repairs (em dashes, signoff). */
  text: string;
  violations: VoiceViolation[];
  /** True when nothing blocking remains. Flags may still be present. */
  passes: boolean;
}

const BANNED_PHRASES: { ruleId: VoiceRuleId; patterns: RegExp[] }[] = [
  {
    ruleId: "no_generic_check_in",
    patterns: [
      /\bjust checking in\b/i,
      /\bchecking in\b/i,
      /\btouching base\b/i,
      /\btouch base\b/i,
      /\bcircling back\b/i,
      /\bfollowing up to see\b/i,
      /\bbumping this\b/i,
    ],
  },
  {
    ruleId: "no_needy_phrasing",
    patterns: [
      /\bsorry to bother\b/i,
      /\bi know you'?re busy\b/i,
      /\bhope (this|i'?m) not\b/i,
      /\bany chance you (could|might)\b/i,
      /\bwould love to pick your brain\b/i,
      /\bplease please\b/i,
      /\bhope that'?s ok\b/i,
    ],
  },
  {
    ruleId: "no_fabricated_familiarity",
    patterns: [
      /\bas always\b/i,
      /\bwe both know\b/i,
      /\bi'?ve been thinking about you\b/i,
      /\bmy friend\b/i,
      /\bgreat catching up\b/i,
      /\bas i mentioned last time\b/i,
    ],
  },
  {
    ruleId: "no_unconfirmed_promise",
    patterns: [
      /\bi guarantee\b/i,
      /\bwe will double\b/i,
      /\bwe'?ll have (it|this) done by\b/i,
      /\bi promise\b/i,
      /\bfree of charge\b/i,
    ],
  },
  {
    ruleId: "no_corporate_filler",
    patterns: [
      /\bleverage\b/i,
      /\bsynerg(y|ies|istic)\b/i,
      /\bbandwidth\b/i,
      /\breach out to touch\b/i,
      /\bat your earliest convenience\b/i,
      /\bper my last email\b/i,
      /\bgame[- ]chang(er|ing)\b/i,
      /\bcutting[- ]edge\b/i,
      /\bseamless\b/i,
    ],
  },
];

/** Sentences longer than this read as a paragraph pretending to be a line. */
const LONG_SENTENCE_WORDS = 32;

function stripSignoff(text: string): { body: string; signoff: string | null } {
  const index = text.lastIndexOf("Trust,");
  if (index === -1) return { body: text, signoff: null };
  return { body: text.slice(0, index).trimEnd(), signoff: text.slice(index).trim() };
}

/**
 * Mechanical repairs only: things with exactly one correct answer.
 * Anything requiring judgement is reported, never silently rewritten.
 */
export function repairVoice(input: string): string {
  return input
    .replace(/\u2014/g, ". ")
    .replace(/\s+--\s+/g, ". ")
    .replace(/\.\s*\.\s*/g, ". ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trimEnd();
}

/** Add the exact Trust Tai signoff when an email is missing one. */
export function ensureSignoff(input: string): string {
  const { body, signoff } = stripSignoff(input);
  if (signoff && /^Trust,\s*\n?\s*Tai\.?$/i.test(signoff)) {
    return `${body}\n\n${EMAIL_SIGNOFF}`;
  }
  return `${body.trimEnd()}\n\n${EMAIL_SIGNOFF}`;
}

export interface VoiceCheckOptions {
  register: VoiceRegister;
  /** Email drafts must close with the signoff. A LinkedIn note must not. */
  requireSignoff?: boolean;
}

/**
 * Read a draft against the Voice DNA.
 *
 * Blocking rules stop a draft from being approved. Flags are shown to the
 * writer and left to their judgement.
 */
export function checkVoice(input: string, options: VoiceCheckOptions): VoiceVerdict {
  const requireSignoff = options.requireSignoff ?? true;
  let text = repairVoice(input);
  if (requireSignoff) text = ensureSignoff(text);

  const violations: VoiceViolation[] = [];
  const add = (ruleId: VoiceRuleId, excerpt: string) => {
    if (violations.some((entry) => entry.ruleId === ruleId && entry.excerpt === excerpt)) return;
    const rule = VOICE_RULES[ruleId];
    violations.push({
      ruleId,
      severity: rule.severity,
      excerpt,
      because: rule.because,
    });
  };

  if (/\u2014/.test(input)) add("no_em_dash", ", ");
  const bang = input.match(/[^\n!]{0,30}!/);
  if (bang) add("no_exclamation", bang[0].trim());

  for (const group of BANNED_PHRASES) {
    for (const pattern of group.patterns) {
      const hit = text.match(pattern);
      if (hit) add(group.ruleId, hit[0]);
    }
  }

  const { body } = stripSignoff(text);
  const sentences = body
    .split(/(?<=[.?])\s+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const long = sentences.find((entry) => entry.split(/\s+/).length > LONG_SENTENCE_WORDS);
  if (long) add("short_cadence", `${long.slice(0, 60)}…`);

  if (requireSignoff && !/Trust,\s*\n\s*Tai/.test(input)) {
    add("signoff", "Missing Trust, Tai");
  }

  return {
    text,
    violations,
    passes: violations.every((entry) => entry.severity !== "block"),
  };
}

/** Heavy moments never leave the room without a person reading them. */
export function requiresHumanReview(register: VoiceRegister, verdict: VoiceVerdict): boolean {
  return HUMAN_REVIEW_REGISTERS.includes(register) || !verdict.passes;
}

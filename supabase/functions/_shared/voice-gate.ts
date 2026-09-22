/**
 * Shared Jev voice pre-gate for edge-function draft writes.
 *
 * Purpose: score an agent-written draft BEFORE it lands in comms_drafts, so a
 * clearly off-voice draft never reaches Tai's approval queue (needs_human_review).
 * It attacks approval-queue latency by bouncing the obvious failures early.
 *
 * GOVERNANCE — read before changing:
 *   - This gate ONLY EVER BOUNCES. It NEVER APPROVES. A "pass" here means the
 *     draft is allowed to proceed to needs_human_review, where the app's
 *     deterministic voice-policy.ts remains the defensible authority at approval
 *     time. This gate is early triage in FRONT of that check, never a substitute.
 *   - FAIL-OPEN. If Jev errors, times out, or the key is missing, the verdict is
 *     "pass" (with reason logged). A broken third-party scorer must never block
 *     legitimate outbound work. The deterministic check still catches it later.
 *   - Hard overrides run in CODE, not Jev: em/en dash, leftover placeholder,
 *     superiority/false-urgency. These DO bounce even when Jev is unreachable,
 *     because they are deterministic and cheap and match Tai's non-negotiables.
 *
 * Spec: workspace/scripts/jev-questions/GATE-SPEC.md (Tai, 2026-09-19).
 */

const JEV_URL = "https://api.typesafe.ai/v1/systemone";
const JEV_KEY = Deno.env.get("TYPESAFE_API_KEY");

// Pass floor on the 0-2 sounds_like_tai score = 7/10 (spec). Confidence floor 0.8.
const PASS_FLOOR = 1.4;
const CONF_FLOOR = 0.8;

export type GateVerdict = "pass" | "bounce" | "error";

export interface GateResult {
  verdict: GateVerdict;
  /** Passed on to the caller: true only when the draft may reach needs_human_review. */
  allow: boolean;
  grade: number | null;
  confidence: number | null;
  reasons: string[];
  /** The full block to merge into the draft's rationale.gate for auditability. */
  audit: Record<string, unknown>;
}

/** The voice rubric. Kept in sync with workspace/scripts/jev-questions/voice-pregate.json. */
const VOICE_QUESTIONS = {
  sounds_like_tai: {
    type: "score",
    instructions:
      "Could a generic AI have written this, or does it sound specifically like Tai Shobajo: settled authority, warmth, zero filler, slightly underwritten rather than over-polished? CRITICAL INVERSION from Tai's own grading of all five registers: POLISH IS A NEGATIVE SIGNAL. When the writing starts proving that it sounds like Tai, it stops sounding like Tai. Score DOWN for manufactured quotable/aphoristic closers, mandatory principle endings, lifted signature phrases used for effect, sensory detail added to satisfy a framework, and casual markers (bro/my guy/emoji/forced teasing) used to simulate closeness. Score UP for a real specific anchor (concrete evidence, shared history, a true detail), restraint (stops when the truth is complete), owning his part, and presence (meets the person or moment at its actual weight). Tai's signal: specificity, presence, restraint, truth.",
    criteria: [
      "Reads like generic AI copy, or is polished/performed to sound like Tai",
      "Neutral, could be many people",
      "Distinctly sounds like Tai: specific, present, restrained, true",
    ],
  },
  sees_person_first: {
    type: "noul",
    instructions:
      "Does the message make the reader feel SEEN before it starts managing them? Seeing the person means accurate recognition of their specific situation. Naming the person plus an accurate observation about their situation COUNTS. A pleasantry does NOT count. A bare status report does NOT count.",
    criteria: {
      true: "Leads with genuine recognition of the person's specific situation",
      false: "Jumps to business with no recognition, or generic filler pleasantry",
    },
  },
} as const;

const EM_EN_DASH = /[‒–—―]/;
const PLACEHOLDER = /\[[a-z_ ]+\]|\{\{[^}]+\}\}|\bTODO\b|\bPLACEHOLDER\b|\bXXX\b/i;
const SUPERIORITY =
  /we('| a)re the best|unlike other agenc|better than (any|other)|act now|limited time|don'?t miss out|last chance|\bhurry\b/i;

/**
 * Deterministic hard overrides. Return a reason string on the FIRST hit, else null.
 * These bounce even when Jev is unreachable.
 */
function hardOverride(text: string, recipient?: string): string | null {
  if (EM_EN_DASH.test(text)) return "hard_override:em_or_en_dash";
  if (PLACEHOLDER.test(text)) return "hard_override:leftover_placeholder";
  if (SUPERIORITY.test(text)) return "hard_override:superiority_or_urgency";
  if (recipient && recipient.trim() && !text.includes(recipient.trim())) {
    return `hard_override:recipient_name_missing:${recipient.trim()}`;
  }
  return null;
}

async function scoreWithJev(
  text: string,
): Promise<{ grade: number | null; confidence: number | null; sees: number | null; raw: unknown }> {
  const res = await fetch(JEV_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${JEV_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ state: text, model: "jev-latest", questions: VOICE_QUESTIONS }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    throw new Error(`Jev HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    answers?: {
      sounds_like_tai?: { score?: number; confidence?: number };
      sees_person_first?: { noul?: number };
    };
  };
  const a = data.answers ?? {};
  return {
    grade: a.sounds_like_tai?.score ?? null,
    confidence: a.sounds_like_tai?.confidence ?? null,
    sees: a.sees_person_first?.noul ?? null,
    raw: data,
  };
}

/**
 * Gate a draft. Fail-open on any Jev error. Never approves; only decides whether
 * the draft may proceed to needs_human_review (allow=true) or must bounce
 * (allow=false -> caller writes review_state 'needs_redraft').
 */
export async function gateDraft(
  text: string,
  opts: { recipient?: string; messageType?: "first" | "ongoing" } = {},
): Promise<GateResult> {
  const at = new Date().toISOString();

  // 1. Hard overrides first — deterministic, run even if Jev is down.
  const override = hardOverride(text, opts.recipient);
  if (override) {
    return {
      verdict: "bounce",
      allow: false,
      grade: null,
      confidence: null,
      reasons: [override],
      audit: { at, layer: "hard_override", reason: override, jev_called: false },
    };
  }

  // 2. Jev score — fail-open.
  if (!JEV_KEY) {
    return {
      verdict: "error",
      allow: true, // fail-open: missing key must not block outbound work
      grade: null,
      confidence: null,
      reasons: ["jev_key_missing:failed_open"],
      audit: { at, layer: "jev", error: "TYPESAFE_API_KEY not set", failed_open: true },
    };
  }

  try {
    const { grade, confidence, sees, raw } = await scoreWithJev(text);
    if (grade === null) {
      return {
        verdict: "error",
        allow: true,
        grade: null,
        confidence: null,
        reasons: ["jev_no_grade:failed_open"],
        audit: { at, layer: "jev", error: "no grade in response", raw, failed_open: true },
      };
    }

    const meetsGrade = grade >= PASS_FLOOR;
    const meetsConf = (confidence ?? 0) >= CONF_FLOOR;
    // Low confidence is NOT a bounce here: bouncing on low confidence would let a
    // flaky score suppress a fine draft. Low-confidence passes to human review
    // (where the deterministic check runs). Only a confident low grade bounces.
    const allow = meetsGrade || !meetsConf;
    const reasons: string[] = [];
    if (!meetsGrade) reasons.push(`low_grade:${grade.toFixed(2)}<${PASS_FLOOR}`);
    if (!meetsConf) reasons.push(`low_confidence:${(confidence ?? 0).toFixed(2)}:passed_to_human`);
    if (opts.messageType === "first" && sees !== null && sees < 0.5) {
      reasons.push(`first_contact_low_recognition:${sees.toFixed(2)}`);
    }

    return {
      verdict: allow ? "pass" : "bounce",
      allow,
      grade,
      confidence: confidence ?? null,
      reasons,
      audit: {
        at,
        layer: "jev",
        grade,
        confidence,
        sees_person: sees,
        message_type: opts.messageType ?? null,
        pass_floor: PASS_FLOOR,
        conf_floor: CONF_FLOOR,
      },
    };
  } catch (err) {
    // Fail-open on network/timeout/parse error.
    return {
      verdict: "error",
      allow: true,
      grade: null,
      confidence: null,
      reasons: [`jev_error:failed_open`],
      audit: {
        at,
        layer: "jev",
        error: err instanceof Error ? err.message : String(err),
        failed_open: true,
      },
    };
  }
}

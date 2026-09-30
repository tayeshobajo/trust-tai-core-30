/**
 * Scout intro composer: writes a Touch 1 intro FROM the prospect's recorded
 * evidence instead of filling a template.
 *
 * Why this exists: templated intros (fixed opener, one personalized middle
 * sentence, fixed closer) were structurally identical across the whole queue
 * and scored 0.6-1.1 on the Jev sounds_like_tai scale, because sameness and
 * polish are negative signals in that rubric. The doctrine
 * (workspace/trust-tai/playbooks/outreach-sequence-doctrine.md) is explicit:
 * personalization is not mentioning something about the prospect, it is
 * letting what you learned change what you say next. A draft passes only if
 * it could not reasonably have been sent to anyone else.
 *
 * Governance:
 *  - Evidence-only. The composer sees the statements Scout actually recorded
 *    (world_card, scout_intel, observed, why_it_fits). Nothing else exists.
 *  - FAIL CLOSED. No evidence, no provider, or an unreadable reply means no
 *    draft. A mail-merge fallback is exactly the failure this replaces.
 *  - The composer never sends. Its output goes through the same voice gate
 *    and lands in needs_human_review like every other scout draft.
 */

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const COMPOSER_MODEL = Deno.env.get("SCOUT_INTRO_MODEL") ?? "claude-sonnet-4-5";

export const COMPOSER_VERSION = "scout-intro-composer/2026-09-30";

export type ComposeErrorCode =
  | "insufficient_evidence"
  | "composer_unavailable"
  | "compose_unreadable";

export class ComposeError extends Error {
  constructor(
    readonly code: ComposeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ComposeError";
  }
}

export interface EvidenceLine {
  statement: string;
  source: string;
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function pushUnique(out: EvidenceLine[], statement: string, source: string): void {
  const text = statement.trim();
  if (!text) return;
  if (out.some((line) => line.statement === text)) return;
  out.push({ statement: text, source });
}

/**
 * Everything on record about this prospect, flattened to cited statements.
 * Mirrors the app's World Card composer fields (src/data/world-card.ts)
 * without porting it: the serialized card is read where it exists, and the
 * rawer stores are read where it does not.
 */
export function prospectEvidence(prospect: {
  metadata?: unknown;
  observed?: unknown;
  inferred?: unknown;
  provenance?: unknown;
}): EvidenceLine[] {
  const out: EvidenceLine[] = [];
  const metadata = (prospect.metadata ?? {}) as Record<string, unknown>;

  const card = (metadata["world_card"] ?? {}) as Record<string, unknown>;
  const cardFields: [string, string][] = [
    ["building", "world_card.building"],
    ["cares_about", "world_card.cares_about"],
    ["recent_changes", "world_card.recent_changes"],
    ["vision_outgrew_system", "world_card.vision_outgrew_system"],
    ["why_trust_tai", "world_card.why_trust_tai"],
  ];
  for (const [field, source] of cardFields) {
    const items = card[field];
    if (Array.isArray(items)) {
      for (const item of items) pushUnique(out, str(item), source);
    }
  }

  const intel = (metadata["scout_intel"] ?? {}) as Record<string, unknown>;
  for (const field of ["buying_signals", "opportunities"]) {
    const items = intel[field];
    if (Array.isArray(items)) {
      for (const item of items) {
        if (typeof item === "string") pushUnique(out, item, `scout_intel.${field}`);
        else if (item && typeof item === "object") {
          pushUnique(
            out,
            str((item as Record<string, unknown>)["statement"]),
            `scout_intel.${field}`,
          );
        }
      }
    }
  }

  if (Array.isArray(prospect.observed)) {
    for (const item of prospect.observed) {
      if (typeof item === "string") pushUnique(out, item, "prospect.observed");
      else if (item && typeof item === "object") {
        const row = item as Record<string, unknown>;
        pushUnique(
          out,
          str(row["evidence"]) || str(row["statement"]) || str(row["fact"]),
          str(row["source_url"]) || "prospect.observed",
        );
      }
    }
  }

  const inferred = (prospect.inferred ?? {}) as Record<string, unknown>;
  pushUnique(out, str(inferred["why_it_fits"]), "prospect.inferred.why_it_fits");
  pushUnique(out, str(inferred["summary"]), "prospect.inferred.summary");

  const provenance = (prospect.provenance ?? {}) as Record<string, unknown>;
  pushUnique(out, str(provenance["why_sourced"]), "prospect.provenance.why_sourced");

  return out;
}

/** True when the record carries at least one statement a stranger could not guess. */
export function evidenceIsDistinctive(evidence: EvidenceLine[]): boolean {
  return evidence.some((line) => line.statement.length >= 40);
}

/**
 * The person to address. Scout stores prospects as
 * "Daner Wealth Management (Marc Daner, CFP/ChFC)"; the human name lives in
 * the parenthetical when there is one.
 */
export function recipientFirstName(companyName: string): string {
  const paren = companyName.match(/\(([^)]+)\)/);
  const inside = paren?.[1]?.split(",")[0]?.trim() ?? "";
  const candidate = inside || companyName.trim();
  const first = candidate.split(/\s+/)[0] ?? "";
  return /^[A-Z][a-z]+$/.test(first) ? first : "";
}

const COMPOSER_INSTRUCTIONS = `You write one short first-contact note from Tai Shobajo, founder of Trust Tai,
to a business owner he has researched but never met. This is Touch 1 of a long
sequence: its only job is "Interesting guy. He clearly looked at us. This
doesn't feel like spam."

THE ONE RULE. Personalization is not mentioning a fact about them.
Personalization is letting what you learned CHANGE WHAT YOU SAY. Your note
passes only if it could not reasonably have been sent to anyone else. Compose
the whole note from the evidence: pick the single strongest statement, decide
what it says about the person who built this business, and let that thought
shape the opening, the structure, and the way Tai introduces himself.

Tai's position: he helps founder-led businesses turn where they are trying
to go into a clear digital Roadmap, then builds the systems behind it. That
is the MEANING, never the wording. The phrases "turn where they're trying to
go", "clear digital Roadmap", and "build the systems behind it" are banned
verbatim; every note phrases who Tai is freshly, in plain words a person
would say out loud, and differently from every recently_used_openings entry.
Acceptable shapes to riff on, never copy: "I map out what a business's
digital side should become, then my team builds it." / "I spend my days
helping founders figure out what to build next, and then building it." /
"I run Trust Tai. We plan first, build second." Never call Trust Tai a web
development agency.

WHAT MAY BE SPOKEN. Touch 1 voices RECOGNITION ONLY: what they built, how
long, what it says about them. Evidence about gaps, their website, intake,
forms, tiers, "the path in", or what is missing may steer WHICH strength you
recognize and how Tai describes himself, but the note NEVER says the gap out
loud. No diagnosis, no "but right now", no "that works until it doesn't", no
observation about their site or how clients reach them. That analysis belongs
to a later message and saying it here reads as an audit, which kills trust.

Structure is NOT fixed. Vary it note to note:
- Do not open with Tai introducing himself. Open from the evidence: the one
  thing he noticed, stated plainly, the way you'd mention it to a friend.
- 3 to 4 sentences before the signature, total. Slightly underwritten beats
  polished. Stop when the truth is complete. A note that feels a touch too
  short is right; a note that explains is wrong.
- Tai's self-introduction is ONE plain sentence, no list of services, no
  "for you that might look like", no promised outcomes. He says who he is
  the way a person does at a dinner party, not the way a landing page does.
- No ask of any kind: no call, no calendar, no "happy to chat", no reply
  bait, no "if that's a conversation worth having". Simply close, or leave
  the door open in five words or fewer.
- The last sentence is the self-introduction or a plain close. Never a
  clever line, a principle, or a callback. If the ending sounds quotable,
  delete it and end earlier.

Voice, non-negotiable:
- True over warm. Research deeply, reveal lightly: exactly ONE concrete fact
  from the evidence, and one modest thought about it. Prefer the fact with
  proper nouns, dates, or numbers in it (a show name, a year, a publication
  month); named specifics are what make the note impossible to send to
  anyone else. Never enumerate their activities, credentials, or offerings;
  a list proves research was done, which is the opposite of the point.
- The thought stays earthbound: what the fact shows about how they work,
  said the way you'd say it across a table. Good: "That's two decades of
  showing up in the same market, under your own name, doing the work." Do
  not interpret the fact into meaning about their character or story. The
  words "that's not" may not appear anywhere in the note (the "that's not
  X, it's Y" reframe is a tell). Also banned: "that takes a", "rare",
  "remarkable", "a different kind of", "says a lot about", anything that
  awards them a quality or medal.
- Never comment on their website, About page, copy, intake, funnel, booking
  path, or how they present themselves online. Not even as a compliment.
  No sentence about what exists or is missing between a client and them.
  Tai noticed the business, not the site.
- Everyday words, natural contractions, quiet confidence. No performed
  admiration, no flattery, no superlatives, no quoting their testimonials
  back at them, no guessed emotional backstory.
- NEVER use an em dash or en dash anywhere. No exclamation marks.
- Banned words: very, really, just, actually, leverage (as a verb), synergy,
  passionate, excited.
- Banned phrases, these are burned from earlier campaigns and read as
  template: "caught my attention", "I'm not reaching out to sell you a
  website", "outgrown the way", "worth introducing myself", "came across",
  "I work with founder-led businesses that".
- recently_used_openings lists how recent notes began. Your opening sentence
  must not resemble any of them in shape or wording.
- Only the evidence provided exists. Never invent a fact, a detail, a shared
  connection, or a location.

When recipient_first_name is a real person's first name, address them by it
on its own line, with a comma, as the first line of the body. When it is
empty, write NO salutation line at all and never address the reader by the
business name; instead mention the business by name naturally inside the
note. End the body with exactly this signature block:

Tai
Founder, Trust Tai
Strategy -> Roadmap -> Build

Subject line: specific and plain, under eight words, lowercase-normal
capitalization, no punctuation tricks. It should read like a person typed it.

Return JSON only: {"subject": string, "body": string}`;

interface ComposeInput {
  recipient: string;
  companyName: string;
  websiteUrl: string | null;
  evidence: EvidenceLine[];
  recentOpenings: string[];
}

/** Strip the failure modes the voice gate hard-bounces, without a second model call. */
function sanitize(text: string): string {
  return text
    .replace(/\s*[‒–—―]\s*/g, ", ")
    .replace(/!/g, ".")
    .trim();
}

export async function composeIntro(
  input: ComposeInput,
): Promise<{ subject: string; body: string; model: string }> {
  if (!evidenceIsDistinctive(input.evidence)) {
    throw new ComposeError(
      "insufficient_evidence",
      "No distinctive evidence is on record for this prospect, so a genuine intro cannot be composed. Attach evidence first.",
    );
  }
  if (!ANTHROPIC_KEY) {
    throw new ComposeError(
      "composer_unavailable",
      "ANTHROPIC_API_KEY is not set for this function, so no intro can be composed.",
    );
  }

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: COMPOSER_MODEL,
      max_tokens: 700,
      temperature: 1,
      system: COMPOSER_INSTRUCTIONS,
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            recipient_first_name: input.recipient,
            company: input.companyName,
            website: input.websiteUrl,
            evidence: input.evidence,
            recently_used_openings: input.recentOpenings,
          }),
        },
      ],
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    throw new ComposeError(
      "composer_unavailable",
      `Composer provider error (HTTP ${res.status}).`,
    );
  }
  const data = (await res.json()) as {
    content?: { type: string; text?: string }[];
    model?: string;
  };
  const text = (data.content ?? [])
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("");
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new ComposeError("compose_unreadable", "Composer returned no readable draft.");
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    throw new ComposeError("compose_unreadable", "Composer returned unparseable JSON.");
  }
  const subject = sanitize(str(parsed["subject"]));
  const body = sanitize(str(parsed["body"]));
  if (!subject || !body) {
    throw new ComposeError("compose_unreadable", "Composer returned an empty subject or body.");
  }
  return { subject, body, model: data.model ?? COMPOSER_MODEL };
}

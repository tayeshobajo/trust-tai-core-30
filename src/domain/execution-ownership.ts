/**
 * Trust Tai OS, the execution ownership law.
 *
 * Roadmap proposes. It never executes, and it never decides on its own which
 * room will carry the work by borrowing a room's name from a sentence a model
 * happened to write. Ownership is deterministic here, in one place, so no
 * surface, prompt, projection or learned pattern can drift.
 *
 * The law:
 *   Projects  engineering and product delivery: websites, apps, software,
 *             dashboards, prototypes, integrations, feature builds.
 *   Ops       engineering maintenance, support and recurring technical work.
 *   Studio    Trust Tai content and creative production only: blog, newsletter,
 *             LinkedIn, Substack, social, campaign assets, media production.
 *
 * Studio is never a general builder. Engineering work is never collapsed into
 * Studio, whatever wording arrives from a provider or a person.
 */

/** The three rooms that can actually carry a milestone to done. */
export type ExecutionRoom = "projects" | "ops" | "studio";

export const EXECUTION_ROOMS: ExecutionRoom[] = ["projects", "ops", "studio"];

export const EXECUTION_ROOM_LABEL: Record<ExecutionRoom, string> = {
  projects: "Projects",
  ops: "Ops",
  studio: "Studio",
};

export const EXECUTION_ROOM_LAW: Record<ExecutionRoom, string> = {
  projects:
    "Projects carries engineering and product delivery: websites, apps, software, dashboards, prototypes, integrations and feature builds.",
  ops: "Ops carries maintenance, support, incidents and recurring technical operations.",
  studio:
    "Studio carries Trust Tai content and creative production only: blog, newsletter, LinkedIn, Substack, social, campaign assets and media.",
};

/* ------------------------------------------------------------- vocabulary */

/** Words that mean software gets built. These can only ever mean Projects. */
const ENGINEERING = [
  "app",
  "application",
  "platform",
  "portal",
  "website",
  "web app",
  "site",
  "software",
  "dashboard",
  "prototype",
  "mvp",
  "feature",
  "build out",
  "integration",
  "integrate",
  "api",
  "database",
  "schema",
  "automation",
  "workflow tool",
  "booking system",
  "calculator",
  "configurator",
  "checkout",
  "login",
  "authentication",
  "engineering",
  "implementation",
  "implement",
  "deploy",
  "codebase",
  "interactive",
];

/** Words that mean keeping something already live healthy. Ops. */
const MAINTENANCE = [
  "maintenance",
  "maintain",
  "support",
  "upkeep",
  "monitoring",
  "monitor",
  "uptime",
  "incident",
  "hosting",
  "patch",
  "security update",
  "backup",
  "retainer",
  "recurring",
  "ongoing technical",
  "helpdesk",
  "sla",
  "bug fixes",
];

/** Words that mean content and creative production. Studio, and only this. */
const CONTENT = [
  "blog",
  "article",
  "newsletter",
  "linkedin",
  "substack",
  "social post",
  "social content",
  "content series",
  "content calendar",
  "editorial",
  "campaign asset",
  "copywriting",
  "brand story",
  "case study",
  "video",
  "podcast",
  "photography",
  "creative production",
  "thought leadership",
];

function hits(haystack: string, words: string[]): string[] {
  return words.filter((word) => haystack.includes(word));
}

/** Every vocabulary term the classifier actually matched, kept for QA. */
export interface OwnershipSignals {
  engineering: string[];
  maintenance: string[];
  content: string[];
}

export interface OwnershipRead {
  primary: ExecutionRoom;
  /** What the words said. Exposed so a person can audit the decision. */
  signals: OwnershipSignals;
  /** Real secondary dependencies, never a replacement for the primary owner. */
  secondary: ExecutionRoom[];
  /** One plain sentence: why this room carries it. */
  because: string;
}

/**
 * Deterministic. Engineering language always wins over content language,
 * because a dashboard with a launch post is still a build. Pure maintenance
 * goes to Ops. Content only, with nothing to build, goes to Studio. When
 * nothing is recognised, the default is Projects: proposing a milestone means
 * something gets made, and Studio must never be the fallback builder.
 */
export function classifyExecutionOwner(...parts: (string | null | undefined)[]): OwnershipRead {
  const text = parts.filter(Boolean).join(" ").toLowerCase();

  const engineering = hits(text, ENGINEERING);
  const maintenance = hits(text, MAINTENANCE);
  const content = hits(text, CONTENT);

  const signals: OwnershipSignals = { engineering, maintenance, content };

  if (engineering.length > 0) {
    const secondary: ExecutionRoom[] = [];
    if (content.length > 0) secondary.push("studio");
    if (maintenance.length > 0) secondary.push("ops");
    return {
      primary: "projects",
      signals,
      secondary,
      because:
        secondary.length > 0
          ? `This is a build, so Projects carries it. ${secondary
              .map((room) => EXECUTION_ROOM_LABEL[room])
              .join(" and ")} supports it, and does not own it.`
          : "This is a build, so Projects carries it.",
    };
  }

  if (maintenance.length > 0) {
    return {
      primary: "ops",
      signals,
      secondary: [],
      because: "This is recurring technical work on something already live, so Ops carries it.",
    };
  }

  if (content.length > 0) {
    return {
      primary: "studio",
      signals,
      secondary: [],
      because: "This is content and creative production, so Studio carries it.",
    };
  }

  return {
    primary: "projects",
    signals,
    secondary: [],
    because: "Nothing here reads as content or maintenance, so delivery sits with Projects.",
  };
}

/** True when a room may never be the primary owner of this work. */
export function isOwnershipAllowed(room: ExecutionRoom, read: OwnershipRead): boolean {
  return read.primary === room;
}

/* ------------------------------------------------- execution boundary copy */

const ROOM_CLAIM =
  /\b(Studio|Projects|Ops|Trust Tai Studio)\b(?=\s+(?:will\s+)?(?:builds?|build|designs?|develops?|ships?|delivers?|implements?|creates?|produces?|maintains?))/gi;

/**
 * Rewrite a boundary sentence so it names the room that actually owns the
 * work. Only the room name is touched: what the sentence promises is left
 * exactly as written, because that is the author's scope, not ours.
 */
export function correctExecutionBoundary(
  boundary: string | null | undefined,
  owner: ExecutionRoom,
): string {
  const text = (boundary ?? "").trim();
  if (!text) return "";
  return text.replace(ROOM_CLAIM, EXECUTION_ROOM_LABEL[owner]);
}

/** The boundary as it should read, with the owner resolved from the milestone. */
export function ownedExecutionBoundary(input: {
  name?: string | null;
  whatWeBuild?: string | null;
  executionBoundary?: string | null;
}): { owner: OwnershipRead; boundary: string } {
  const owner = classifyExecutionOwner(
    input.name,
    input.whatWeBuild,
    input.executionBoundary,
  );
  return { owner, boundary: correctExecutionBoundary(input.executionBoundary, owner.primary) };
}

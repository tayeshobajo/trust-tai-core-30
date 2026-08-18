/**
 * §5 Normalized document structure — provider-neutral shape all adapters
 * produce before extraction. No provider-specific types leak past this file.
 */
import { createHash } from "crypto";

export interface NormalizedMessage {
  role: "user" | "assistant" | "system" | "unknown";
  author?: string;
  at?: string;
  body: string;
}

export interface NormalizedDocument {
  source_id: string;
  provider: "chatgpt" | "claude" | "google_doc" | "notion" | "upload" | "other";
  title: string;
  authors: string[];
  messages: NormalizedMessage[];
  attachments: { name: string; kind?: string }[];
  imported_at: string;
  /** Fingerprint of the full content — incremental import key. */
  content_hash: string;
}

export function normalizeDocument(input: {
  source_id: string;
  provider: NormalizedDocument["provider"];
  title: string;
  raw: string;
  authors?: string[];
}): NormalizedDocument {
  // Chat export heuristics: message-block formats used by ChatGPT and Claude
  // share/exports ("You:"/"ChatGPT:" / "Human:"/"Assistant:" / markdown
  // speaker turns). Speaker-split first; fall back to whole-text single block.
  const speakerRe =
    /^(?:You|User|Human|Me|Tai)\s*:|^ChatGPT\s*:|^Assistant\s*:|^Claude\s*:/im;
  const lines = input.raw.split(/\r?\n/);
  const messages: NormalizedMessage[] = [];
  let current: { role: NormalizedMessage["role"]; body: string[] } | null = null;

  const roleOf = (line: string): NormalizedMessage["role"] | null => {
    if (/^(?:You|User|Human|Me|Tai)\s*:/i.test(line)) return "user";
    if (/^(?:ChatGPT|Assistant|Claude)\s*:/i.test(line)) return "assistant";
    return null;
  };

  for (const line of lines) {
    const role = speakerRe.test(line) ? roleOf(line) : null;
    if (role) {
      if (current) messages.push({ role: current.role, body: current.body.join("\n").trim() });
      current = { role, body: [line.replace(/^[^:]*:\s*/, "")] };
    } else if (current) {
      current.body.push(line);
    }
  }
  if (current) messages.push({ role: current.role, body: current.body.join("\n").trim() });

  const body = messages.filter((m) => m.body.length > 0);
  if (body.length === 0) {
    body.push({ role: "unknown", body: input.raw.trim() });
  }

  return {
    source_id: input.source_id,
    provider: input.provider,
    title: input.title,
    authors: input.authors ?? [],
    messages: body,
    attachments: [],
    imported_at: new Date().toISOString(),
    content_hash: createHash("sha256").update(input.raw).digest("hex"),
  };
}

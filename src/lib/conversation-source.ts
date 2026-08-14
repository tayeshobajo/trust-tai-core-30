/**
 * Parsing a pasted conversation link into a safe source reference.
 *
 * Browser-safe on purpose: the room can tell a person whether a link is
 * readable before anything is sent to the server. No key is involved here.
 */

import type { ConversationProvider, ConversationSourceRef } from "@/domain/steward";

const FATHOM_HOSTS = ["fathom.video", "www.fathom.video", "app.fathom.video", "fathom.ai"];

/** Recognise a Fathom call link and pull the id or share token out of it. */
export function parseFathomRef(input: string): ConversationSourceRef | null {
  const raw = input.trim();
  if (!raw) return null;

  const numeric = raw.match(/^\d{6,}$/);
  if (numeric) {
    return { provider: "fathom", externalId: raw, url: `https://fathom.video/calls/${raw}` };
  }

  let url: URL;
  try {
    url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (!FATHOM_HOSTS.includes(url.hostname.toLowerCase())) return null;

  const parts = url.pathname.split("/").filter(Boolean);
  const last = parts[parts.length - 1] ?? "";
  const isShare = parts.includes("share");
  if (!last) return null;

  return {
    provider: "fathom",
    ...(isShare ? { shareToken: last } : { externalId: last.replace(/[^\w-]/g, "") }),
    url: url.toString(),
  };
}

/** Every provider Steward can parse today. Unknown links are refused, not guessed. */
export function parseConversationLink(input: string): ConversationSourceRef | null {
  return parseFathomRef(input);
}

export function providerLabel(provider: ConversationProvider): string {
  switch (provider) {
    case "fathom":
      return "Fathom";
    case "fixture":
      return "Rehearsal transcript";
    case "manual":
      return "Entered by hand";
    default:
      return provider;
  }
}

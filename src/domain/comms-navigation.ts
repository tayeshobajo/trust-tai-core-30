/** Keep legacy bookmarks pointed at the exact conversation record. */
export function conversationSearch(search: Record<string, unknown>): {
  relationship?: string;
  thread?: string;
  message?: string;
} {
  return Object.fromEntries(
    ["relationship", "thread", "message"].flatMap((key) =>
      typeof search[key] === "string" && search[key] ? [[key, search[key]]] : [],
    ),
  );
}

import type { QueryClient, QueryKey } from "@tanstack/react-query";

/** The editor writes one canonical task that can appear in both bounded reads. */
export async function refreshStewardBoardReads(
  client: QueryClient,
  businessKey: QueryKey,
  org: string,
  user: string,
) {
  await Promise.all([
    client.invalidateQueries({ queryKey: businessKey }),
    client.invalidateQueries({ queryKey: ["steward", "forward-sources", org, user] }),
  ]);
}

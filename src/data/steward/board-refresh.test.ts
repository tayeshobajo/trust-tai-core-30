import { QueryClient } from "@tanstack/react-query";
import { expect, it } from "vitest";
import { refreshStewardBoardReads } from "./board-refresh";

it("invalidates both editor reads, including a carry outside the bounded board, without invalidating another user", async () => {
  const client = new QueryClient();
  const board = ["business", "org", "user"];
  const carries = ["steward", "forward-sources", "org", "user", ["event"]];
  const other = ["steward", "forward-sources", "org", "other", ["event"]];
  for (const key of [board, carries, other]) client.setQueryData(key, { revision: 1 });
  await refreshStewardBoardReads(client, board, "org", "user");
  expect(client.getQueryState(board)?.isInvalidated).toBe(true);
  expect(client.getQueryState(carries)?.isInvalidated).toBe(true);
  expect(client.getQueryState(other)?.isInvalidated).toBe(false);
  const reloaded = await client.fetchQuery({
    queryKey: carries,
    queryFn: async () => ({ revision: 2, status: "complete", owner: "New", due: "2026-10-25" }),
  });
  expect(reloaded).toEqual({ revision: 2, status: "complete", owner: "New", due: "2026-10-25" });
});

import type { DatabaseSync } from "node:sqlite";
import { digest } from "./studio-research-coordinator-contracts";
import type { RouteEnvelope } from "./studio-research-route-transport.server";
/** Caller provides a private coordinator-owned database, never a browser-selected path. */
export function createRouteLedger(db: DatabaseSync) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS studio_route_requests(nonce TEXT PRIMARY KEY,digest TEXT NOT NULL,state TEXT NOT NULL,response TEXT)",
  );
  return {
    claim(e: RouteEnvelope) {
      const hash = digest(e);
      const inserted = db
        .prepare("INSERT OR IGNORE INTO studio_route_requests VALUES(?,?,'claimed',NULL)")
        .run(e.nonce, hash).changes;
      const row = db
        .prepare("SELECT digest,state,response FROM studio_route_requests WHERE nonce=?")
        .get(e.nonce)!;
      if (row["digest"] !== hash) throw Error("replay_mismatch");
      return { claimed: !!inserted, response: row["response"] as string | null };
    },
    finish(e: RouteEnvelope, token: string) {
      if (
        db
          .prepare(
            "UPDATE studio_route_requests SET state='done',response=? WHERE nonce=? AND digest=? AND state='claimed'",
          )
          .run(token, e.nonce, digest(e)).changes !== 1
      )
        throw Error("receipt_conflict");
    },
  };
}

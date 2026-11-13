/** Local durable v2 attempt/receipt ledger. Never resets or updates the legacy singleton or jobs. */
import { DatabaseSync } from "node:sqlite";
import { type KeyObject } from "node:crypto";
import { CoordinatorStore } from "./studio-research-coordinator-store.server";
import { digest } from "./studio-research-coordinator-contracts";
import { verifySignedJson } from "./studio-research-coordinator-authority.server";
import {
  attemptBinding,
  assertAttemptCurrent,
  parseAttemptApproval,
  verifyPhaseChain,
  type AttemptApproval,
} from "./studio-research-attempt-contracts.server";
import { type TimingBinding } from "./studio-research-timing-candidate.server";
export class AttemptStore {
  private db: DatabaseSync;
  constructor(
    private path: string,
    private receiptKey: KeyObject,
  ) {
    // Reuse private file/path validation. No legacy data mutation occurs on opening existing tables.
    const legacy = new CoordinatorStore(path);
    legacy.close();
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA busy_timeout=1000; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS studio_attempt_approvals(attempt_id TEXT PRIMARY KEY, approval TEXT NOT NULL, approval_digest TEXT NOT NULL UNIQUE, prior_run_id TEXT NOT NULL UNIQUE);
      CREATE TABLE IF NOT EXISTS studio_attempt_claims(attempt_id TEXT PRIMARY KEY REFERENCES studio_attempt_approvals(attempt_id), binding_digest TEXT NOT NULL, claimed_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS studio_attempt_receipts(attempt_id TEXT NOT NULL, sequence INTEGER NOT NULL, token TEXT NOT NULL, PRIMARY KEY(attempt_id,sequence));
      CREATE TABLE IF NOT EXISTS studio_attempt_cancellations(attempt_id TEXT PRIMARY KEY, cancelled_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS studio_attempt_settlements(attempt_id TEXT PRIMARY KEY, outcome TEXT NOT NULL, settled_at INTEGER NOT NULL);
      ${["studio_attempt_approvals", "studio_attempt_claims", "studio_attempt_receipts", "studio_attempt_cancellations", "studio_attempt_settlements"].map((t) => `CREATE TRIGGER IF NOT EXISTS ${t}_no_update BEFORE UPDATE ON ${t} BEGIN SELECT RAISE(ABORT,'attempt_immutable'); END; CREATE TRIGGER IF NOT EXISTS ${t}_no_delete BEFORE DELETE ON ${t} BEGIN SELECT RAISE(ABORT,'attempt_immutable'); END;`).join("\n")}`);
  }
  close() {
    this.db.close();
  }
  private atomic<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      this.db.exec("COMMIT");
      return out;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  /** Explicit provisioning only, requiring operator pin plus signed immutable new approval. Never called by run. */
  provision(token: string, approverKey: KeyObject, pinnedApprovalDigest: string, now: number) {
    const a = parseAttemptApproval(verifySignedJson(approverKey, token));
    assertAttemptCurrent(a, now);
    if (digest(a) !== pinnedApprovalDigest) throw Error("attempt_pin_mismatch");
    const legacy = new CoordinatorStore(this.path);
    let old;
    try {
      old = legacy.read(a.historicalApproval.request.requestId);
    } finally {
      legacy.close();
    }
    if (
      !old ||
      old.state !== "uncertain" ||
      old.data.runId !== a.priorRunId ||
      old.approvalDigest !== digest(a.historicalApproval)
    )
      throw Error("attempt_history_mismatch");
    this.atomic(() => {
      this.db
        .prepare("INSERT INTO studio_attempt_approvals VALUES(?,?,?,?)")
        .run(a.attemptId, JSON.stringify(a), digest(a), a.priorRunId);
    });
  }
  read(id: string): AttemptApproval {
    const row = this.db
      .prepare("SELECT approval, approval_digest FROM studio_attempt_approvals WHERE attempt_id=?")
      .get(id);
    if (!row) throw Error("attempt_not_approved");
    const a = parseAttemptApproval(JSON.parse(String(row["approval"])));
    if (digest(a) !== row["approval_digest"] || a.attemptId !== id)
      throw Error("attempt_integrity");
    return a;
  }
  claim(binding: TimingBinding, now: number) {
    this.atomic(() => {
      const a = this.read(binding.attemptId);
      assertAttemptCurrent(a, now);
      if (digest(attemptBinding(a)) !== digest(binding) || this.cancelled(a.attemptId))
        throw Error("attempt_binding_invalid");
      this.db
        .prepare("INSERT INTO studio_attempt_claims VALUES(?,?,?)")
        .run(a.attemptId, digest(binding), now);
    });
  }
  tokens(id: string): string[] {
    return this.db
      .prepare("SELECT token FROM studio_attempt_receipts WHERE attempt_id=? ORDER BY sequence")
      .all(id)
      .map((r) => String(r["token"]));
  }
  append(id: string, token: string) {
    this.atomic(() => {
      const a = this.read(id),
        tokens = this.tokens(id);
      if (!this.db.prepare("SELECT 1 FROM studio_attempt_claims WHERE attempt_id=?").get(id))
        throw Error("attempt_unclaimed");
      if (tokens.includes(token)) return; // Exact receipt replay only, including after settlement.
      if (this.outcome(id)) throw Error("attempt_terminal");
      verifyPhaseChain([...tokens, token], this.receiptKey, a);
      this.db
        .prepare("INSERT INTO studio_attempt_receipts VALUES(?,?,?)")
        .run(id, tokens.length, token);
    });
  }
  cancel(id: string, now: number) {
    this.read(id);
    this.db.prepare("INSERT OR IGNORE INTO studio_attempt_cancellations VALUES(?,?)").run(id, now);
  }
  cancelled(id: string) {
    return !!this.db
      .prepare("SELECT 1 FROM studio_attempt_cancellations WHERE attempt_id=?")
      .get(id);
  }
  outcome(id: string): "complete" | "uncertain" | null {
    const row = this.db
      .prepare("SELECT outcome FROM studio_attempt_settlements WHERE attempt_id=?")
      .get(id);
    return row ? (row["outcome"] as "complete" | "uncertain") : null;
  }
  settle(id: string, outcome: "complete" | "uncertain", now: number) {
    this.atomic(() => {
      const a = this.read(id),
        chain = verifyPhaseChain(this.tokens(id), this.receiptKey, a);
      if (outcome === "complete" && (!chain.complete || this.cancelled(id) || now >= a.expiresAt))
        throw Error("attempt_result_unconfirmed");
      this.db.prepare("INSERT INTO studio_attempt_settlements VALUES(?,?,?)").run(id, outcome, now);
    });
  }
}

/** Local durable v2 attempt/receipt ledger. Never resets or updates the legacy singleton or jobs. */
import {
  assertSuccessorPredecessor,
  signSuccessorReservation,
} from "./studio-research-successor.server";
import { createPublicKey } from "node:crypto";
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
    private version: 2 | 3 = 2,
  ) {
    // Reuse private file/path validation. No legacy data mutation occurs on opening existing tables.
    const legacy = new CoordinatorStore(path);
    legacy.close();
    this.db = new DatabaseSync(path);
    this.db.exec(
      `PRAGMA busy_timeout=1000; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS studio_attempt_approvals(attempt_id TEXT PRIMARY KEY, approval TEXT NOT NULL, approval_digest TEXT NOT NULL UNIQUE, prior_run_id TEXT NOT NULL UNIQUE);
      CREATE TABLE IF NOT EXISTS studio_attempt_claims(attempt_id TEXT PRIMARY KEY REFERENCES studio_attempt_approvals(attempt_id), binding_digest TEXT NOT NULL, claimed_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS studio_attempt_receipts(attempt_id TEXT NOT NULL, sequence INTEGER NOT NULL, token TEXT NOT NULL, PRIMARY KEY(attempt_id,sequence));
      CREATE TABLE IF NOT EXISTS studio_attempt_cancellations(attempt_id TEXT PRIMARY KEY, cancelled_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS studio_attempt_settlements(attempt_id TEXT PRIMARY KEY, outcome TEXT NOT NULL, settled_at INTEGER NOT NULL);
      ${["studio_attempt_approvals", "studio_attempt_claims", "studio_attempt_receipts", "studio_attempt_cancellations", "studio_attempt_settlements"].map((t) => `CREATE TRIGGER IF NOT EXISTS ${t}_no_update BEFORE UPDATE ON ${t} BEGIN SELECT RAISE(ABORT,'attempt_immutable'); END; CREATE TRIGGER IF NOT EXISTS ${t}_no_delete BEFORE DELETE ON ${t} BEGIN SELECT RAISE(ABORT,'attempt_immutable'); END;`).join("\n")}`.replaceAll(
        "studio_attempt_",
        this.version === 3 ? "studio_successor_" : "studio_attempt_",
      ),
    );
    if (this.version === 3)
      this.db
        .exec(`CREATE TABLE IF NOT EXISTS studio_successor_reservations(attempt_id TEXT PRIMARY KEY, predecessor_attempt_id TEXT NOT NULL UNIQUE, token TEXT NOT NULL);
      CREATE TRIGGER IF NOT EXISTS studio_successor_reservations_no_update BEFORE UPDATE ON studio_successor_reservations BEGIN SELECT RAISE(ABORT,'attempt_immutable'); END;
      CREATE TRIGGER IF NOT EXISTS studio_successor_reservations_no_delete BEFORE DELETE ON studio_successor_reservations BEGIN SELECT RAISE(ABORT,'attempt_immutable'); END;
      ${["claims", "receipts", "cancellations", "settlements"].map((t) => `CREATE TRIGGER IF NOT EXISTS studio_predecessor_${t}_frozen BEFORE INSERT ON studio_attempt_${t} WHEN EXISTS(SELECT 1 FROM studio_successor_reservations WHERE predecessor_attempt_id=NEW.attempt_id) BEGIN SELECT RAISE(ABORT,'successor_predecessor_frozen'); END;`).join("\n")}`);
  }
  private table(name: string) {
    return (this.version === 3 ? "studio_successor_" : `studio_attempt_`) + name;
  }
  hasClaim(id: string) {
    return !!this.db.prepare(`SELECT 1 FROM ${this.table("claims")} WHERE attempt_id=?`).get(id);
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
    if (this.version !== 2 || a.version !== 2) throw Error("successor_explicit_provision_required");
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
      old["state"] !== "uncertain" ||
      old["data"].runId !== a.priorRunId ||
      old.approvalDigest !== digest(a.historicalApproval)
    )
      throw Error("attempt_history_mismatch");
    this.atomic(() => {
      this.db
        .prepare(`INSERT INTO ${this.table("approvals")} VALUES(?,?,?,?)`)
        .run(a.attemptId, JSON.stringify(a), digest(a), a.priorRunId);
    });
  }
  /** Explicit offline provisioning only. No API route calls this method. Reservation survives lost responses. */
  provisionSuccessor(
    token: string,
    studioKey: KeyObject,
    pinnedDigest: string,
    hostSigner: KeyObject,
    clock: () => number,
  ) {
    if (this.version !== 3) throw Error("successor_store_required");
    const a = parseAttemptApproval(verifySignedJson(studioKey, token));
    if (
      a.version !== 3 ||
      digest(a) !== pinnedDigest ||
      !createPublicKey(hostSigner)
        .export({ type: "spki", format: "der" })
        .equals(this.receiptKey.export({ type: "spki", format: "der" }))
    )
      throw Error("successor_pin_invalid");
    return this.atomic(() => {
      const now = clock();
      const row = this.db
        .prepare("SELECT approval,approval_digest FROM studio_attempt_approvals WHERE attempt_id=?")
        .get(a.predecessorAttemptId);
      if (!row) throw Error("successor_predecessor_missing");
      const prior = parseAttemptApproval(JSON.parse(String(row["approval"])));
      if (digest(prior) !== row["approval_digest"]) throw Error("successor_predecessor_invalid");
      assertSuccessorPredecessor(a, prior, now);
      for (const table of ["claims", "receipts", "cancellations", "settlements"])
        if (
          this.db
            .prepare(`SELECT 1 FROM studio_attempt_${table} WHERE attempt_id=?`)
            .get(prior.attemptId)
        )
          throw Error("successor_predecessor_consumed");
      const old = this.db
        .prepare("SELECT state,approval_digest,data FROM jobs WHERE id=?")
        .get(a.historicalApproval.request.requestId);
      if (
        !old ||
        old["state"] !== "uncertain" ||
        old["approval_digest"] !== digest(a.historicalApproval) ||
        JSON.parse(String(old["data"])).runId !== a.priorRunId
      )
        throw Error("successor_history_invalid");
      const originalData = JSON.parse(String(old["data"]));
      if (a.sessionId === originalData.sessionId || a.nonce === originalData.launch?.nonce)
        throw Error("successor_identity_reused");
      const reservation = signSuccessorReservation(a, hostSigner, now);
      this.db
        .prepare("INSERT INTO studio_successor_approvals VALUES(?,?,?,?)")
        .run(a.attemptId, JSON.stringify(a), digest(a), a.priorRunId);
      this.db
        .prepare("INSERT INTO studio_successor_reservations VALUES(?,?,?)")
        .run(a.attemptId, a.predecessorAttemptId, reservation);
      return reservation;
    });
  }
  reservation(id: string): string {
    if (this.version !== 3) throw Error("successor_store_required");
    this.read(id);
    const row = this.db
      .prepare("SELECT token FROM studio_successor_reservations WHERE attempt_id=?")
      .get(id);
    if (!row) throw Error("successor_reservation_missing");
    return String(row["token"]);
  }
  read(id: string): AttemptApproval {
    const row = this.db
      .prepare(
        `SELECT approval, approval_digest FROM ${this.table("approvals")} WHERE attempt_id=?`,
      )
      .get(id);
    if (!row) throw Error("attempt_not_approved");
    const a = parseAttemptApproval(JSON.parse(String(row["approval"])));
    if (a.version !== this.version || digest(a) !== row["approval_digest"] || a.attemptId !== id)
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
        .prepare(`INSERT INTO ${this.table("claims")} VALUES(?,?,?)`)
        .run(a.attemptId, digest(binding), now);
    });
  }
  tokens(id: string): string[] {
    return this.db
      .prepare(`SELECT token FROM ${this.table("receipts")} WHERE attempt_id=? ORDER BY sequence`)
      .all(id)
      .map((r) => String(r["token"]));
  }
  append(id: string, token: string) {
    this.atomic(() => {
      const a = this.read(id),
        tokens = this.tokens(id);
      if (!this.db.prepare(`SELECT 1 FROM ${this.table("claims")} WHERE attempt_id=?`).get(id))
        throw Error("attempt_unclaimed");
      if (tokens.includes(token)) return; // Exact receipt replay only, including after settlement.
      if (this.outcome(id)) throw Error("attempt_terminal");
      verifyPhaseChain([...tokens, token], this.receiptKey, a);
      this.db
        .prepare(`INSERT INTO ${this.table("receipts")} VALUES(?,?,?)`)
        .run(id, tokens.length, token);
    });
  }
  cancel(id: string, now: number) {
    this.read(id);
    this.db
      .prepare(`INSERT OR IGNORE INTO ${this.table("cancellations")} VALUES(?,?)`)
      .run(id, now);
  }
  cancelled(id: string) {
    return !!this.db
      .prepare(`SELECT 1 FROM ${this.table("cancellations")} WHERE attempt_id=?`)
      .get(id);
  }
  outcome(id: string): "complete" | "uncertain" | null {
    const row = this.db
      .prepare(`SELECT outcome FROM ${this.table("settlements")} WHERE attempt_id=?`)
      .get(id);
    return row ? (row["outcome"] as "complete" | "uncertain") : null;
  }
  settle(id: string, outcome: "complete" | "uncertain", now: number) {
    this.atomic(() => {
      const a = this.read(id),
        chain = verifyPhaseChain(this.tokens(id), this.receiptKey, a);
      if (outcome === "complete" && (!chain.complete || this.cancelled(id) || now >= a.expiresAt))
        throw Error("attempt_result_unconfirmed");
      this.db
        .prepare(`INSERT INTO ${this.table("settlements")} VALUES(?,?,?)`)
        .run(id, outcome, now);
    });
  }
}

import {
  assertTrialApproval,
  assertTrialWindow,
  type TrialConfig,
} from "./studio-research-trial.server";
import { cliAccountingSchema, type CliAccounting } from "./studio-research-coordinator-contracts";
/** Private local SQLite candidate. No production DB connection or automatic host migration. */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, lstatSync, chmodSync, openSync, closeSync, constants } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { z } from "zod";
import {
  approvalSchema,
  type Approval,
  type Brief,
  digest,
} from "./studio-research-coordinator-contracts";
import type { SourceEvidence } from "./studio-research-source-evidence.server";
export type State =
  | "approved"
  | "collecting"
  | "running"
  | "cancel_requested"
  | "cancelled"
  | "failed"
  | "uncertain"
  | "ready"
  | "reviewed";
export type Review = {
  decision: "use" | "edit" | "save" | "skip";
  editedText?: string;
  by: string;
  at: number;
};
export type Job = {
  id: string;
  revision: number;
  state: State;
  approval: Approval;
  approvalDigest: string;
  data: {
    evidence?: SourceEvidence[];
    runId?: string;
    sessionId?: string;
    result?: Brief;
    resultDigest?: string;
    promptDigest?: string;
    evidenceDigest?: string;
    launch?: {
      nonce: string;
      profile: unknown;
      startedAt: number;
      launchDeadline: number;
      completionDeadline: number;
    };
    stopReceipt?: { ack: string; payloadDigest: string; verifiedAt: number };
    delivery?: { ack: string; payloadDigest: string; verifiedAt: number };
    completion?: {
      receipt: unknown;
      outputDigest: string;
      providerRequests: null;
      accounting: CliAccounting;
      completedAt: number;
    };
    review?: Review;
    reason?: string;
  };
};
const edges: Record<State, readonly State[]> = {
  approved: ["collecting", "cancelled", "failed"],
  collecting: ["running", "cancel_requested", "failed", "uncertain"],
  running: ["ready", "cancel_requested", "uncertain", "running"],
  cancel_requested: ["cancelled", "uncertain", "cancel_requested"],
  cancelled: [],
  failed: [],
  uncertain: ["uncertain"],
  ready: ["reviewed", "ready"],
  reviewed: ["reviewed"],
};
export class CoordinatorStore {
  private db: DatabaseSync;
  constructor(path: string) {
    if (!isAbsolute(path)) throw Error("storage_path_invalid");
    const directory = dirname(path);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (lstatSync(directory).isSymbolicLink() || (lstatSync(directory).mode & 0o077) !== 0)
      throw Error("storage_directory_not_private");
    try {
      const s = lstatSync(path);
      if (!s.isFile() || s.isSymbolicLink() || (s.mode & 0o077) !== 0)
        throw Error("storage_file_invalid");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      closeSync(openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600));
    }
    this.db = new DatabaseSync(path);
    chmodSync(path, 0o600);
    this.db.exec(`PRAGMA busy_timeout=1000; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;
   CREATE TABLE IF NOT EXISTS single_trial_admission(slot INTEGER PRIMARY KEY CHECK(slot=1), binding TEXT NOT NULL, approval_digest TEXT NOT NULL, consumed_at INTEGER NOT NULL);
   CREATE TRIGGER IF NOT EXISTS no_trial_update BEFORE UPDATE ON single_trial_admission BEGIN SELECT RAISE(ABORT,'trial_immutable'); END;
   CREATE TRIGGER IF NOT EXISTS no_trial_delete BEFORE DELETE ON single_trial_admission BEGIN SELECT RAISE(ABORT,'trial_consumed'); END;
   CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, revision INTEGER NOT NULL, state TEXT NOT NULL CHECK(state IN ('approved','collecting','running','cancel_requested','cancelled','failed','uncertain','ready','reviewed')), approval TEXT NOT NULL, approval_digest TEXT NOT NULL, data TEXT NOT NULL);
   CREATE UNIQUE INDEX IF NOT EXISTS one_unsettled_job ON jobs((1)) WHERE state IN ('collecting','running','cancel_requested','uncertain');
   CREATE TABLE IF NOT EXISTS events(job_id TEXT NOT NULL, revision INTEGER NOT NULL, state TEXT NOT NULL, data_digest TEXT NOT NULL, PRIMARY KEY(job_id,revision));
   CREATE TRIGGER IF NOT EXISTS immutable_approval BEFORE UPDATE ON jobs WHEN NEW.id<>OLD.id OR NEW.approval<>OLD.approval OR NEW.approval_digest<>OLD.approval_digest BEGIN SELECT RAISE(ABORT,'immutable_approval'); END;
   CREATE TRIGGER IF NOT EXISTS no_job_delete BEFORE DELETE ON jobs BEGIN SELECT RAISE(ABORT,'retain_reservation'); END;
   CREATE TRIGGER IF NOT EXISTS no_event_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT,'immutable_history'); END;
   CREATE TRIGGER IF NOT EXISTS no_event_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'immutable_history'); END;`);
  }
  /** Single global slot; committed before dispatch. Never deleted on failure or restart. */
  consumeTrial(t: TrialConfig, approval: Approval, now: number): void {
    assertTrialApproval(t, approval);
    assertTrialWindow(t, now);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const r = this.db
        .prepare("INSERT OR IGNORE INTO single_trial_admission VALUES(1,?,?,?)")
        .run(digest(t), digest(approval), now);
      if (r.changes !== 1) throw Error("trial_already_consumed");
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  close() {
    this.db.close();
  }
  read(id: string): Job | null {
    z.string().uuid().parse(id);
    const row = this.db.prepare("SELECT * FROM jobs WHERE id=?").get(id);
    if (!row) return null;
    const approval = approvalSchema.parse(JSON.parse(String(row["approval"])));
    if (approval.request.requestId !== id || digest(approval) !== row["approval_digest"])
      throw Error("storage_integrity");
    const event = this.db
      .prepare("SELECT * FROM events WHERE job_id=? AND revision=?")
      .get(id, Number(row["revision"]));
    if (
      !event ||
      event["state"] !== row["state"] ||
      event["data_digest"] !== digest(JSON.parse(String(row["data"])))
    )
      throw Error("storage_integrity");
    return {
      id,
      revision: Number(row["revision"]),
      state: String(row["state"]) as State,
      approval,
      approvalDigest: String(row["approval_digest"]),
      data: JSON.parse(String(row["data"])),
    };
  }
  create(approval: Approval) {
    const id = approval.request.requestId;
    const serialized = JSON.stringify(approval);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const inserted = this.db
        .prepare("INSERT OR IGNORE INTO jobs VALUES(?,0,'approved',?,?,'{}')")
        .run(id, serialized, digest(approval));
      if (inserted.changes)
        this.db.prepare("INSERT INTO events VALUES(?,0,'approved',?)").run(id, digest({}));
      else if (this.read(id)?.approvalDigest !== digest(approval)) throw Error("approval_conflict");
      this.db.exec("COMMIT");
      return this.read(id)!;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  transition(job: Job, state: State, data: Job["data"]): Job | null {
    if (!edges[job.state]?.includes(state)) throw Error("transition_invalid");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.read(job.id);
      if (!current || current.revision !== job.revision || current.state !== job.state) {
        this.db.exec("ROLLBACK");
        return null;
      }
      const merged = { ...current.data, ...data };
      for (const field of [
        "evidence",
        "runId",
        "sessionId",
        "result",
        "resultDigest",
        "promptDigest",
        "evidenceDigest",
        "launch",
        "completion",
        "delivery",
        "stopReceipt",
        "review",
      ] as const)
        if (
          current.data[field] !== undefined &&
          JSON.stringify(current.data[field]) !== JSON.stringify(merged[field])
        )
          throw Error("receipt_immutable");
      const revision = current.revision + 1;
      this.db
        .prepare("UPDATE jobs SET revision=?,state=?,data=? WHERE id=? AND revision=?")
        .run(revision, state, JSON.stringify(merged), job.id, job.revision);
      this.db
        .prepare("INSERT INTO events VALUES(?,?,?,?)")
        .run(job.id, revision, state, digest(merged));
      this.db.exec("COMMIT");
      return this.read(job.id);
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  history(id: string) {
    z.string().uuid().parse(id);
    return this.db
      .prepare("SELECT revision,state,data_digest FROM events WHERE job_id=? ORDER BY revision")
      .all(id);
  }
  /** Explicit quiesced restart reconciliation only. Never requeues a consumed job. */
  recover(quiesced: boolean) {
    if (!quiesced) throw Error("recovery_requires_quiescence");
    const ids = this.db
      .prepare("SELECT id FROM jobs WHERE state IN ('collecting','running','cancel_requested')")
      .all();
    for (const row of ids) {
      const job = this.read(String(row["id"]))!;
      this.transition(job, "uncertain", { reason: "interrupted_requires_reconciliation" });
    }
    return ids.length;
  }
}

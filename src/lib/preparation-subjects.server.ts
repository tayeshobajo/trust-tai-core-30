/**
 * Where a job gets its subject from (server only).
 *
 * Each job needs two honest readings of the real subject: the revision it
 * stands at right now, and the material a person would read. Both belong to
 * the room that owns the subject, not to this runner, so they arrive here as
 * registered readers rather than being invented.
 *
 * The registry is deliberately empty of guesses. A job with no reader is told
 * so in plain words and refuses, because a job that made up its own subject
 * would be worse than a job that does not run.
 */

import type { PreparationJobId, PreparationRequest } from "@/domain/preparation-jobs";
import type { DeterministicRead } from "@/lib/preparation-runner.server";

export interface SubjectReader {
  /** Does this subject belong to this workspace? A no is fatal and silent. */
  belongsToWorkspace(request: PreparationRequest, token: string): Promise<boolean>;
  /** The revision the subject stands at right now. */
  currentRevision(request: PreparationRequest, token: string): Promise<string>;
  /** Everything the output rests on, computed in code. */
  read(request: PreparationRequest, token: string): Promise<DeterministicRead>;
}

const READERS = new Map<PreparationJobId, SubjectReader>();

/** Rooms register their own reader. Registering twice replaces, never merges. */
export function registerSubjectReader(jobId: PreparationJobId, reader: SubjectReader): void {
  READERS.set(jobId, reader);
}

export function subjectReader(jobId: PreparationJobId): SubjectReader | null {
  return READERS.get(jobId) ?? null;
}

export function registeredJobs(): PreparationJobId[] {
  return [...READERS.keys()];
}

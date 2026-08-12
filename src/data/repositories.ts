/**
 * Persistence boundary.
 *
 * Every read/write goes through these interfaces so a shared Supabase backend
 * can be connected later without touching the product shell.
 */

import type { ActivityStream } from "@/domain/activity";
import type {
  Client,
  Contact,
  Conversation,
  Decision,
  ID,
  Organization,
  Project,
  Prospect,
  Task,
  User,
  Website,
} from "@/domain/entities";
import type { IntelligenceProvider } from "@/domain/intelligence";
import type { ScoutProvider } from "@/domain/scout";

export interface ReadRepository<T> {
  list(organizationId: ID): Promise<T[]>;
  get(id: ID): Promise<T | null>;
}

export interface TrustTaiDataSource {
  organizations: { get(id: ID): Promise<Organization | null> };
  users: ReadRepository<User>;
  clients: ReadRepository<Client>;
  contacts: ReadRepository<Contact>;
  prospects: ReadRepository<Prospect>;
  projects: ReadRepository<Project>;
  websites: ReadRepository<Website>;
  conversations: ReadRepository<Conversation>;
  tasks: ReadRepository<Task>;
  decisions: ReadRepository<Decision> & {
    setStatus(id: ID, status: Decision["status"]): Promise<Decision | null>;
  };
  activity: ActivityStream;
  intelligence: IntelligenceProvider;
  /** Scout's own read/write surface. Fit evidence stays in the Scout module. */
  scout: ScoutProvider;
}

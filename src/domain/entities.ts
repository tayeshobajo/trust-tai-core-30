/**
 * Trust Tai OS, shared core entity contracts.
 *
 * One identity. One organization model. Shared entities.
 * Apps read and extend these entities; they never duplicate them.
 */

export type ID = string;
export type ISODateTime = string;

/** Every shared entity carries the same envelope. */
export interface BaseEntity {
  id: ID;
  organizationId: ID;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export type EntityType =
  | "organization"
  | "user"
  | "client"
  | "contact"
  | "prospect"
  | "project"
  | "website"
  | "conversation"
  /** A tracked human relationship, owned by Comms. */
  | "relationship"
  /** A produced artifact or published asset, owned by Studio/Roadmap. */
  | "content"
  | "activity"
  | "task"
  | "decision"
  | "roadmap"
  | "app";


/** Canonical Trust Tai lifecycle states. Never communicated by color alone. */
export type LifecycleStatus =
  | "mapped"
  | "in_build"
  | "live"
  | "needs_decision"
  | "at_risk"
  | "blocked"
  | "unknown";

export interface Organization {
  id: ID;
  name: string;
  slug: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export type UserRole = "owner" | "steward" | "operator" | "viewer";

export interface User extends BaseEntity {
  name: string;
  email: string;
  role: UserRole;
}

export interface Client extends BaseEntity {
  name: string;
  status: LifecycleStatus;
  stewardUserId?: ID;
}

export interface Contact extends BaseEntity {
  clientId?: ID;
  name: string;
  email?: string;
  phone?: string;
  title?: string;
}

/**
 * A company Trust Tai is considering, before it becomes a client.
 * Deliberately minimal, fit evidence lives in the Scout module.
 */
export type ProspectStatus =
  | "discovered"
  | "reviewing"
  | "qualified"
  | "passed"
  | "ready_for_comms"
  | "converted"
  | "archived";

export interface Prospect extends BaseEntity {
  /** Persisted as `company_name`. */
  name: string;
  /** Display shape of the persisted `website_url`. */
  domain: string;
  /** Full persisted `website_url`, exactly as stored. */
  websiteUrl: string;
  status: ProspectStatus;
}

export interface Project extends BaseEntity {
  clientId?: ID;
  name: string;
  status: LifecycleStatus;
  ownerUserId?: ID;
  /** Point A → Point B framing. */
  pointA?: string;
  pointB?: string;
  nextMove?: string;
}

export interface Website extends BaseEntity {
  clientId?: ID;
  projectId?: ID;
  domain: string;
  status: LifecycleStatus;
  lastCheckedAt?: ISODateTime;
}

export type ConversationChannel = "email" | "call" | "meeting" | "message" | "note";

export interface Conversation extends BaseEntity {
  clientId?: ID;
  projectId?: ID;
  channel: ConversationChannel;
  subject: string;
  participantContactIds: ID[];
  lastMessageAt?: ISODateTime;
}

export type TaskStatus = "todo" | "in_progress" | "waiting" | "done";

export interface Task extends BaseEntity {
  title: string;
  status: TaskStatus;
  ownerUserId?: ID;
  dueAt?: ISODateTime;
  clientId?: ID;
  projectId?: ID;
  /** The app that created this task, e.g. "ops". */
  sourceAppId?: ID;
}

export type DecisionStatus = "open" | "approved" | "declined" | "deferred";

/** A decision object must make context, consequence, recommendation, owner and deadline clear. */
export interface Decision extends BaseEntity {
  title: string;
  context: string;
  consequence: string;
  recommendation?: string;
  /** Whether the recommendation came from the intelligence layer or a person. */
  recommendationSource: "intelligence" | "human";
  ownerUserId: ID;
  status: DecisionStatus;
  dueAt?: ISODateTime;
  clientId?: ID;
  projectId?: ID;
  sourceAppId?: ID;
}

/** Union of the shared entity shapes. */
export type CoreEntity =
  | Organization
  | User
  | Client
  | Contact
  | Prospect
  | Project
  | Website
  | Conversation
  | Task
  | Decision;

/** Stable cross-app pointer to any shared entity. */
export interface EntityRef {
  type: EntityType;
  id: ID;
  label?: string;
}

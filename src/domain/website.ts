/**
 * Trust Tai OS, the Website signal boundary.
 *
 * TrustTai.com is a signal source, not another operating system. It owns
 * attention (traffic, campaigns) and intake (the adaptive roadmap
 * conversation). It hands completed intakes into Core as structured inbound
 * signals. It never creates downstream business truth: no roadmap, no project,
 * no automatic qualification. Scout owns what happens next.
 *
 * Everything here is a contract shape. Persistence lives in
 * `src/data/supabase/website-service.ts`, ingestion in
 * `src/lib/website-intake.server.ts`.
 */

import type { ID, ISODateTime } from "./entities";

/** The room id, as registered in the app registry. */
export const WEBSITE_APP_ID = "website";

/** Provenance written on every inbound record. Structural, never only a tag. */
export const WEBSITE_SOURCE_APP = "website";
export const WEBSITE_SOURCE_CHANNEL = "website";
export const WEBSITE_SOURCE_TYPE = "roadmap_intake";

/** The friendly label Scout shows on an inbound record. */
export const WEBSITE_INTAKE_LABEL = "Website · Roadmap Intake";

/* ------------------------------------------------------------- attribution */

export interface WebsiteUtm {
  source?: string | null;
  medium?: string | null;
  campaign?: string | null;
  term?: string | null;
  content?: string | null;
}

export interface WebsiteAttribution {
  landingPath?: string | null;
  entryReferrer?: string | null;
  utm?: WebsiteUtm | null;
  gclid?: string | null;
  fbclid?: string | null;
  sessionId?: string | null;
  pageViewsBeforeStart?: number | null;
  device?: string | null;
  locale?: string | null;
}

/* ------------------------------------------------------------- the intake */

export interface WebsitePerson {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  role?: string | null;
}

export interface WebsiteCompany {
  name?: string | null;
  website?: string | null;
  industryStated?: string | null;
  sizeStated?: string | null;
  locationStated?: string | null;
}

export type WebsiteModality = "text" | "voice";

/** One answer, preserved exactly as the founder gave it. Never rewritten. */
export interface WebsiteVerbatimAnswer {
  questionId: string;
  questionText: string;
  answerText: string;
  modality: WebsiteModality;
  mediaUrl?: string | null;
  answeredAt?: ISODateTime | null;
  skipped?: boolean;
}

/** What the website's own extraction made of the conversation. */
export interface WebsiteStructured {
  currentState: string[];
  desiredFuture: string[];
  pains: string[];
  goals: string[];
  constraints: string[];
  existingAssets: string[];
  ideas: string[];
  openQuestions: string[];
}

export const EMPTY_STRUCTURED: WebsiteStructured = {
  currentState: [],
  desiredFuture: [],
  pains: [],
  goals: [],
  constraints: [],
  existingAssets: [],
  ideas: [],
  openQuestions: [],
};

export interface WebsiteSignals {
  frame?: string | null;
  frameConfidence?: number | null;
  objectiveCoverage?: number | null;
  completeness?: number | null;
  authorizesResearch?: boolean | null;
}

export interface WebsiteConsent {
  marketingOptIn?: boolean | null;
  privacyVersion?: string | null;
}

/** How the submission was connected to Scout, and why. */
export type WebsiteLinkState =
  /** Matched or created a canonical Scout prospect on evidence. */
  | "linked"
  /** Kept as an unlinked inbound signal because identity was ambiguous. */
  | "unlinked"
  /** A retry of a submission already processed. */
  | "duplicate";

export interface WebsiteSubmission {
  id: ID;
  organizationId: ID;
  /** The website's own id. The idempotency key. */
  submissionId: string;
  sourceApp: string;
  sourceChannel: string;
  sourceType: string;
  submittedAt: ISODateTime;
  startedAt?: ISODateTime | null;
  receivedAt: ISODateTime;
  attribution: WebsiteAttribution;
  person: WebsitePerson;
  company: WebsiteCompany;
  verbatim: WebsiteVerbatimAnswer[];
  structured: WebsiteStructured;
  signals: WebsiteSignals;
  consent: WebsiteConsent;
  /** The canonical Scout prospect, when identity was clear enough to link. */
  scoutProspectId?: ID | null;
  linkState: WebsiteLinkState;
  /** Plain language, for the person reading the room and for the audit trail. */
  linkReason: string;
  /** Read-only correlation of what Scout has since decided. */
  scoutStatus?: string | null;
}

/* -------------------------------------------------------- website analytics */

/**
 * The whole event vocabulary the Website room needs. Deliberately small:
 * Core is not an analytics warehouse, it correlates attention with intake.
 */
export const WEBSITE_EVENT_NAMES = [
  "page_view",
  "cta_clicked",
  "intake_view",
  "intake_started",
  "intake_answered",
  "intake_resume_requested",
  "intake_resumed",
  "intake_submitted",
  "intake_abandoned",
  "content_read",
  "contact_clicked",
  "newsletter_subscribed",
] as const;

export type WebsiteEventName = (typeof WEBSITE_EVENT_NAMES)[number];

export function isWebsiteEventName(value: unknown): value is WebsiteEventName {
  return (WEBSITE_EVENT_NAMES as readonly string[]).includes(String(value));
}

export interface WebsiteEvent {
  id: ID;
  organizationId: ID;
  eventName: WebsiteEventName;
  occurredAt: ISODateTime;
  sessionId?: string | null;
  /** Stable key for "the same happening", so retries never double count. */
  eventKey: string;
  path?: string | null;
  referrer?: string | null;
  utm: WebsiteUtm;
  device?: string | null;
  submissionId?: string | null;
  questionId?: string | null;
  modality?: WebsiteModality | null;
  properties: Record<string, unknown>;
}

/* ------------------------------------------------------- room read shapes */

/** A number Core genuinely knows, or an honest absence. Never a fabricated 0. */
export type KnownNumber = number | null;

export interface WebsiteFunnelStage {
  key: string;
  label: string;
  value: KnownNumber;
  note?: string;
}

export interface WebsiteSourceRow {
  source: string;
  campaign?: string | null;
  visits: KnownNumber;
  starts: KnownNumber;
  submissions: KnownNumber;
  qualified: KnownNumber;
}

export interface WebsiteQuestionDropOff {
  questionId: string;
  questionText: string;
  reached: number;
  answered: number;
  abandoned: number;
}

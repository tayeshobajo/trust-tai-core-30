/**
 * In-memory reference implementation of the Trust Tai OS data source.
 *
 * Used for the signed-in preview of the foundation shell. It is NOT a backend:
 * when Lovable Cloud is connected, swap this module for a Supabase-backed
 * implementation of the same `TrustTaiDataSource` interface.
 */

import type { ActivityEvent, ActivityQuery } from "@/domain/activity";
import type {
  Client,
  Decision,
  ID,
  Organization,
  Project,
  Task,
  User,
} from "@/domain/entities";
import type { ContextRequest, ContextResult } from "@/domain/intelligence";
import type { ReadRepository, TrustTaiDataSource } from "./repositories";

const ORG_ID = "org_trusttai";
const NOW = "2026-08-12T09:00:00.000Z";

const organization: Organization = {
  id: ORG_ID,
  name: "Trust Tai",
  slug: "trust-tai",
  createdAt: NOW,
  updatedAt: NOW,
};

const base = { organizationId: ORG_ID, createdAt: NOW, updatedAt: NOW };

const users: User[] = [
  { ...base, id: "usr_tai", name: "Tai", email: "tai@trusttai.com", role: "owner" },
  { ...base, id: "usr_steward", name: "Amara", email: "amara@trusttai.com", role: "steward" },
];

const clients: Client[] = [
  { ...base, id: "cli_northbank", name: "Northbank Legal", status: "live", stewardUserId: "usr_steward" },
  { ...base, id: "cli_harrow", name: "Harrow & Co", status: "in_build", stewardUserId: "usr_steward" },
];

const projects: Project[] = [
  {
    ...base,
    id: "prj_northbank_site",
    clientId: "cli_northbank",
    name: "Northbank site rebuild",
    status: "in_build",
    ownerUserId: "usr_steward",
    pointA: "Dated site, no enquiry tracking.",
    pointB: "Clear service pages with tracked enquiries.",
    nextMove: "Approve the service page structure.",
  },
  {
    ...base,
    id: "prj_harrow_intake",
    clientId: "cli_harrow",
    name: "Harrow intake redesign",
    status: "mapped",
    ownerUserId: "usr_tai",
    pointA: "Intake handled by email.",
    pointB: "Guided intake with triage.",
    nextMove: "Confirm scope before build order.",
  },
];

const tasks: Task[] = [
  {
    ...base,
    id: "tsk_1",
    title: "Draft Northbank service page copy",
    status: "in_progress",
    ownerUserId: "usr_steward",
    projectId: "prj_northbank_site",
    sourceAppId: "projects",
  },
  {
    ...base,
    id: "tsk_2",
    title: "Renew Harrow hosting certificate",
    status: "waiting",
    ownerUserId: "usr_tai",
    clientId: "cli_harrow",
    sourceAppId: "ops",
  },
];

const decisions: Decision[] = [
  {
    ...base,
    id: "dec_1",
    title: "Approve Northbank service page structure",
    context: "Build is paused until the page structure is agreed.",
    consequence: "Every extra day of delay pushes launch by a day.",
    recommendation: "Approve the five-page structure and revisit depth after launch.",
    recommendationSource: "intelligence",
    ownerUserId: "usr_tai",
    status: "open",
    dueAt: "2026-08-14T17:00:00.000Z",
    clientId: "cli_northbank",
    projectId: "prj_northbank_site",
    sourceAppId: "roadmap",
  },
  {
    ...base,
    id: "dec_2",
    title: "Confirm who carries Harrow stewardship",
    context: "Harrow has no named steward after the intake redesign was mapped.",
    consequence: "Without an owner, signals will sit unread.",
    recommendation: "Assign Amara as steward through launch.",
    recommendationSource: "human",
    ownerUserId: "usr_tai",
    status: "open",
    clientId: "cli_harrow",
    sourceAppId: "projects",
  },
];

const activity: ActivityEvent[] = [
  {
    id: "act_1",
    organizationId: ORG_ID,
    name: "project.status_changed",
    subject: { type: "project", id: "prj_northbank_site", label: "Northbank site rebuild" },
    summary: "Northbank site rebuild moved to In build.",
    provenance: {
      appId: "projects",
      actor: { type: "user", id: "usr_steward", label: "Amara" },
      observedAt: "2026-08-11T14:12:00.000Z",
      confidence: "observed",
    },
    occurredAt: "2026-08-11T14:12:00.000Z",
  },
  {
    id: "act_2",
    organizationId: ORG_ID,
    name: "website.flagged",
    subject: { type: "website", id: "web_harrow", label: "harrowandco.com" },
    summary: "Certificate expires in 9 days.",
    provenance: {
      appId: "ops",
      actor: { type: "system", id: "ops.monitor" },
      observedAt: "2026-08-12T06:00:00.000Z",
      confidence: "observed",
    },
    occurredAt: "2026-08-12T06:00:00.000Z",
  },
  {
    id: "act_3",
    organizationId: ORG_ID,
    name: "decision.created",
    subject: { type: "decision", id: "dec_1", label: "Northbank page structure" },
    summary: "A decision is waiting on you.",
    provenance: {
      appId: "roadmap",
      actor: { type: "intelligence", id: "intelligence.layer" },
      observedAt: "2026-08-12T07:30:00.000Z",
      confidence: "inferred",
    },
    occurredAt: "2026-08-12T07:30:00.000Z",
  },
];

function readOnly<T extends { id: ID }>(rows: T[]): ReadRepository<T> {
  return {
    async list() {
      return rows;
    },
    async get(id: ID) {
      return rows.find((row) => row.id === id) ?? null;
    },
  };
}

export const memorySource: TrustTaiDataSource = {
  organizations: { async get(id) { return id === ORG_ID ? organization : null; } },
  users: readOnly(users),
  clients: readOnly(clients),
  contacts: readOnly([]),
  projects: readOnly(projects),
  websites: readOnly([]),
  conversations: readOnly([]),
  tasks: readOnly(tasks),
  decisions: {
    ...readOnly(decisions),
    async setStatus(id, status) {
      const decision = decisions.find((row) => row.id === id);
      if (!decision) return null;
      decision.status = status;
      return decision;
    },
  },
  activity: {
    async record(event) {
      const stored: ActivityEvent = { ...event, id: `act_${activity.length + 1}` };
      activity.unshift(stored);
      return stored;
    },
    async list(query: ActivityQuery) {
      return activity
        .filter((event) => event.organizationId === query.organizationId)
        .slice(0, query.limit ?? 20);
    },
  },
  intelligence: {
    async retrieve(request: ContextRequest): Promise<ContextResult> {
      return {
        request,
        facts: [
          {
            id: "ctx_1",
            statement: "Northbank has been in build for 11 days with one open decision.",
            subject: { type: "project", id: "prj_northbank_site", label: "Northbank site rebuild" },
            provenance: {
              appId: "projects",
              actor: { type: "system", id: "projects.reader" },
              observedAt: NOW,
              confidence: "observed",
            },
            kind: "fact",
          },
          {
            id: "ctx_2",
            statement: "Approving the page structure today keeps launch inside the month.",
            subject: { type: "decision", id: "dec_1", label: "Northbank page structure" },
            provenance: {
              appId: "roadmap",
              actor: { type: "intelligence", id: "intelligence.layer" },
              observedAt: NOW,
              confidence: "inferred",
            },
            kind: "recommendation",
          },
        ],
        authorizedAppIds: ["projects", "roadmap", "ops"],
        withheld: [
          { appId: "comms", reason: "not_connected" },
          { appId: "scout", reason: "not_connected" },
        ],
        generatedAt: NOW,
      };
    },
  },
};

export const memoryOrganization = organization;
export const memoryUsers = users;
export const memoryActivity = activity;
export const memoryClients = clients;

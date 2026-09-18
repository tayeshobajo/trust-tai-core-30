/**
 * Files & Links on a client page: the front door to everything about a
 * company's work that lives outside Trust Tai.
 *
 * A resource is a saved reference and nothing more. Saving a Lovable project
 * URL, a knowledge base, a chat, a recording, a document or an assets folder
 * records where the thing is. It does not connect to the provider, does not
 * read the contents, does not sync, and never claims any of those. Real
 * ingestion stays where it already lives, behind its own explicit action.
 *
 * Scope is either the whole company or one of this company's own projects.
 * Account-wide material must never force a fake project into existence.
 */

import type { ID, ISODateTime } from "./entities";

export type ResourceCategory =
  | "lovable_project"
  | "knowledge_base"
  | "chat"
  | "meeting_recording"
  | "google_doc"
  | "assets"
  | "other";

export const RESOURCE_CATEGORIES: ResourceCategory[] = [
  "lovable_project",
  "knowledge_base",
  "chat",
  "meeting_recording",
  "google_doc",
  "assets",
  "other",
];

export const RESOURCE_CATEGORY_LABEL: Record<ResourceCategory, string> = {
  lovable_project: "Lovable project",
  knowledge_base: "Knowledge base",
  chat: "Chat",
  meeting_recording: "Meeting recording",
  google_doc: "Google Doc",
  assets: "Assets or folder",
  other: "Other",
};

/** What each preset is for, shown as a quiet hint rather than a rule. */
export const RESOURCE_CATEGORY_HINT: Record<ResourceCategory, string> = {
  lovable_project: "A Lovable build. More than one is normal.",
  knowledge_base: "A written knowledge base or documentation space.",
  chat: "A ChatGPT, Claude or other working conversation.",
  meeting_recording: "A recording or transcript of a call.",
  google_doc: "A Google Doc, Sheet or Slide deck.",
  assets: "A Drive, Dropbox or Figma folder of client assets.",
  other: "Anything else worth finding again.",
};

/** The three kinds that earn a shortcut on the client overview. */
export const PINNED_CATEGORIES: ResourceCategory[] = ["lovable_project", "knowledge_base", "chat"];

export function isResourceCategory(value: unknown): value is ResourceCategory {
  return typeof value === "string" && (RESOURCE_CATEGORIES as string[]).includes(value);
}

export interface ClientResource {
  id: ID;
  organizationId: ID;
  clientId: ID;
  /** null means the whole company, not an unknown project. */
  projectId: ID | null;
  category: ResourceCategory;
  title: string;
  url: string;
  description: string | null;
  /** Only meaningful for a recording, and always optional. */
  meetingDate: string | null;
  createdAt: ISODateTime;
  createdBy: ID | null;
}

export interface ClientResourceDraft {
  category: ResourceCategory;
  title: string;
  url: string;
  description?: string | undefined;
  meetingDate?: string | undefined;
  /** null is a deliberate choice: client-wide. */
  projectId: ID | null;
}

/* ------------------------------------------------------------------- urls */

export type UrlCheck = { ok: true; url: string } | { ok: false; problem: string };

/**
 * Only an ordinary web address is allowed, and it is opened in a new tab, so
 * script, data and file addresses are refused outright and an address that
 * carries a username or password is refused rather than quietly stored.
 */
export function checkResourceUrl(raw: string): UrlCheck {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { ok: false, problem: "A web address is needed." };
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, problem: "That is not a web address. It should start with https://" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, problem: "Only http and https addresses can be saved here." };
  }
  if (parsed.username || parsed.password) {
    return {
      ok: false,
      problem: "That address carries a sign-in credential. Save a plain link instead.",
    };
  }
  if (!parsed.hostname) return { ok: false, problem: "That address has no site in it." };
  return { ok: true, url: parsed.toString() };
}

/* -------------------------------------------------------------- duplicates */

function sameUrl(left: string, right: string): boolean {
  return (
    left.trim().toLowerCase().replace(/\/+$/, "") === right.trim().toLowerCase().replace(/\/+$/, "")
  );
}

/**
 * The same address in the same scope is almost always a mistake. The same
 * address on a different project is a deliberate act and is allowed.
 */
export function findDuplicate(
  existing: ClientResource[],
  draft: Pick<ClientResourceDraft, "url" | "projectId">,
  ignoreId?: ID,
): ClientResource | null {
  return (
    existing.find(
      (resource) =>
        resource.id !== ignoreId &&
        (resource.projectId ?? null) === (draft.projectId ?? null) &&
        sameUrl(resource.url, draft.url),
    ) ?? null
  );
}

/* ---------------------------------------------------------- reading a list */

export interface ResourceFilter {
  /** "all" shows every scope, grouped. A project id narrows to it. */
  projectId: "all" | ID | "client";
  query: string;
  category: "all" | ResourceCategory;
}

export const EMPTY_FILTER: ResourceFilter = { projectId: "all", query: "", category: "all" };

/**
 * A selected project shows its own resources plus the company-wide ones,
 * because company-wide material is true of every project by definition. The
 * caller labels which is which; this only decides membership.
 */
export function filterResources(
  resources: ClientResource[],
  filter: ResourceFilter,
  projectNames: Record<ID, string> = {},
): ClientResource[] {
  const needle = filter.query.trim().toLowerCase();
  return resources.filter((resource) => {
    if (filter.category !== "all" && resource.category !== filter.category) return false;
    if (filter.projectId === "client" && resource.projectId !== null) return false;
    if (filter.projectId !== "all" && filter.projectId !== "client") {
      if (resource.projectId !== null && resource.projectId !== filter.projectId) return false;
    }
    if (!needle) return true;
    const haystack = [
      resource.title,
      resource.description ?? "",
      RESOURCE_CATEGORY_LABEL[resource.category],
      resource.projectId ? (projectNames[resource.projectId] ?? "") : "Client-wide",
      resource.url,
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(needle);
  });
}

export interface ResourceGroup {
  /** null is the company-wide group. */
  projectId: ID | null;
  label: string;
  resources: ClientResource[];
}

/** Company-wide first, then one group per project, each in saved order. */
export function groupByProject(
  resources: ClientResource[],
  projectNames: Record<ID, string>,
): ResourceGroup[] {
  const groups = new Map<string, ResourceGroup>();
  for (const resource of resources) {
    const key = resource.projectId ?? "";
    let group = groups.get(key);
    if (!group) {
      group = {
        projectId: resource.projectId,
        label: resource.projectId
          ? (projectNames[resource.projectId] ?? "A project")
          : "Client-wide",
        resources: [],
      };
      groups.set(key, group);
    }
    group.resources.push(resource);
  }
  const all = [...groups.values()];
  const wide = all.filter((group) => group.projectId === null);
  const projects = all
    .filter((group) => group.projectId !== null)
    .sort((left, right) => left.label.localeCompare(right.label));
  return [...wide, ...projects];
}

/** Plain words for where a resource belongs. */
export function scopeLabel(resource: ClientResource, projectNames: Record<ID, string>): string {
  if (!resource.projectId) return "Client-wide";
  return projectNames[resource.projectId] ?? "A project";
}

export interface ResourceShortcut {
  resource: ClientResource;
  /** Distinct enough to tell two Lovable projects apart at a glance. */
  label: string;
}

/**
 * The shortcuts pinned on the overview. Several of one kind is the normal
 * case, so each keeps its own title and its scope when that is what separates
 * two otherwise identical names.
 */
export function pinnedShortcuts(
  resources: ClientResource[],
  projectNames: Record<ID, string> = {},
): ResourceShortcut[] {
  const pinned = resources.filter((resource) => PINNED_CATEGORIES.includes(resource.category));
  const titleCounts = new Map<string, number>();
  for (const resource of pinned) {
    const key = resource.title.trim().toLowerCase();
    titleCounts.set(key, (titleCounts.get(key) ?? 0) + 1);
  }
  return pinned.map((resource) => {
    const repeated = (titleCounts.get(resource.title.trim().toLowerCase()) ?? 0) > 1;
    return {
      resource,
      label: repeated
        ? `${resource.title} (${scopeLabel(resource, projectNames)})`
        : resource.title,
    };
  });
}

/* ------------------------------------------------------------ honest words */

/** Never "connected", never "synced", never "read". A link is a link. */
export const RESOURCE_TRUTH =
  "These are saved links. Trust Tai records where something lives; it does not open, read or sync the contents.";

export const RESOURCE_EMPTY_LINE = "No links saved for this company yet";
export const RESOURCE_EMPTY_BECAUSE =
  "Add the places this work actually lives: a Lovable project, a knowledge base, a working chat, a call recording, a Google Doc or a folder of client assets. Company-wide is fine; a project is optional.";

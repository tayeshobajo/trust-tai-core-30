/**
 * Trust Tai OS, shared application registry.
 *
 * Every internal Trust Tai app is registered here once. The shell, navigation,
 * and intelligence layer all read from this single list.
 *
 * Suite law (see docs/architecture-canon.md):
 *   Apps own state. Core owns identity. The event stream owns history.
 *   Steward owns interpretation. Pulse owns visibility.
 *
 * `layer` is the architectural position of a room, and it is not cosmetic:
 * only `business` rooms own domain truth (clients, contacts, prospects,
 * conversations, projects, content, websites). `intelligence` and
 * `stewardship` rooms read across the suite with provenance, propose bounded
 * work, and route execution back to the owning business room.
 */

import type { ID } from "./entities";

export type AppStatus = "live" | "in_build" | "mapped" | "external";

/**
 * Where a room sits in the suite topology.
 * - `core` · the shell itself (identity, navigation, shared entities).
 * - `business` · owns domain state: Scout, Comms, Roadmap, Projects, Ops, Studio.
 * - `intelligence` · the suite-wide visibility/readout surface: Pulse.
 * - `stewardship` · the cross-suite interpretation, memory, judgment,
 *                    recommendation and routing layer: Steward. It owns no
 *                    business entity and never becomes a peer domain.
 */
export type AppLayer = "core" | "business" | "intelligence" | "stewardship";

export type CapabilityTag =
  | "clients"
  | "contacts"
  | "projects"
  | "websites"
  | "conversations"
  | "tasks"
  | "decisions"
  | "monitoring"
  | "content"
  | "analytics"
  | "intelligence";

/**
 * How a room is reached.
 * - `primary` · sits in the ordinary left navigation.
 * - `deep_link` · a real room with its own route, permissions and event
 *   ownership, reached from the surfaces that compose it (the Clients shell,
 *   Home, Approvals) rather than from the rail. Leaving the rail is a
 *   navigation decision, never a demotion of ownership.
 */
export type AppNavigation = "primary" | "deep_link";

export interface AppRegistration {
  id: ID;
  name: string;
  slug: string;
  description: string;
  status: AppStatus;
  /** Architectural position. Only `business` rooms own domain truth. */
  layer: AppLayer;
  /** Route inside this shell. External apps still have a room here. */
  route: string;
  /**
   * Where the real product lives, for apps deployed outside this shell. The
   * room stays in the shell; this is the door out of it.
   */
  launchUrl?: string;
  /** Lucide icon name, resolved by the navigation component. */
  icon: string;
  capabilities: CapabilityTag[];
  /** Absent means `primary`. */
  navigation?: AppNavigation;
}

/**
 * The ordinary top-level navigation, in the order the charter fixes it
 * (docs/production-plan.md, "Navigation target"). Settings is secondary and
 * lives in the account menu, not here. Roadmap and Projects are deliberately
 * absent: they remain registered, routed and deep-linkable.
 */
export const PRIMARY_NAVIGATION: readonly ID[] = [
  "home",
  "clients",
  "scout",
  "comms",
  "website",
  "ops",
  "studio",
  "pulse",
  "conductor",
  "approvals",
  "steward",
];

export const APP_REGISTRY: AppRegistration[] = [
  {
    id: "home",
    layer: "core",
    name: "Home",
    slug: "home",
    description: "Where you are, what matters now, and the next move.",
    status: "live",
    route: "/",
    icon: "Compass",
    capabilities: ["decisions", "intelligence"],
  },
  {
    id: "clients",
    layer: "business",
    name: "Clients",
    slug: "clients",
    description:
      "The book of companies Trust Tai is responsible for: tier, value, review and delivery, in one place.",
    status: "live",
    route: "/modules/clients",
    icon: "Building2",
    capabilities: ["clients", "contacts"],
  },
  {
    id: "scout",
    layer: "business",
    name: "Scout",
    slug: "scout",
    description: "Find and qualify the right clients before outreach begins.",
    status: "live",
    route: "/modules/scout",
    icon: "Search",
    capabilities: ["clients", "contacts", "intelligence"],
  },
  {
    id: "comms",
    layer: "business",
    name: "Comms",
    slug: "comms",
    description: "Relationships kept warm, with a truthful reason to reach out.",
    status: "live",
    route: "/modules/comms",
    icon: "MessagesSquare",
    capabilities: ["conversations", "contacts", "intelligence"],
  },
  {
    id: "roadmap",
    layer: "business",
    name: "Roadmap",
    slug: "roadmap",
    description: "Point A to Point B, sequenced into a build order.",
    status: "live",
    route: "/modules/roadmap",
    icon: "Route",
    capabilities: ["projects", "decisions"],
    // Reached through the client it belongs to. Still owns its state, its
    // permissions, its routes and its events.
    navigation: "deep_link",
  },
  {
    id: "projects",
    layer: "business",
    name: "Projects",
    slug: "projects",
    description: "Delivery, ownership, and milestone truth.",
    status: "live",
    route: "/modules/projects",
    icon: "SquareStack",
    capabilities: ["projects", "tasks"],
    navigation: "deep_link",
  },
  {
    id: "steward",
    layer: "stewardship",
    name: "Steward",
    slug: "steward",
    description:
      "Interpretation, memory and judgment across the suite: conversations become commitments, and commitments get kept.",
    status: "live",
    route: "/modules/steward",
    icon: "HeartHandshake",
    // Steward reads conversations, commitments and decisions that other rooms
    // and core entities own. It stores interpretation and memory, never a
    // second copy of domain truth.
    capabilities: ["intelligence"],
  },
  {
    id: "website",
    layer: "business",
    name: "Website",
    slug: "website",
    description: "Attention and intake on TrustTai.com, and what reached Scout because of it.",
    status: "live",
    route: "/modules/website",
    icon: "Globe",
    capabilities: ["analytics", "contacts", "intelligence"],
  },
  {
    id: "ops",
    layer: "business",
    name: "Ops",
    slug: "ops",
    description: "Maintenance, technical stewardship and site health, in the standalone Ops app.",
    status: "live",
    route: "/modules/ops",
    launchUrl: "https://ops.trusttai.com",
    icon: "ShieldCheck",
    capabilities: ["websites", "monitoring", "tasks"],
  },
  {
    id: "studio",
    layer: "business",
    name: "Studio",
    slug: "studio",
    description:
      "The content room. One command becomes an editorial package, and one approval decides whether any of it reaches the website.",
    status: "live",
    route: "/modules/studio",
    icon: "PenTool",
    capabilities: ["content"],
  },

  {
    id: "pulse",
    layer: "intelligence",
    name: "Pulse",
    slug: "pulse",
    description: "Signals and outcomes across the portfolio, the suite readout surface.",
    status: "live",
    route: "/modules/pulse",
    icon: "Activity",
    capabilities: ["analytics", "intelligence"],
  },
  {
    id: "conductor",
    layer: "intelligence",
    name: "Conductor",
    slug: "conductor",
    description:
      "The command layer: ask the whole business a question and get a grounded answer, with bounded next steps you authorise.",
    status: "live",
    route: "/modules/conductor",
    icon: "Compass",
    capabilities: ["intelligence", "analytics"],
  },
  {
    id: "approvals",
    layer: "intelligence",
    name: "Approvals",
    slug: "approvals",
    description:
      "One place to decide. Agents prepare the work, you approve it, and the owning room executes afterwards.",
    status: "live",
    route: "/modules/approvals",
    icon: "CheckCheck",
    capabilities: ["decisions", "intelligence"],
  },
];


export function getApp(slug: string): AppRegistration | undefined {
  return APP_REGISTRY.find((app) => app.slug === slug);
}

/** Rooms that own domain state. Only these may write business truth. */
export function businessApps(): AppRegistration[] {
  return APP_REGISTRY.filter((app) => app.layer === "business");
}

export function isBusinessApp(appId: string): boolean {
  return APP_REGISTRY.some((app) => app.id === appId && app.layer === "business");
}

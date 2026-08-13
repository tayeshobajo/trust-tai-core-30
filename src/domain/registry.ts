/**
 * Trust Tai OS — shared application registry.
 *
 * Every internal Trust Tai app is registered here once. The shell, navigation,
 * and intelligence layer all read from this single list.
 */

import type { ID } from "./entities";

export type AppStatus = "live" | "in_build" | "mapped" | "external";

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

export interface AppRegistration {
  id: ID;
  name: string;
  slug: string;
  description: string;
  status: AppStatus;
  /** Route inside this shell, or an absolute URL for external products. */
  route: string;
  /** Lucide icon name, resolved by the navigation component. */
  icon: string;
  capabilities: CapabilityTag[];
}

export const APP_REGISTRY: AppRegistration[] = [
  {
    id: "home",
    name: "Home",
    slug: "home",
    description: "Where you are, what matters now, and the next move.",
    status: "live",
    route: "/",
    icon: "Compass",
    capabilities: ["decisions", "intelligence"],
  },
  {
    id: "scout",
    name: "Scout",
    slug: "scout",
    description: "Find and qualify the right clients before outreach begins.",
    status: "in_build",
    route: "/modules/scout",
    icon: "Search",
    capabilities: ["clients", "contacts", "intelligence"],
  },
  {
    id: "comms",
    name: "Comms",
    slug: "comms",
    description: "Relationships kept warm, with a truthful reason to reach out.",
    status: "in_build",
    route: "/modules/comms",
    icon: "MessagesSquare",
    capabilities: ["conversations", "contacts", "intelligence"],
  },
  {
    id: "roadmap",
    name: "Roadmap",
    slug: "roadmap",
    description: "Point A to Point B, sequenced into a build order.",
    status: "mapped",
    route: "/modules/roadmap",
    icon: "Route",
    capabilities: ["projects", "decisions"],
  },
  {
    id: "projects",
    name: "Projects",
    slug: "projects",
    description: "Delivery, ownership, and milestone truth.",
    status: "mapped",
    route: "/modules/projects",
    icon: "SquareStack",
    capabilities: ["projects", "tasks"],
  },
  {
    id: "ops",
    name: "Ops",
    slug: "ops",
    description: "Maintenance and site health. Lives in the existing Ops product.",
    status: "external",
    route: "/modules/ops",
    icon: "ShieldCheck",
    capabilities: ["websites", "monitoring", "tasks"],
  },
  {
    id: "studio",
    name: "Studio",
    slug: "studio",
    description: "Brand, content, and asset production.",
    status: "mapped",
    route: "/modules/studio",
    icon: "PenTool",
    capabilities: ["content"],
  },
  {
    id: "pulse",
    name: "Pulse",
    slug: "pulse",
    description: "Signals and outcomes across the portfolio.",
    status: "mapped",
    route: "/modules/pulse",
    icon: "Activity",
    capabilities: ["analytics", "intelligence"],
  },
];

export function getApp(slug: string): AppRegistration | undefined {
  return APP_REGISTRY.find((app) => app.slug === slug);
}

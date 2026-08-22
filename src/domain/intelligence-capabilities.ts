/**
 * The suite capability view, composed.
 *
 * The runtime must never recommend an operation a room cannot actually
 * perform, and must never treat an external effect (an email sent, an Ops
 * task, a Paperclip dispatch) as something the suite did itself. This module
 * answers one question per room — "what can you really do, and where is the
 * human boundary?" — by composing the existing registries:
 *
 * - ADAPTER_CAPABILITIES (src/domain/adapter-registry.ts): declared execution
 *   coverage, consequence classes, approval requirements.
 * - APP_REGISTRY (src/domain/registry.ts): layer and status of the room.
 * - action-authority: which permission a person must hold.
 * - EXTERNAL_SURFACES below: effects that leave the building.
 */

import { ADAPTER_CAPABILITIES, type AdapterCapability } from "./adapter-registry";
import { APP_REGISTRY } from "./registry";
import { actionPermission } from "./action-authority";
import type { Permission } from "./access";

/**
 * Effects that leave the suite. The runtime marks any step touching one of
 * these as external: a person carries it, and completion requires downstream
 * evidence (api_response / downstream_receipt), never just "we sent it".
 */
export const EXTERNAL_SURFACES: Record<string, string[]> = {
  scout: ["web_research_provider"],
  comms: ["gmail"],
  roadmap: [],
  projects: ["paperclip", "ops", "studio"],
  ops: ["ops_external_app"],
  studio: [],
  steward: ["fathom", "paperclip"],
  pulse: [],
  home: [],
  conductor: [],
  website: ["ga4", "search_console"],
};

export interface CapabilityAnswer {
  room: string;
  /** False when the room is not in the suite registry at all. */
  exists: boolean;
  layer?: string;
  /** Operations with a real adapter behind them — the room can do these. */
  executable: AdapterCapability[];
  /** Declared but deliberately unroutable operations, with the reason. */
  unavailable: AdapterCapability[];
  /** True when the room holds no executable operations at all. */
  readOnly: boolean;
  /** Surfaces whose effect leaves the suite. */
  externalSurfaces: string[];
  /** What always requires a human in this room. */
  humanOnly: string[];
}

/** What can this room do? The runtime consults this before recommending. */
export function roomCapabilities(room: string): CapabilityAnswer {
  const registered = APP_REGISTRY.find((app) => app.id === room);
  const capabilities = ADAPTER_CAPABILITIES.filter((cap) => cap.room === room);
  const executable = capabilities.filter((cap) => cap.supported);
  const unavailable = capabilities.filter((cap) => !cap.supported);

  const humanOnly: string[] = [];
  for (const cap of capabilities) {
    if (cap.requiresApproval) {
      humanOnly.push(`${cap.operation} — always needs a person's approval`);
    }
    if (operationIsExternal(room, cap.operation)) {
      humanOnly.push(`${cap.operation} — external effect; a person carries it`);
    }
  }

  return {
    room,
    exists: Boolean(registered),
    ...(registered ? { layer: registered.layer } : {}),
    executable,
    unavailable,
    readOnly: executable.length === 0,
    externalSurfaces: EXTERNAL_SURFACES[room] ?? [],
    humanOnly,
  };
}

/** The permission a person must hold to approve an operation in a room. */
export function approvalPermissionFor(room: string, operation: string): Permission {
  /* actionPermission never throws: an unmapped room falls back to org.manage. */
  return actionPermission({ appId: room, operation });
}

/**
 * May a read recommend this operation? Only when it is supported in the
 * capability registry, or when the room has no registry coverage at all (a
 * read-only room recommending a human step is fine — the person executes).
 */
export function operationIsRecommendable(room: string, operation: string): boolean {
  const answer = roomCapabilities(room);
  const declared = [...answer.executable, ...answer.unavailable];
  if (declared.length === 0) return true;
  return answer.executable.some((cap) => cap.operation === operation);
}

/** Does this operation's effect leave the suite? */
export function operationIsExternal(room: string, operation: string): boolean {
  return (EXTERNAL_SURFACES[room] ?? []).some(
    (surface) => operation === surface || operation.includes(surface),
  );
}

/** Every room that can execute anything, for suite-wide readouts. */
export function executableRooms(): string[] {
  return [...new Set(ADAPTER_CAPABILITIES.filter((cap) => cap.supported).map((cap) => cap.room))];
}

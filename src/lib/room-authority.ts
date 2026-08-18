/**
 * Trust Tai OS, room authority at the write boundary.
 *
 * Visibility is decided by `@/domain/app-access` and rendered by the shell.
 * Authority has to be enforced somewhere a mutation cannot slip past, because
 * the database only knows "is this person a member of the organization": it
 * cannot tell a `view` grant from a `work` grant. So the resolved decision is
 * published here once, by the workspace boundary, and every room service that
 * writes asks this module first.
 *
 * Fails closed once it knows the answer. Before the boundary has published
 * anything (server rendering, tests, scripts) it stays silent rather than
 * pretending to be an authorization layer it is not.
 */

import type { AppAccessDecision } from "@/domain/app-access";

interface RoomAuthority {
  visible: boolean;
  canWork: boolean;
}

let known = false;
let rooms: Record<string, RoomAuthority> = {};

/** Publish the resolved access for the signed-in person. Called by the gate. */
export function setRoomAuthority(decisions: AppAccessDecision[]): void {
  const next: Record<string, RoomAuthority> = {};
  for (const decision of decisions) {
    next[decision.appId] = { visible: decision.visible, canWork: decision.canWork };
  }
  rooms = next;
  known = true;
}

/** Forget everything. Sign-out, and tests. */
export function clearRoomAuthority(): void {
  rooms = {};
  known = false;
}

export function roomAuthorityKnown(): boolean {
  return known;
}

/** May this person work in this room? Unknown room after resolution: no. */
export function canWorkInRoom(appId: string): boolean {
  if (!known) return true;
  return rooms[appId]?.canWork === true;
}

export function roomIsVisible(appId: string): boolean {
  if (!known) return true;
  return rooms[appId]?.visible === true;
}

export class RoomAuthorityError extends Error {
  readonly appId: string;
  constructor(appId: string, roomName: string) {
    super(`You have view access to ${roomName}. Changing it is not part of your access.`);
    this.name = "RoomAuthorityError";
    this.appId = appId;
  }
}

/** Refuse a write the person's access does not carry. */
export function assertRoomWrite(appId: string, roomName: string): void {
  if (!canWorkInRoom(appId)) throw new RoomAuthorityError(appId, roomName);
}

/**
 * Wrap a room service so every method that is not a declared read asks for
 * authority first. New write methods are therefore guarded by default, which
 * is the safe direction for a mistake to fall.
 */
export function guardRoomWrites<T extends object>(
  appId: string,
  roomName: string,
  service: T,
  readMethods: readonly string[],
): T {
  const reads = new Set<string>(readMethods);
  return new Proxy(service, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function" || typeof property !== "string") return value;
      if (reads.has(property)) return value;
      return function guarded(this: unknown, ...args: unknown[]) {
        assertRoomWrite(appId, roomName);
        return (value as (...a: unknown[]) => unknown).apply(this ?? target, args);
      };
    },
  });
}

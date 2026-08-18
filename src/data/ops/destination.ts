/**
 * Turning an Ops destination row into a safe route hint.
 *
 * Ops writes absolute destination URLs. Only a URL that is genuinely on the
 * Ops origin may become a target path, and only the path plus query travels
 * with the handshake. Nothing here ever carries a credential.
 */

import { OPS_ORIGIN } from "@/domain/ops";

export function opsPathOf(destination: string): string | undefined {
  try {
    const url = new URL(destination, OPS_ORIGIN);
    if (url.origin !== OPS_ORIGIN) return undefined;
    const path = `${url.pathname}${url.search}`;
    return path === "/" ? undefined : path;
  } catch {
    return undefined;
  }
}

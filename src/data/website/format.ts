/**
 * Presentation helpers shared by the Website room and the page detail route.
 *
 * One rule: a number we were never told renders as a dash, never as zero.
 */

import type { KnownNumber } from "@/domain/website";

export const UNKNOWN = "—";

export function percent(value: KnownNumber): string {
  return value === null ? UNKNOWN : `${(value * 100).toFixed(1)}%`;
}

export function decimal(value: KnownNumber): string {
  return value === null ? UNKNOWN : value.toFixed(1);
}

export function seconds(value: KnownNumber): string {
  return value === null ? UNKNOWN : `${Math.round(value)}s`;
}

/** "3 hours ago" style, honest about never having been told. */
export function lastSynced(value: string | null | undefined): string {
  if (!value) return "Never";
  const then = Date.parse(value);
  if (Number.isNaN(then)) return "Never";
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60_000));
  if (minutes < 60) return minutes <= 1 ? "Just now" : `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  return `${Math.round(hours / 24)} days ago`;
}

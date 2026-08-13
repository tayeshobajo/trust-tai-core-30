/**
 * Ambient Identity Wash primitives.
 *
 * One approved pattern, one implementation. A surface declares which accent it
 * belongs to; the gradient itself lives in the `tt-ambient` utility so no page
 * hand-writes a gradient string.
 *
 * The wash is light entering the top of a surface: 4–8% of the accent fading
 * to nothing within 140–220px. The canvas stays paper, the card stays white,
 * and every control, status colour and piece of text is untouched — contrast
 * is unaffected because the wash never sits behind body copy at strength.
 */

import type { CSSProperties, ElementType, ReactNode } from "react";

import { resolveAmbientAccent } from "@/domain/ambient-theme";
import { cn } from "@/lib/utils";

/** How much accent enters the surface. Inside the approved 4–8% range. */
export type AmbientStrength = "faint" | "default" | "present";

const STRENGTH: Record<AmbientStrength, string> = {
  faint: "4%",
  default: "6%",
  present: "8%",
};

/** How far the light travels before it is gone. Approved range: 140–220px. */
export type AmbientDepth = "shallow" | "default" | "deep";

const DEPTH: Record<AmbientDepth, string> = {
  shallow: "140px",
  default: "180px",
  deep: "220px",
};

export interface AmbientProps {
  /** Registered app id. Chooses the room's canonical accent. */
  appId: string;
  /**
   * A real, validated colour belonging to the subject of this page — a
   * company's own brand colour, for example. Falls back to the app accent.
   */
  contextAccent?: string | null;
  strength?: AmbientStrength;
  depth?: AmbientDepth;
}

/** The custom properties the `tt-ambient` utility reads. Decorative only. */
export function ambientStyle({
  appId,
  contextAccent,
  strength = "default",
  depth = "default",
}: AmbientProps): CSSProperties {
  return {
    "--tt-ambient-accent": resolveAmbientAccent(appId, contextAccent),
    "--tt-ambient-strength": STRENGTH[strength],
    "--tt-ambient-depth": DEPTH[depth],
  } as CSSProperties;
}

/**
 * A surface carrying the wash. Use it on the identity/hero/primary region of a
 * page, not behind every card — one atmospheric region reads stronger than
 * several tinted containers.
 */
export function AmbientSurface({
  appId,
  contextAccent,
  strength,
  depth,
  rule = false,
  as: Tag = "div",
  className,
  children,
  ...rest
}: AmbientProps & {
  /** Draw the 2px identity rule along the top edge. Use sparingly. */
  rule?: boolean;
  as?: ElementType;
  className?: string;
  children: ReactNode;
} & { [key: string]: unknown }) {
  const style = ambientStyle({ appId, contextAccent, ...(strength ? { strength } : {}), ...(depth ? { depth } : {}) });

  return (
    <Tag className={cn("tt-ambient", className)} style={style} {...rest}>
      {rule ? <AmbientRule appId={appId} contextAccent={contextAccent ?? null} /> : null}
      {children}
    </Tag>
  );
}

/** 2px identity rule drawn from the surface's accent. Decorative only. */
export function AmbientRule({
  appId,
  contextAccent,
  className,
}: Pick<AmbientProps, "appId" | "contextAccent"> & { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("tt-ambient-rule", className)}
      style={ambientStyle({ appId, contextAccent })}
    />
  );
}

/** A small identity dot. Place beside an eyebrow, never beside a status. */
export function AmbientDot({
  appId,
  contextAccent,
  className,
}: Pick<AmbientProps, "appId" | "contextAccent"> & { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-1.5 shrink-0 rounded-full", className)}
      style={{ backgroundColor: resolveAmbientAccent(appId, contextAccent) }}
    />
  );
}

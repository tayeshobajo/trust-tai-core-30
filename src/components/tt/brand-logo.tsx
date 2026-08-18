/**
 * The Trust Tai brand mark, taken from the live trusttai.com identity.
 *
 * One component so the logo is never re-typed as a text lockup: the OS shell,
 * the sign-in screen and the fail-closed boundary all render this file.
 */

import logoDark from "@/assets/brand/trust-tai-logo.png";
import logoWhite from "@/assets/brand/trust-tai-logo-white.png";
import { cn } from "@/lib/utils";

const NATURAL_WIDTH = 534;
const NATURAL_HEIGHT = 97;

export function BrandLogo({
  variant = "dark",
  height = 28,
  className,
  alt = "Trust Tai",
}: {
  /** "dark" is the ink lockup for the OS's light shell; "white" is for dark surfaces. */
  variant?: "dark" | "white";
  height?: number;
  className?: string;
  alt?: string;
}) {
  const src = variant === "white" ? logoWhite : logoDark;
  const width = Math.round((height * NATURAL_WIDTH) / NATURAL_HEIGHT);
  return (
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      style={{ height, width }}
      className={cn("block object-contain", className)}
      decoding="async"
    />
  );
}

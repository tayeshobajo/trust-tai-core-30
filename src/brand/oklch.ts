/**
 * oklch to sRGB hex.
 *
 * The app's colour tokens are authored in oklch, which is right for screens
 * and impossible in email: no mail client understands oklch, CSS variables or
 * color-mix(). Rather than let somebody eyeball a hex that "looks about
 * right", the email palette is converted from the very same tokens and the
 * conversion is checked by a test, so the letter in an inbox is the same
 * Trust Tai as the letter on screen.
 */

/** Parse an `oklch(L C H)` declaration. Returns null for anything else. */
export function parseOklch(value: string): { l: number; c: number; h: number } | null {
  const match = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/i.exec(value.trim());
  if (!match) return null;
  return { l: Number(match[1]), c: Number(match[2]), h: Number(match[3]) };
}

function channel(value: number): number {
  const encoded = value <= 0.0031308 ? 12.92 * value : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(encoded * 255)));
}

/** Convert an `oklch(...)` string to a lowercase `#rrggbb` hex, clipped to sRGB. */
export function oklchToHex(value: string): string | null {
  const parsed = parseOklch(value);
  if (!parsed) return null;

  const hue = (parsed.h * Math.PI) / 180;
  const a = parsed.c * Math.cos(hue);
  const b = parsed.c * Math.sin(hue);

  const lCube = (parsed.l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mCube = (parsed.l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const sCube = (parsed.l - 0.0894841775 * a - 1.291485548 * b) ** 3;

  const r = 4.0767416621 * lCube - 3.3077115913 * mCube + 0.2309699292 * sCube;
  const g = -1.2684380046 * lCube + 2.6097574011 * mCube - 0.3413193965 * sCube;
  const blue = -0.0041960863 * lCube - 0.7034186147 * mCube + 1.707614701 * sCube;

  return `#${[r, g, blue].map((part) => channel(part).toString(16).padStart(2, "0")).join("")}`;
}

/** Relative luminance of a `#rrggbb` hex, for contrast checks. */
export function luminance(hex: string): number {
  const parts = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const linear = parts.map((part) =>
    part <= 0.04045 ? part / 12.92 : Math.pow((part + 0.055) / 1.055, 2.4),
  );
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

/** WCAG contrast ratio between two `#rrggbb` hex colours. */
export function contrastRatio(a: string, b: string): number {
  const first = luminance(a);
  const second = luminance(b);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

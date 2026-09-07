/**
 * Reveal and focus: the shared handoff between an action and the place it
 * opens.
 *
 * When a control opens or changes something further up or down the page, the
 * person should see where their click landed. This module keeps that behaviour
 * in one place: bring the destination into view, mark it briefly so the eye
 * finds it, and put the cursor in the first meaningful field.
 *
 * The decisions are pure functions so they can be tested without a browser.
 * Motion is always subject to the reader's reduced-motion preference.
 */

import { useCallback, useRef } from "react";

/** How long the temporary blue emphasis stays on a revealed panel. */
export const REVEAL_HIGHLIGHT_MS = 1400;

/** Attribute a revealed element carries while it is emphasised. */
export const REVEAL_ATTRIBUTE = "data-tt-reveal";

/** True when the reader asked for less motion. Safe outside a browser. */
export function prefersReducedMotion(win?: Pick<Window, "matchMedia"> | undefined): boolean {
  const target = win ?? (typeof window === "undefined" ? undefined : window);
  if (!target?.matchMedia) return false;
  try {
    return target.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** Smooth by default, instant for readers who asked for less motion. */
export function revealBehavior(reduced: boolean): ScrollBehavior {
  return reduced ? "auto" : "smooth";
}

/**
 * Whether the destination needs scrolling at all. A panel already comfortably
 * on screen should never move the page under the reader.
 */
export function needsScroll(
  rect: { top: number; bottom: number },
  viewportHeight: number,
  margin = 96,
): boolean {
  if (viewportHeight <= 0) return false;
  if (rect.top < margin) return true;
  if (rect.bottom > viewportHeight - margin) return true;
  return false;
}

const FOCUSABLE =
  "input:not([type=hidden]):not([disabled]), textarea:not([disabled]), select:not([disabled])";

/** The first field worth putting a cursor in, if the panel has one. */
export function firstFocusable(root: {
  querySelector: (selector: string) => Element | null;
}): HTMLElement | null {
  const found = root.querySelector(FOCUSABLE);
  return found instanceof HTMLElement ? found : null;
}

export type RevealOptions = {
  /** Put the cursor in the first field. On by default. */
  focus?: boolean | undefined;
  /** Extra breathing room above and below when deciding to scroll. */
  margin?: number | undefined;
};

/**
 * Reveal a panel that has just opened: scroll it into view when it is out of
 * comfortable reach, mark it briefly, and focus its first field.
 *
 * Call it after the panel has rendered; the hook waits a frame itself.
 */
export function useReveal<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reveal = useCallback((options: RevealOptions = {}) => {
    if (typeof window === "undefined") return;
    window.requestAnimationFrame(() => {
      const node = ref.current;
      if (!node) return;
      const reduced = prefersReducedMotion();
      const rect = node.getBoundingClientRect();
      if (needsScroll(rect, window.innerHeight, options.margin ?? 96)) {
        node.scrollIntoView({ behavior: revealBehavior(reduced), block: "center" });
      }
      node.setAttribute(REVEAL_ATTRIBUTE, "on");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        node.removeAttribute(REVEAL_ATTRIBUTE);
      }, REVEAL_HIGHLIGHT_MS);
      if (options.focus !== false) {
        firstFocusable(node)?.focus({ preventScroll: true });
      }
    });
  }, []);

  return { ref, reveal };
}

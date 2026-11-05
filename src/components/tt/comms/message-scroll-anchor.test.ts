// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { anchorConversationMessage } from "./message-scroll-anchor";

let resize: () => void;
let frames: Map<number, FrameRequestCallback>;
let cleanup: (() => void) | undefined;
let id = 0;
const scrollIntoView = vi.fn();
const flush = () => {
  const pending = [...frames.values()];
  frames.clear();
  pending.forEach((fn) => fn(0));
};
beforeEach(() => {
  frames = new Map();
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => {
    frames.set(++id, fn);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (key: number) => frames.delete(key));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  scrollIntoView.mockReset();
});
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});
function fixture(height = 400) {
  document.body.innerHTML =
    '<div data-conversation-scroll><div data-conversation-content><div tabindex="-1" data-message-id="target">Linked message</div></div></div>';
  const pane = document.querySelector<HTMLElement>("[data-conversation-scroll]")!;
  const content = pane.firstElementChild as HTMLElement;
  const target = content.firstElementChild as HTMLElement;
  let offset = 800;
  let paneHeight = height;
  Object.defineProperty(pane, "clientHeight", { get: () => paneHeight });
  pane.scrollIntoView = scrollIntoView;
  pane.getBoundingClientRect = () =>
    ({ top: 100, bottom: 100 + paneHeight, height: paneHeight }) as DOMRect;
  target.getBoundingClientRect = () =>
    ({ top: 100 + offset - pane.scrollTop, height: 900 }) as DOMRect;
  return {
    pane,
    content,
    target,
    move: (next: number) => {
      offset = next;
    },
    shrink: (next: number) => {
      paneHeight = next;
    },
  };
}

describe("deep-link layout settling", () => {
  it.each([400, 180])(
    "keeps the message beginning visible in a %spx pane after delayed history and a draft panel arrive",
    async (height) => {
      const f = fixture(height);
      cleanup = anchorConversationMessage(f.target);
      expect(document.activeElement).toBe(f.target);
      expect(f.pane.scrollTop).toBe(788);
      flush();
      f.move(1400); // Older history/inline bodies expand above the named message.
      resize();
      flush();
      expect(f.pane.scrollTop).toBe(1388);
      f.shrink(120); // Saved-draft controls reduce the remaining pane.
      resize();
      flush();
      expect(f.target.getBoundingClientRect().top).toBe(112);
      f.move(1600);
      f.content.prepend(document.createElement("p")); // Same-size replacement can still shift the target.
      await Promise.resolve();
      flush();
      expect(f.pane.scrollTop).toBe(1588);
      expect(scrollIntoView).toHaveBeenCalledTimes(1); // No repeated outer-page jumps.
    },
  );
  it.each(["wheel", "touchstart", "pointerdown", "keydown"])(
    "releases the anchor permanently after user %s, including pending frames",
    (event) => {
      const f = fixture();
      cleanup = anchorConversationMessage(f.target);
      document.dispatchEvent(new Event(event));
      f.pane.scrollTop = 100;
      f.move(1400);
      resize();
      flush();
      expect(f.pane.scrollTop).toBe(100);
      expect(f.pane.style.overflowAnchor).toBe("");
    },
  );
  it("waits for a hidden mobile pane to become measurable", () => {
    const f = fixture(0);
    cleanup = anchorConversationMessage(f.target);
    expect(scrollIntoView).not.toHaveBeenCalled();
    f.shrink(200);
    resize();
    flush();
    expect(f.pane.scrollTop).toBe(788);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });
  it("cleans up on navigation and allows a newly requested target to anchor", () => {
    const f = fixture();
    cleanup = anchorConversationMessage(f.target);
    cleanup();
    f.pane.scrollTop = 0;
    resize();
    flush();
    expect(f.pane.scrollTop).toBe(0);
    f.move(2000);
    cleanup = anchorConversationMessage(f.target);
    expect(f.pane.scrollTop).toBe(1988);
  });
});

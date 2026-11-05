/** Keep a deep-linked message in its own scroll pane as async content settles.
 * Never keep pulling a reader back after they interact, and never write data. */
export function anchorConversationMessage(target: HTMLElement): () => void {
  const pane = target.closest<HTMLElement>("[data-conversation-scroll]");
  const content = pane?.querySelector<HTMLElement>("[data-conversation-content]");
  target.focus({ preventScroll: true });
  if (!pane || !content) return () => {};

  let stopped = false;
  let frame: number | undefined;
  let revealed = false;
  const previousAnchor = pane.style.overflowAnchor;
  pane.style.overflowAnchor = "none";

  const align = () => {
    frame = undefined;
    if (stopped || !target.isConnected || pane.clientHeight === 0) return;
    if (!revealed) {
      // Reveal the pane once on mobile. Later adjustments move only its contents.
      pane.scrollIntoView({ block: "nearest", behavior: "instant" });
      revealed = true;
    }
    const delta =
      target.getBoundingClientRect().top - pane.getBoundingClientRect().top - pane.clientTop - 12;
    // Align the beginning, including for messages taller than the available pane.
    if (Math.abs(delta) > 1) pane.scrollTop += delta;
  };
  const schedule = () => {
    if (!stopped && frame === undefined) frame = requestAnimationFrame(align);
  };
  const resize = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(schedule);
  resize?.observe(pane);
  resize?.observe(content);
  resize?.observe(target);
  const mutations = new MutationObserver(schedule);
  mutations.observe(content, { childList: true, characterData: true, subtree: true });
  content.addEventListener("load", schedule, true);

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (frame !== undefined) cancelAnimationFrame(frame);
    resize?.disconnect();
    mutations.disconnect();
    content.removeEventListener("load", schedule, true);
    pane.style.overflowAnchor = previousAnchor;
    for (const event of ["wheel", "touchstart", "pointerdown", "keydown"]) {
      document.removeEventListener(event, stop, true);
    }
  };
  for (const event of ["wheel", "touchstart", "pointerdown", "keydown"]) {
    document.addEventListener(event, stop, { capture: true, passive: true });
  }
  align();
  schedule();
  return stop;
}

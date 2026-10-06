/** Edges of a scroll container that fade because more content lies beyond them. */
export type ScrollEdgeFade = "none" | "top" | "bottom" | "both";

/** Scroll offsets within this many pixels of an end count as reaching it, absorbing fractional layout. */
const SCROLL_EDGE_TOLERANCE = 1;

/** Resolve which edges fade from a container's vertical scroll metrics. */
export function scrollEdgeFade(metrics: { scrollTop: number; scrollHeight: number; clientHeight: number }): ScrollEdgeFade {
  const maxScrollTop = metrics.scrollHeight - metrics.clientHeight;
  if (maxScrollTop <= SCROLL_EDGE_TOLERANCE) return "none";
  const up = metrics.scrollTop > SCROLL_EDGE_TOLERANCE;
  const down = metrics.scrollTop < maxScrollTop - SCROLL_EDGE_TOLERANCE;
  if (up && down) return "both";
  if (up) return "top";
  return down ? "bottom" : "none";
}

/**
 * Svelte action that fades a scroll container's top or bottom edge while content lies beyond it.
 * It sets `data-scroll-fade` on the node, which the global stylesheet turns into a mask, and refreshes on scroll and on size changes of the node or its children.
 */
export function scrollEdgeFadeAction(node: HTMLElement) {
  let frame: number | null = null;
  const refresh = () => {
    frame = null;
    const fade = scrollEdgeFade(node);
    if (fade === "none") node.removeAttribute("data-scroll-fade");
    else node.setAttribute("data-scroll-fade", fade);
  };
  const requestRefresh = () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(refresh);
  };
  const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(requestRefresh);
  observer?.observe(node);
  for (const child of node.children) observer?.observe(child);
  node.addEventListener("scroll", refresh, { passive: true });
  refresh();
  return {
    destroy() {
      observer?.disconnect();
      node.removeEventListener("scroll", refresh);
      if (frame !== null) cancelAnimationFrame(frame);
      node.removeAttribute("data-scroll-fade");
    },
  };
}

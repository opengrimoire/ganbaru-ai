/**
 * Svelte action that moves the host element under another DOM node (default
 * `<body>`) for the lifetime of the component. Used for popovers and menus
 * that would otherwise be clipped by an ancestor's `overflow: hidden` or
 * stacked beneath a higher z-index sibling.
 *
 * The portaled node should usually use `position: fixed` with coordinates
 * computed from its trigger's `getBoundingClientRect()`, since once it lives
 * under `<body>` the original ancestor positioning context no longer
 * applies.
 */
export function portal(node: HTMLElement, target: HTMLElement | string = "body") {
  function mount(spec: HTMLElement | string) {
    const targetEl =
      typeof spec === "string" ? document.querySelector(spec) : spec;
    if (targetEl instanceof HTMLElement) targetEl.appendChild(node);
  }
  mount(target);
  return {
    update(spec: HTMLElement | string) {
      mount(spec);
    },
    destroy() {
      node.remove();
    },
  };
}

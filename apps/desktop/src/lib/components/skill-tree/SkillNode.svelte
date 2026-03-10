<script lang="ts">
  import type { NodeState, NodeTier } from "@ganbaruai/shared-types";

  interface Props {
    id: string;
    label: string;
    tier: NodeTier;
    state: NodeState;
    depth: number;
    x: number;
    y: number;
    isFocal: boolean;
    hasSubGraph: boolean;
    onclick: (id: string) => void;
    ondblclick: (id: string) => void;
  }

  let {
    id,
    label,
    tier,
    state,
    depth,
    x,
    y,
    isFocal,
    hasSubGraph,
    onclick,
    ondblclick,
  }: Props = $props();

  function radius(): number {
    switch (tier) {
      case "keystone": return 32;
      case "notable": return 24;
      case "basic": return 18;
    }
  }

  function depthOpacity(): number {
    switch (depth) {
      case 0: return 1;
      case 1: return 1;
      case 2: return 0.45;
      default: return 0.2;
    }
  }

  function handleClick() {
    onclick(id);
  }

  function handleDblClick() {
    ondblclick(id);
  }

  const r = $derived(radius());
  const opacity = $derived(depthOpacity());
</script>

<g
  class="skill-node"
  data-state={state}
  data-tier={tier}
  data-focal={isFocal}
  style="--depth-opacity: {opacity}"
  transform="translate({x}, {y})"
  role="button"
  tabindex="-1"
  onclick={handleClick}
  ondblclick={handleDblClick}
  onkeydown={(e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleClick();
    }
  }}
>
  <!-- Outer glow ring (unlocked / available only) -->
  {#if state !== "locked"}
    <circle
      class="skill-node__glow"
      r={r + 6}
      fill="none"
      stroke-width="2"
    />
  {/if}

  <!-- Main circle -->
  <circle
    class="skill-node__body"
    r={r}
    stroke-width={isFocal ? 2.5 : 1.5}
  />

  <!-- Sub-graph indicator (small arrow/chevron) -->
  {#if hasSubGraph && state !== "locked"}
    <circle
      class="skill-node__sub-indicator"
      cx={r * 0.65}
      cy={r * 0.65}
      r={5}
    />
  {/if}

  <!-- Label -->
  <text
    class="skill-node__label"
    y={r + 16}
    text-anchor="middle"
    font-size={tier === "keystone" ? 11 : tier === "notable" ? 10 : 9}
  >
    {label}
  </text>
</g>

<style>
  .skill-node {
    cursor: default;
    opacity: var(--depth-opacity, 1);
    transition: opacity 0.3s ease;
  }

  /* Locked */
  .skill-node[data-state="locked"] {
    pointer-events: none;
  }

  .skill-node[data-state="locked"] .skill-node__body {
    fill: #1a1a1a;
    stroke: #333;
    filter: grayscale(1);
  }

  .skill-node[data-state="locked"] .skill-node__label {
    fill: #444;
  }

  /* Available */
  .skill-node[data-state="available"] {
    cursor: pointer;
  }

  .skill-node[data-state="available"] .skill-node__body {
    fill: #1e2a1e;
    stroke: #4ade80;
    filter: drop-shadow(0 0 6px rgba(74, 222, 128, 0.4));
  }

  .skill-node[data-state="available"] .skill-node__glow {
    stroke: rgba(74, 222, 128, 0.25);
    animation: pulse-glow 2.5s ease-in-out infinite;
  }

  .skill-node[data-state="available"] .skill-node__label {
    fill: #a0a0a0;
  }

  /* Unlocked */
  .skill-node[data-state="unlocked"] {
    cursor: pointer;
  }

  .skill-node[data-state="unlocked"] .skill-node__body {
    fill: #1a2433;
    stroke: #60a5fa;
    filter: drop-shadow(0 0 10px rgba(96, 165, 250, 0.5)) brightness(1.1);
  }

  .skill-node[data-state="unlocked"] .skill-node__glow {
    stroke: rgba(96, 165, 250, 0.2);
  }

  .skill-node[data-state="unlocked"] .skill-node__label {
    fill: #d0d0d0;
  }

  /* Focal node emphasis */
  .skill-node[data-focal="true"][data-state="unlocked"] .skill-node__body {
    filter: drop-shadow(0 0 14px rgba(96, 165, 250, 0.7)) brightness(1.2);
  }

  .skill-node[data-focal="true"][data-state="available"] .skill-node__body {
    filter: drop-shadow(0 0 14px rgba(74, 222, 128, 0.6)) brightness(1.2);
  }

  .skill-node[data-focal="true"] .skill-node__label {
    fill: #e8e8e8;
    font-weight: 600;
  }

  /* Tier-specific sizes are handled by the radius() function */
  /* Keystone gets a special double border */
  .skill-node[data-tier="keystone"] .skill-node__body {
    stroke-width: 2.5;
  }

  /* Sub-graph indicator */
  .skill-node__sub-indicator {
    fill: rgba(255, 255, 255, 0.6);
    pointer-events: none;
  }

  .skill-node[data-state="locked"] .skill-node__sub-indicator {
    display: none;
  }

  /* Label */
  .skill-node__label {
    font-family: system-ui, sans-serif;
    pointer-events: none;
    user-select: none;
  }

  @keyframes pulse-glow {
    0%, 100% {
      opacity: 0.4;
    }
    50% {
      opacity: 1;
    }
  }
</style>

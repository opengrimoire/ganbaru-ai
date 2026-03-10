<script lang="ts">
  interface Props {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    state: "locked" | "active";
  }

  let { x1, y1, x2, y2, state }: Props = $props();
</script>

<line
  class="skill-edge"
  data-state={state}
  {x1} {y1} {x2} {y2}
/>

<style>
  .skill-edge {
    stroke-width: 1.5;
    transition: stroke 0.3s ease, stroke-opacity 0.3s ease;
  }

  .skill-edge[data-state="locked"] {
    stroke: #2a2a2a;
    stroke-opacity: 0.5;
  }

  .skill-edge[data-state="active"] {
    stroke: #60a5fa;
    stroke-opacity: 0.6;
    filter: drop-shadow(0 0 3px rgba(96, 165, 250, 0.3));
  }
</style>

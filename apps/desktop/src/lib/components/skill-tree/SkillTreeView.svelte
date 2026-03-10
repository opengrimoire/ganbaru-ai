<script lang="ts">
  import { spring } from "svelte/motion";
  import { onMount } from "svelte";
  import { getSkillTree } from "$lib/stores/skill-tree.svelte";
  import SkillNode from "./SkillNode.svelte";
  import SkillEdge from "./SkillEdge.svelte";
  import NodeDetailPanel from "./NodeDetailPanel.svelte";

  const tree = getSkillTree();

  let containerEl: HTMLDivElement | undefined = $state(undefined);
  let svgWidth = $state(800);
  let svgHeight = $state(600);

  // Spring-animated offset for center-snap
  const offset = spring(
    { x: 0, y: 0 },
    { stiffness: 0.12, damping: 0.7 },
  );

  // Recompute offset when focal node changes
  $effect(() => {
    const focal = tree.focalNode;
    if (focal) {
      offset.set({
        x: svgWidth / 2 - focal.position.x,
        y: svgHeight / 2 - focal.position.y,
      });
    }
  });

  // Track container size
  $effect(() => {
    if (!containerEl) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        svgWidth = entry.contentRect.width;
        svgHeight = entry.contentRect.height;
      }
    });
    observer.observe(containerEl);
    return () => observer.disconnect();
  });

  // Auto-focus container on mount so keyboard works immediately
  onMount(() => {
    containerEl?.focus();
  });

  function handleNodeClick(nodeId: string) {
    tree.focusNode(nodeId);
  }

  function handleNodeDblClick(nodeId: string) {
    const node = tree.visibleNodes.find((n) => n.id === nodeId);
    if (!node) return;

    if (node.subGraphId && node.state === "unlocked") {
      tree.enterNode(nodeId);
    } else if (node.state === "available") {
      tree.unlockNode(nodeId);
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    switch (e.key) {
      case "ArrowUp":
        e.preventDefault();
        tree.navigate("up");
        break;
      case "ArrowDown":
        e.preventDefault();
        tree.navigate("down");
        break;
      case "ArrowLeft":
        e.preventDefault();
        tree.navigate("left");
        break;
      case "ArrowRight":
        e.preventDefault();
        tree.navigate("right");
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (tree.focalNode) {
          const node = tree.focalNode;
          if (node.subGraphId && node.state === "unlocked") {
            tree.enterNode(node.id);
          } else if (node.state === "available") {
            tree.unlockNode(node.id);
          }
        }
        break;
      case "Escape":
      case "Backspace":
        e.preventDefault();
        if (tree.canGoBack) {
          tree.exitLayer();
        }
        break;
    }
  }

  // Build a position lookup for edges
  const nodePositions = $derived.by(() => {
    const map = new Map<string, { x: number; y: number }>();
    for (const node of tree.visibleNodes) {
      map.set(node.id, { x: node.position.x, y: node.position.y });
    }
    return map;
  });
</script>

<div
  class="skill-tree-viewport"
  bind:this={containerEl}
  role="application"
  aria-label="Skill tree"
  tabindex="0"
  onkeydown={handleKeydown}
>
  <!-- Breadcrumb navigation -->
  {#if tree.breadcrumbs.length > 1}
    <div class="skill-tree-breadcrumb">
      {#each tree.breadcrumbs as crumb, i}
        {#if i > 0}
          <span class="skill-tree-breadcrumb__sep">/</span>
        {/if}
        {#if i < tree.breadcrumbs.length - 1}
          <button
            class="skill-tree-breadcrumb__item"
            onclick={() => tree.navigateToBreadcrumb(i)}
          >
            {crumb.label}
          </button>
        {:else}
          <span class="skill-tree-breadcrumb__current">{crumb.label}</span>
        {/if}
      {/each}
    </div>
  {/if}

  <!-- Skill points display -->
  <div class="skill-tree-sp">
    <span class="skill-tree-sp__value">{tree.skillPoints}</span>
    <span class="skill-tree-sp__label">SP</span>
  </div>

  <!-- SVG viewport -->
  <svg
    width={svgWidth}
    height={svgHeight}
    class="skill-tree-svg"
  >
    <g transform="translate({$offset.x}, {$offset.y})">
      <!-- Edges first (below nodes) -->
      {#each tree.visibleEdges as edge (edge.id)}
        {@const src = nodePositions.get(edge.source)}
        {@const tgt = nodePositions.get(edge.target)}
        {#if src && tgt}
          <SkillEdge
            x1={src.x}
            y1={src.y}
            x2={tgt.x}
            y2={tgt.y}
            state={edge.state}
          />
        {/if}
      {/each}

      <!-- Nodes -->
      {#each tree.visibleNodes as node (node.id)}
        <SkillNode
          id={node.id}
          label={node.label}
          tier={node.tier}
          state={node.state}
          depth={node.depth}
          x={node.position.x}
          y={node.position.y}
          isFocal={node.depth === 0}
          hasSubGraph={!!node.subGraphId}
          onclick={handleNodeClick}
          ondblclick={handleNodeDblClick}
        />
      {/each}
    </g>
  </svg>

  <!-- Detail panel always visible for focal node -->
  {#if tree.focalNode}
    <NodeDetailPanel
      label={tree.focalNode.label}
      description={tree.focalNode.description}
      tier={tree.focalNode.tier}
      state={tree.focalNode.state}
      cost={tree.focalNode.cost}
      skillPoints={tree.skillPoints}
      hasSubGraph={!!tree.focalNode.subGraphId}
      onunlock={() => {
        if (tree.focalNode) tree.unlockNode(tree.focalNode.id);
      }}
      onenter={() => {
        if (tree.focalNode) tree.enterNode(tree.focalNode.id);
      }}
    />
  {/if}

  <!-- Navigation hint -->
  <div class="skill-tree-hint">
    Arrow keys to navigate &middot; Enter to select &middot; Esc to go back
  </div>
</div>

<style>
  .skill-tree-viewport {
    position: relative;
    width: 100%;
    height: 100%;
    background: #0d0d0d;
    overflow: hidden;
    outline: none;
  }

  .skill-tree-svg {
    display: block;
  }

  /* Breadcrumb */
  .skill-tree-breadcrumb {
    position: absolute;
    top: 0.75rem;
    left: 0.75rem;
    display: flex;
    align-items: center;
    gap: 0.25rem;
    z-index: 10;
  }

  .skill-tree-breadcrumb__sep {
    color: #444;
    font-size: 0.75rem;
  }

  .skill-tree-breadcrumb__item {
    background: none;
    border: none;
    color: #666;
    font-size: 0.75rem;
    cursor: pointer;
    padding: 0.125rem 0.25rem;
    border-radius: 3px;
  }

  .skill-tree-breadcrumb__item:hover {
    color: #e8e8e8;
    background: rgba(255, 255, 255, 0.06);
  }

  .skill-tree-breadcrumb__current {
    color: #a0a0a0;
    font-size: 0.75rem;
    font-weight: 500;
  }

  /* Skill points */
  .skill-tree-sp {
    position: absolute;
    top: 0.75rem;
    right: 0.75rem;
    display: flex;
    align-items: baseline;
    gap: 0.25rem;
    z-index: 10;
  }

  .skill-tree-sp__value {
    font-size: 1.25rem;
    font-weight: 700;
    color: #f59e0b;
    font-variant-numeric: tabular-nums;
  }

  .skill-tree-sp__label {
    font-size: 0.6875rem;
    color: #666;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  /* Navigation hint */
  .skill-tree-hint {
    position: absolute;
    bottom: 0.75rem;
    left: 0.75rem;
    font-size: 0.6875rem;
    color: #444;
    pointer-events: none;
    z-index: 10;
  }
</style>

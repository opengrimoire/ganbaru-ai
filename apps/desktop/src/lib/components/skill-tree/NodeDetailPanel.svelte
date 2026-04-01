<script lang="ts">
  import type { NodeState, NodeTier } from "@ganbaruai/shared-types";

  interface Props {
    label: string;
    description: string;
    tier: NodeTier;
    state: NodeState;
    cost: number;
    skillPoints: number;
    hasSubGraph: boolean;
    onunlock: () => void;
    onenter: () => void;
  }

  let {
    label,
    description,
    tier,
    state,
    cost,
    skillPoints,
    hasSubGraph,
    onunlock,
    onenter,
  }: Props = $props();

  const canAfford = $derived(skillPoints >= cost);
  const tierLabel = $derived(tier.charAt(0).toUpperCase() + tier.slice(1));
</script>

<div class="node-detail-panel">
  <div class="node-detail-panel__header">
    <h3 class="node-detail-panel__title">{label}</h3>
    <span class="node-detail-panel__tier" data-tier={tier}>{tierLabel}</span>
  </div>

  <p class="node-detail-panel__desc">{description}</p>

  <div class="node-detail-panel__footer">
    {#if state === "available"}
      <div class="node-detail-panel__cost" class:affordable={canAfford}>
        Cost: {cost} SP
      </div>
      <button
        class="node-detail-panel__btn node-detail-panel__btn--unlock"
        disabled={!canAfford}
        onclick={onunlock}
      >
        {canAfford ? "Unlock" : "Not enough SP"}
      </button>
    {:else if state === "unlocked"}
      <div class="node-detail-panel__status node-detail-panel__status--unlocked">
        Unlocked
      </div>
      {#if hasSubGraph}
        <button
          class="node-detail-panel__btn node-detail-panel__btn--enter"
          onclick={onenter}
        >
          Enter
        </button>
      {/if}
    {:else}
      <div class="node-detail-panel__status node-detail-panel__status--locked">
        Locked: unlock prerequisites first
      </div>
    {/if}
  </div>
</div>

<style>
  .node-detail-panel {
    position: absolute;
    bottom: 1rem;
    right: 1rem;
    width: 260px;
    background: #1a1a1a;
    border: 1px solid #333;
    border-radius: 8px;
    padding: 0.875rem;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
    z-index: 10;
  }

  .node-detail-panel__header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 0.5rem;
  }

  .node-detail-panel__title {
    font-size: 0.875rem;
    font-weight: 600;
    color: #e8e8e8;
    margin: 0;
  }

  .node-detail-panel__tier {
    font-size: 0.6875rem;
    color: #666;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .node-detail-panel__tier[data-tier="keystone"] {
    color: #f59e0b;
  }

  .node-detail-panel__tier[data-tier="notable"] {
    color: #818cf8;
  }

  .node-detail-panel__desc {
    font-size: 0.75rem;
    color: #999;
    margin: 0 0 0.75rem;
    line-height: 1.4;
  }

  .node-detail-panel__footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .node-detail-panel__cost {
    font-size: 0.75rem;
    color: #ef4444;
    font-weight: 500;
  }

  .node-detail-panel__cost.affordable {
    color: #4ade80;
  }

  .node-detail-panel__status {
    font-size: 0.75rem;
  }

  .node-detail-panel__status--unlocked {
    color: #60a5fa;
  }

  .node-detail-panel__status--locked {
    color: #666;
  }

  .node-detail-panel__btn {
    font-size: 0.75rem;
    padding: 0.25rem 0.75rem;
    border-radius: 4px;
    border: 1px solid;
    cursor: pointer;
    font-weight: 500;
    transition: background 0.15s ease, border-color 0.15s ease;
  }

  .node-detail-panel__btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .node-detail-panel__btn--unlock {
    background: rgba(74, 222, 128, 0.1);
    border-color: #4ade80;
    color: #4ade80;
  }

  .node-detail-panel__btn--unlock:hover:not(:disabled) {
    background: rgba(74, 222, 128, 0.2);
  }

  .node-detail-panel__btn--enter {
    background: rgba(96, 165, 250, 0.1);
    border-color: #60a5fa;
    color: #60a5fa;
  }

  .node-detail-panel__btn--enter:hover {
    background: rgba(96, 165, 250, 0.2);
  }
</style>

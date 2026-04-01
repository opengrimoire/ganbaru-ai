import type { NodeState, SkillEdge, SkillGraph, SkillNode } from "@ganbaruai/shared-types";
import { graphRegistry, rootGraph } from "$lib/data/skill-graphs";

interface GraphContext {
  graphId: string;
  focalNodeId: string;
}

export interface VisibleNode extends SkillNode {
  state: NodeState;
  depth: number;
}

export interface VisibleEdge extends SkillEdge {
  state: "locked" | "active";
}

/** Persisted unlock states: graphId:nodeId -> NodeState */
let nodeStates = $state<Record<string, NodeState>>({});

/** Navigation stack. The top entry is the current context. */
let graphStack = $state<GraphContext[]>([{ graphId: "root", focalNodeId: rootGraph.nodes[0].id }]);

/** Skill points available to spend */
let skillPoints = $state(50);

function stateKey(graphId: string, nodeId: string): string {
  return `${graphId}:${nodeId}`;
}

function currentContext(): GraphContext {
  return graphStack[graphStack.length - 1];
}

function currentGraph(): SkillGraph {
  const ctx = currentContext();
  return graphRegistry[ctx.graphId] ?? rootGraph;
}

/**
 * Build adjacency list for a graph (bidirectional for navigation).
 */
function buildAdjacency(graph: SkillGraph): Record<string, string[]> {
  const adj: Record<string, string[]> = {};
  for (const node of graph.nodes) {
    adj[node.id] = [];
  }
  for (const edge of graph.edges) {
    adj[edge.source]?.push(edge.target);
    adj[edge.target]?.push(edge.source);
  }
  return adj;
}

/**
 * BFS from focal node, returning nodes within maxDepth with their depth.
 */
function getNodesWithinDepth(
  graph: SkillGraph,
  focalId: string,
  maxDepth: number,
): { node: SkillNode; depth: number }[] {
  const adj = buildAdjacency(graph);
  const visited = new Set<string>();
  const result: { node: SkillNode; depth: number }[] = [];
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));

  const queue: { id: string; depth: number }[] = [{ id: focalId, depth: 0 }];
  visited.add(focalId);

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    const node = nodeMap.get(id);
    if (node) {
      result.push({ node, depth });
    }
    if (depth < maxDepth) {
      for (const neighborId of adj[id] ?? []) {
        if (!visited.has(neighborId)) {
          visited.add(neighborId);
          queue.push({ id: neighborId, depth: depth + 1 });
        }
      }
    }
  }

  return result;
}

/**
 * Compute the state of a node based on its prerequisites.
 */
function computeNodeState(node: SkillNode, graphId: string): NodeState {
  const key = stateKey(graphId, node.id);
  const persisted = nodeStates[key];
  if (persisted === "unlocked") return "unlocked";

  // Nodes with no prerequisites and zero cost start unlocked
  if (node.prerequisites.length === 0 && node.cost === 0) {
    return "unlocked";
  }

  // Check if all prerequisites are unlocked
  const allPrereqsMet = node.prerequisites.every((preId) => {
    const preKey = stateKey(graphId, preId);
    const preState = nodeStates[preKey];
    if (preState === "unlocked") return true;

    // Check zero-cost no-prereq nodes (auto-unlocked)
    const graph = graphRegistry[graphId];
    const preNode = graph?.nodes.find((n) => n.id === preId);
    return preNode !== undefined && preNode.prerequisites.length === 0 && preNode.cost === 0;
  });

  return allPrereqsMet ? "available" : "locked";
}

/**
 * Find the best neighbor in a given direction from the focal node.
 */
function findNeighborInDirection(
  direction: "up" | "down" | "left" | "right",
): string | undefined {
  const graph = currentGraph();
  const ctx = currentContext();
  const adj = buildAdjacency(graph);
  const focal = graph.nodes.find((n) => n.id === ctx.focalNodeId);
  if (!focal) return undefined;

  const neighbors = adj[focal.id] ?? [];
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));

  let best: { id: string; score: number } | undefined;

  for (const nId of neighbors) {
    const neighbor = nodeMap.get(nId);
    if (!neighbor) continue;

    const dx = neighbor.position.x - focal.position.x;
    const dy = neighbor.position.y - focal.position.y;

    let score: number;
    switch (direction) {
      case "up":
        if (dy >= 0) continue;
        score = -dy - Math.abs(dx) * 0.5;
        break;
      case "down":
        if (dy <= 0) continue;
        score = dy - Math.abs(dx) * 0.5;
        break;
      case "left":
        if (dx >= 0) continue;
        score = -dx - Math.abs(dy) * 0.5;
        break;
      case "right":
        if (dx <= 0) continue;
        score = dx - Math.abs(dy) * 0.5;
        break;
    }

    if (score > 0 && (!best || score > best.score)) {
      best = { id: nId, score };
    }
  }

  return best?.id;
}

export function getSkillTree() {
  const visibleNodes = $derived.by((): VisibleNode[] => {
    const graph = currentGraph();
    const ctx = currentContext();
    const nodesWithDepth = getNodesWithinDepth(graph, ctx.focalNodeId, 2);

    return nodesWithDepth.map(({ node, depth }) => ({
      ...node,
      state: computeNodeState(node, ctx.graphId),
      depth,
    }));
  });

  const visibleEdges = $derived.by((): VisibleEdge[] => {
    const graph = currentGraph();
    const visibleIds = new Set(visibleNodes.map((n) => n.id));
    const ctx = currentContext();

    return graph.edges
      .filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target))
      .map((e) => {
        const sourceState = computeNodeState(
          graph.nodes.find((n) => n.id === e.source)!,
          ctx.graphId,
        );
        return {
          ...e,
          state: sourceState === "unlocked" ? ("active" as const) : ("locked" as const),
        };
      });
  });

  const focalNode = $derived.by((): VisibleNode | undefined => {
    return visibleNodes.find((n) => n.depth === 0);
  });

  const breadcrumbs = $derived.by((): { graphId: string; label: string }[] => {
    return graphStack.map((ctx) => {
      const graph = graphRegistry[ctx.graphId];
      return { graphId: ctx.graphId, label: graph?.label ?? ctx.graphId };
    });
  });

  return {
    get visibleNodes(): VisibleNode[] {
      return visibleNodes;
    },

    get visibleEdges(): VisibleEdge[] {
      return visibleEdges;
    },

    get focalNode(): VisibleNode | undefined {
      return focalNode;
    },

    get breadcrumbs(): { graphId: string; label: string }[] {
      return breadcrumbs;
    },

    get skillPoints(): number {
      return skillPoints;
    },

    get canGoBack(): boolean {
      return graphStack.length > 1;
    },

    get currentGraphLabel(): string {
      return currentGraph().label;
    },

    focusNode(nodeId: string) {
      const graph = currentGraph();
      if (graph.nodes.some((n) => n.id === nodeId)) {
        graphStack[graphStack.length - 1] = {
          ...currentContext(),
          focalNodeId: nodeId,
        };
      }
    },

    enterNode(nodeId: string) {
      const graph = currentGraph();
      const node = graph.nodes.find((n) => n.id === nodeId);
      if (node?.subGraphId) {
        const subGraph = graphRegistry[node.subGraphId];
        if (subGraph) {
          graphStack = [...graphStack, {
            graphId: subGraph.id,
            focalNodeId: subGraph.nodes[0].id,
          }];
        }
      }
    },

    exitLayer() {
      if (graphStack.length > 1) {
        graphStack = graphStack.slice(0, -1);
      }
    },

    navigateToBreadcrumb(index: number) {
      if (index >= 0 && index < graphStack.length) {
        graphStack = graphStack.slice(0, index + 1);
      }
    },

    navigate(direction: "up" | "down" | "left" | "right") {
      const targetId = findNeighborInDirection(direction);
      if (targetId) {
        this.focusNode(targetId);
      }
    },

    unlockNode(nodeId: string): boolean {
      const graph = currentGraph();
      const ctx = currentContext();
      const node = graph.nodes.find((n) => n.id === nodeId);
      if (!node) return false;

      const state = computeNodeState(node, ctx.graphId);
      if (state !== "available") return false;
      if (skillPoints < node.cost) return false;

      skillPoints -= node.cost;
      nodeStates = {
        ...nodeStates,
        [stateKey(ctx.graphId, nodeId)]: "unlocked",
      };
      return true;
    },

    addSkillPoints(amount: number) {
      skillPoints += amount;
    },
  };
}

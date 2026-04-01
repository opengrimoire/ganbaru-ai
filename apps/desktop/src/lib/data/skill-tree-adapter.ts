import type { SkillGraph, SkillNode, SkillEdge, NodeTier } from "@ganbaruai/shared-types";
import treeData from "./skill-tree-data.json";

interface JsonBranch {
  id: string;
  name: string;
  color: string;
  icon: string;
  description: string;
  radial_position_degrees: number;
}

interface JsonNode {
  id: string;
  name: string;
  description: string;
  branch: string | null;
  level: number;
  tier: "origin" | "basic" | "notable" | "keystone";
  prerequisites: string[];
  tags: string[];
  xp_to_unlock: number;
  flavor_text?: string;
  cross_branch?: { type: string; [key: string]: unknown };
}

interface JsonTreeData {
  metadata: Record<string, unknown>;
  branches: JsonBranch[];
  nodes: JsonNode[];
  tag_definitions: unknown[];
  rendering_hints: Record<string, unknown>;
}

/** Divide raw xp_to_unlock by this to get skill point cost */
const XP_SCALE = 25;

/** Distance from origin to branch nodes */
const R_BRANCH = 180;

/** Distance from branch node to its cluster children */
const CLUSTER_DIST = 160;

/** Fan spread for cluster children around their branch (120 degrees) */
const FAN_SPREAD = (2 * Math.PI) / 3;

/** Distance between depth levels in sub-graph layouts */
const RING_SPACING = 160;

function mapTier(tier: string): NodeTier {
  if (tier === "origin") return "keystone";
  return tier as NodeTier;
}

function degToRad(degrees: number): number {
  return ((degrees - 90) * Math.PI) / 180;
}

/**
 * Build parent->children map using first in-set prerequisite as the parent.
 */
function buildChildMap(nodes: JsonNode[]): Map<string, string[]> {
  const nodeIds = new Set(nodes.map((n) => n.id));
  const childMap = new Map<string, string[]>();

  for (const node of nodes) {
    const parent = node.prerequisites.find((p) => nodeIds.has(p));
    if (parent) {
      const children = childMap.get(parent) ?? [];
      children.push(node.id);
      childMap.set(parent, children);
    }
  }

  return childMap;
}

/**
 * DFS to collect all descendant IDs from a node.
 */
function getDescendants(
  nodeId: string,
  childMap: Map<string, string[]>,
): string[] {
  const result: string[] = [];
  const stack = [...(childMap.get(nodeId) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop()!;
    result.push(id);
    stack.push(...(childMap.get(id) ?? []));
  }
  return result;
}

/**
 * Radial tree layout: positions nodes in concentric rings based on depth
 * from the root. Children are placed proportionally by subtree size.
 */
function layoutRadialTree(
  rootId: string,
  nodes: JsonNode[],
  ringSpacing: number,
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const childMap = buildChildMap(nodes);
  const rootNode = nodeMap.get(rootId);
  if (!rootNode) return positions;

  const rootLevel = rootNode.level;
  positions.set(rootId, { x: 0, y: 0 });

  function countLeaves(nodeId: string): number {
    const children = childMap.get(nodeId) ?? [];
    return children.length === 0
      ? 1
      : children.reduce((sum, c) => sum + countLeaves(c), 0);
  }

  function layout(nodeId: string, angleStart: number, angleEnd: number) {
    const node = nodeMap.get(nodeId);
    if (!node) return;

    if (node.id !== rootId) {
      const angle = (angleStart + angleEnd) / 2;
      const radius = (node.level - rootLevel) * ringSpacing;
      positions.set(nodeId, {
        x: Math.round(Math.cos(angle - Math.PI / 2) * radius),
        y: Math.round(Math.sin(angle - Math.PI / 2) * radius),
      });
    }

    const children = childMap.get(nodeId) ?? [];
    if (children.length === 0) return;

    const leafCounts = children.map((c) => countLeaves(c));
    const total = leafCounts.reduce((a, b) => a + b, 0);

    let current = angleStart;
    for (let i = 0; i < children.length; i++) {
      const span = (leafCounts[i] / total) * (angleEnd - angleStart);
      layout(children[i], current, current + span);
      current += span;
    }
  }

  layout(rootId, 0, 2 * Math.PI);
  return positions;
}

/**
 * Build root graph: origin + branch nodes (level 1) + cluster nodes (level 2).
 * Cluster nodes with level 3+ descendants get a subGraphId.
 */
function buildRootGraph(data: JsonTreeData): SkillGraph {
  const originJson = data.nodes.find((n) => n.tier === "origin");

  const nodes: SkillNode[] = [
    {
      id: "origin",
      label: originJson?.name ?? "You",
      description:
        originJson?.description ??
        "The center of your skill tree. All branches radiate from here.",
      icon: "origin",
      tier: "keystone",
      cost: 0,
      prerequisites: [],
      position: { x: 0, y: 0 },
    },
  ];

  const edges: SkillEdge[] = [];
  const branchRootIds: string[] = [];

  for (const branch of data.branches) {
    const branchAngle = degToRad(branch.radial_position_degrees);
    const bx = Math.round(Math.cos(branchAngle) * R_BRANCH);
    const by = Math.round(Math.sin(branchAngle) * R_BRANCH);

    // Find the actual level 1 node for this branch
    const branchRoot = data.nodes.find(
      (n) => n.branch === branch.id && n.level === 1,
    );
    if (!branchRoot) continue;

    branchRootIds.push(branchRoot.id);

    // Branch root node (level 1), gateway, auto-unlocked
    nodes.push({
      id: branchRoot.id,
      label: branch.name,
      description: branchRoot.description,
      icon: branch.icon,
      tier: mapTier(branchRoot.tier),
      cost: 0,
      prerequisites: [],
      position: { x: bx, y: by },
    });

    edges.push({
      id: `e-origin-${branchRoot.id}`,
      source: "origin",
      target: branchRoot.id,
    });

    // Level 2 cluster nodes for this branch
    const branchNodes = data.nodes.filter((n) => n.branch === branch.id);
    const clusters = branchNodes.filter((n) => n.level === 2);
    const childMap = buildChildMap(branchNodes);

    clusters.forEach((cluster, i) => {
      // Fan position around branch node in outward direction
      let childAngle: number;
      if (clusters.length === 1) {
        childAngle = branchAngle;
      } else {
        childAngle =
          branchAngle +
          FAN_SPREAD * (i / (clusters.length - 1) - 0.5);
      }

      const cx = bx + Math.round(Math.cos(childAngle) * CLUSTER_DIST);
      const cy = by + Math.round(Math.sin(childAngle) * CLUSTER_DIST);

      // Check if this cluster has level 3+ descendants
      const descendants = getDescendants(cluster.id, childMap);
      const hasSubGraph = descendants.length > 0;

      const rootNodeIds = new Set(nodes.map((n) => n.id));

      nodes.push({
        id: cluster.id,
        label: cluster.name,
        description: cluster.description,
        icon: branch.icon,
        tier: mapTier(cluster.tier),
        cost: Math.ceil(cluster.xp_to_unlock / XP_SCALE),
        prerequisites: cluster.prerequisites.filter((p) =>
          rootNodeIds.has(p) || p === branchRoot.id,
        ),
        position: { x: cx, y: cy },
        subGraphId: hasSubGraph ? cluster.id : undefined,
        metadata: cluster.flavor_text
          ? { flavorText: cluster.flavor_text }
          : undefined,
      });

      edges.push({
        id: `e-${branchRoot.id}-${cluster.id}`,
        source: branchRoot.id,
        target: cluster.id,
      });
    });
  }

  // Ring edges between adjacent branches
  for (let i = 0; i < branchRootIds.length; i++) {
    const next = (i + 1) % branchRootIds.length;
    edges.push({
      id: `e-ring-${branchRootIds[i]}-${branchRootIds[next]}`,
      source: branchRootIds[i],
      target: branchRootIds[next],
    });
  }

  return { id: "root", label: "Skill tree", nodes, edges };
}

/**
 * Build a sub-graph for a level 2 cluster containing its level 3+ descendants.
 * The cluster node becomes the center (cost 0, no prerequisites).
 */
function buildClusterSubGraph(
  data: JsonTreeData,
  clusterId: string,
  branchId: string,
  descendantIds: string[],
): SkillGraph {
  const branch = data.branches.find((b) => b.id === branchId);
  if (!branch) throw new Error(`Branch not found: ${branchId}`);

  const nodeMap = new Map(data.nodes.map((n) => [n.id, n]));
  const clusterNode = nodeMap.get(clusterId);
  if (!clusterNode) throw new Error(`Cluster node not found: ${clusterId}`);

  // All nodes: cluster center + descendants
  const subJsonNodes = [
    clusterNode,
    ...descendantIds.map((id) => nodeMap.get(id)!).filter(Boolean),
  ];
  const subNodeIds = new Set(subJsonNodes.map((n) => n.id));

  const positions = layoutRadialTree(clusterId, subJsonNodes, RING_SPACING);

  const nodes: SkillNode[] = subJsonNodes.map((n) => ({
    id: n.id,
    label: n.name,
    description: n.description,
    icon: branch.icon,
    tier: mapTier(n.tier),
    cost: n.id === clusterId ? 0 : Math.ceil(n.xp_to_unlock / XP_SCALE),
    prerequisites:
      n.id === clusterId
        ? []
        : n.prerequisites.filter((p) => subNodeIds.has(p)),
    position: positions.get(n.id) ?? { x: 0, y: 0 },
    metadata: n.flavor_text ? { flavorText: n.flavor_text } : undefined,
  }));

  // Edges from prerequisites within this sub-graph
  const edges: SkillEdge[] = [];
  for (const node of subJsonNodes) {
    if (node.id === clusterId) continue;
    for (const preId of node.prerequisites) {
      if (subNodeIds.has(preId)) {
        edges.push({
          id: `e-${preId}-${node.id}`,
          source: preId,
          target: node.id,
        });
      }
    }
  }

  return { id: clusterId, label: clusterNode.name, nodes, edges };
}

/**
 * Convert the full JSON skill tree into SkillGraph format.
 * Root graph has origin + branches + clusters.
 * Each cluster with descendants gets its own navigable sub-graph.
 */
export function convertSkillTree(): {
  rootGraph: SkillGraph;
  graphRegistry: Record<string, SkillGraph>;
} {
  const data = treeData as unknown as JsonTreeData;
  const root = buildRootGraph(data);

  const registry: Record<string, SkillGraph> = { root };

  // Build sub-graphs for each level 2 cluster with level 3+ descendants
  for (const branch of data.branches) {
    const branchNodes = data.nodes.filter((n) => n.branch === branch.id);
    const childMap = buildChildMap(branchNodes);
    const clusters = branchNodes.filter((n) => n.level === 2);

    for (const cluster of clusters) {
      const descendants = getDescendants(cluster.id, childMap);
      if (descendants.length > 0) {
        registry[cluster.id] = buildClusterSubGraph(
          data,
          cluster.id,
          branch.id,
          descendants,
        );
      }
    }
  }

  return { rootGraph: root, graphRegistry: registry };
}

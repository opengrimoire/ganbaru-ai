export type NodeState = "locked" | "available" | "unlocked";
export type NodeTier = "basic" | "notable" | "keystone";

export interface SkillNode {
  id: string;
  label: string;
  description: string;
  icon: string;
  tier: NodeTier;
  cost: number;
  prerequisites: string[];
  position: { x: number; y: number };
  subGraphId?: string;
  metadata?: Record<string, unknown>;
}

export interface SkillEdge {
  id: string;
  source: string;
  target: string;
}

export interface SkillGraph {
  id: string;
  label: string;
  nodes: SkillNode[];
  edges: SkillEdge[];
}

export interface PersistedNodeState {
  nodeId: string;
  graphId: string;
  state: NodeState;
}

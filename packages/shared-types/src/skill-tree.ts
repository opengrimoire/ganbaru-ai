export type NodeType = "basic" | "notable" | "keystone";

export interface SkillNode {
  id: string;
  name: string;
  description: string;
  nodeType: NodeType;
  branchId: string;
  parentIds: string[];
  level: number;
  currentXp: number;
  requiredXp: number;
  unlocked: boolean;
  lastPracticedAt: string | null;
}

export interface SkillBranch {
  id: string;
  name: string;
  color: string;
  parentBranchId: string | null;
  depth: number;
}

export type TaskPriority = "easy" | "medium" | "hard" | "epic";

export type TaskStatus = "backlog" | "todo" | "in_progress" | "done";

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  estimatedPomodoros: number;
  actualPomodoros: number;
  skillBranchIds: string[];
  sessionBlockId: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

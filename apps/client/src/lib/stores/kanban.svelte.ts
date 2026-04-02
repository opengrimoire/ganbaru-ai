import type { Task, TaskStatus, TaskPriority } from "@ganbaruai/shared-types";
import { execute, select } from "$lib/api/db";

let tasks = $state<Task[]>([]);
let isLoaded = $state(false);

function generateId(): string {
  return crypto.randomUUID();
}

export function getKanban() {
  return {
    get tasks() {
      return tasks;
    },
    get isLoaded() {
      return isLoaded;
    },
    byStatus(status: TaskStatus): Task[] {
      return tasks
        .filter((t) => t.status === status)
        .sort((a, b) => {
          const aOrder = (a as Task & { sortOrder?: number }).sortOrder ?? 0;
          const bOrder = (b as Task & { sortOrder?: number }).sortOrder ?? 0;
          return aOrder - bOrder;
        });
    },
    async load() {
      const rows = await select<
        Task & { sortOrder: number; sort_order: number }
      >(
        `SELECT id, title, description, status, priority,
                estimated_pomodoros as "estimatedPomodoros",
                actual_pomodoros as "actualPomodoros",
                session_block_id as "sessionBlockId",
                sort_order as "sortOrder",
                created_at as "createdAt",
                updated_at as "updatedAt"
         FROM tasks ORDER BY sort_order`,
      );
      tasks = rows.map((r) => ({
        ...r,
        skillBranchIds: [],
        tags: [],
      }));
      isLoaded = true;
    },
    async addTask(
      title: string,
      priority: TaskPriority = "medium",
      status: TaskStatus = "backlog",
    ) {
      const id = generateId();
      const now = new Date().toISOString();
      await execute(
        `INSERT INTO tasks (id, title, status, priority, sort_order, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, title, status, priority, tasks.length, now, now],
      );
      tasks = [
        ...tasks,
        {
          id,
          title,
          description: "",
          status,
          priority,
          estimatedPomodoros: 1,
          actualPomodoros: 0,
          skillBranchIds: [],
          sessionBlockId: null,
          tags: [],
          createdAt: now,
          updatedAt: now,
        },
      ];
    },
    async updateTaskStatus(taskId: string, newStatus: TaskStatus) {
      await execute(
        `UPDATE tasks SET status = $1, updated_at = $2 WHERE id = $3`,
        [newStatus, new Date().toISOString(), taskId],
      );
      tasks = tasks.map((t) =>
        t.id === taskId ? { ...t, status: newStatus } : t,
      );
    },
    async deleteTask(taskId: string) {
      await execute(`DELETE FROM tasks WHERE id = $1`, [taskId]);
      tasks = tasks.filter((t) => t.id !== taskId);
    },
  };
}

import type { Task, TaskStatus, TaskPriority } from "@ganbaruai/shared-types";
import { invoke } from "@tauri-apps/api/core";
import { dbUrl, select } from "$lib/api/db";

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
      await invoke("kanban_add_task", {
        dbUrl: dbUrl(),
        task: {
          id,
          title,
          status,
          priority,
          sortOrder: tasks.length,
          createdAt: now,
          updatedAt: now,
        },
      });
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
      const updatedAt = new Date().toISOString();
      await invoke("kanban_update_task_status", {
        dbUrl: dbUrl(),
        taskId,
        status: newStatus,
        updatedAt,
      });
      tasks = tasks.map((t) =>
        t.id === taskId ? { ...t, status: newStatus, updatedAt } : t,
      );
    },
    async deleteTask(taskId: string) {
      await invoke("kanban_delete_task", { dbUrl: dbUrl(), taskId });
      tasks = tasks.filter((t) => t.id !== taskId);
    },
  };
}

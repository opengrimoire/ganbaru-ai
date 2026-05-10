import type { Task, TaskStatus, TaskPriority } from "@ganbaruai/shared-types";
import { invoke } from "@tauri-apps/api/core";
import { dbUrl, ensureDbUrl } from "$lib/api/db";

let tasks = $state<Task[]>([]);
let isLoaded = $state(false);

interface KanbanTaskRead {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  estimated_pomodoros: number;
  actual_pomodoros: number;
  session_block_id: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

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
      const rows = await invoke<KanbanTaskRead[]>("kanban_load_tasks", {
        dbUrl: await ensureDbUrl(),
      });
      tasks = rows.map((r) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        status: r.status,
        priority: r.priority,
        estimatedPomodoros: r.estimated_pomodoros,
        actualPomodoros: r.actual_pomodoros,
        sessionBlockId: r.session_block_id,
        sortOrder: r.sort_order,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
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

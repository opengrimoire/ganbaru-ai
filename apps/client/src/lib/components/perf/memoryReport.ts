export interface ProcessMemory {
  name: string;
  mb: number;
}

export interface MemoryReport {
  processes: ProcessMemory[];
  total_mb: number;
  platform: string;
}

export type StartupMemorySnapshot =
  | { status: "pending" }
  | { status: "ready"; report: MemoryReport }
  | { status: "failed"; message: string };

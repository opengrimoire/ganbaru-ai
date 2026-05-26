import { invoke } from "@tauri-apps/api/core";
import type { PomodoroPhase } from "@ganbaruai/shared-types";

export interface ProcrastinationStopperRuntimeState {
  active: boolean;
  phase: PomodoroPhase | "inactive";
  activeRunId: string | null;
  activeBlockId: string | null;
  remainingSeconds: number | null;
  updatedAt: string;
}

export async function writeProcrastinationStopperRuntimeState(
  state: ProcrastinationStopperRuntimeState,
): Promise<void> {
  await invoke("procrastination_stopper_write_state", { state });
}

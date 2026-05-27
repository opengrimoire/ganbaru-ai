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

export interface ProcrastinationStopperExtensionStatus {
  connected: boolean;
  lastSeenAt: string | null;
  lastMessageType: string | null;
  checkedAt: string;
  staleSeconds: number;
  reason: string | null;
}

export async function writeProcrastinationStopperRuntimeState(
  state: ProcrastinationStopperRuntimeState,
): Promise<void> {
  await invoke("procrastination_stopper_write_state", { state });
}

export async function getProcrastinationStopperExtensionStatus(
  freshAfter?: string,
): Promise<ProcrastinationStopperExtensionStatus> {
  return await invoke<ProcrastinationStopperExtensionStatus>(
    "procrastination_stopper_get_extension_status",
    { freshAfter: freshAfter ?? null },
  );
}

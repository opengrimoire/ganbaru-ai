import { invoke } from "@tauri-apps/api/core";
import type { PomodoroPhase } from "@ganbaruai/shared-types";

export interface DoomscrollingRuntimeState {
  active: boolean;
  phase: PomodoroPhase | "inactive";
  activeRunId: string | null;
  activeBlockId: string | null;
  remainingSeconds: number | null;
  updatedAt: string;
}

export interface DoomscrollingExtensionStatus {
  connected: boolean;
  lastSeenAt: string | null;
  lastMessageType: string | null;
  checkedAt: string;
  staleSeconds: number;
  reason: string | null;
}

export async function writeDoomscrollingRuntimeState(
  state: DoomscrollingRuntimeState,
): Promise<void> {
  await invoke("doomscrolling_write_state", { state });
}

export async function getDoomscrollingExtensionStatus(
  freshAfter?: string,
): Promise<DoomscrollingExtensionStatus> {
  return await invoke<DoomscrollingExtensionStatus>(
    "doomscrolling_get_extension_status",
    { freshAfter: freshAfter ?? null },
  );
}

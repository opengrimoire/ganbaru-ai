import { invoke } from "@tauri-apps/api/core";

import { dbUrl } from "$lib/api/db";
import type { PersistedSegment } from "$lib/components/calendar/types";
import type { PomodoroAdaptiveDecisionEnvelopeWrite } from "$lib/pomodoro/adaptive/persistence";
import {
  buildPomodoroSegmentUpdate,
  buildPomodoroSegmentWrite,
  type PomodoroActiveEventReferenceTransfer,
  type PomodoroBackendWriteOptions,
  type PomodoroRunClosure,
  type PomodoroRunEventWrite,
  type PomodoroRunWindowUpdate,
  type PomodoroRunWrite,
  type PomodoroSegmentEndReason,
  type PomodoroTransitionRunWrite,
} from "./pomodoro-backend-writes";

export interface PomodoroRunRepositoryDependencies {
  endReasonForSegment(segment: PersistedSegment): PomodoroSegmentEndReason | null;
  completeWrite(options?: PomodoroBackendWriteOptions): void;
}

export interface PomodoroRunRepository {
  persistSegments(
    updatedSegments: PersistedSegment[],
    warning: string,
    bumpSegmentVersion: boolean,
    occurredAt?: string | null,
    throwOnError?: boolean,
  ): Promise<void>;
  persistSegment(
    segment: PersistedSegment,
    warning: string,
    bumpSegmentVersion: boolean,
    occurredAt?: string | null,
    throwOnError?: boolean,
  ): Promise<void>;
  insertSegments(newSegments: PersistedSegment[]): Promise<void>;
  insertSegmentWithAdaptiveDecision(
    segment: PersistedSegment,
    adaptiveDecision: PomodoroAdaptiveDecisionEnvelopeWrite,
  ): Promise<void>;
  startRun(
    run: PomodoroRunWrite,
    segment: PersistedSegment,
    options?: PomodoroBackendWriteOptions,
  ): Promise<void>;
  transitionRun(
    transition: PomodoroTransitionRunWrite,
    options?: PomodoroBackendWriteOptions,
  ): Promise<void>;
  closeRun(
    closure: PomodoroRunClosure,
    warning?: string,
    throwOnError?: boolean,
  ): Promise<void>;
  updateRunWindow(update: PomodoroRunWindowUpdate): void;
  transferActiveEventReference(
    transfer: PomodoroActiveEventReferenceTransfer,
  ): Promise<void>;
  recordRunEvent(
    event: PomodoroRunEventWrite,
    warning?: string,
  ): void;
  sendHeartbeat(runId: string, heartbeatAt: string): void;
  cleanupOrphans(): Promise<void>;
}

export function createPomodoroRunRepository(
  dependencies: PomodoroRunRepositoryDependencies,
): PomodoroRunRepository {
  let writeQueue: Promise<void> = Promise.resolve();

  function enqueueWrite(operation: () => Promise<void>): Promise<void> {
    const queued = writeQueue.then(operation, operation);
    writeQueue = queued.catch(() => undefined);
    return queued;
  }

  function persistSegments(
    updatedSegments: PersistedSegment[],
    warning: string,
    bumpSegmentVersion: boolean,
    occurredAt: string | null = null,
    throwOnError = false,
  ): Promise<void> {
    const persisted = updatedSegments.filter(
      (segment) => segment.status !== "planned" && segment.status !== "skipped",
    );
    if (persisted.length === 0) return Promise.resolve();
    return enqueueWrite(async () => {
      await invoke("pomodoro_update_segments", {
        dbUrl: dbUrl(),
        segments: persisted.map((segment) =>
          buildPomodoroSegmentUpdate(
            segment,
            dependencies.endReasonForSegment(segment),
            occurredAt,
          ),
        ),
      });
      if (bumpSegmentVersion) {
        dependencies.completeWrite();
      }
    }).catch((e) => {
      console.warn(warning, e);
      if (throwOnError) throw e;
    });
  }

  return {
    persistSegments,

    persistSegment(
      segment,
      warning,
      bumpSegmentVersion,
      occurredAt = null,
      throwOnError = false,
    ) {
      return persistSegments(
        [segment],
        warning,
        bumpSegmentVersion,
        occurredAt,
        throwOnError,
      );
    },

    async insertSegments(newSegments) {
      const persisted = newSegments.filter(
        (segment) => segment.status !== "planned" && segment.status !== "skipped",
      );
      if (persisted.length === 0) return;
      await enqueueWrite(async () => {
        await invoke("pomodoro_insert_segments", {
          dbUrl: dbUrl(),
          segments: persisted.map(buildPomodoroSegmentWrite),
        });
        dependencies.completeWrite();
      }).catch((e) => console.warn("Failed to insert segments:", e));
    },

    async insertSegmentWithAdaptiveDecision(segment, adaptiveDecision) {
      await enqueueWrite(async () => {
        await invoke("pomodoro_insert_segment_with_adaptive_decision", {
          dbUrl: dbUrl(),
          segment: buildPomodoroSegmentWrite(segment),
          adaptiveDecision,
        });
        dependencies.completeWrite();
      }).catch((e) => console.warn("Failed to insert adaptive boundary segment:", e));
    },

    async startRun(run, segment, options = {}) {
      await enqueueWrite(async () => {
        await invoke("pomodoro_start_run", {
          dbUrl: dbUrl(),
          run,
          segment: buildPomodoroSegmentWrite(segment),
        });
        dependencies.completeWrite(options);
      });
    },

    async transitionRun(transition, options = {}) {
      await enqueueWrite(async () => {
        await invoke("pomodoro_transition_run", {
          dbUrl: dbUrl(),
          transition,
        });
        dependencies.completeWrite(options);
      });
    },

    closeRun(
      closure,
      warning = "Failed to close pomodoro run:",
      throwOnError = false,
    ) {
      return enqueueWrite(async () => {
        await invoke("pomodoro_close_run", {
          dbUrl: dbUrl(),
          closure,
        });
        dependencies.completeWrite();
      }).catch((e) => {
        console.warn(warning, e);
        if (throwOnError) throw e;
      });
    },

    updateRunWindow(update) {
      enqueueWrite(async () => {
        await invoke("pomodoro_update_run_window", {
          dbUrl: dbUrl(),
          update,
        });
      }).catch((e) => console.warn("Failed to update pomodoro run window:", e));
    },

    transferActiveEventReference(transfer) {
      return enqueueWrite(async () => {
        await invoke("pomodoro_transfer_active_event_reference", {
          dbUrl: dbUrl(),
          transfer,
        });
        dependencies.completeWrite();
      }).catch((e) => console.warn("Failed to transfer pomodoro event reference:", e));
    },

    recordRunEvent(event, warning = "Failed to record pomodoro event:") {
      enqueueWrite(async () => {
        await invoke("pomodoro_record_run_event", {
          dbUrl: dbUrl(),
          event,
        });
      }).catch((e) => console.warn(warning, e));
    },

    sendHeartbeat(runId, heartbeatAt) {
      invoke("pomodoro_heartbeat", {
        dbUrl: dbUrl(),
        runId,
        heartbeatAt,
      }).catch((e) => console.warn("Failed to update pomodoro heartbeat:", e));
    },

    async cleanupOrphans() {
      await invoke("pomodoro_recover_open_runs", {
        dbUrl: dbUrl(),
      });
      dependencies.completeWrite();
    },
  };
}

export interface DeleteUndoToast {
  id: string;
  pending: boolean;
  restore?: () => Promise<void>;
  label: string;
}

export interface SaveToast {
  id: string;
  pending: boolean;
  message: string;
  variant: "success" | "error";
}

const DELETE_UNDO_TIMEOUT_MS = 5_000;
const SAVE_SUCCESS_TOAST_TIMEOUT_MS = 3_000;
const SAVE_ERROR_TOAST_TIMEOUT_MS = 8_000;

export function createCalendarViewToastController() {
  let deleteUndoToast: DeleteUndoToast | null = $state(null);
  let deleteUndoTimer: ReturnType<typeof setTimeout> | undefined;
  let saveSuccessToast: SaveToast | null = $state(null);
  let saveSuccessTimer: ReturnType<typeof setTimeout> | undefined;

  function clearDeleteUndoTimer(): void {
    if (deleteUndoTimer) {
      clearTimeout(deleteUndoTimer);
      deleteUndoTimer = undefined;
    }
  }

  function dismissDeleteUndoToast(): void {
    clearDeleteUndoTimer();
    deleteUndoToast = null;
  }

  function showDeletePendingToast(label: string): string {
    clearDeleteUndoTimer();
    const id = crypto.randomUUID();
    deleteUndoToast = { id, pending: true, label };
    return id;
  }

  function dismissDeleteToastIfCurrent(id: string): void {
    if (deleteUndoToast?.id === id) dismissDeleteUndoToast();
  }

  function showDeleteUndoToast(
    id: string,
    label: string,
    restore?: () => Promise<void>,
  ): void {
    clearDeleteUndoTimer();
    if (deleteUndoToast?.id !== id) return;
    deleteUndoToast = { id, pending: false, restore, label };
    deleteUndoTimer = setTimeout(() => {
      if (deleteUndoToast?.id === id) deleteUndoToast = null;
      deleteUndoTimer = undefined;
    }, DELETE_UNDO_TIMEOUT_MS);
  }

  function clearSaveSuccessTimer(): void {
    if (saveSuccessTimer) {
      clearTimeout(saveSuccessTimer);
      saveSuccessTimer = undefined;
    }
  }

  function dismissSaveSuccessToast(): void {
    clearSaveSuccessTimer();
    saveSuccessToast = null;
  }

  function showSavePendingToast(message: string): string {
    clearSaveSuccessTimer();
    const id = crypto.randomUUID();
    saveSuccessToast = { id, pending: true, message, variant: "success" };
    return id;
  }

  function dismissSaveToastIfCurrent(id: string): void {
    if (saveSuccessToast?.id === id) dismissSaveSuccessToast();
  }

  function showSaveSuccessToast(id: string, message: string): void {
    clearSaveSuccessTimer();
    if (saveSuccessToast?.id !== id) return;
    saveSuccessToast = { id, pending: false, message, variant: "success" };
    saveSuccessTimer = setTimeout(() => {
      if (saveSuccessToast?.id === id) saveSuccessToast = null;
      saveSuccessTimer = undefined;
    }, SAVE_SUCCESS_TOAST_TIMEOUT_MS);
  }

  function showSaveErrorToast(id: string, message: string): void {
    clearSaveSuccessTimer();
    if (saveSuccessToast?.id !== id) return;
    saveSuccessToast = { id, pending: false, message, variant: "error" };
    saveSuccessTimer = setTimeout(() => {
      if (saveSuccessToast?.id === id) saveSuccessToast = null;
      saveSuccessTimer = undefined;
    }, SAVE_ERROR_TOAST_TIMEOUT_MS);
  }

  function destroy(): void {
    clearDeleteUndoTimer();
    clearSaveSuccessTimer();
  }

  return {
    get deleteUndoToast() {
      return deleteUndoToast;
    },
    get saveSuccessToast() {
      return saveSuccessToast;
    },
    dismissDeleteUndoToast,
    showDeletePendingToast,
    dismissDeleteToastIfCurrent,
    showDeleteUndoToast,
    dismissSaveToastIfCurrent,
    showSavePendingToast,
    showSaveSuccessToast,
    showSaveErrorToast,
    destroy,
  };
}

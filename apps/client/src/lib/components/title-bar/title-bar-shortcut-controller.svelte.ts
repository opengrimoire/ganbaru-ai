import {
  recordResetShortcutPress,
  titleBarShortcutAction,
  type ResetShortcutSequenceState,
} from "$lib/components/titlebar-shortcuts";
import { isEditableKeyboardTarget } from "$lib/utils";

const RESET_REQUIRED_PRESSES = 10;
const RESET_WINDOW_MS = 8_000;

type AppCloseRequestHandler = () => Promise<void>;

/** Coordinates close requests that originate above the desktop shell. */
class AppCloseCoordinator {
  confirmationOpen = $state(false);
  private requestHandler: AppCloseRequestHandler | null = null;

  registerRequestHandler(handler: AppCloseRequestHandler): () => void {
    this.requestHandler = handler;
    return () => {
      if (this.requestHandler === handler) this.requestHandler = null;
      this.confirmationOpen = false;
    };
  }

  request(): Promise<void> {
    return this.requestHandler?.() ?? Promise.resolve();
  }

  setConfirmationOpen(open: boolean): void {
    this.confirmationOpen = open;
  }
}

const appClose = new AppCloseCoordinator();

export function getAppCloseCoordinator(): AppCloseCoordinator {
  return appClose;
}

export interface TitleBarShortcutControllerContext {
  benchmarkLocked: () => boolean;
  themeEditorLocked: () => boolean;
  ensureBenchmarkOverlay: () => Promise<void>;
  showResetSequenceConfirmation: () => void;
  closeOtherConfirmations: () => void;
  requestClose: () => Promise<void>;
  toggleTheme: () => void;
  openThemeSwitcher: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
}

/** Own shell shortcut capture and the hidden reset sequence lifecycle. */
export function createTitleBarShortcutController(
  context: TitleBarShortcutControllerContext,
): void {
  let resetSequence: ResetShortcutSequenceState = {
    pressCount: 0,
    lastPressAtMs: null,
  };
  let resetTimer: ReturnType<typeof setTimeout> | undefined;

  function clearResetSequence(): void {
    resetSequence = { pressCount: 0, lastPressAtMs: null };
    if (resetTimer) clearTimeout(resetTimer);
    resetTimer = undefined;
  }

  function registerResetPress(): boolean {
    if (context.benchmarkLocked()) {
      void context.ensureBenchmarkOverlay();
      return false;
    }
    if (context.themeEditorLocked()) return false;
    if (resetTimer) clearTimeout(resetTimer);
    const result = recordResetShortcutPress(resetSequence, performance.now(), {
      requiredPresses: RESET_REQUIRED_PRESSES,
      maxGapMs: RESET_WINDOW_MS,
    });
    resetSequence = result.state;
    if (result.resetTriggered) {
      clearResetSequence();
      context.closeOtherConfirmations();
      context.showResetSequenceConfirmation();
      return true;
    }
    resetTimer = setTimeout(clearResetSequence, RESET_WINDOW_MS);
    return false;
  }

  $effect(() => {
    function handleShortcut(event: KeyboardEvent): void {
      const action = titleBarShortcutAction(
        event,
        isEditableKeyboardTarget(event.target),
      );
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (action === "close") {
        const resetTriggered = event.shiftKey
          && !event.repeat
          && !isEditableKeyboardTarget(event.target)
          && registerResetPress();
        if (!resetTriggered) void context.requestClose();
      } else if (action === "theme-toggle") {
        context.toggleTheme();
      } else if (action === "theme-switcher") {
        context.openThemeSwitcher();
      } else if (action === "zoom-in") {
        context.zoomIn();
      } else if (action === "zoom-out") {
        context.zoomOut();
      } else {
        context.resetZoom();
      }
    }

    window.addEventListener("keydown", handleShortcut, { capture: true });
    return () => {
      window.removeEventListener("keydown", handleShortcut, { capture: true });
      clearResetSequence();
    };
  });
}

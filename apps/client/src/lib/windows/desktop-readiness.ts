interface DesktopReadinessOptions {
  mounted: Promise<unknown>;
  flushUpdates: () => Promise<void>;
  document: Document;
  clearTransitionMarker: (key: string) => void;
  revealMainWindow: (() => Promise<void>) | null;
  onError: (error: unknown) => void;
}

/**
 * Finishes desktop boot without relying on frames from a hidden WebView.
 * The ownership cover stays in place until mounted content and fonts are ready.
 * Failed boot leaves native fallback reveal responsible for window recovery.
 */
export async function finishDesktopReadiness(options: DesktopReadinessOptions): Promise<void> {
  const cover = options.document.getElementById("vault-ownership-transition-cover");
  const clearCover = () => {
    cover?.remove();
    const storageKey = cover?.dataset.storageKey;
    if (!storageKey) return;
    try {
      options.clearTransitionMarker(storageKey);
    } catch {
      // Session storage is optional; unavailable storage must not prevent reveal.
    }
  };

  try {
    await options.mounted;
    await options.flushUpdates();
    // Resolve styles and required fonts even when native visibility prevents paint.
    options.document.documentElement.getBoundingClientRect();
    await options.document.fonts.ready;
    clearCover();
    await options.revealMainWindow?.();
  } catch (error: unknown) {
    clearCover();
    options.onError(error);
  }
}

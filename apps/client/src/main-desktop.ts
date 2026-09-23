import { Temporal } from "@js-temporal/polyfill";
(globalThis as unknown as { Temporal: typeof Temporal }).Temporal = Temporal;
import { mount, tick, unmount } from "svelte";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ensureConfigLoaded, flushConfig } from "./lib/vault/config";
import { getActiveVaultInfo } from "./lib/vault/state";
import {
  getLocalization,
  initializeLocalizationFromConfig,
} from "./lib/i18n/translator.svelte";
import { DEFAULT_LANGUAGE_PREFERENCE } from "./lib/i18n/locales";
import {
  clearPreVaultLanguagePreference,
  readPreVaultLanguagePreference,
} from "./lib/i18n/pre-vault-language";
import { hydrateUserThemes } from "./lib/stores/theme.svelte";
import {
  parsePomodoroBlockedScreenState,
  pomodoroBlockedScreenPalette,
  pomodoroBlockedScreenStateFromOverlayKind,
  type PomodoroBlockedScreenState,
} from "./lib/components/pomodoro/blocked-screen";
import { applyPlatformProfileToDocument } from "./lib/platform";
import { installModalKeyboardRouter } from "./lib/modal-focus";
import { finishDesktopReadiness } from "./lib/windows/desktop-readiness";

applyPlatformProfileToDocument();
installModalKeyboardRouter();

interface BenchmarkBootProbe {
  vaultMode?: "user" | "benchmark";
  stage?: string;
  harnessVersion?: string;
  datasetVersion?: string;
  startedAt?: string;
  updatedAt?: string;
}

function pomodoroOverlayInitialStateFromLocation(): PomodoroBlockedScreenState {
  const params = new URLSearchParams(window.location.search);
  const screenState = params.get("screenState");
  if (screenState !== null) {
    return parsePomodoroBlockedScreenState(screenState);
  }
  return pomodoroBlockedScreenStateFromOverlayKind(params.get("overlayKind"));
}

function preparePomodoroOverlayDocument(): void {
  const { background } = pomodoroBlockedScreenPalette(
    pomodoroOverlayInitialStateFromLocation(),
  );
  const app = document.getElementById("app");
  document.documentElement.style.backgroundColor = background;
  document.body.style.backgroundColor = background;
  if (app) app.style.backgroundColor = background;
}

async function hasFreshBenchmarkResumeState(): Promise<boolean> {
  try {
    const {
      HARNESS_VERSION,
      DENSE_DATASET_VERSION,
      isBenchmarkPendingStage,
      isFreshBenchmarkPendingAge,
      isFreshBenchmarkTotalAge,
    } = await import("./lib/benchmark/types");
    const json = await invoke<string | null>("read_benchmark_state");
    if (!json) return false;
    const parsed = JSON.parse(json) as BenchmarkBootProbe;
    return parsed.vaultMode === "benchmark"
      && isBenchmarkPendingStage(parsed.stage)
      && parsed.harnessVersion === HARNESS_VERSION
      && parsed.datasetVersion === DENSE_DATASET_VERSION
      && isFreshBenchmarkTotalAge(parsed)
      && isFreshBenchmarkPendingAge(parsed);
  } catch (err) {
    console.error("benchmark boot probe failed", err);
    return false;
  }
}

function safeStorage(): Storage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

async function applyPreVaultLanguagePreference(): Promise<void> {
  const storage = safeStorage();
  const preference = readPreVaultLanguagePreference(storage);
  if (!preference) return;
  const applied = await getLocalization().setLanguagePreference(preference);
  if (!applied) return;
  await flushConfig();
  clearPreVaultLanguagePreference(storage);
}

// Boot order: validate the active Ganbaru AI folder, hydrate root
// config.json, load user themes from SQLite, then mount App. Config and theme
// reads block first paint so the initial render matches what the user has on
// disk, with no flash of defaults.
const appPromise = (async () => {
  const target = document.getElementById("app")!;
  type MountedRoot = ReturnType<typeof mount>;

  const preVaultPreference = readPreVaultLanguagePreference(safeStorage());
  await getLocalization().setLanguagePreference(
    preVaultPreference ?? DEFAULT_LANGUAGE_PREFERENCE,
    { persist: false },
  );

  const windowKind = new URLSearchParams(window.location.search).get("ganbaruWindow");
  if (windowKind === "pomodoroOverlay") {
    preparePomodoroOverlayDocument();
    const { default: PomodoroOverlayWindow } = await import(
      "$lib/components/pomodoro/PomodoroOverlayWindow.svelte"
    );
    return mount(PomodoroOverlayWindow, {
      target: document.getElementById("app")!,
    });
  }
  if (windowKind === "pomodoroOverlayBlocker") {
    preparePomodoroOverlayDocument();
    const { default: PomodoroOverlayBlocker } = await import(
      "$lib/components/pomodoro/PomodoroOverlayBlocker.svelte"
    );
    return mount(PomodoroOverlayBlocker, {
      target: document.getElementById("app")!,
    });
  }

  async function mountVaultSetupView(initialError: string | null) {
    const handoffOnboardingModulePromise = import(
      "$lib/components/vault/VaultHandoffOnboardingView.svelte"
    );
    void handoffOnboardingModulePromise.catch(() => undefined);
    const pairingQrModulePromise = import("$lib/components/vault/PairingQrCode.svelte");
    void pairingQrModulePromise.catch(() => undefined);
    const { default: VaultSetupView } = await import(
      "$lib/components/vault/VaultSetupView.svelte"
    );
    let setupView: MountedRoot;
    setupView = mount(VaultSetupView, {
      target,
      props: {
        initialError,
        onReady: async (info, preferenceReady) => {
          const appRuntimeReady = preferenceReady.then(async () => {
            await ensureConfigLoaded();
            await initializeLocalizationFromConfig();
            await applyPreVaultLanguagePreference();
            await hydrateUserThemes();
          });
          void appRuntimeReady.catch(() => undefined);
          await mountVaultHandoffOnboarding(info.vaultId, setupView, appRuntimeReady);
        },
      },
    });
    return setupView;
  }

  async function mountVaultHandoffOnboarding(
    vaultId: string,
    currentView?: MountedRoot,
    appRuntimeReady: Promise<void> = Promise.resolve(),
  ) {
    const appModulePromise = import("./App.svelte");
    void appModulePromise.catch(() => undefined);
    const [{ default: VaultHandoffOnboardingView }, handoffApi] = await Promise.all([
      import("$lib/components/vault/VaultHandoffOnboardingView.svelte"),
      import("$lib/api/vault-handoff"),
      import("$lib/components/vault/PairingQrCode.svelte"),
    ]);
    const initialStatus = await handoffApi.readPairingStatus();
    const initialInvitation = initialStatus.linked
      ? null
      : await handoffApi.createPairingInvitation();

    if (currentView) await unmount(currentView);

    let onboardingView: MountedRoot;
    let transitionPromise: Promise<void> | null = null;
    const openApp = (): Promise<void> => {
      if (transitionPromise) return transitionPromise;
      transitionPromise = Promise.all([appModulePromise, appRuntimeReady])
        .then(async ([{ default: App }]) => {
          await unmount(onboardingView);
          mount(App, { target });
        })
        .catch((error: unknown) => {
          transitionPromise = null;
          throw error;
        });
      return transitionPromise;
    };
    onboardingView = mount(VaultHandoffOnboardingView, {
      target,
      props: {
        vaultId,
        initialInvitation,
        initialStatus,
        onComplete: openApp,
      },
    });
    return onboardingView;
  }

  try {
    const activeVault = await getActiveVaultInfo();
    if (!activeVault) {
      return await mountVaultSetupView(null);
    }
    await ensureConfigLoaded();
    await initializeLocalizationFromConfig();
    await applyPreVaultLanguagePreference();
    const benchmarkResumePending = await hasFreshBenchmarkResumeState();
    if (!benchmarkResumePending) {
      await hydrateUserThemes();
      const { vaultHandoffOnboardingCompleted } = await import(
        "./lib/vault/handoff-onboarding"
      );
      if (!vaultHandoffOnboardingCompleted(safeStorage(), activeVault.vaultId)) {
        return await mountVaultHandoffOnboarding(activeVault.vaultId);
      }
    }
  } catch (err) {
    const vaultError = err instanceof Error ? err.message : String(err);
    return await mountVaultSetupView(vaultError);
  }

  const { default: App } = await import("./App.svelte");
  return mount(App, {
    target,
  });
})();

void finishDesktopReadiness({
  mounted: appPromise,
  flushUpdates: tick,
  document,
  clearTransitionMarker: (key) => window.sessionStorage.removeItem(key),
  revealMainWindow: getCurrentWindow().label === "main"
    ? () => invoke<void>("reveal_main_window")
    : null,
  onError: (error) => {
    console.error("Failed to reveal the initialized main window:", error);
  },
});

export default appPromise;

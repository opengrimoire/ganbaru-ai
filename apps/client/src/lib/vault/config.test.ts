import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type Mock,
} from "vitest";

// Each test pulls in a fresh copy of the module so the cache + loadPromise
// reset between cases.
async function loadModule() {
  return await import("./config");
}

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...(args as [string, unknown])),
}));

interface MutableLocalStorage {
  store: Map<string, string>;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  clear(): void;
  key(index: number): string | null;
  readonly length: number;
}

function installLocalStorage(): MutableLocalStorage {
  const store = new Map<string, string>();
  const fake: MutableLocalStorage = {
    store,
    getItem(key) {
      return store.has(key) ? store.get(key)! : null;
    },
    setItem(key, value) {
      store.set(key, value);
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
    key(i) {
      return Array.from(store.keys())[i] ?? null;
    },
    get length() {
      return store.size;
    },
  };
  vi.stubGlobal("localStorage", fake);
  return fake;
}

function uninstallLocalStorage() {
  vi.stubGlobal("localStorage", undefined);
}

function setReadResponse(json: string) {
  invokeMock.mockImplementation(((cmd: string) => {
    if (cmd === "vault_read_config") return Promise.resolve(json);
    if (cmd === "vault_write_config") return Promise.resolve();
    return Promise.reject(new Error(`unexpected command: ${cmd}`));
  }) as unknown as Mock);
}

beforeEach(() => {
  vi.resetModules();
  invokeMock.mockReset();
  setReadResponse("{}");
});

afterEach(() => {
  vi.useRealTimers();
  uninstallLocalStorage();
});

describe("ensureConfigLoaded", () => {
  it("invokes vault_read_config exactly once across repeat calls", async () => {
    installLocalStorage();
    const { ensureConfigLoaded } = await loadModule();
    await Promise.all([
      ensureConfigLoaded(),
      ensureConfigLoaded(),
      ensureConfigLoaded(),
    ]);
    const reads = invokeMock.mock.calls.filter(
      ([cmd]) => cmd === "vault_read_config",
    );
    expect(reads.length).toBe(1);
  });

  it("treats malformed JSON from the backend as an empty config", async () => {
    installLocalStorage();
    setReadResponse("not json");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { ensureConfigLoaded, getConfigKey } = await loadModule();
    try {
      await ensureConfigLoaded();
      expect(getConfigKey("anything", "fallback")).toBe("fallback");
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy.mock.calls[0]?.[0]).toBe("vault_read_config failed");
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("treats a non-object root as an empty config", async () => {
    installLocalStorage();
    setReadResponse("[1, 2, 3]");
    const { ensureConfigLoaded, getConfigKey } = await loadModule();
    await ensureConfigLoaded();
    expect(getConfigKey("anything", "fallback")).toBe("fallback");
  });
});

describe("getConfigKey", () => {
  it("returns the fallback when the dotted path is absent", async () => {
    installLocalStorage();
    setReadResponse(JSON.stringify({ theme: { activeId: "dark" } }));
    const { ensureConfigLoaded, getConfigKey } = await loadModule();
    await ensureConfigLoaded();
    expect(getConfigKey("preferences.fontScale", 1)).toBe(1);
  });

  it("walks dotted paths into nested objects", async () => {
    installLocalStorage();
    setReadResponse(
      JSON.stringify({
        theme: { activeId: "midnight" },
        preferences: { fontScale: 1.1 },
      }),
    );
    const { ensureConfigLoaded, getConfigKey } = await loadModule();
    await ensureConfigLoaded();
    expect(getConfigKey("theme.activeId", "dark")).toBe("midnight");
    expect(getConfigKey("preferences.fontScale", 1)).toBe(1.1);
  });

  it("ignores prototype-chain keys", async () => {
    installLocalStorage();
    setReadResponse("{}");
    const { ensureConfigLoaded, getConfigKey } = await loadModule();
    await ensureConfigLoaded();
    // toString lives on Object.prototype but readPath uses Object.hasOwn.
    expect(getConfigKey("toString", "fallback")).toBe("fallback");
  });
});

describe("setConfigKey", () => {
  it("stores values under nested dotted paths", async () => {
    vi.useFakeTimers();
    installLocalStorage();
    const { ensureConfigLoaded, setConfigKey, flushConfig, getConfigKey } =
      await loadModule();
    await ensureConfigLoaded();

    setConfigKey("theme.activeId", "midnight");
    expect(getConfigKey("theme.activeId", "")).toBe("midnight");
    await vi.runAllTimersAsync();
    await flushConfig();
    const writes = invokeMock.mock.calls.filter(
      ([cmd]) => cmd === "vault_write_config",
    );
    expect(writes.length).toBeGreaterThan(0);
    const payload = JSON.parse(
      (writes[writes.length - 1][1] as { json: string }).json,
    );
    expect(payload.theme.activeId).toBe("midnight");
  });

  it("debounces a burst of edits into a single write", async () => {
    vi.useFakeTimers();
    installLocalStorage();
    const { ensureConfigLoaded, setConfigKey, flushConfig } = await loadModule();
    await ensureConfigLoaded();

    setConfigKey("theme.activeId", "a");
    setConfigKey("theme.activeId", "b");
    setConfigKey("theme.activeId", "c");

    await vi.runAllTimersAsync();
    await flushConfig();

    const writes = invokeMock.mock.calls.filter(
      ([cmd]) => cmd === "vault_write_config",
    );
    expect(writes.length).toBe(1);
    const payload = JSON.parse(
      (writes[0][1] as { json: string }).json,
    );
    expect(payload.theme.activeId).toBe("c");
  });

  it("removes a key when set to undefined", async () => {
    vi.useFakeTimers();
    installLocalStorage();
    setReadResponse(
      JSON.stringify({ preferences: { fontFamilyId: "inter" } }),
    );
    const { ensureConfigLoaded, setConfigKey, flushConfig, getConfigKey } =
      await loadModule();
    await ensureConfigLoaded();
    setConfigKey("preferences.fontFamilyId", undefined);
    await vi.runAllTimersAsync();
    await flushConfig();
    expect(getConfigKey("preferences.fontFamilyId", "missing")).toBe("missing");
  });
});

describe("flushConfig", () => {
  it("forces a pending debounced write to flush early", async () => {
    vi.useFakeTimers();
    installLocalStorage();
    const { ensureConfigLoaded, setConfigKey, flushConfig } = await loadModule();
    await ensureConfigLoaded();

    setConfigKey("theme.activeId", "a");
    // Do not advance timers; flushConfig should bypass the debounce.
    await flushConfig();
    const writes = invokeMock.mock.calls.filter(
      ([cmd]) => cmd === "vault_write_config",
    );
    expect(writes.length).toBe(1);
  });
});

describe("migrateFromLocalStorage", () => {
  it("copies legacy keys into the config and removes them", async () => {
    const ls = installLocalStorage();
    ls.setItem("ganbaruai-theme", "midnight");
    ls.setItem("ganbaruai-font-family", "monospace");
    ls.setItem("ganbaruai-font-scale", "1.15");

    const { ensureConfigLoaded, getConfigKey } = await loadModule();
    await ensureConfigLoaded();

    expect(getConfigKey("theme.activeId", "")).toBe("midnight");
    expect(getConfigKey("preferences.fontFamilyId", "")).toBe("monospace");
    expect(getConfigKey("preferences.fontScale", 0)).toBe(1.15);

    expect(ls.store.has("ganbaruai-theme")).toBe(false);
    expect(ls.store.has("ganbaruai-font-family")).toBe(false);
    expect(ls.store.has("ganbaruai-font-scale")).toBe(false);
  });

  it("does not overwrite existing config values", async () => {
    const ls = installLocalStorage();
    ls.setItem("ganbaruai-theme", "midnight");
    setReadResponse(JSON.stringify({ theme: { activeId: "solarized" } }));

    const { ensureConfigLoaded, getConfigKey } = await loadModule();
    await ensureConfigLoaded();

    expect(getConfigKey("theme.activeId", "")).toBe("solarized");
    // Legacy key should still be cleared even though it did not win.
    expect(ls.store.has("ganbaruai-theme")).toBe(false);
  });

  it("rejects non-numeric font-scale legacy values", async () => {
    const ls = installLocalStorage();
    ls.setItem("ganbaruai-font-scale", "garbage");
    const { ensureConfigLoaded, getConfigKey } = await loadModule();
    await ensureConfigLoaded();
    expect(getConfigKey("preferences.fontScale", "fallback")).toBe("fallback");
    expect(ls.store.has("ganbaruai-font-scale")).toBe(false);
  });

  it("triggers a write only when something migrated", async () => {
    vi.useFakeTimers();
    installLocalStorage();
    const { ensureConfigLoaded } = await loadModule();
    await ensureConfigLoaded();
    await vi.runAllTimersAsync();
    const writes = invokeMock.mock.calls.filter(
      ([cmd]) => cmd === "vault_write_config",
    );
    expect(writes.length).toBe(0);
  });

  it("writes after a legacy migration so the migrated state hits disk", async () => {
    vi.useFakeTimers();
    const ls = installLocalStorage();
    ls.setItem("ganbaruai-theme", "midnight");
    const { ensureConfigLoaded } = await loadModule();
    await ensureConfigLoaded();
    const writes = invokeMock.mock.calls.filter(
      ([cmd]) => cmd === "vault_write_config",
    );
    expect(writes.length).toBe(1);
    const payload = JSON.parse(
      (writes[0][1] as { json: string }).json,
    );
    expect(payload.theme.activeId).toBe("midnight");
  });

  it("is a no-op when localStorage is unavailable", async () => {
    uninstallLocalStorage();
    // Without localStorage, the migration step should silently skip.
    const { ensureConfigLoaded, getConfigKey } = await loadModule();
    await ensureConfigLoaded();
    expect(getConfigKey("theme.activeId", "fallback")).toBe("fallback");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...(args as [string, unknown])),
}));

async function loadModule() {
  return await import("./state");
}

beforeEach(() => {
  vi.resetModules();
  invokeMock.mockReset();
});

describe("data folder state api", () => {
  it("formats non-empty default folder errors with default-specific guidance", async () => {
    const { formatDataFolderError } = await loadModule();

    expect(
      formatDataFolderError(
        "selected folder is not empty and is not a Ganbaru AI folder",
        "default",
      ),
    ).toBe(
      "The default Ganbaru AI folder already exists, but it is not a valid Ganbaru AI folder. Move those files somewhere else, choose another folder, or import an existing Ganbaru AI folder.",
    );
  });

  it("formats import and marker errors as user-facing folder guidance", async () => {
    const { formatDataFolderError } = await loadModule();

    expect(formatDataFolderError("selected folder is not a Ganbaru AI folder", "import")).toBe(
      "This does not look like a Ganbaru AI folder. Select the folder from your previous installation.",
    );
    expect(
      formatDataFolderError(
        "read Ganbaru AI folder marker: No such file or directory (os error 2)",
        "import",
      ),
    ).toBe(
      "This folder is missing the Ganbaru AI folder marker. Select the main Ganbaru AI folder, not one of its subfolders.",
    );
    expect(formatDataFolderError("parse Ganbaru AI folder marker: expected value", "import")).toBe(
      "This Ganbaru AI folder marker is damaged. The app cannot import this folder automatically.",
    );
  });

  it("formats permission and database errors without raw backend text", async () => {
    const { formatDataFolderError } = await loadModule();

    expect(formatDataFolderError("read Ganbaru AI folder: Permission denied")).toBe(
      "Ganbaru AI cannot access this folder. Check folder permissions or choose another location.",
    );
    expect(
      formatDataFolderError("run database migrations: file is not a database", "startup"),
    ).toBe(
      "The app found this Ganbaru AI folder, but ganbaru-ai.sqlite could not be opened. Restore a backup or choose another folder.",
    );
  });

  it("normalizes malformed app state responses to an empty state", async () => {
    invokeMock.mockResolvedValue({ activeVaultPath: 123, recentVaultPaths: [null, ""] });
    const { readVaultAppState } = await loadModule();

    await expect(readVaultAppState()).resolves.toEqual({
      activeVaultPath: null,
      recentVaultPaths: [],
    });
  });

  it("accepts complete data folder info responses", async () => {
    invokeMock.mockResolvedValue({
      path: "/home/victor/Documents/Ganbaru AI",
      configPath: "/home/victor/Documents/Ganbaru AI/config.json",
      databasePath: "/home/victor/Documents/Ganbaru AI/ganbaru-ai.sqlite",
      vaultId: "vault-1",
      displayName: "Ganbaru AI",
    });
    const { getActiveVaultInfo } = await loadModule();

    await expect(getActiveVaultInfo()).resolves.toEqual({
      path: "/home/victor/Documents/Ganbaru AI",
      configPath: "/home/victor/Documents/Ganbaru AI/config.json",
      databasePath: "/home/victor/Documents/Ganbaru AI/ganbaru-ai.sqlite",
      vaultId: "vault-1",
      displayName: "Ganbaru AI",
    });
  });

  it("rejects incomplete data folder info responses", async () => {
    invokeMock.mockResolvedValue({
      path: "/home/victor/Documents/Ganbaru AI",
      configPath: "/home/victor/Documents/Ganbaru AI/config.json",
      databasePath: "/home/victor/Documents/Ganbaru AI/ganbaru-ai.sqlite",
      vaultId: "vault-1",
    });
    const { getActiveVaultInfo } = await loadModule();

    await expect(getActiveVaultInfo()).rejects.toThrow("data folder response is incomplete");
  });

  it("reads the default data folder location", async () => {
    invokeMock.mockResolvedValue({
      path: "/home/victor/Documents/Ganbaru AI",
      parentPath: "/home/victor/Documents",
      folderName: "Ganbaru AI",
      developmentBuild: false,
    });
    const { getDefaultDataFolderLocation } = await loadModule();

    await expect(getDefaultDataFolderLocation()).resolves.toEqual({
      path: "/home/victor/Documents/Ganbaru AI",
      parentPath: "/home/victor/Documents",
      folderName: "Ganbaru AI",
      developmentBuild: false,
    });
  });
});

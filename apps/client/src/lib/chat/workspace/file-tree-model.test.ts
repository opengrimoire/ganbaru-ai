import { describe, expect, it } from "vitest";
import type { ProjectWorkingFolderFileEntry } from "$lib/chat/contracts";
import { chatVirtualRange, flattenChatFileTree } from "./file-tree-model";

function entry(relativePath: string, kind: "file" | "directory"): ProjectWorkingFolderFileEntry {
  return {
    relativePath,
    displayName: relativePath.split("/").at(-1) ?? relativePath,
    kind,
    ignored: false,
    byteSize: kind === "file" ? 10 : null,
  };
}

describe("Chat file tree model", () => {
  it("flattens only expanded directories with stable depth", () => {
    const rows = flattenChatFileTree(
      [entry("src", "directory"), entry("README.md", "file")],
      {
        src: [entry("src/lib", "directory"), entry("src/main.ts", "file")],
        "src/lib": [entry("src/lib/model.ts", "file")],
      },
      ["src"],
    );

    expect(rows.map((row) => [row.entry.relativePath, row.depth])).toEqual([
      ["src", 0],
      ["src/lib", 1],
      ["src/main.ts", 1],
      ["README.md", 0],
    ]);
  });

  it("bounds virtual rows and preserves the full scroll size", () => {
    expect(chatVirtualRange(5_000, 2_600, 260, 26, 4)).toEqual({
      start: 96,
      end: 114,
      offset: 2_496,
      totalSize: 130_000,
    });
    expect(chatVirtualRange(0, 0, 0, 26)).toEqual({ start: 0, end: 0, offset: 0, totalSize: 0 });
  });
});

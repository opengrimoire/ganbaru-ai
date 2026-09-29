import { describe, expect, it, vi } from "vitest";
import { createNotesMentionDataController } from "./notes-mention-data-controller.svelte";
import type { NotesDatabaseMentionData } from "./notes-block-mention-targets";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

describe("Notes mention data controller", () => {
  it("shares database data only while mention menus need it", async () => {
    const result = deferred<NotesDatabaseMentionData>();
    const load = vi.fn(() => result.promise);
    const controller = createNotesMentionDataController(load);
    expect(load).not.toHaveBeenCalled();
    const closeFirst = controller.acquire();
    const closeSecond = controller.acquire();
    expect(load).toHaveBeenCalledOnce();
    result.resolve({ dataSources: [], rowPages: [{ id: "row" } as NotesDatabaseMentionData["rowPages"][number]] });
    await result.promise;
    expect(controller.rowPages).toHaveLength(1);
    closeFirst();
    closeFirst();
    expect(controller.rowPages).toHaveLength(1);
    closeSecond();
    expect(controller.rowPages).toEqual([]);
    const closeThird = controller.acquire();
    expect(load).toHaveBeenCalledTimes(2);
    closeThird();
    await result.promise;
    expect(controller.rowPages).toEqual([]);
  });

  it("rejects data from a previous vault while a menu is still open", async () => {
    const first = deferred<NotesDatabaseMentionData>();
    const second = deferred<NotesDatabaseMentionData>();
    const load = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const controller = createNotesMentionDataController(load);
    const close = controller.acquire();
    controller.switchVault();
    second.resolve({ dataSources: [], rowPages: [] });
    await second.promise;
    first.resolve({ dataSources: [], rowPages: [{ id: "old-vault" } as NotesDatabaseMentionData["rowPages"][number]] });
    await first.promise;
    expect(controller.rowPages).toEqual([]);
    close();
  });

  it("ignores an older aggregate result after a newer reload finishes", async () => {
    const first = deferred<NotesDatabaseMentionData>();
    const second = deferred<NotesDatabaseMentionData>();
    const load = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const controller = createNotesMentionDataController(load);

    const firstReload = controller.reload();
    const secondReload = controller.reload();
    second.resolve({ dataSources: [], rowPages: [] });
    await secondReload;
    first.resolve({
      dataSources: [],
      rowPages: [{ id: "stale" } as NotesDatabaseMentionData["rowPages"][number]],
    });
    await firstReload;

    expect(controller.rowPages).toEqual([]);
  });

  it("clears current data when the latest aggregate load fails", async () => {
    const successful: NotesDatabaseMentionData = { dataSources: [], rowPages: [] };
    const load = vi.fn()
      .mockResolvedValueOnce(successful)
      .mockRejectedValueOnce(new Error("failed"));
    const controller = createNotesMentionDataController(load);
    await controller.reload();
    await controller.reload();
    expect(controller.dataSources).toEqual([]);
    expect(controller.rowPages).toEqual([]);
  });
});

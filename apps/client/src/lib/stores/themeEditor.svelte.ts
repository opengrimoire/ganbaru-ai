import type { ThemeId } from "./themes";

// Tracks which theme is currently being edited in the floating editor
// panel. Lifted to a module-level store so the settings modal and the
// floating panel can coordinate: opening the editor from a list row
// auto-closes the modal, and the footer's Back button reopens it.
let editingId = $state<ThemeId | undefined>(undefined);

export function getThemeEditor() {
  return {
    get editingId(): ThemeId | undefined {
      return editingId;
    },
    open(id: ThemeId): void {
      editingId = id;
    },
    close(): void {
      editingId = undefined;
    },
  };
}

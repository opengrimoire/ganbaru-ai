import {
  createBlockWrite,
  createTextPayload,
  type NotesHeadingBlockType,
} from "./block-factory";
import type { NotesBlockType } from "./types";
import type { NotesBlockWrite } from "./types";

export const NOTES_INSERTABLE_BLOCK_TYPES = [
  "paragraph",
  "heading_1",
  "heading_2",
  "heading_3",
  "heading_4",
  "heading_5",
  "heading_6",
  "bulleted_list_item",
  "numbered_list_item",
  "to_do",
  "toggle",
  "callout",
  "quote",
  "child_page",
  "child_database",
  "breadcrumb",
  "table_of_contents",
  "column_list",
  "table",
  "tab",
  "image",
  "video",
  "audio",
  "file",
  "pdf",
  "bookmark",
  "link_preview",
  "template",
  "button",
  "embed",
  "equation",
  "divider",
  "code",
] as const satisfies readonly NotesBlockType[];

export type NotesInsertableBlockType = (typeof NOTES_INSERTABLE_BLOCK_TYPES)[number];
export type NotesBlockInsertCommand =
  | { kind: "block"; blockType: NotesInsertableBlockType }
  | { kind: "toggle_heading"; headingType: NotesHeadingBlockType };
export type NotesBlockInsertRequest = NotesBlockInsertCommand;
export interface NotesBlockInsertMenuRect {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface NotesBlockInsertMenuPlacementInput {
  triggerRect: NotesBlockInsertMenuRect;
  viewportWidth: number;
  viewportHeight: number;
  preferredWidth?: number;
  preferredMaxHeight?: number;
  margin?: number;
  gap?: number;
}

const NOTES_INSERTABLE_TOGGLE_HEADING_TYPES = [
  "heading_1",
  "heading_2",
  "heading_3",
  "heading_4",
  "heading_5",
  "heading_6",
] as const satisfies readonly NotesHeadingBlockType[];

export function isNotesInsertableBlockType(value: unknown): value is NotesInsertableBlockType {
  return (
    typeof value === "string"
    && NOTES_INSERTABLE_BLOCK_TYPES.includes(value as NotesInsertableBlockType)
  );
}

export function notesInsertableBlockTypes(): readonly NotesInsertableBlockType[] {
  return NOTES_INSERTABLE_BLOCK_TYPES;
}

export function notesBlockInsertCommands(): readonly NotesBlockInsertCommand[] {
  return [
    ...NOTES_INSERTABLE_BLOCK_TYPES.map((blockType) => ({ kind: "block" as const, blockType })),
    ...NOTES_INSERTABLE_TOGGLE_HEADING_TYPES.map((headingType) => ({
      kind: "toggle_heading" as const,
      headingType,
    })),
  ];
}

export function notesBlockInsertCommandKey(command: NotesBlockInsertCommand): string {
  switch (command.kind) {
    case "block":
      return `block:${command.blockType}`;
    case "toggle_heading":
      return `toggle-heading:${command.headingType}`;
  }
}

export function normalizeNotesBlockInsertCommand(
  request?: NotesBlockInsertRequest,
): NotesBlockInsertCommand {
  if (request === undefined) return { kind: "block", blockType: "paragraph" };
  return request;
}

export function createBlockWriteFromInsertCommand(
  id: string,
  command: NotesBlockInsertCommand,
): NotesBlockWrite {
  if (command.kind === "block") return createBlockWrite(id, command.blockType);
  const payload = createTextPayload("", { isToggleable: true, open: true });
  switch (command.headingType) {
    case "heading_1":
      return { id, type: "heading_1", heading_1: payload };
    case "heading_2":
      return { id, type: "heading_2", heading_2: payload };
    case "heading_3":
      return { id, type: "heading_3", heading_3: payload };
    case "heading_4":
      return { id, type: "heading_4", heading_4: payload };
    case "heading_5":
      return { id, type: "heading_5", heading_5: payload };
    case "heading_6":
      return { id, type: "heading_6", heading_6: payload };
  }
}

export function notesBlockInsertMenuStyle(
  input: NotesBlockInsertMenuPlacementInput,
): string {
  const margin = input.margin ?? 8;
  const gap = input.gap ?? 4;
  const preferredWidth = input.preferredWidth ?? 256;
  const preferredMaxHeight = input.preferredMaxHeight ?? 448;
  const width = Math.max(0, Math.min(preferredWidth, input.viewportWidth - margin * 2));
  const maxLeft = Math.max(margin, input.viewportWidth - margin - width);
  const left = clamp(input.triggerRect.left, margin, maxLeft);
  const belowTop = input.triggerRect.bottom + gap;
  const aboveAvailable = Math.max(0, input.triggerRect.top - margin - gap);
  const belowAvailable = Math.max(0, input.viewportHeight - belowTop - margin);
  const openAbove = belowAvailable < Math.min(180, preferredMaxHeight) && aboveAvailable > belowAvailable;
  const maxHeight = Math.max(0, Math.min(preferredMaxHeight, openAbove ? aboveAvailable : belowAvailable));
  const top = openAbove
    ? Math.max(margin, input.triggerRect.top - gap - maxHeight)
    : Math.min(belowTop, Math.max(margin, input.viewportHeight - margin - maxHeight));
  return [
    "position:fixed",
    `left:${Math.round(left)}px`,
    `top:${Math.round(top)}px`,
    `width:${Math.round(width)}px`,
    `max-height:${Math.round(maxHeight)}px`,
  ].join("; ");
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

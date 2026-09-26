import { normalizeRichTextLinkUrl } from "./rich-text";

/** Clipboard-relative paths have no shared base URL and must never become invented web links. */
export function notesClipboardLinkUrl(value: string | null | undefined): string | null {
  if (!value || !/^(?:https?:|mailto:)/iu.test(value.trim())) return null;
  return normalizeRichTextLinkUrl(value);
}

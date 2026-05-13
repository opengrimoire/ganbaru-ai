import DOMPurify, { type Config } from "dompurify";

const ALLOWED_DESCRIPTION_TAGS = [
  "a",
  "b",
  "br",
  "div",
  "em",
  "i",
  "li",
  "ol",
  "p",
  "strong",
  "u",
  "ul",
] as const;

const SANITIZER_CONFIG = {
  ALLOWED_TAGS: [...ALLOWED_DESCRIPTION_TAGS],
  ALLOWED_ATTR: ["href"],
  ALLOW_ARIA_ATTR: false,
  ALLOW_DATA_ATTR: false,
  FORBID_ATTR: ["style"],
  FORBID_TAGS: [
    "base",
    "button",
    "embed",
    "form",
    "iframe",
    "img",
    "input",
    "link",
    "math",
    "meta",
    "object",
    "script",
    "select",
    "style",
    "svg",
    "textarea",
  ],
} satisfies Config;

/**
 * Return whether a calendar description URL may be kept as a link.
 *
 * Calendar descriptions intentionally support only normal web links. Other
 * schemes stay as visible text, but never become clickable in the webview.
 */
export function isSafeCalendarDescriptionUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function stripUnsafeLinkProtocols(root: ParentNode): void {
  for (const link of root.querySelectorAll("a[href]")) {
    const href = link.getAttribute("href");
    if (!href || !isSafeCalendarDescriptionUrl(href)) {
      link.removeAttribute("href");
    }
  }
}

function escapeHtmlText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Sanitize stored or edited calendar description HTML.
 *
 * The current editor supports a small rich-text subset: inline emphasis,
 * paragraphs or divs, line breaks, ordered and unordered lists, list items,
 * and HTTP(S) links. Everything else is removed before the value is rendered
 * or persisted.
 */
export function sanitizeCalendarDescriptionHtml(value: string): string {
  if (value.length === 0) return "";
  if (typeof document === "undefined") return escapeHtmlText(value);
  const sanitized = DOMPurify.sanitize(value, SANITIZER_CONFIG);
  const template = document.createElement("template");
  template.innerHTML = sanitized;
  stripUnsafeLinkProtocols(template.content);
  return template.innerHTML;
}

/**
 * Build preview text from sanitized description HTML.
 */
export function calendarDescriptionPreviewText(value: string): string {
  const sanitized = sanitizeCalendarDescriptionHtml(value);
  if (!sanitized || typeof document === "undefined") return sanitized.trim();
  const template = document.createElement("template");
  template.innerHTML = sanitized;
  return template.content.textContent?.trim() ?? "";
}

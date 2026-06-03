// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  calendarDescriptionPreviewText,
  isSafeCalendarDescriptionUrl,
  MAX_CALENDAR_DESCRIPTION_CHARS,
  sanitizeCalendarDescriptionHtml,
} from "./description-sanitizer";

describe("sanitizeCalendarDescriptionHtml", () => {
  it("keeps the editor's allowed formatting subset", () => {
    const html = [
      "<p><strong>Strong</strong> <b>bold</b></p>",
      "<div><em>Em</em> <i>italic</i> <u>underline</u><br></div>",
      "<ol><li>One</li></ol><ul><li>Two</li></ul>",
      '<a href="https://example.com/path">Link</a>',
      '<a href="http://example.com">Http</a>',
    ].join("");

    expect(sanitizeCalendarDescriptionHtml(html)).toBe(html);
  });

  it("removes unsafe tags, attributes, styles, and URL schemes", () => {
    const html = [
      '<script>alert("x")</script>',
      '<img src="x" onerror="alert(1)">',
      '<svg><circle onload="alert(1)"></circle></svg>',
      '<iframe src="https://example.com"></iframe>',
      '<form action="https://example.com"><input value="x"></form>',
      '<p style="color:red" onclick="alert(1)">Text ',
      '<a href="javascript:alert(1)" onclick="alert(1)">bad</a>',
      '<a href="https://safe.example" target="_blank" rel="noopener">safe</a>',
      "</p>",
    ].join("");

    const sanitized = sanitizeCalendarDescriptionHtml(html);

    expect(sanitized).not.toContain("script");
    expect(sanitized).not.toContain("img");
    expect(sanitized).not.toContain("svg");
    expect(sanitized).not.toContain("iframe");
    expect(sanitized).not.toContain("form");
    expect(sanitized).not.toContain("style=");
    expect(sanitized).not.toContain("onclick");
    expect(sanitized).not.toContain("javascript:");
    expect(sanitized).toContain("<p>Text <a>bad</a>");
    expect(sanitized).toContain('<a href="https://safe.example">safe</a>');
  });

  it("turns pasted rich HTML into safe output", () => {
    const html = [
      '<span style="font-size:48px" onclick="alert(1)">',
      "<b>Keep bold</b>",
      "</span>",
      '<div><font color="red">Plain text</font>',
      '<a href="ftp://example.com/file">ftp link</a></div>',
    ].join("");

    expect(sanitizeCalendarDescriptionHtml(html)).toBe(
      '<b>Keep bold</b><div>Plain text<a>ftp link</a></div>',
    );
  });

  it("caps raw input before sanitizing", () => {
    const html = `${"a".repeat(MAX_CALENDAR_DESCRIPTION_CHARS + 10)}<strong>after cap</strong>`;

    expect(sanitizeCalendarDescriptionHtml(html)).toBe(
      "a".repeat(MAX_CALENDAR_DESCRIPTION_CHARS),
    );
  });

  it("handles a cap that cuts through malformed hostile HTML", () => {
    const html = `${"a".repeat(MAX_CALENDAR_DESCRIPTION_CHARS - 2)}<script>alert("x")</script>`;
    const sanitized = sanitizeCalendarDescriptionHtml(html);

    expect(sanitized).not.toContain("script");
    expect(sanitized).not.toContain("alert");
    expect(sanitized.length).toBeLessThanOrEqual(MAX_CALENDAR_DESCRIPTION_CHARS);
  });

  it("builds preview text from sanitized content", () => {
    const preview = calendarDescriptionPreviewText(
      '<p>Hello <strong>there</strong><script>alert("x")</script></p>',
    );

    expect(preview).toBe("Hello there");
  });

  it("builds preview text from capped sanitized content", () => {
    const preview = calendarDescriptionPreviewText(
      `${"a".repeat(MAX_CALENDAR_DESCRIPTION_CHARS + 1)}<strong>after cap</strong>`,
    );

    expect(preview).toBe("a".repeat(MAX_CALENDAR_DESCRIPTION_CHARS));
  });

  it("accepts only HTTP and HTTPS link URLs", () => {
    expect(isSafeCalendarDescriptionUrl("https://example.com")).toBe(true);
    expect(isSafeCalendarDescriptionUrl("http://example.com")).toBe(true);
    expect(isSafeCalendarDescriptionUrl("mailto:user@example.com")).toBe(false);
    expect(isSafeCalendarDescriptionUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeCalendarDescriptionUrl("/relative/path")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import type { Calendar } from "$lib/components/calendar/types";
import {
  calendarDisplayName,
  calendarIdentityEmail,
  calendarImportDate,
} from "./calendar-display";

function makeCalendar(overrides: Partial<Calendar> = {}): Calendar {
  return {
    id: "cal-1",
    name: "Ganbaru AI",
    color: "",
    source: "local",
    visible: true,
    readOnly: false,
    ...overrides,
  };
}

const expectedDateFormatter = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  year: "numeric",
});
const expectedTimeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

function expectedLocalDate(value: string): string {
  return expectedDateFormatter.format(new Date(`${value}T12:00:00`));
}

function expectedLocalTimestamp(value: string): string {
  const date = new Date(value);
  return `${expectedDateFormatter.format(date)} at ${expectedTimeFormatter.format(date)}`;
}

describe("calendar display helpers", () => {
  it("uses the .ics source filename as the imported calendar label", () => {
    const calendar = makeCalendar({
      name: "Imported from old-label@example.com (2026-05-14)",
      source: "ics",
      sourceUrl: "person@example.com.ics",
    });

    expect(calendarDisplayName(calendar)).toBe("person@example.com");
  });

  it("falls back to imported calendar names when source_url is unavailable", () => {
    const calendar = makeCalendar({
      name: "Imported from old-label@example.com (2026-05-14)",
      source: "ics",
    });

    expect(calendarDisplayName(calendar)).toBe("old-label@example.com");
    expect(calendarImportDate(calendar)).toBe(expectedLocalDate("2026-05-14"));
  });

  it("formats imported timestamps in the local date and time", () => {
    const timestamp = "2026-05-26T00:33:21.944Z";
    const calendar = makeCalendar({
      createdAt: timestamp,
      source: "ics",
      sourceUrl: "person@example.com.ics",
    });

    expect(calendarImportDate(calendar)).toBe(expectedLocalTimestamp(timestamp));
    expect(calendarImportDate(calendar)).not.toBe(timestamp);
  });

  it("derives an identity email from the source filename", () => {
    const calendar = makeCalendar({
      source: "ics",
      sourceUrl: "person@example.com.ics",
    });

    expect(calendarIdentityEmail(calendar)).toBe("person@example.com");
  });

  it("does not derive identities from non-email imported calendar names", () => {
    const calendar = makeCalendar({
      name: "work",
      source: "ics",
      sourceUrl: "work.ics",
    });

    expect(calendarIdentityEmail(calendar)).toBeUndefined();
  });
});

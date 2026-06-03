import type { Calendar } from "$lib/components/calendar/types";

const IMPORTED_NAME_PATTERN = /^Imported from (.+) \((\d{4}-\d{2}-\d{2})\)$/;
const EMAIL_PATTERN = /^[^\s@<>()[\],;:]+@[^\s@<>()[\],;:]+\.[^\s@<>()[\],;:]+$/i;
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const IMPORT_DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  year: "numeric",
});
const IMPORT_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

function stripIcsExtension(value: string): string {
  return value.replace(/\.ics$/i, "");
}

function basename(value: string): string {
  const parts = value.split(/[\\/]/);
  return parts[parts.length - 1] ?? value;
}

function sourceName(calendar: Calendar): string | undefined {
  if (!calendar.sourceUrl) return undefined;
  return stripIcsExtension(basename(calendar.sourceUrl));
}

function legacyImportedNameParts(name: string): { label: string; date: string } | undefined {
  const match = IMPORTED_NAME_PATTERN.exec(name);
  if (!match) return undefined;
  return {
    label: match[1] ?? name,
    date: match[2] ?? "",
  };
}

function validDate(value: Date): Date | undefined {
  return Number.isNaN(value.getTime()) ? undefined : value;
}

function localDateOnly(value: string): Date | undefined {
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) return undefined;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return validDate(new Date(year, month - 1, day, 12));
}

function parseImportTimestamp(value: string): Date | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const dateOnly = localDateOnly(trimmed);
  if (dateOnly) return dateOnly;

  return validDate(new Date(trimmed)) ?? validDate(new Date(trimmed.replace(" ", "T")));
}

function formatImportDateOnly(value: string): string | undefined {
  const date = localDateOnly(value);
  return date ? IMPORT_DATE_FORMATTER.format(date) : undefined;
}

function formatImportTimestamp(value: string): string | undefined {
  const trimmed = value.trim();
  const dateOnly = formatImportDateOnly(trimmed);
  if (dateOnly) return dateOnly;

  const date = parseImportTimestamp(value);
  if (!date) return undefined;

  return `${IMPORT_DATE_FORMATTER.format(date)} at ${IMPORT_TIME_FORMATTER.format(date)}`;
}

export function calendarDisplayName(calendar: Calendar): string {
  if (calendar.source === "ics") {
    return sourceName(calendar) ?? legacyImportedNameParts(calendar.name)?.label ?? calendar.name;
  }
  return calendar.name;
}

export function calendarImportDate(calendar: Calendar): string | undefined {
  if (calendar.source !== "ics") return undefined;
  return (
    (calendar.createdAt ? formatImportTimestamp(calendar.createdAt) : undefined) ??
    formatImportDateOnly(legacyImportedNameParts(calendar.name)?.date ?? "")
  );
}

export function calendarIdentityEmail(calendar: Calendar | undefined): string | undefined {
  if (!calendar || calendar.source !== "ics") return undefined;

  const candidates = [
    sourceName(calendar),
    legacyImportedNameParts(calendar.name)?.label,
    calendar.name,
  ];

  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed && EMAIL_PATTERN.test(trimmed)) return trimmed;
  }

  return undefined;
}

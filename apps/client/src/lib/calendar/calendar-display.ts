import type { Calendar } from "$lib/components/calendar/types";

const IMPORTED_NAME_PATTERN = /^Imported from (.+) \((\d{4}-\d{2}-\d{2})\)$/;
const EMAIL_PATTERN = /^[^\s@<>()[\],;:]+@[^\s@<>()[\],;:]+\.[^\s@<>()[\],;:]+$/i;

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

export function calendarDisplayName(calendar: Calendar): string {
  if (calendar.source === "ics") {
    return sourceName(calendar) ?? legacyImportedNameParts(calendar.name)?.label ?? calendar.name;
  }
  return calendar.name;
}

export function calendarImportDate(calendar: Calendar): string | undefined {
  if (calendar.source !== "ics") return undefined;
  return calendar.createdAt?.split(" ")[0] ?? legacyImportedNameParts(calendar.name)?.date;
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

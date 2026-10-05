import type {
  ProjectCustomField,
  ProjectCustomFieldOption,
  ProjectCustomFieldType,
} from "$lib/projects/types";
import { projectCustomFieldUsesOptions } from "$lib/projects/custom-fields";

export interface NewCustomFieldOptionDraft {
  id: string;
  name: string;
}

export interface NewCustomFieldDraft {
  id: string;
  name: string;
  fieldType: ProjectCustomFieldType;
  optionRows: NewCustomFieldOptionDraft[];
  optionName: string;
}

export interface CustomFieldUpdateSaveDraft {
  field: ProjectCustomField;
  name: string;
}

export interface CustomFieldCreateSaveDraft {
  draftId: string;
  name: string;
  fieldType: ProjectCustomFieldType;
  optionNames: string[];
}

export interface CustomFieldSaveDraft {
  updates: CustomFieldUpdateSaveDraft[];
  creates: CustomFieldCreateSaveDraft[];
}

export interface CustomFieldOptionUpdateDraft {
  option: ProjectCustomFieldOption;
  name: string;
}

export interface CustomFieldOptionCreateDraft {
  field: ProjectCustomField;
  name: string;
  draftId: string;
}

export interface CustomFieldOptionSaveDraft {
  updates: CustomFieldOptionUpdateDraft[];
  creates: CustomFieldOptionCreateDraft[];
}

export type ProjectSettingsCustomFieldDraftError =
  | "name_required"
  | "name_exists"
  | "option_name_required"
  | "option_name_exists";

export type ProjectSettingsCustomFieldDraftResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ProjectSettingsCustomFieldDraftError };

export interface ProjectSettingsCustomFieldSaveInput {
  fields: readonly ProjectCustomField[];
  fieldNameDrafts: Readonly<Record<string, string>>;
  createDraftRows: readonly NewCustomFieldDraft[];
}

export interface ProjectSettingsCustomFieldOptionSaveInput {
  fields: readonly ProjectCustomField[];
  fieldOptions: (fieldId: string) => readonly ProjectCustomFieldOption[];
  optionNameDrafts: Readonly<Record<string, string>>;
  optionCreateDraftRowsByField: Readonly<Record<string, readonly NewCustomFieldOptionDraft[]>>;
}

function normalizedDraftName(value: string): string {
  return value.trim().toLowerCase();
}

export function projectSettingsCustomFieldNameDraftValue(
  field: ProjectCustomField,
  fieldNameDrafts: Readonly<Record<string, string>>,
): string {
  return fieldNameDrafts[field.id] ?? field.name;
}

export function projectSettingsCustomFieldDraftDirty(
  field: ProjectCustomField,
  fieldNameDrafts: Readonly<Record<string, string>>,
): boolean {
  return projectSettingsCustomFieldNameDraftValue(field, fieldNameDrafts) !== field.name;
}

export function projectSettingsCustomFieldOptionNameDraftValue(
  option: ProjectCustomFieldOption,
  optionNameDrafts: Readonly<Record<string, string>>,
): string {
  return optionNameDrafts[option.id] ?? option.name;
}

export function projectSettingsCustomFieldOptionDraftDirty(
  option: ProjectCustomFieldOption,
  optionNameDrafts: Readonly<Record<string, string>>,
): boolean {
  return projectSettingsCustomFieldOptionNameDraftValue(option, optionNameDrafts) !== option.name;
}

export function projectSettingsCustomFieldOptionCreateDraftRows(
  rowsByField: Readonly<Record<string, readonly NewCustomFieldOptionDraft[]>>,
  fieldId: string,
): NewCustomFieldOptionDraft[] {
  return [...(rowsByField[fieldId] ?? [])];
}

export function projectSettingsSetCustomFieldOptionCreateDraftName(
  rowsByField: Readonly<Record<string, readonly NewCustomFieldOptionDraft[]>>,
  fieldId: string,
  optionId: string,
  name: string,
): Record<string, NewCustomFieldOptionDraft[]> {
  const nextRowsByField: Record<string, NewCustomFieldOptionDraft[]> = Object.fromEntries(
    Object.entries(rowsByField).map(([currentFieldId, rows]) => [currentFieldId, [...rows]]),
  );
  nextRowsByField[fieldId] = projectSettingsCustomFieldOptionCreateDraftRows(rowsByField, fieldId)
    .map((option) => option.id === optionId ? { ...option, name } : option);
  return nextRowsByField;
}

export function projectSettingsRemoveCustomFieldOptionCreateDraft(
  rowsByField: Readonly<Record<string, readonly NewCustomFieldOptionDraft[]>>,
  fieldId: string,
  optionId: string,
): Record<string, NewCustomFieldOptionDraft[]> {
  const remainingRows = projectSettingsCustomFieldOptionCreateDraftRows(rowsByField, fieldId)
    .filter((option) => option.id !== optionId);
  const nextRowsByField: Record<string, NewCustomFieldOptionDraft[]> = Object.fromEntries(
    Object.entries(rowsByField).map(([currentFieldId, rows]) => [currentFieldId, [...rows]]),
  );
  if (remainingRows.length > 0) {
    nextRowsByField[fieldId] = remainingRows;
  } else {
    delete nextRowsByField[fieldId];
  }
  return nextRowsByField;
}

export function projectSettingsSetCustomFieldCreateDraftName(
  rows: readonly NewCustomFieldDraft[],
  fieldId: string,
  name: string,
): NewCustomFieldDraft[] {
  return rows.map((field) => field.id === fieldId ? { ...field, name } : field);
}

export function projectSettingsSetCustomFieldCreateDraftOptionName(
  rows: readonly NewCustomFieldDraft[],
  fieldId: string,
  optionId: string,
  name: string,
): NewCustomFieldDraft[] {
  return rows.map((field) =>
    field.id === fieldId
      ? {
          ...field,
          optionRows: field.optionRows.map((option) =>
            option.id === optionId ? { ...option, name } : option
          ),
        }
      : field
  );
}

export function projectSettingsSetCustomFieldCreateDraftPendingOptionName(
  rows: readonly NewCustomFieldDraft[],
  fieldId: string,
  optionName: string,
): NewCustomFieldDraft[] {
  return rows.map((field) => field.id === fieldId ? { ...field, optionName } : field);
}

export function projectSettingsRemoveCustomFieldCreateDraft(
  rows: readonly NewCustomFieldDraft[],
  fieldId: string,
): NewCustomFieldDraft[] {
  return rows.filter((field) => field.id !== fieldId);
}

export function projectSettingsRemoveCustomFieldCreateDraftOption(
  rows: readonly NewCustomFieldDraft[],
  fieldId: string,
  optionId: string,
): NewCustomFieldDraft[] {
  return rows.map((field) =>
    field.id === fieldId
      ? { ...field, optionRows: field.optionRows.filter((option) => option.id !== optionId) }
      : field
  );
}

export function projectSettingsCustomFieldOptionNamesForCreate(
  fieldType: ProjectCustomFieldType,
  optionRows: readonly NewCustomFieldOptionDraft[],
  pendingOptionName: string,
): ProjectSettingsCustomFieldDraftResult<string[]> {
  if (!projectCustomFieldUsesOptions(fieldType)) return { ok: true, value: [] };
  const names: string[] = [];
  const seenNames = new Set<string>();
  for (const option of optionRows) {
    const name = option.name.trim();
    if (!name) return { ok: false, error: "option_name_required" };
    const normalizedName = normalizedDraftName(name);
    if (seenNames.has(normalizedName)) return { ok: false, error: "option_name_exists" };
    seenNames.add(normalizedName);
    names.push(name);
  }
  const pendingName = pendingOptionName.trim();
  if (pendingName) {
    const normalizedName = normalizedDraftName(pendingName);
    if (seenNames.has(normalizedName)) return { ok: false, error: "option_name_exists" };
    names.push(pendingName);
  }
  return { ok: true, value: names };
}

export function projectSettingsCustomFieldSaveDrafts(
  input: ProjectSettingsCustomFieldSaveInput,
): ProjectSettingsCustomFieldDraftResult<CustomFieldSaveDraft> {
  const updates: CustomFieldUpdateSaveDraft[] = [];
  const creates: CustomFieldCreateSaveDraft[] = [];
  const seenNames = new Set<string>();
  for (const field of input.fields) {
    const name = projectSettingsCustomFieldNameDraftValue(field, input.fieldNameDrafts).trim();
    if (!name) return { ok: false, error: "name_required" };
    const normalizedName = normalizedDraftName(name);
    if (seenNames.has(normalizedName)) return { ok: false, error: "name_exists" };
    seenNames.add(normalizedName);
    if (!projectSettingsCustomFieldDraftDirty(field, input.fieldNameDrafts)) continue;
    updates.push({ field, name });
  }
  for (const field of input.createDraftRows) {
    const name = field.name.trim();
    if (!name) return { ok: false, error: "name_required" };
    const normalizedName = normalizedDraftName(name);
    if (seenNames.has(normalizedName)) return { ok: false, error: "name_exists" };
    seenNames.add(normalizedName);
    const optionNames = projectSettingsCustomFieldOptionNamesForCreate(
      field.fieldType,
      field.optionRows,
      "",
    );
    if (!optionNames.ok) return optionNames;
    creates.push({
      draftId: field.id,
      name,
      fieldType: field.fieldType,
      optionNames: optionNames.value,
    });
  }
  return { ok: true, value: { updates, creates } };
}

export function projectSettingsCustomFieldOptionSaveDrafts(
  input: ProjectSettingsCustomFieldOptionSaveInput,
): ProjectSettingsCustomFieldDraftResult<CustomFieldOptionSaveDraft> {
  const updates: CustomFieldOptionUpdateDraft[] = [];
  const creates: CustomFieldOptionCreateDraft[] = [];
  for (const field of input.fields) {
    if (!projectCustomFieldUsesOptions(field.fieldType)) continue;
    const seenNames = new Set<string>();
    for (const option of input.fieldOptions(field.id)) {
      const name = projectSettingsCustomFieldOptionNameDraftValue(option, input.optionNameDrafts).trim();
      if (!name) return { ok: false, error: "option_name_required" };
      const normalizedName = normalizedDraftName(name);
      if (seenNames.has(normalizedName)) return { ok: false, error: "option_name_exists" };
      seenNames.add(normalizedName);
      if (!projectSettingsCustomFieldOptionDraftDirty(option, input.optionNameDrafts)) continue;
      updates.push({ option, name });
    }
    for (const option of input.optionCreateDraftRowsByField[field.id] ?? []) {
      const name = option.name.trim();
      if (!name) return { ok: false, error: "option_name_required" };
      const normalizedName = normalizedDraftName(name);
      if (seenNames.has(normalizedName)) return { ok: false, error: "option_name_exists" };
      seenNames.add(normalizedName);
      creates.push({ field, name, draftId: option.id });
    }
  }
  return { ok: true, value: { updates, creates } };
}

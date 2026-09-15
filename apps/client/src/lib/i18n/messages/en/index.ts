import { benchmark } from "./benchmark";
import { calendar } from "./calendar";
import { chat } from "./chat";
import { common } from "./common";
import { diagnostics } from "./diagnostics";
import { focusDialog, pomodoroNotification, pomodoroOverlay } from "./focus";
import { format } from "./format";
import { music } from "./music";
import { mobile } from "./mobile";
import { notes } from "./notes";
import { projects } from "./projects";
import { quickNotes } from "./quick-notes";
import { settings } from "./settings";
import { theme } from "./theme";
import { titleBar } from "./title-bar";
import { updates } from "./updates";
import { dataFolderError, language, vaultHandoff, vaultOwnership, vaultOwnershipPrompt, vaultSetup } from "./vault";
import { window } from "./window";

export const en = {
  common,
  window,
  vaultSetup,
  dataFolderError,
  language,
  vaultOwnership,
  vaultOwnershipPrompt,
  vaultHandoff,
  focusDialog,
  pomodoroOverlay,
  pomodoroNotification,
  calendar,
  chat,
  settings,
  updates,
  diagnostics,
  benchmark,
  notes,
  projects,
  quickNotes,
  music,
  mobile,
  titleBar,
  format,
  theme,
} as const;

export type MessageCatalog = typeof en;

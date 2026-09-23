import { Temporal } from "@js-temporal/polyfill";
import { tick, untrack } from "svelte";
import type { Translate } from "$lib/i18n/translator.svelte";
import { blockColor, canBlockHaveColor } from "$lib/notes/block-color";
import {
  blockEditableRichText,
  blockPlainText,
  blockTextAnnotationsForSelection,
  blockTextLinkRangeForSelection,
  headingIsToggleable,
  headingToggleOpen,
  isHeadingBlockType,
  type NotesHeadingBlockType,
} from "$lib/notes/block-factory";
import { normalizeNotesClipboardPlainText, shouldHandleNotesPlainTextPaste } from "$lib/notes/block-clipboard";
import { planNotesKeyboardAction, type NotesKeyboardAction } from "$lib/notes/block-keyboard";
import { shouldDeferNotesCompositionInput, shouldLetNativeCompositionHandleKeydown } from "$lib/notes/composition";
import { planNotesControlledTextEdit } from "$lib/notes/controlled-text-input";
import { notesSlashMenuItemDomId } from "$lib/notes/editor-accessibility";
import {
  beginLazyComponentLoad,
  rejectLazyComponentLoad,
  resolveLazyComponentLoad,
  type LazyComponentLoadState,
} from "$lib/lazy-component-loader";
import {
  clampNotesTextSelection,
  notesEditableSelectionViewportRect,
  notesPlainTextFromEditableRoot,
  notesTextSelectionFromEditableRoot,
  planNotesSelectionReconciliation,
  restoreNotesEditableSelection,
  type NotesTextSelection,
} from "$lib/notes/editor-selection";
import { shouldRestoreNotesEditorFocusAfterLazyLoad } from "$lib/notes/lazy-editor-focus";
import { notesTextContextMenuSelectionAtPoint } from "$lib/notes/text-context-menu";
import {
  buildDateMentionTargets,
  detectPageMentionQuery,
  filterNotesMentionTargets,
  normalizeRichTextLinkUrl,
  planRichTextEquationConversion,
  replacePlainTextPreservingRichText,
  richTextAnnotationTogglePatch,
  richTextColorPatch,
  type NotesDateMentionTarget,
  type NotesInlineEquationConversionError,
  type NotesInlineEquationConversionPlan,
  type NotesMentionQuery,
  type NotesMentionTarget,
  type NotesNamedMentionTarget,
  type NotesObjectMentionTarget,
  type NotesPageMentionTarget,
  type NotesRichTextAnnotationName,
  type NotesRichTextAnnotationPatch,
} from "$lib/notes/rich-text";
import { planNotesMarkdownInlineShortcutConversion } from "$lib/notes/rich-text-markdown";
import {
  notesRichTextEquationShortcutRequested,
  notesRichTextFormattingShortcutAnnotationName,
  notesRichTextLinkShortcutRequested,
} from "$lib/notes/rich-text-shortcuts";
import {
  nextNotesSlashActiveIndex,
  notesSlashCommandKey,
  notesSlashInputSessionFromText,
  recordRecentNotesSlashCommandKey,
  type NotesSlashAction,
  type NotesSlashCommand,
} from "$lib/notes/slash-commands";
import type {
  NotesBlock,
  NotesBlockType,
  NotesColor,
  NotesRichText,
} from "$lib/notes/types";
import { notesUndoShortcutAction } from "$lib/notes/undo-history";
import {
  loadNotesTextControl,
  retryNotesTextControl,
  type LoadedNotesTextControl,
  type NotesTextControlKind,
} from "./notes-editor-component-registry";

export interface NotesTextEditorRuntimeSource {
  block: () => NotesBlock;
  editableRichText: () => readonly NotesRichText[];
  focusBlockId: () => string | null;
  focusRequestId: () => number;
  focusSelection: () => NotesTextSelection | null;
  contextMenuOpen: () => boolean;
  linkEditorOpen: () => boolean;
  mentionOpen: () => boolean;
  slashOpen: () => boolean;
  templateControlsOpen: () => boolean;
  buttonControlsOpen: () => boolean;
}

export interface NotesTextEditorControllerSource {
  block: () => NotesBlock;
  previousBlockType: () => NotesBlockType | null;
  isOnlyBlock: () => boolean;
  focusBlockId: () => string | null;
  focusRequestId: () => number;
  focusSelection: () => NotesTextSelection | null;
  mentionTargets: () => NotesNamedMentionTarget[];
  locale: () => string;
  translate: Translate;
  onTextInput: (blockId: string, text: string, selection: NotesTextSelection | null) => void;
  onReplaceRichText: (blockId: string, richText: readonly NotesRichText[]) => Promise<void> | void;
  onInsertPageMention: (blockId: string, start: number, end: number, target: NotesPageMentionTarget) => Promise<void> | void;
  onInsertDateMention: (blockId: string, start: number, end: number, target: NotesDateMentionTarget) => Promise<void> | void;
  onInsertObjectMention: (blockId: string, start: number, end: number, target: NotesObjectMentionTarget) => Promise<void> | void;
  onApplyTextLink: (blockId: string, start: number, end: number, url: string | null) => Promise<void> | void;
  onInsertInlineEquation: (blockId: string, start: number, end: number, expression: string) => Promise<void> | void;
  onPastePlainText: (blockId: string, start: number, end: number, plainText: string) => Promise<boolean> | boolean;
  onPasteRichHtml: (blockId: string, start: number, end: number, html: string) => Promise<boolean> | boolean;
  onApplyTextAnnotations: (blockId: string, start: number, end: number, patch: NotesRichTextAnnotationPatch) => Promise<void> | void;
  onCreateInlineComment: (blockId: string, start: number, end: number) => Promise<void> | void;
  onCreateInlineSuggestion: (blockId: string, start: number, end: number) => Promise<void> | void;
  onKeyboardAction: (blockId: string, action: NotesKeyboardAction) => void;
  onUndo: () => Promise<void> | void;
  onRedo: () => Promise<void> | void;
  onConvert: (blockId: string, type: NotesBlockType, clearText?: boolean) => void;
  onConvertToToggleHeading: (blockId: string, type: NotesHeadingBlockType, clearText?: boolean) => void;
  onColorChange: (blockId: string, color: NotesColor) => void;
  onCopyLink: (blockId: string) => Promise<void> | void;
  onDuplicate: (blockId: string) => void;
  onMoveUp: (blockId: string) => void;
  onMoveDown: (blockId: string) => void;
  onDelete: (blockId: string) => void;
  onToggleOpen: (blockId: string, open: boolean) => void;
  onFocusBlock: (blockId: string) => void;
}

export interface NotesTextEditorVisibleControls {
  textContextMenu: boolean;
  linkEditor: boolean;
  mentionMenu: boolean;
  slashMenu: boolean;
  templateControls: boolean;
  buttonControls: boolean;
}

export interface NotesTextInputMenuState {
  slashOpen: boolean;
  mentionQuery: NotesMentionQuery | null;
}

/** Plans mutually exclusive slash and mention menus after a controlled text edit. */
export function planNotesTextInputMenuState(
  value: string,
  selection: NotesTextSelection | null,
  slashWasOpen: boolean,
  canUseMentions: boolean,
): NotesTextInputMenuState {
  const slashOpen = notesSlashInputSessionFromText(value, slashWasOpen).open;
  return {
    slashOpen,
    mentionQuery: slashOpen || !canUseMentions || !selection
      ? null
      : detectPageMentionQuery(value, selection.start, selection.end),
  };
}

/** Returns the independently lazy editor controls required by current UI state. */
export function requestedNotesTextControls(
  visible: NotesTextEditorVisibleControls,
): NotesTextControlKind[] {
  const controls: NotesTextControlKind[] = [];
  if (visible.textContextMenu) controls.push("text-context-menu");
  if (visible.linkEditor) controls.push("link-editor");
  if (visible.mentionMenu) controls.push("mention-menu");
  if (visible.slashMenu) controls.push("slash-menu");
  if (visible.templateControls) controls.push("template-controls");
  if (visible.buttonControls) controls.push("button-controls");
  return controls;
}

/**
 * Owns the DOM-sensitive lifecycle shared by every Notes text control.
 *
 * The controller below owns domain command routing while this DOM runtime owns
 * selection reconciliation, toolbar geometry, composition state, and lazy
 * control loading. Keeping those concerns adjacent prevents delayed component
 * loads from stealing focus or restoring a stale selection.
 */
export class NotesTextEditorRuntime {
  editor: HTMLDivElement | null = $state(null);
  textSelection = $state<NotesTextSelection>({ start: 0, end: 0 });
  compositionActive = $state(false);
  controlLoadStates = $state<Partial<Record<
    NotesTextControlKind,
    LazyComponentLoadState<NotesTextControlKind, LoadedNotesTextControl>
  >>>({});

  #hasTextSelection = false;
  #appliedFocusRequestId = -1;

  constructor(private readonly source: NotesTextEditorRuntimeSource) {
    $effect(() => {
      const requested = requestedNotesTextControls({
        textContextMenu: source.contextMenuOpen(),
        linkEditor: source.linkEditorOpen(),
        mentionMenu: source.mentionOpen(),
        slashMenu: source.slashOpen(),
        templateControls: source.templateControlsOpen(),
        buttonControls: source.buttonControlsOpen(),
      });
      for (const kind of requested) this.requestControl(kind);
    });

    $effect(() => {
      const block = source.block();
      const requestedFocusId = source.focusRequestId();
      const focusRequestedForEditor = source.focusBlockId() === block.id;
      const requestedSelection = source.focusSelection();
      void block.type;
      void block.last_edited_time;
      void source.editableRichText();
      const { selection, selectionIsKnown } = untrack(() => ({
        selection: this.textSelection,
        selectionIsKnown: this.#hasTextSelection,
      }));
      void tick().then(() => {
        if (!this.editor) return;
        const length = notesPlainTextFromEditableRoot(this.editor).length;
        const plan = planNotesSelectionReconciliation({
          focusRequestIsNew: requestedFocusId !== this.#appliedFocusRequestId,
          focusRequestedForEditor,
          requestedSelection,
          currentSelection: selectionIsKnown ? selection : null,
          textLength: length,
          editorActive: document.activeElement === this.editor,
        });
        this.#appliedFocusRequestId = requestedFocusId;
        if (!plan) return;
        if (plan.focusEditor) this.editor.focus();
        this.restoreTrackedSelection(plan.selection);
      });
    });

  }

  requestControl(kind: NotesTextControlKind, retry = false): void {
    const current = this.controlLoadStates[kind] ?? null;
    if (!retry && current?.key === kind) return;
    const loadingState = beginLazyComponentLoad(current, kind);
    const requestedWhileFocused = typeof document !== "undefined" && document.activeElement === this.editor;
    this.controlLoadStates = { ...this.controlLoadStates, [kind]: loadingState };
    const request = retry ? retryNotesTextControl(kind) : loadNotesTextControl(kind);
    void request.then((component) => {
      const latest = this.controlLoadStates[kind];
      if (!latest) return;
      this.controlLoadStates = {
        ...this.controlLoadStates,
        [kind]: resolveLazyComponentLoad(latest, kind, loadingState.requestId, component),
      };
      if (kind === "link-editor") {
        void tick().then(() => {
          if (shouldRestoreNotesEditorFocusAfterLazyLoad({
            requestedWhileFocused,
            stillOwnsFocus: typeof document !== "undefined" && document.activeElement === this.editor,
            compositionActive: this.compositionActive,
          })) {
            this.editor?.focus();
            this.restoreTrackedSelection(this.textSelection);
          }
        });
      }
    }).catch((error: unknown) => {
      const latest = this.controlLoadStates[kind];
      if (!latest) return;
      this.controlLoadStates = {
        ...this.controlLoadStates,
        [kind]: rejectLazyComponentLoad(latest, kind, loadingState.requestId, error),
      };
      console.error(`load Notes ${kind} control failed`, error);
    });
  }

  setTrackedSelection(selection: NotesTextSelection): void {
    this.textSelection = selection;
    this.#hasTextSelection = true;
  }

  restoreTrackedSelection(selection: NotesTextSelection): void {
    if (!this.editor) return;
    const safeSelection = clampNotesTextSelection(
      selection,
      notesPlainTextFromEditableRoot(this.editor).length,
    );
    restoreNotesEditableSelection(this.editor, safeSelection);
    this.setTrackedSelection(safeSelection);
  }

  async focusEditorWithSelection(start: number, end: number): Promise<void> {
    await tick();
    this.editor?.focus();
    if (!this.editor) {
      this.setTrackedSelection({ start, end });
      return;
    }
    this.restoreTrackedSelection({ start, end });
  }
}

export function createNotesTextEditorRuntime(
  source: NotesTextEditorRuntimeSource,
): NotesTextEditorRuntime {
  return new NotesTextEditorRuntime(source);
}

/** Owns all stateful editing, command routing, and DOM reconciliation for one text block. */
export class NotesTextEditorController {
  readonly runtime: NotesTextEditorRuntime;
  #rightClickSelection: NotesTextSelection | null = null;

  slashOpen = $state(false);
  slashActiveIndex = $state(0);
  slashActiveCommand = $state<NotesSlashCommand | null>(null);
  slashItemCount = $state(0);
  mentionQuery = $state<NotesMentionQuery | null>(null);
  mentionActiveIndex = $state(0);
  linkEditorOpen = $state(false);
  linkRange = $state({ start: 0, end: 0, url: null as string | null });
  linkUrlInput = $state("");
  linkError = $state<string | null>(null);
  contextMenuOpen = $state(false);
  contextMenuPoint = $state<{ x: number; y: number } | null>(null);
  contextMenuFocusOnOpen = $state(false);
  inlineEquationErrorReason = $state<NotesInlineEquationConversionError | null>(null);
  templateControlsOpen = $state(false);
  buttonControlsOpen = $state(false);

  constructor(private readonly source: NotesTextEditorControllerSource) {
    this.runtime = createNotesTextEditorRuntime({
      block: source.block,
      editableRichText: () => this.editableRichText,
      focusBlockId: source.focusBlockId,
      focusRequestId: source.focusRequestId,
      focusSelection: source.focusSelection,
      contextMenuOpen: () => this.contextMenuOpen,
      linkEditorOpen: () => this.linkEditorOpen,
      mentionOpen: () => this.mentionOpen,
      slashOpen: () => this.slashOpen,
      templateControlsOpen: () => this.templateControlsOpen,
      buttonControlsOpen: () => this.buttonControlsOpen,
    });

    $effect(() => {
      if (this.mentionActiveIndex >= this.mentionMatches.length) this.mentionActiveIndex = 0;
    });

    $effect(() => {
      void this.slashQuery;
      void this.slashOpen;
      this.slashActiveIndex = 0;
    });
  }

  get block(): NotesBlock { return this.source.block(); }
  get text(): string { return blockPlainText(this.block); }
  get editableRichText(): readonly NotesRichText[] { return blockEditableRichText(this.block); }
  get textSelection(): NotesTextSelection { return this.runtime.textSelection; }
  get canUseMentions(): boolean { return this.block.type !== "code"; }
  get canUseLinks(): boolean { return this.canUseMentions; }
  get canUseInlineFormatting(): boolean { return this.canUseMentions; }
  get currentTextAnnotationRange() {
    return blockTextAnnotationsForSelection(this.block, this.textSelection.start, this.textSelection.end);
  }
  get currentTextLinkRange() {
    return blockTextLinkRangeForSelection(this.block, this.textSelection.start, this.textSelection.end);
  }
  get hasTextSelection(): boolean {
    return this.textSelection.start !== this.textSelection.end;
  }
  get canFormatSelection(): boolean { return this.canUseInlineFormatting && this.hasTextSelection; }
  get canOpenLinkEditor(): boolean {
    return this.canUseLinks && (
      this.textSelection.start !== this.textSelection.end
      || this.currentTextLinkRange.url !== null
      || this.linkEditorOpen
    );
  }
  get currentColor(): NotesColor { return blockColor(this.block); }
  get blockSupportsColor(): boolean { return canBlockHaveColor(this.block.type); }
  get headingToggleable(): boolean {
    return isHeadingBlockType(this.block.type) && headingIsToggleable(this.block);
  }
  get headingOpen(): boolean {
    return !isHeadingBlockType(this.block.type) || headingToggleOpen(this.block);
  }
  get slashInputSession() { return notesSlashInputSessionFromText(this.text, this.slashOpen); }
  get slashQuery(): string { return this.slashInputSession.query; }
  get slashActiveDescendant(): string | undefined {
    return this.slashOpen && this.slashItemCount > 0
      ? notesSlashMenuItemDomId(this.block.id, this.slashActiveIndex)
      : undefined;
  }
  get mentionOpen(): boolean { return this.mentionQuery !== null && this.canUseMentions; }
  get mentionMatches(): NotesMentionTarget[] {
    if (!this.mentionQuery || !this.canUseMentions) return [];
    const t = this.source.translate;
    const dateTargets = buildDateMentionTargets(this.mentionQuery.query, {
      today: Temporal.Now.plainDateISO(),
      locale: this.source.locale(),
      labels: {
        today: t("notes.dateMentionToday"),
        tomorrow: t("notes.dateMentionTomorrow"),
        yesterday: t("notes.dateMentionYesterday"),
        nextWeek: t("notes.dateMentionNextWeek"),
        date: t("notes.dateMention"),
        reminder: t("notes.reminderMention"),
        remindTitle: (dateLabel: string) => t("notes.remindOnDate", dateLabel),
      },
      limit: 4,
    });
    return [
      ...dateTargets,
      ...filterNotesMentionTargets(this.source.mentionTargets(), this.mentionQuery.query),
    ].slice(0, 8);
  }

  closeCompositionSensitiveMenus(): void {
    this.slashOpen = false;
    this.slashActiveIndex = 0;
    this.slashActiveCommand = null;
    this.slashItemCount = 0;
    this.mentionQuery = null;
    this.mentionActiveIndex = 0;
  }

  closeSlashMenu(): void {
    this.slashOpen = false;
    this.slashActiveIndex = 0;
    this.slashActiveCommand = null;
    this.slashItemCount = 0;
  }

  openTemplateControls = (): void => {
    this.templateControlsOpen = true;
    if (this.runtime.controlLoadStates["template-controls"]?.status === "failed") {
      this.runtime.requestControl("template-controls", true);
    }
  };

  openButtonControls = (): void => {
    this.buttonControlsOpen = true;
    if (this.runtime.controlLoadStates["button-controls"]?.status === "failed") {
      this.runtime.requestControl("button-controls", true);
    }
  };

  handleCompositionStart = (): void => {
    this.runtime.compositionActive = true;
    this.closeCompositionSensitiveMenus();
  };

  updateLinkInput = (value: string): void => {
    this.linkUrlInput = value;
    this.linkError = null;
  };

  cancelLinkEditor = (): void => {
    this.linkEditorOpen = false;
  };

  updateSlashActiveIndex = (index: number): void => {
    this.slashActiveIndex = index;
  };

  updateSlashActiveCommand = (command: NotesSlashCommand | null, itemCount: number): void => {
    this.slashActiveCommand = command;
    this.slashItemCount = itemCount;
  };

  async applyTextAnnotationsToRange(
    start: number,
    end: number,
    patch: NotesRichTextAnnotationPatch,
  ): Promise<void> {
    if (start === end) return;
    this.inlineEquationErrorReason = null;
    await Promise.resolve(this.source.onApplyTextAnnotations(this.block.id, start, end, patch));
    await this.runtime.focusEditorWithSelection(start, end);
  }

  inlineEquationErrorMessage(reason: NotesInlineEquationConversionError): string {
    return reason === "selection_required"
      ? this.source.translate("notes.inlineEquationSelectionRequired")
      : this.source.translate("notes.inlineEquationInvalid");
  }

  async applyInlineEquationConversion(plan: NotesInlineEquationConversionPlan): Promise<void> {
    if (plan.type === "error") {
      this.inlineEquationErrorReason = plan.reason;
      this.linkEditorOpen = false;
      this.slashOpen = false;
      this.mentionQuery = null;
      await this.runtime.focusEditorWithSelection(plan.start, plan.end);
      return;
    }
    this.inlineEquationErrorReason = null;
    await Promise.resolve(this.source.onInsertInlineEquation(
      this.block.id,
      plan.start,
      plan.end,
      plan.expression,
    ));
    await this.runtime.focusEditorWithSelection(plan.cursor, plan.cursor);
  }

  insertInlineEquationFromSelection(): void {
    void this.applyInlineEquationConversion(planRichTextEquationConversion(
      this.text,
      this.currentTextAnnotationRange.start,
      this.currentTextAnnotationRange.end,
    ));
  }

  insertInlineEquationFromEditor(target: EventTarget | null): boolean {
    if (!this.canUseInlineFormatting || !(target instanceof HTMLElement)) return false;
    const selection = notesTextSelectionFromEditableRoot(target);
    if (!selection) return false;
    this.syncTextSelection(target);
    void this.applyInlineEquationConversion(
      planRichTextEquationConversion(this.text, selection.start, selection.end),
    );
    return true;
  }

  createInlineCommentFromSelection(): void {
    if (!this.canFormatSelection) return;
    const { start, end } = this.textSelection;
    this.slashOpen = false;
    this.mentionQuery = null;
    void Promise.resolve(this.source.onCreateInlineComment(this.block.id, start, end))
      .then(() => this.runtime.focusEditorWithSelection(start, end));
  }

  createInlineSuggestionFromSelection(): void {
    if (!this.canFormatSelection) return;
    const { start, end } = this.textSelection;
    this.slashOpen = false;
    this.mentionQuery = null;
    void Promise.resolve(this.source.onCreateInlineSuggestion(this.block.id, start, end))
      .then(() => this.runtime.focusEditorWithSelection(start, end));
  }

  toggleTextAnnotation(name: NotesRichTextAnnotationName): void {
    const range = this.currentTextAnnotationRange;
    void this.applyTextAnnotationsToRange(
      range.start,
      range.end,
      richTextAnnotationTogglePatch(range.annotations, name),
    );
  }

  applyTextColor(color: NotesColor): void {
    const range = this.currentTextAnnotationRange;
    void this.applyTextAnnotationsToRange(range.start, range.end, richTextColorPatch(color));
  }

  applyAnnotationShortcut(event: KeyboardEvent): boolean {
    const name = notesRichTextFormattingShortcutAnnotationName(event);
    if (!name || !this.canUseInlineFormatting || !(event.currentTarget instanceof HTMLElement)) {
      return false;
    }
    const selection = notesTextSelectionFromEditableRoot(event.currentTarget);
    if (!selection || selection.start === selection.end) return false;
    const range = blockTextAnnotationsForSelection(this.block, selection.start, selection.end);
    void this.applyTextAnnotationsToRange(
      selection.start,
      selection.end,
      richTextAnnotationTogglePatch(range.annotations, name),
    );
    this.syncTextSelection(event.currentTarget);
    event.preventDefault();
    return true;
  }

  handleKeydown = (event: KeyboardEvent): void => {
    if (shouldLetNativeCompositionHandleKeydown({
      active: this.runtime.compositionActive,
      eventIsComposing: event.isComposing,
      key: event.key,
    })) return;
    const undoAction = notesUndoShortcutAction(event);
    if (undoAction) {
      event.preventDefault();
      void Promise.resolve(undoAction === "undo" ? this.source.onUndo() : this.source.onRedo());
      return;
    }
    if (notesRichTextLinkShortcutRequested(event)) {
      if (this.openLinkEditorFromEditor(event.currentTarget)) event.preventDefault();
      return;
    }
    if (notesRichTextEquationShortcutRequested(event)) {
      if (this.insertInlineEquationFromEditor(event.currentTarget)) event.preventDefault();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && this.headingToggleable) {
      event.preventDefault();
      this.source.onToggleOpen(this.block.id, !this.headingOpen);
      return;
    }
    if (this.applyAnnotationShortcut(event)) return;
    if (this.routeMentionKey(event) || this.routeSlashKey(event)) return;
    const target = event.currentTarget;
    const selection = target instanceof HTMLElement ? notesTextSelectionFromEditableRoot(target) : null;
    const currentText = target instanceof HTMLElement ? notesPlainTextFromEditableRoot(target) : this.text;
    const selectionStart = selection?.start ?? currentText.length;
    const selectionEnd = selection?.end ?? selectionStart;
    const action = planNotesKeyboardAction({
      key: event.key,
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      altKey: event.altKey,
      text: currentText,
      selectionStart,
      selectionEnd,
      blockType: this.block.type,
      previousBlockType: this.source.previousBlockType(),
      isOnlyBlock: this.source.isOnlyBlock(),
    });
    if (action.type === "none") return;
    if (action.type === "insert_newline") {
      event.preventDefault();
      const edit = planNotesControlledTextEdit({
        inputType: "insertLineBreak",
        data: null,
        text: currentText,
        selectionStart,
        selectionEnd,
      });
      if (edit) this.commitPlainTextValue(edit.text, edit.selection);
      return;
    }
    if (action.type === "open_slash_menu") {
      this.slashOpen = true;
      this.mentionQuery = null;
      return;
    }
    if (action.preventDefault) event.preventDefault();
    this.slashOpen = false;
    this.mentionQuery = null;
    this.source.onKeyboardAction(this.block.id, action);
  };

  private routeMentionKey(event: KeyboardEvent): boolean {
    if (!this.mentionOpen) return false;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const count = this.mentionMatches.length;
      this.mentionActiveIndex = count === 0
        ? 0
        : (this.mentionActiveIndex + (event.key === "ArrowDown" ? 1 : count - 1)) % count;
      return true;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      const target = this.mentionMatches[this.mentionActiveIndex];
      if (target) {
        event.preventDefault();
        void this.selectMention(target);
      }
      return true;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      this.mentionQuery = null;
      this.mentionActiveIndex = 0;
      return true;
    }
    return false;
  }

  private routeSlashKey(event: KeyboardEvent): boolean {
    if (!this.slashOpen) return false;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      this.slashActiveIndex = nextNotesSlashActiveIndex(
        this.slashActiveIndex,
        this.slashItemCount,
        event.key === "ArrowDown" ? "next" : "previous",
      );
      return true;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      if (this.slashActiveCommand) this.selectSlashCommand(this.slashActiveCommand);
      return true;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      this.closeSlashMenu();
      return true;
    }
    return false;
  }

  handleBeforeInput = (event: InputEvent): void => {
    if (event.isComposing || this.runtime.compositionActive) return;
    if (event.inputType === "historyUndo" || event.inputType === "historyRedo") {
      event.preventDefault();
      void Promise.resolve(event.inputType === "historyUndo" ? this.source.onUndo() : this.source.onRedo());
      return;
    }
    if (!(event.currentTarget instanceof HTMLElement)) return;
    const currentText = notesPlainTextFromEditableRoot(event.currentTarget);
    const selection = notesTextSelectionFromEditableRoot(event.currentTarget);
    const selectionStart = selection?.start ?? currentText.length;
    const selectionEnd = selection?.end ?? selectionStart;
    if (event.inputType !== "insertParagraph") {
      const edit = planNotesControlledTextEdit({
        inputType: event.inputType,
        data: event.data,
        text: currentText,
        selectionStart,
        selectionEnd,
      });
      if (!edit) return;
      event.preventDefault();
      this.commitPlainTextValue(edit.text, edit.selection);
      return;
    }
    if (this.mentionOpen || this.slashOpen) return;
    const action = planNotesKeyboardAction({
      key: "Enter",
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      text: currentText,
      selectionStart,
      selectionEnd,
      blockType: this.block.type,
      previousBlockType: this.source.previousBlockType(),
      isOnlyBlock: this.source.isOnlyBlock(),
    });
    if (action.type === "insert_newline") {
      const edit = planNotesControlledTextEdit({
        inputType: event.inputType,
        data: event.data,
        text: currentText,
        selectionStart,
        selectionEnd,
      });
      if (!edit) return;
      event.preventDefault();
      this.commitPlainTextValue(edit.text, edit.selection);
      return;
    }
    if (action.type === "none" || action.type === "open_slash_menu") return;
    event.preventDefault();
    this.slashOpen = false;
    this.mentionQuery = null;
    this.source.onKeyboardAction(this.block.id, action);
  };

  updateMentionQueryFromText(plainText: string, selection: NotesTextSelection | null): void {
    if (!this.canUseMentions || !selection) {
      this.mentionQuery = null;
      this.mentionActiveIndex = 0;
      return;
    }
    this.mentionQuery = detectPageMentionQuery(plainText, selection.start, selection.end);
    this.mentionActiveIndex = 0;
  }

  syncTextSelection = (target: EventTarget | null): void => {
    if (!(target instanceof HTMLElement)) return;
    const selection = notesTextSelectionFromEditableRoot(target);
    if (!selection) return;
    this.runtime.setTrackedSelection(selection);
  };

  captureContextMenuSelection = (event: PointerEvent): void => {
    if (event.button !== 2 || !(event.currentTarget instanceof HTMLElement)) return;
    this.#rightClickSelection = null;
    const editor = event.currentTarget;
    const selection = editor.ownerDocument.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
    if (!selection.anchorNode || !selection.focusNode) return;
    if (!editor.contains(selection.anchorNode) || !editor.contains(selection.focusNode)) return;
    const rects = Array.from(selection.getRangeAt(0).getClientRects()).map((rect) => ({
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
    }));
    if (notesTextContextMenuSelectionAtPoint(rects, { x: event.clientX, y: event.clientY })) {
      this.#rightClickSelection = notesTextSelectionFromEditableRoot(editor);
    }
  };

  openContextMenu = (event: MouseEvent): void => {
    if (!(event.currentTarget instanceof HTMLElement)) return;
    event.preventDefault();
    event.stopPropagation();
    const preservedSelection = this.#rightClickSelection;
    this.#rightClickSelection = null;
    this.syncTextSelection(event.currentTarget);
    if (preservedSelection) this.runtime.restoreTrackedSelection(preservedSelection);
    const keyboardPosition = event.clientX === 0 && event.clientY === 0;
    this.contextMenuFocusOnOpen = keyboardPosition;
    if (keyboardPosition) {
      const selection = event.currentTarget.ownerDocument.getSelection();
      const caretRect = selection?.rangeCount && event.currentTarget.contains(selection.anchorNode)
        ? selection.getRangeAt(0).getBoundingClientRect()
        : null;
      const anchor = notesEditableSelectionViewportRect(event.currentTarget)
        ?? (caretRect && (caretRect.width > 0 || caretRect.height > 0)
          ? caretRect
          : event.currentTarget.getBoundingClientRect());
      this.contextMenuPoint = { x: anchor.left, y: anchor.bottom };
    } else {
      this.contextMenuPoint = { x: event.clientX, y: event.clientY };
    }
    this.contextMenuOpen = true;
    this.slashOpen = false;
    this.mentionQuery = null;
  };

  closeContextMenu = (restoreFocus = false): void => {
    this.contextMenuOpen = false;
    if (restoreFocus) {
      const { start, end } = this.textSelection;
      void this.runtime.focusEditorWithSelection(start, end);
    }
  };

  #selectedHtml(): string | null {
    const editor = this.runtime.editor;
    if (!editor) return null;
    const selection = editor.ownerDocument.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
    if (!selection.anchorNode || !selection.focusNode) return null;
    if (!editor.contains(selection.anchorNode) || !editor.contains(selection.focusNode)) return null;
    const container = editor.ownerDocument.createElement("div");
    container.append(selection.getRangeAt(0).cloneContents());
    return container.innerHTML || null;
  }

  copySelectedText = async (): Promise<void> => {
    const { start, end } = this.textSelection;
    if (start === end) return;
    if (!navigator.clipboard) throw new Error("Notes text clipboard is unavailable");
    const plainText = this.text.slice(start, end);
    const html = this.#selectedHtml();
    if (html && navigator.clipboard.write && typeof ClipboardItem !== "undefined") {
      try {
        await navigator.clipboard.write([new ClipboardItem({
          "text/plain": new Blob([plainText], { type: "text/plain" }),
          "text/html": new Blob([html], { type: "text/html" }),
        })]);
        return;
      } catch (error) {
        console.warn("Notes rich clipboard write failed; trying plain text", error);
      }
    }
    await navigator.clipboard.writeText(plainText);
  };

  cutSelectedText = async (): Promise<void> => {
    const { start, end } = this.textSelection;
    if (start === end) return;
    await this.copySelectedText();
    const edit = planNotesControlledTextEdit({
      inputType: "deleteByCut",
      data: null,
      text: this.text,
      selectionStart: start,
      selectionEnd: end,
    });
    if (!edit) return;
    this.source.onTextInput(this.block.id, edit.text, edit.selection);
    await this.runtime.focusEditorWithSelection(edit.selection.start, edit.selection.end);
  };

  pasteFromClipboard = async (plainOnly = false): Promise<void> => {
    if (!navigator.clipboard) throw new Error("Notes text clipboard is unavailable");
    const { start, end } = this.textSelection;
    if (!plainOnly && this.block.type !== "code" && navigator.clipboard.read) {
      let html: string | null = null;
      try {
        const items = await navigator.clipboard.read();
        const htmlItem = items.find((item) => item.types.includes("text/html"));
        if (htmlItem) html = await (await htmlItem.getType("text/html")).text();
      } catch (error) {
        console.warn("Notes rich clipboard read failed; trying plain text", error);
      }
      if (html?.trim() && await Promise.resolve(this.source.onPasteRichHtml(
        this.block.id,
        start,
        end,
        html,
      ))) return;
    }
    const plainText = normalizeNotesClipboardPlainText(await navigator.clipboard.readText());
    if (!plainText) return;
    const handled = await Promise.resolve(this.source.onPastePlainText(
      this.block.id,
      start,
      end,
      plainText,
    ));
    if (handled) return;
    const edit = planNotesControlledTextEdit({
      inputType: "insertText",
      data: plainText,
      text: this.text,
      selectionStart: start,
      selectionEnd: end,
    });
    if (!edit) return;
    this.source.onTextInput(this.block.id, edit.text, edit.selection);
    await this.runtime.focusEditorWithSelection(edit.selection.start, edit.selection.end);
  };

  openLinkEditorFromEditor(target: EventTarget | null): boolean {
    if (!this.canUseLinks || !(target instanceof HTMLElement)) return false;
    this.syncTextSelection(target);
    const selection = notesTextSelectionFromEditableRoot(target);
    if (!selection) return false;
    const range = blockTextLinkRangeForSelection(this.block, selection.start, selection.end);
    if (range.start === range.end && !range.url) return false;
    this.linkRange = range;
    this.linkUrlInput = range.url ?? "";
    this.linkError = null;
    this.inlineEquationErrorReason = null;
    this.linkEditorOpen = true;
    this.slashOpen = false;
    this.mentionQuery = null;
    return true;
  }

  openLinkEditorFromButton = (): void => {
    if (this.runtime.editor) this.openLinkEditorFromEditor(this.runtime.editor);
  };

  applyLinkFromEditor = async (): Promise<void> => {
    const normalizedUrl = normalizeRichTextLinkUrl(this.linkUrlInput);
    if (!normalizedUrl) {
      this.linkError = this.source.translate("notes.linkUrlInvalid");
      return;
    }
    this.linkError = null;
    const { start, end } = this.linkRange;
    await Promise.resolve(this.source.onApplyTextLink(this.block.id, start, end, normalizedUrl));
    this.linkEditorOpen = false;
    await this.runtime.focusEditorWithSelection(start, end);
  };

  removeLinkFromEditor = async (): Promise<void> => {
    this.linkError = null;
    const { start, end } = this.linkRange;
    await Promise.resolve(this.source.onApplyTextLink(this.block.id, start, end, null));
    this.linkEditorOpen = false;
    await this.runtime.focusEditorWithSelection(start, end);
  };

  commitPlainTextValue(value: string, selection: NotesTextSelection | null): void {
    this.inlineEquationErrorReason = null;
    if (selection) this.runtime.setTrackedSelection(selection);
    if (this.canUseInlineFormatting && selection) {
      const nextRichText = replacePlainTextPreservingRichText(this.editableRichText, value);
      const shortcutPlan = planNotesMarkdownInlineShortcutConversion(
        nextRichText,
        selection.start,
        selection.end,
      );
      if (shortcutPlan) {
        this.closeCompositionSensitiveMenus();
        void Promise.resolve(this.source.onReplaceRichText(this.block.id, shortcutPlan.richText))
          .then(() => this.runtime.focusEditorWithSelection(shortcutPlan.cursor, shortcutPlan.cursor))
          .catch((error: unknown) => console.warn("notes inline markdown shortcut failed", error));
        return;
      }
    }
    const menuState = planNotesTextInputMenuState(
      value,
      selection,
      this.slashOpen,
      this.canUseMentions,
    );
    this.slashOpen = menuState.slashOpen;
    this.mentionQuery = menuState.mentionQuery;
    this.mentionActiveIndex = 0;
    this.source.onTextInput(this.block.id, value, selection);
  }

  commitRichTextInput(target: HTMLElement): void {
    this.syncTextSelection(target);
    this.commitPlainTextValue(
      notesPlainTextFromEditableRoot(target),
      notesTextSelectionFromEditableRoot(target),
    );
  }

  handleInput = (event: Event): void => {
    if (!(event.currentTarget instanceof HTMLElement)) return;
    const eventIsComposing = event instanceof InputEvent && event.isComposing;
    if (shouldDeferNotesCompositionInput({
      active: this.runtime.compositionActive,
      eventIsComposing,
    })) {
      this.closeCompositionSensitiveMenus();
      return;
    }
    this.commitRichTextInput(event.currentTarget);
  };

  handleCompositionEnd = (event: CompositionEvent): void => {
    this.runtime.compositionActive = false;
    if (event.currentTarget instanceof HTMLElement) this.commitRichTextInput(event.currentTarget);
  };

  handlePaste = async (event: ClipboardEvent): Promise<void> => {
    if (!(event.currentTarget instanceof HTMLElement)) return;
    const html = event.clipboardData?.getData("text/html") ?? "";
    const selection = notesTextSelectionFromEditableRoot(event.currentTarget);
    if (!selection) return;
    if (html.trim() && this.block.type !== "code") {
      event.preventDefault();
      const handled = await Promise.resolve(
        this.source.onPasteRichHtml(this.block.id, selection.start, selection.end, html),
      );
      if (handled) return;
      await this.runtime.focusEditorWithSelection(selection.start, selection.start);
      return;
    }
    const plainText = normalizeNotesClipboardPlainText(
      event.clipboardData?.getData("text/plain") ?? "",
    );
    if (!plainText) {
      event.preventDefault();
      return;
    }
    if (!shouldHandleNotesPlainTextPaste({
      currentBlockType: this.block.type,
      currentText: this.text,
      selectionStart: selection.start,
      plainText,
    })) {
      event.preventDefault();
      const nextText = `${this.text.slice(0, selection.start)}${plainText}${this.text.slice(selection.end)}`;
      const cursor = selection.start + plainText.length;
      this.source.onTextInput(this.block.id, nextText, { start: cursor, end: cursor });
      await this.runtime.focusEditorWithSelection(cursor, cursor);
      return;
    }
    event.preventDefault();
    const handled = await Promise.resolve(this.source.onPastePlainText(
      this.block.id,
      selection.start,
      selection.end,
      plainText,
    ));
    if (handled) return;
    const nextText = `${this.text.slice(0, selection.start)}${plainText}${this.text.slice(selection.end)}`;
    const cursor = selection.start + plainText.length;
    this.source.onTextInput(this.block.id, nextText, { start: cursor, end: cursor });
    await this.runtime.focusEditorWithSelection(cursor, cursor);
  };

  handleEditorBlur = (): void => {
    this.runtime.compositionActive = false;
    this.slashOpen = false;
    window.setTimeout(() => {
      this.mentionQuery = null;
      this.mentionActiveIndex = 0;
    }, 120);
  };

  handleEditorFocus = (): void => {
    if (this.source.focusBlockId() !== this.block.id) this.source.onFocusBlock(this.block.id);
    this.runtime.requestControl("text-context-menu");
  };

  selectMention = async (target: NotesMentionTarget): Promise<void> => {
    if (!this.mentionQuery) return;
    const cursor = this.mentionQuery.start + target.title.length;
    const range = this.mentionQuery;
    this.mentionQuery = null;
    this.mentionActiveIndex = 0;
    if (target.kind === "page") {
      await Promise.resolve(this.source.onInsertPageMention(this.block.id, range.start, range.end, target));
    } else if (target.kind === "date") {
      await Promise.resolve(this.source.onInsertDateMention(this.block.id, range.start, range.end, target));
    } else {
      await Promise.resolve(this.source.onInsertObjectMention(this.block.id, range.start, range.end, target));
    }
    await this.runtime.focusEditorWithSelection(cursor, cursor);
  };

  clearSlashText(): void {
    if (this.text.startsWith("/")) {
      this.source.onTextInput(this.block.id, "", { start: 0, end: 0 });
    }
  }

  selectSlashCommand = (command: NotesSlashCommand): void => {
    const clearTypedSlashText = this.slashInputSession.open;
    this.closeSlashMenu();
    recordRecentNotesSlashCommandKey(notesSlashCommandKey(command));
    switch (command.kind) {
      case "block":
        if (command.blockType === "child_page" && clearTypedSlashText) this.clearSlashText();
        this.source.onConvert(this.block.id, command.blockType, clearTypedSlashText);
        return;
      case "toggle_heading":
        this.source.onConvertToToggleHeading(this.block.id, command.headingType, clearTypedSlashText);
        return;
      case "action":
        if (command.action !== "delete" && clearTypedSlashText) this.clearSlashText();
        this.runSlashAction(command.action);
        return;
      case "color":
        if (!this.blockSupportsColor) return;
        if (clearTypedSlashText) this.clearSlashText();
        this.source.onColorChange(this.block.id, command.color);
    }
  };

  runSlashAction(action: NotesSlashAction): void {
    switch (action) {
      case "copy_link":
        void Promise.resolve(this.source.onCopyLink(this.block.id))
          .catch((error: unknown) => console.warn("copy notes block link failed", error));
        return;
      case "duplicate": this.source.onDuplicate(this.block.id); return;
      case "move_up": this.source.onMoveUp(this.block.id); return;
      case "move_down": this.source.onMoveDown(this.block.id); return;
      case "delete": this.source.onDelete(this.block.id); return;
    }
  }
}

export function createNotesTextEditorController(
  source: NotesTextEditorControllerSource,
): NotesTextEditorController {
  return new NotesTextEditorController(source);
}

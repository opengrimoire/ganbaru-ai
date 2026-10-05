import { describe, expect, it } from "vitest";
import { parseNotesBlock, parseNotesMentionNotification, parseNotesPageHistorySettings, parseNotesPageHistorySnapshot, parseNotesPageTemplate } from "./validation";
import { baseBlock, basePage, baseRichText } from "./validation.fixtures";

describe("notes collaboration-history boundary validation", () => {
  it("parses mention notification DTOs", () => {
      expect(parseNotesMentionNotification({
        object: "mention_notification",
        id: "notification-a",
        source_type: "comment",
        source_id: "10101010-1010-4010-8010-101010101010",
        page_id: basePage.id,
        page_title: "Inbox",
        block_id: baseBlock.id,
        comment_id: "10101010-1010-4010-8010-101010101010",
        kind: "user_mention",
        target_type: "user",
        target_id: "12121212-1212-4212-8212-121212121212",
        trigger_at: null,
        plain_text: "Alice",
        source_plain_text: "Hi Alice",
        status: "pending",
        delivered_at: null,
        created_time: "2026-07-01T12:00:00.000Z",
        last_edited_time: "2026-07-01T12:00:00.000Z",
      })).toMatchObject({
        source_type: "comment",
        kind: "user_mention",
        target_type: "user",
        status: "pending",
      });
    });

  it("parses page template DTOs", () => {
      const template = parseNotesPageTemplate({
        object: "page_template",
        id: "99999999-9999-4999-8999-999999999999",
        name: "Weekly review",
        source_page_id: basePage.id,
        properties: {
          title: {
            id: "title",
            type: "title",
            title: [baseRichText],
          },
        },
        icon: { type: "emoji", emoji: "📄" },
        cover: null,
        block_count: 3,
        created_time: "2026-07-01T12:00:00.000Z",
        last_edited_time: "2026-07-01T12:00:00.000Z",
      });

      expect(template.name).toBe("Weekly review");
      expect(template.source_page_id).toBe(basePage.id);
      expect(template.block_count).toBe(3);
    });

  it("rejects negative page template block counts", () => {
      expect(() =>
        parseNotesPageTemplate({
          object: "page_template",
          id: "99999999-9999-4999-8999-999999999999",
          name: "Weekly review",
          source_page_id: null,
          properties: {},
          icon: null,
          cover: null,
          block_count: -1,
          created_time: "2026-07-01T12:00:00.000Z",
          last_edited_time: "2026-07-01T12:00:00.000Z",
        }),
      ).toThrow("page template.block_count must not be negative");
    });

  it("parses page history snapshot DTOs", () => {
      const snapshot = parseNotesPageHistorySnapshot({
        object: "page_history_snapshot",
        id: "88888888-8888-4888-8888-888888888888",
        page_id: basePage.id,
        title: "Draft",
        icon: { type: "emoji", emoji: "🕘" },
        cover: null,
        block_count: 4,
        reason: "update_block",
        created_by: { object: "user", id: "70707070-7070-4070-8070-707070707070" },
        created_time: "2026-07-01T12:00:00.000Z",
        page_last_edited_time: "2026-07-01T11:59:00.000Z",
      });

      expect(snapshot.page_id).toBe(basePage.id);
      expect(snapshot.block_count).toBe(4);
      expect(snapshot.reason).toBe("update_block");
      expect(snapshot.created_by.id).toBe("70707070-7070-4070-8070-707070707070");
    });

  it("rejects invalid page history snapshot block counts", () => {
      expect(() =>
        parseNotesPageHistorySnapshot({
          object: "page_history_snapshot",
          id: "88888888-8888-4888-8888-888888888888",
          page_id: basePage.id,
          title: "Draft",
          icon: null,
          cover: null,
          block_count: -1,
          reason: "update_block",
          created_by: { object: "user", id: "70707070-7070-4070-8070-707070707070" },
          created_time: "2026-07-01T12:00:00.000Z",
          page_last_edited_time: "2026-07-01T11:59:00.000Z",
        }),
      ).toThrow("page history snapshot.block_count must not be negative");
    });

  it("parses page history settings DTOs", () => {
      expect(
        parseNotesPageHistorySettings({
          object: "page_history_settings",
          retention_days: 90,
          updated_at: "2026-07-01T12:00:00.000Z",
        }),
      ).toMatchObject({ retention_days: 90 });

      expect(
        parseNotesPageHistorySettings({
          object: "page_history_settings",
          retention_days: 180,
          updated_at: "2026-07-01T12:00:00.000Z",
        }),
      ).toMatchObject({ retention_days: 180 });
    });

  it("accepts disabled history and rejects invalid retention windows", () => {
      expect(
        parseNotesPageHistorySettings({
          object: "page_history_settings",
          retention_days: 0,
          updated_at: "2026-07-01T12:00:00.000Z",
        }),
      ).toMatchObject({ retention_days: 0 });

      expect(() =>
        parseNotesPageHistorySettings({
          object: "page_history_settings",
          retention_days: 14,
          updated_at: "2026-07-01T12:00:00.000Z",
        }),
      ).toThrow("page history settings.retention_days is unsupported");
    });

  it("parses template block payloads", () => {
      const block = parseNotesBlock({
        ...baseBlock,
        type: "template",
        template: {
          rich_text: [baseRichText],
        },
      });

      expect(block.type).toBe("template");
      if (block.type === "template") {
        expect(block.template.rich_text[0]?.plain_text).toBe("Heading");
      }
    });

  it("rejects invalid template rich text payloads", () => {
      expect(() =>
        parseNotesBlock({
          ...baseBlock,
          type: "template",
          template: {
            rich_text: "Add task",
          },
        }),
      ).toThrow("block.template.rich_text must be an array");

      expect(() =>
        parseNotesBlock({
          ...baseBlock,
          type: "template",
          template: {
            rich_text: [baseRichText],
            color: "default",
          },
        }),
      ).toThrow("block.template.color is not supported");

      expect(() =>
        parseNotesBlock({
          ...baseBlock,
          type: "template",
          template: {
            rich_text: [baseRichText],
            children: [],
          },
        }),
      ).toThrow("block.template.children must be stored as child blocks");
    });
});

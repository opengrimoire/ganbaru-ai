import { describe, expect, it } from "vitest";
import {
  buildNotesBlockLink,
  buildNotesPageLink,
  isNotesUuid,
  notesBlockAnchorId,
  parseNotesBlockLinkHash,
  parseNotesLinkHash,
} from "./block-link";

const pageId = "11111111-1111-4111-8111-111111111111";
const blockId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("notes block links", () => {
  it("builds local notes links with page and block anchors", () => {
    expect(
      buildNotesBlockLink("http://localhost:1420/?view=calendar", { pageId, blockId }),
    ).toBe(
      "http://localhost:1420/?view=notes#notes?page=11111111-1111-4111-8111-111111111111&block=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );
  });

  it("builds local notes page links", () => {
    expect(buildNotesPageLink("http://localhost:1420/?view=calendar", { pageId })).toBe(
      "http://localhost:1420/?view=notes#notes?page=11111111-1111-4111-8111-111111111111",
    );
  });

  it("removes detached window search state from copied links", () => {
    expect(
      buildNotesBlockLink("http://localhost:1420/?ganbaruWindow=notes&view=notes", {
        pageId,
        blockId,
      }),
    ).not.toContain("ganbaruWindow");
  });

  it("parses valid notes block hashes", () => {
    expect(
      parseNotesBlockLinkHash(
        "#notes?page=11111111-1111-4111-8111-111111111111&block=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      ),
    ).toEqual({ pageId, blockId });
  });

  it("parses valid notes page hashes", () => {
    expect(parseNotesLinkHash("#notes?page=11111111-1111-4111-8111-111111111111")).toEqual({
      pageId,
    });
  });

  it("rejects malformed notes block hashes", () => {
    expect(parseNotesBlockLinkHash("#notes?page=bad&block=bad")).toBeNull();
    expect(parseNotesBlockLinkHash("#notes?page=11111111-1111-4111-8111-111111111111")).toBeNull();
    expect(parseNotesBlockLinkHash("#calendar")).toBeNull();
  });

  it("validates UUID shaped ids", () => {
    expect(isNotesUuid(pageId)).toBe(true);
    expect(isNotesUuid("page-a")).toBe(false);
  });

  it("creates DOM-safe anchor ids", () => {
    expect(notesBlockAnchorId("block/a b")).toBe("notes-block-block_a_b");
  });
});

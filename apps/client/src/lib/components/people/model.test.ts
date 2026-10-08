import { describe, expect, it } from "vitest";
import {
  CONTACT_CARD_MATRIX_SIZE,
  PEOPLE_CAPABILITIES,
  capabilitiesForRole,
  contactCardCode,
  contactCardMatrix,
  verificationCode,
} from "./model";

describe("capabilitiesForRole", () => {
  it("nests the presets so each role narrows the one above it", () => {
    const owner = capabilitiesForRole("owner");
    const administrator = capabilitiesForRole("administrator");
    const member = capabilitiesForRole("member");
    const guest = capabilitiesForRole("guest");

    expect([...owner].sort()).toEqual(PEOPLE_CAPABILITIES.map((capability) => capability.id).sort());
    expect([...administrator]).toEqual([...owner]);
    for (const capability of member) expect(administrator.has(capability)).toBe(true);
    for (const capability of guest) expect(member.has(capability)).toBe(true);
    expect(guest.size).toBeLessThan(member.size);
    expect(member.size).toBeLessThan(administrator.size);
  });

  it("keeps management capabilities away from members and guests", () => {
    const management = PEOPLE_CAPABILITIES.filter((capability) => capability.group === "management");
    expect(management.length).toBeGreaterThan(0);
    for (const capability of management) {
      expect(capabilitiesForRole("member").has(capability.id)).toBe(false);
      expect(capabilitiesForRole("guest").has(capability.id)).toBe(false);
    }
  });

  it("prefills a custom role from the member preset", () => {
    expect([...capabilitiesForRole("custom")]).toEqual([...capabilitiesForRole("member")]);
  });
});

describe("contactCardCode", () => {
  it("formats a prefixed, grouped, unambiguous code", () => {
    expect(contactCardCode("vault:1")).toMatch(/^GANB(-[0-9A-HJKMNP-TV-Z]{4}){4}$/);
  });

  it("is stable for one seed and differs between seeds", () => {
    expect(contactCardCode("vault:1")).toBe(contactCardCode("vault:1"));
    expect(contactCardCode("vault:1")).not.toBe(contactCardCode("vault:2"));
  });
});

describe("verificationCode", () => {
  it("formats three digit groups that ignore surrounding whitespace and letter case", () => {
    expect(verificationCode("ganb-abcd")).toMatch(/^\d{4} \d{4} \d{4}$/);
    expect(verificationCode("  ganb-abcd ")).toBe(verificationCode("GANB-ABCD"));
    expect(verificationCode("GANB-ABCD")).not.toBe(verificationCode("GANB-ABCE"));
  });
});

describe("contactCardMatrix", () => {
  it("fills a square grid with finder patterns in three corners", () => {
    const { modules, width } = contactCardMatrix("vault:1");
    const at = (row: number, column: number) => modules[row * width + column];

    expect(width).toBe(CONTACT_CARD_MATRIX_SIZE);
    expect(modules).toHaveLength(width * width);
    for (const [top, left] of [[0, 0], [0, width - 7], [width - 7, 0]]) {
      expect(at(top, left)).toBe(true);
      expect(at(top + 1, left + 1)).toBe(false);
      expect(at(top + 3, left + 3)).toBe(true);
      expect(at(top + 6, left + 6)).toBe(true);
    }
    expect(at(7, 7)).toBe(false);
  });

  it("derives the data area from the seed", () => {
    const first = contactCardMatrix("vault:1").modules;
    const second = contactCardMatrix("vault:2").modules;
    expect(first).toEqual(contactCardMatrix("vault:1").modules);
    expect(first).not.toEqual(second);
    expect(first.some(Boolean)).toBe(true);
    expect(first.some((module) => !module)).toBe(true);
  });
});

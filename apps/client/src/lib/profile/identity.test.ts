import { describe, expect, it } from "vitest";
import { profileInitials } from "./identity";

describe("profile identity", () => {
  it("uses at most the first two name words for initials", () => {
    expect(profileInitials("You")).toBe("Y");
    expect(profileInitials("Alice Rivera")).toBe("AR");
    expect(profileInitials("  Ana Maria Lopez  ")).toBe("AM");
    expect(profileInitials("")).toBe("?");
  });
});

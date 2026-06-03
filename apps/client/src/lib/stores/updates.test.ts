import { describe, expect, it } from "vitest";
import {
  parseStoredUpdateCheckAt,
  releasePageUrl,
  shouldRunAutomaticUpdateCheck,
  UPDATE_AUTO_CHECK_INTERVAL_MS,
} from "./updates";

describe("automatic update checks", () => {
  it("runs when enabled and no previous check exists", () => {
    expect(shouldRunAutomaticUpdateCheck(true, null, Date.UTC(2026, 0, 2))).toBe(true);
  });

  it("does not run when disabled", () => {
    expect(shouldRunAutomaticUpdateCheck(false, null, Date.UTC(2026, 0, 2))).toBe(false);
  });

  it("waits until the daily interval has elapsed", () => {
    const now = Date.UTC(2026, 0, 2);
    const recent = new Date(now - UPDATE_AUTO_CHECK_INTERVAL_MS + 1).toISOString();
    const old = new Date(now - UPDATE_AUTO_CHECK_INTERVAL_MS).toISOString();

    expect(shouldRunAutomaticUpdateCheck(true, recent, now)).toBe(false);
    expect(shouldRunAutomaticUpdateCheck(true, old, now)).toBe(true);
  });

  it("runs when the stored timestamp is invalid or in the future", () => {
    const now = Date.UTC(2026, 0, 2);
    expect(shouldRunAutomaticUpdateCheck(true, "invalid", now)).toBe(true);
    expect(
      shouldRunAutomaticUpdateCheck(
        true,
        new Date(now + UPDATE_AUTO_CHECK_INTERVAL_MS).toISOString(),
        now,
      ),
    ).toBe(true);
  });

  it("normalizes valid stored timestamps", () => {
    expect(parseStoredUpdateCheckAt("2026-01-02T03:04:05.000Z")).toBe(
      "2026-01-02T03:04:05.000Z",
    );
    expect(parseStoredUpdateCheckAt("nope")).toBeNull();
    expect(parseStoredUpdateCheckAt(null)).toBeNull();
  });

  it("builds a GitHub release page URL from a valid updater version", () => {
    expect(releasePageUrl("opengrimoire/ganbaru-ai", "0.1.0")).toBe(
      "https://github.com/opengrimoire/ganbaru-ai/releases/tag/app-v0.1.0",
    );
  });

  it("rejects release page inputs that should not open external URLs", () => {
    expect(releasePageUrl("opengrimoire/ganbaru-ai", "../0.1.0")).toBeNull();
    expect(releasePageUrl("https://github.com/opengrimoire/ganbaru-ai", "0.1.0")).toBeNull();
    expect(releasePageUrl("opengrimoire/ganbaru-ai", null)).toBeNull();
  });
});

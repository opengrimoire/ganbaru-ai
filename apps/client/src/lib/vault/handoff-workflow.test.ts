import { describe, expect, it } from "vitest";
import type { Translate } from "$lib/i18n/translator.svelte";
import { formatHandoffError } from "./handoff-workflow";

const t = ((key: string, value?: string) => value ? `${key}:${value}` : key) as Translate;

describe("formatHandoffError", () => {
  it("turns ownership blockers into direct recovery guidance", () => {
    expect(formatHandoffError("active Chat work blocks vault handoff", t)).toBe(
      "vaultHandoff.blockerChat",
    );
    expect(formatHandoffError("active Pomodoro run blocks handoff", t)).toBe(
      "vaultHandoff.blockerFocus",
    );
  });

  it("turns coordinator failures into same-network retry guidance", () => {
    expect(formatHandoffError(new Error("connect coordinator: refused"), t)).toBe(
      "vaultHandoff.unreachable",
    );
  });
});

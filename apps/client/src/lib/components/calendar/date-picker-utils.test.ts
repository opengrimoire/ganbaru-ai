import { describe, expect, it } from "vitest";
import { buildCalendarGrid } from "./date-picker-utils";

describe("buildCalendarGrid", () => {
  it("starts weeks on Monday and fills outside-month days", () => {
    const days = buildCalendarGrid(2021, 5, "2021-05-12");

    expect(days).toHaveLength(42);
    expect(days[0]).toMatchObject({
      day: 26,
      dateStr: "2021-04-26",
      currentMonth: false,
    });
    expect(days[5]).toMatchObject({
      day: 1,
      dateStr: "2021-05-01",
      currentMonth: true,
    });
  });

  it("marks only the selected date", () => {
    const days = buildCalendarGrid(2024, 1, "2024-01-15");

    expect(days.filter((day) => day.selected).map((day) => day.dateStr)).toEqual([
      "2024-01-15",
    ]);
  });
});

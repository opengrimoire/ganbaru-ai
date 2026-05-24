import { describe, expect, it } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import type { CalendarEvent } from "./types";
import { buildRecurringCommitPlan, type RecurringCommitPlan } from "./recurrence-edit-plan";
import {
  executeRecurrenceCommitPlan,
  type RecurrenceEditCalendarStore,
  type RecurrenceEditPomodoroBridge,
} from "./recurrence-edit-executor";

type StoreCall = {
  type: string;
  detail?: unknown;
};

function makeTemplate(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "tmpl1",
    title: "Daily standup",
    start: "2027-06-15 09:00",
    end: "2027-06-15 09:30",
    timezone: "America/New_York",
    calendarId: "local",
    recurrence: { frequency: "daily", interval: 1, end: { type: "never" } },
    ...overrides,
  };
}

function makeInstance(template: CalendarEvent, date: string): CalendarEvent {
  return {
    ...template,
    id: `${template.id}::${date}`,
    start: `${date} ${template.start.split(" ")[1]}`,
    end: `${date} ${template.end.split(" ")[1]}`,
    recurringParentId: template.id,
  };
}

class FakeCalendarStore implements RecurrenceEditCalendarStore {
  readonly calls: StoreCall[] = [];
  readonly templates = new Map<string, CalendarEvent>();
  #detachCount = 0;
  #splitCount = 0;

  constructor(template: CalendarEvent) {
    this.templates.set(template.id, template);
  }

  beginBatch(): void {
    this.calls.push({ type: "beginBatch" });
  }

  endBatch(): void {
    this.calls.push({ type: "endBatch" });
  }

  async detachInstance(instanceEvent: CalendarEvent): Promise<CalendarEvent> {
    this.calls.push({ type: "detachInstance", detail: instanceEvent.id });
    this.#detachCount += 1;
    return {
      ...instanceEvent,
      id: `detached-${this.#detachCount}`,
      recurringParentId: undefined,
      recurrence: undefined,
    };
  }

  async setRepeatUntil(parentId: string, date: string): Promise<void> {
    this.calls.push({ type: "setRepeatUntil", detail: { parentId, date } });
  }

  async splitSeries(
    instanceEvent: CalendarEvent,
    changes: Partial<CalendarEvent>,
  ): Promise<CalendarEvent> {
    this.calls.push({ type: "splitSeries", detail: { instanceId: instanceEvent.id, changes } });
    this.#splitCount += 1;
    return {
      ...instanceEvent,
      ...changes,
      id: `split-${this.#splitCount}`,
      recurringParentId: undefined,
    };
  }

  async updateBlock(patch: Partial<CalendarEvent> & { id: string }): Promise<void> {
    this.calls.push({ type: "updateBlock", detail: patch });
    const existing = this.templates.get(patch.id);
    if (existing) this.templates.set(patch.id, { ...existing, ...patch });
  }

  getTemplate(event: CalendarEvent): CalendarEvent | undefined {
    return this.templates.get(event.recurringParentId ?? event.id);
  }

  async protectHistoricalSegments(
    templateId: string,
    cutoffDate: string,
    excludeDate?: string,
  ): Promise<string[]> {
    this.calls.push({ type: "protectHistoricalSegments", detail: { templateId, cutoffDate, excludeDate } });
    return [];
  }

  async refreshWindow(windowStart: Temporal.PlainDate, windowEnd: Temporal.PlainDate): Promise<void> {
    this.calls.push({ type: "refreshWindow", detail: { start: windowStart.toString(), end: windowEnd.toString() } });
  }
}

class FakePomodoro implements RecurrenceEditPomodoroBridge {
  readonly transfers: Array<{ id: string; end?: string }> = [];

  transferBlockId(newBlockId: string, newEndTime?: string): void {
    this.transfers.push({ id: newBlockId, end: newEndTime });
  }
}

async function execute(plan: RecurringCommitPlan, store: FakeCalendarStore, pomodoro = new FakePomodoro()) {
  await executeRecurrenceCommitPlan(plan, {
    calendarStore: store,
    pomodoro,
    window: {
      start: Temporal.PlainDate.from("2027-06-01"),
      end: Temporal.PlainDate.from("2027-06-30"),
    },
  });
  return pomodoro;
}

describe("executeRecurrenceCommitPlan", () => {
  it("executes only-this detach, update, transfer, and refresh operations", async () => {
    const template = makeTemplate();
    const inst20 = makeInstance(template, "2027-06-20");
    const store = new FakeCalendarStore(template);
    const plan = buildRecurringCommitPlan({
      rawBlocks: [template],
      templateId: template.id,
      instanceEvent: inst20,
      changes: { title: "Changed", recurrence: undefined },
      scope: "this",
      activeBlockId: inst20.id,
      today: "2027-06-10",
      currentTime: "12:00",
    });

    const pomodoro = await execute(plan, store);

    expect(store.calls.map((call) => call.type)).toEqual([
      "beginBatch",
      "detachInstance",
      "updateBlock",
      "endBatch",
      "refreshWindow",
    ]);
    expect(pomodoro.transfers).toEqual([{ id: "detached-1", end: "2027-06-20 09:30" }]);
  });

  it("executes only-this active move as one detached occurrence", async () => {
    const template = makeTemplate({
      start: "2026-03-20 09:00",
      end: "2026-03-20 13:00",
    });
    const active = makeInstance(template, "2026-03-20");
    const store = new FakeCalendarStore(template);
    const plan = buildRecurringCommitPlan({
      rawBlocks: [template],
      templateId: template.id,
      instanceEvent: active,
      changes: { start: "2026-03-20 11:00", end: "2026-03-20 15:00" },
      scope: "this",
      activeBlockId: active.id,
      today: "2026-03-20",
      currentTime: "10:30",
    });

    const pomodoro = await execute(plan, store);

    expect(store.calls.map((call) => call.type)).toEqual([
      "beginBatch",
      "detachInstance",
      "updateBlock",
      "endBatch",
      "refreshWindow",
    ]);
    expect(store.calls[2]).toMatchObject({
      type: "updateBlock",
      detail: { id: "detached-1", start: "2026-03-20 11:00", end: "2026-03-20 15:00" },
    });
    expect(pomodoro.transfers).toEqual([{ id: "detached-1", end: "2026-03-20 15:00" }]);
  });

  it("executes following clear by materializing an active later occurrence before splitting", async () => {
    const template = makeTemplate();
    const inst20 = makeInstance(template, "2027-06-20");
    const store = new FakeCalendarStore(template);
    const plan = buildRecurringCommitPlan({
      rawBlocks: [template],
      templateId: template.id,
      instanceEvent: inst20,
      changes: { recurrence: undefined },
      scope: "following",
      activeBlockId: `${template.id}::2027-06-22`,
      today: "2027-06-10",
      currentTime: "12:00",
    });

    const pomodoro = await execute(plan, store);

    expect(store.calls.map((call) => call.type)).toEqual([
      "beginBatch",
      "detachInstance",
      "splitSeries",
      "endBatch",
      "refreshWindow",
    ]);
    expect(pomodoro.transfers).toEqual([{ id: "detached-1", end: "2027-06-22 09:30" }]);
  });

  it("executes following active selected clear as only-this", async () => {
    const template = makeTemplate();
    const inst20 = makeInstance(template, "2027-06-20");
    const store = new FakeCalendarStore(template);
    const plan = buildRecurringCommitPlan({
      rawBlocks: [template],
      templateId: template.id,
      instanceEvent: inst20,
      changes: { recurrence: undefined },
      scope: "following",
      activeBlockId: inst20.id,
      today: "2027-06-10",
      currentTime: "12:00",
    });

    const pomodoro = await execute(plan, store);

    expect(store.calls.map((call) => call.type)).toEqual([
      "beginBatch",
      "detachInstance",
      "updateBlock",
      "endBatch",
      "refreshWindow",
    ]);
    expect(pomodoro.transfers).toEqual([{ id: "detached-1", end: "2027-06-20 09:30" }]);
  });

  it("executes following active selected resize as only-this", async () => {
    const template = makeTemplate();
    const inst20 = makeInstance(template, "2027-06-20");
    const store = new FakeCalendarStore(template);
    const plan = buildRecurringCommitPlan({
      rawBlocks: [template],
      templateId: template.id,
      instanceEvent: inst20,
      changes: { end: "2027-06-20 10:15" },
      scope: "following",
      activeBlockId: inst20.id,
      today: "2027-06-20",
      currentTime: "09:15",
    });

    const pomodoro = await execute(plan, store);

    expect(store.calls.map((call) => call.type)).toEqual([
      "beginBatch",
      "detachInstance",
      "updateBlock",
      "endBatch",
      "refreshWindow",
    ]);
    expect(store.calls[2]).toMatchObject({
      type: "updateBlock",
      detail: {
        id: "detached-1",
        end: "2027-06-20 10:15",
      },
    });
    expect(pomodoro.transfers).toEqual([{ id: "detached-1", end: "2027-06-20 10:15" }]);
  });

  it("executes all recurrence change by protecting history before template update", async () => {
    const template = makeTemplate({
      start: "2027-01-01 09:00",
      end: "2027-01-01 09:30",
    });
    const inst20 = makeInstance(template, "2027-06-20");
    const store = new FakeCalendarStore(template);
    const plan = buildRecurringCommitPlan({
      rawBlocks: [template],
      templateId: template.id,
      instanceEvent: inst20,
      changes: { recurrence: { frequency: "weekly", interval: 1, end: { type: "never" } } },
      scope: "all",
      today: "2027-06-10",
      currentTime: "12:00",
    });

    await execute(plan, store);

    expect(store.calls.map((call) => call.type)).toEqual([
      "beginBatch",
      "protectHistoricalSegments",
      "splitSeries",
      "endBatch",
      "refreshWindow",
    ]);
  });

  it("executes all active selected resize as only-this", async () => {
    const template = makeTemplate({
      start: "2027-06-20 09:00",
      end: "2027-06-20 09:30",
    });
    const store = new FakeCalendarStore(template);
    const plan = buildRecurringCommitPlan({
      rawBlocks: [template],
      templateId: template.id,
      instanceEvent: template,
      changes: { end: "2027-06-20 10:15" },
      scope: "all",
      activeBlockId: template.id,
      today: "2027-06-20",
      currentTime: "09:15",
    });

    const pomodoro = await execute(plan, store);

    expect(store.calls.map((call) => call.type)).toEqual([
      "beginBatch",
      "detachInstance",
      "updateBlock",
      "endBatch",
      "refreshWindow",
    ]);
    expect(store.calls[2]).toMatchObject({
      type: "updateBlock",
      detail: {
        id: "detached-1",
        end: "2027-06-20 10:15",
      },
    });
    expect(pomodoro.transfers).toEqual([{ id: "detached-1", end: "2027-06-20 10:15" }]);
  });

  it("executes all active selected move as only-this", async () => {
    const template = makeTemplate({
      start: "2027-06-20 09:00",
      end: "2027-06-20 09:30",
    });
    const store = new FakeCalendarStore(template);
    const plan = buildRecurringCommitPlan({
      rawBlocks: [template],
      templateId: template.id,
      instanceEvent: template,
      changes: { start: "2027-06-20 11:00", end: "2027-06-20 12:00" },
      scope: "all",
      activeBlockId: template.id,
      today: "2027-06-20",
      currentTime: "09:15",
    });

    const pomodoro = await execute(plan, store);

    expect(store.calls.map((call) => call.type)).toEqual([
      "beginBatch",
      "detachInstance",
      "updateBlock",
      "endBatch",
      "refreshWindow",
    ]);
    expect(store.calls[2]).toMatchObject({
      type: "updateBlock",
      detail: { id: "detached-1", start: "2027-06-20 11:00", end: "2027-06-20 12:00" },
    });
    expect(pomodoro.transfers).toEqual([{ id: "detached-1", end: "2027-06-20 12:00" }]);
  });

  it("executes all future edit by continuing the edited chain from protected active", async () => {
    const template = makeTemplate({
      start: "2026-05-18 20:20",
      end: "2026-05-18 23:20",
    });
    const selected = makeInstance(template, "2026-05-24");
    const store = new FakeCalendarStore(template);
    const plan = buildRecurringCommitPlan({
      rawBlocks: [template],
      templateId: template.id,
      instanceEvent: selected,
      changes: { title: "Changed" },
      scope: "all",
      activeBlockId: `${template.id}::2026-05-23`,
      today: "2026-05-23",
      currentTime: "21:00",
    });

    const pomodoro = await execute(plan, store);

    expect(store.calls.map((call) => call.type)).toEqual([
      "beginBatch",
      "protectHistoricalSegments",
      "splitSeries",
      "endBatch",
      "refreshWindow",
    ]);
    expect(store.calls[1]).toEqual({
      type: "protectHistoricalSegments",
      detail: { templateId: template.id, cutoffDate: "2026-05-24", excludeDate: undefined },
    });
    expect(store.calls[2]).toMatchObject({
      type: "splitSeries",
      detail: {
        instanceId: `${template.id}::2026-05-24`,
        changes: { title: "Changed" },
      },
    });
    expect(pomodoro.transfers).toEqual([]);
  });

  it("executes all future move after now without changing active", async () => {
    const template = makeTemplate({
      start: "2026-05-18 09:00",
      end: "2026-05-18 13:00",
    });
    const selected = makeInstance(template, "2026-05-19");
    const store = new FakeCalendarStore(template);
    const plan = buildRecurringCommitPlan({
      rawBlocks: [template],
      templateId: template.id,
      instanceEvent: selected,
      changes: { start: "2026-05-19 14:00", end: "2026-05-19 18:00" },
      scope: "all",
      activeBlockId: template.id,
      today: "2026-05-18",
      currentTime: "10:30",
    });

    const pomodoro = await execute(plan, store);

    expect(store.calls.map((call) => call.type)).toEqual([
      "beginBatch",
      "protectHistoricalSegments",
      "splitSeries",
      "endBatch",
      "refreshWindow",
    ]);
    expect(store.calls[1]).toEqual({
      type: "protectHistoricalSegments",
      detail: { templateId: template.id, cutoffDate: "2026-05-19", excludeDate: undefined },
    });
    expect(store.calls[2]).toMatchObject({
      type: "splitSeries",
      detail: {
        instanceId: `${template.id}::2026-05-19`,
        changes: { start: "2026-05-19 14:00", end: "2026-05-19 18:00" },
      },
    });
    expect(pomodoro.transfers).toEqual([]);
  });

  it("executes all future move outside protected active without changing active", async () => {
    const template = makeTemplate({
      start: "2026-05-18 20:20",
      end: "2026-05-18 23:20",
    });
    const selected = makeInstance(template, "2026-05-24");
    const store = new FakeCalendarStore(template);
    const plan = buildRecurringCommitPlan({
      rawBlocks: [template],
      templateId: template.id,
      instanceEvent: selected,
      changes: { start: "2026-05-24 10:00", end: "2026-05-24 11:00" },
      scope: "all",
      activeBlockId: `${template.id}::2026-05-23`,
      today: "2026-05-23",
      currentTime: "21:00",
    });

    const pomodoro = await execute(plan, store);

    expect(store.calls.map((call) => call.type)).toEqual([
      "beginBatch",
      "protectHistoricalSegments",
      "splitSeries",
      "endBatch",
      "refreshWindow",
    ]);
    expect(store.calls[1]).toEqual({
      type: "protectHistoricalSegments",
      detail: { templateId: template.id, cutoffDate: "2026-05-24", excludeDate: undefined },
    });
    expect(store.calls[2]).toMatchObject({
      type: "splitSeries",
      detail: {
        instanceId: `${template.id}::2026-05-24`,
        changes: { start: "2026-05-24 10:00", end: "2026-05-24 11:00" },
      },
    });
    expect(pomodoro.transfers).toEqual([]);
  });

  it("executes future-only all clear as a template collapse", async () => {
    const template = makeTemplate();
    const inst20 = makeInstance(template, "2027-06-20");
    const store = new FakeCalendarStore(template);
    const plan = buildRecurringCommitPlan({
      rawBlocks: [template],
      templateId: template.id,
      instanceEvent: inst20,
      changes: { recurrence: undefined },
      scope: "all",
      today: "2027-06-10",
      currentTime: "12:00",
    });

    await execute(plan, store);

    expect(store.calls.map((call) => call.type)).toEqual([
      "beginBatch",
      "updateBlock",
      "endBatch",
      "refreshWindow",
    ]);
  });

  it("executes all clear with protected history by capping before mutable occurrences and detaching the survivor", async () => {
    const template = makeTemplate({
      start: "2026-05-11 08:00",
      end: "2026-05-11 09:00",
    });
    const inst17 = makeInstance(template, "2026-05-17");
    const store = new FakeCalendarStore(template);
    const plan = buildRecurringCommitPlan({
      rawBlocks: [template],
      templateId: template.id,
      instanceEvent: inst17,
      changes: { recurrence: undefined },
      scope: "all",
      today: "2026-05-15",
      currentTime: "21:00",
    });

    await execute(plan, store);

    expect(store.calls.map((call) => call.type)).toEqual([
      "beginBatch",
      "protectHistoricalSegments",
      "setRepeatUntil",
      "detachInstance",
      "updateBlock",
      "endBatch",
      "refreshWindow",
    ]);
    expect(store.calls[2]).toEqual({
      type: "setRepeatUntil",
      detail: { parentId: template.id, date: "2026-05-15" },
    });
    expect(store.calls[3]).toEqual({
      type: "detachInstance",
      detail: inst17.id,
    });
  });
});

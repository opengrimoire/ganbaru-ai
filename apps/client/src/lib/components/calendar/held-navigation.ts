export type HeldNavigationKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";
export type HeldNavigationDirection = "forward" | "back";

export type HeldNavigationEvent =
  | { type: "hold-start"; key: HeldNavigationKey; direction: HeldNavigationDirection }
  | { type: "hold-stop"; key: HeldNavigationKey; repeats: number }
  | { type: "repeat-wait"; key: HeldNavigationKey; repeats: number }
  | { type: "repeat"; key: HeldNavigationKey; direction: HeldNavigationDirection; repeats: number }
  | { type: "repeat-cancelled"; key: HeldNavigationKey; stage: "delay" | "settle" };

type TimerId = ReturnType<typeof setTimeout>;

export interface HeldNavigationControllerOptions {
  holdDelayMs: number;
  repeatMs: number;
  navigate: (direction: HeldNavigationDirection, source: "key" | "hold-repeat") => void;
  waitUntilSettled: () => Promise<void>;
  mark?: (event: HeldNavigationEvent) => void;
  setTimer?: (callback: () => void, delayMs: number) => TimerId;
  clearTimer?: (id: TimerId) => void;
}

export class HeldNavigationController {
  readonly #holdDelayMs: number;
  readonly #repeatMs: number;
  readonly #navigate: HeldNavigationControllerOptions["navigate"];
  readonly #waitUntilSettled: () => Promise<void>;
  readonly #mark?: (event: HeldNavigationEvent) => void;
  readonly #setTimer: (callback: () => void, delayMs: number) => TimerId;
  readonly #clearTimer: (id: TimerId) => void;

  #key: HeldNavigationKey | null = null;
  #direction: HeldNavigationDirection | null = null;
  #holdTimer: TimerId | null = null;
  #repeatTimer: TimerId | null = null;
  #generation = 0;
  #repeats = 0;

  constructor(opts: HeldNavigationControllerOptions) {
    this.#holdDelayMs = opts.holdDelayMs;
    this.#repeatMs = opts.repeatMs;
    this.#navigate = opts.navigate;
    this.#waitUntilSettled = opts.waitUntilSettled;
    this.#mark = opts.mark;
    this.#setTimer = opts.setTimer ?? setTimeout;
    this.#clearTimer = opts.clearTimer ?? clearTimeout;
  }

  get activeKey(): HeldNavigationKey | null {
    return this.#key;
  }

  start(key: HeldNavigationKey, direction: HeldNavigationDirection): void {
    if (this.#key === key) return;
    if (this.#key !== null) this.stop();

    this.#generation++;
    const generation = this.#generation;
    this.#key = key;
    this.#direction = direction;
    this.#repeats = 0;
    this.#mark?.({ type: "hold-start", key, direction });
    this.#navigate(direction, "key");

    this.#holdTimer = this.#setTimer(() => {
      this.#holdTimer = null;
      if (!this.#isActive(generation)) {
        this.#mark?.({ type: "repeat-cancelled", key, stage: "delay" });
        return;
      }
      void this.#runRepeat(generation, key);
    }, this.#holdDelayMs);
  }

  stop(key?: HeldNavigationKey): HeldNavigationKey | null {
    if (key && this.#key !== key) return null;
    const stoppedKey = this.#key;
    if (stoppedKey === null) return null;

    this.#generation++;
    this.#key = null;
    this.#direction = null;
    this.#clearTimers();
    this.#mark?.({ type: "hold-stop", key: stoppedKey, repeats: this.#repeats });
    return stoppedKey;
  }

  #clearTimers(): void {
    if (this.#holdTimer !== null) {
      this.#clearTimer(this.#holdTimer);
      this.#holdTimer = null;
    }
    if (this.#repeatTimer !== null) {
      this.#clearTimer(this.#repeatTimer);
      this.#repeatTimer = null;
    }
  }

  #isActive(generation: number): boolean {
    return this.#generation === generation && this.#key !== null && this.#direction !== null;
  }

  async #runRepeat(generation: number, key: HeldNavigationKey): Promise<void> {
    if (!this.#isActive(generation)) {
      this.#mark?.({ type: "repeat-cancelled", key, stage: "delay" });
      return;
    }

    this.#mark?.({ type: "repeat-wait", key, repeats: this.#repeats });
    await this.#waitUntilSettled();
    if (!this.#isActive(generation)) {
      this.#mark?.({ type: "repeat-cancelled", key, stage: "settle" });
      return;
    }

    const direction = this.#direction;
    if (direction === null) return;
    this.#repeats++;
    this.#mark?.({ type: "repeat", key, direction, repeats: this.#repeats });
    this.#navigate(direction, "hold-repeat");

    this.#repeatTimer = this.#setTimer(() => {
      this.#repeatTimer = null;
      void this.#runRepeat(generation, key);
    }, this.#repeatMs);
  }
}

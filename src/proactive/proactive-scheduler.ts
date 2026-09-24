export const DEFAULT_PROACTIVE_INTERVAL_MS = 60_000;

export type SchedulerClock = {
  setInterval(callback: () => void, delayMs: number): unknown;
  clearInterval(handle: unknown): void;
};

const defaultClock: SchedulerClock = {
  setInterval: (callback, delayMs) => setInterval(callback, delayMs),
  clearInterval: (handle) => clearInterval(handle as NodeJS.Timeout),
};

/**
 * 管理主动行为检查的定时器。
 *
 * 调度器只负责何时调用检查函数，不关心宠物规则；这样可以在测试中
 * 手动 tick，也可以在 CLI 中用真实的 setInterval 运行。
 */
export class ProactiveScheduler {
  private handle: unknown | null = null;

  private running = false;

  private inFlight = false;

  constructor(
    private readonly task: (now: Date) => Promise<void> | void,
    private readonly intervalMs = DEFAULT_PROACTIVE_INTERVAL_MS,
    private readonly clock: SchedulerClock = defaultClock,
    private readonly onError: (error: unknown) => void = () => undefined,
  ) {}

  start(): void {
    if (this.running) {
      return;
    }

    this.running = true;
    this.handle = this.clock.setInterval(() => {
      void this.tick().catch((error: unknown) => this.onError(error));
    }, this.intervalMs);
  }

  stop(): void {
    if (!this.running) {
      return;
    }

    this.running = false;
    if (this.handle !== null) {
      this.clock.clearInterval(this.handle);
      this.handle = null;
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  /** 执行一次检查；如果上一轮还没完成，则跳过本轮，避免并发重复触发。 */
  async tick(now = new Date()): Promise<boolean> {
    if (this.inFlight) {
      return false;
    }

    this.inFlight = true;
    try {
      await this.task(now);
      return true;
    } finally {
      this.inFlight = false;
    }
  }
}

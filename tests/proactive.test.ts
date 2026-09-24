import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createInitialPet } from "../src/domain/pet";
import {
  InMemoryProactiveRepository,
  JsonProactiveRepository,
} from "../src/proactive/proactive-repository";
import {
  ProactiveBehaviorService,
  LlmProactiveMessageGenerator,
  RuleBasedProactiveMessageGenerator,
} from "../src/proactive/proactive-behavior";
import {
  ProactiveScheduler,
  SchedulerClock,
} from "../src/proactive/proactive-scheduler";

const BASE_TIME = new Date("2026-01-01T00:00:00.000Z");
const PET_ID = "00000000-0000-4000-8000-000000000001";

describe("proactive behavior", () => {
  it("triggers a hunger reminder and suppresses it during the cooldown", async () => {
    const repository = new InMemoryProactiveRepository();
    const notifications: string[] = [];
    const service = new ProactiveBehaviorService(
      repository,
      new RuleBasedProactiveMessageGenerator(),
      {
        onNotification: (notification) => {
          notifications.push(notification.message);
        },
      },
    );
    const pet = {
      ...createInitialPet("Mochi", BASE_TIME, PET_ID),
      hunger: 85,
    };

    await service.initialize(pet);
    const first = await service.check(pet, BASE_TIME);
    const second = await service.check(
      pet,
      new Date(BASE_TIME.getTime() + 60 * 60 * 1000),
    );

    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      petId: PET_ID,
      ruleId: "hunger_high",
      reason: "饥饿度已经达到 80 或以上",
      message: "我有点饿了，可以陪我吃点东西吗？",
    });
    expect(second).toEqual([]);
    expect(notifications).toEqual(["我有点饿了，可以陪我吃点东西吗？"]);
  });

  it("does not duplicate a reminder after the service is recreated", async () => {
    const temporaryDirectory = await mkdtemp(
      join(tmpdir(), "virtual-pet-proactive-"),
    );
    const filePath = join(temporaryDirectory, "data", "proactive-store.json");

    try {
      const pet = {
        ...createInitialPet("Mochi", BASE_TIME, PET_ID),
        hunger: 90,
      };
      const firstService = new ProactiveBehaviorService(
        new JsonProactiveRepository(filePath),
      );
      await firstService.initialize(pet);
      await firstService.check(pet, BASE_TIME);

      const restartedService = new ProactiveBehaviorService(
        new JsonProactiveRepository(filePath),
      );
      const repeated = await restartedService.check(
        pet,
        new Date(BASE_TIME.getTime() + 60 * 60 * 1000),
      );

      expect(repeated).toEqual([]);
      await expect(
        new JsonProactiveRepository(filePath).getNotifications(PET_ID),
      ).resolves.toHaveLength(1);
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("resets the inactivity rule when the user interacts", async () => {
    const service = new ProactiveBehaviorService(
      new InMemoryProactiveRepository(),
    );
    const pet = createInitialPet("Mochi", BASE_TIME, PET_ID);

    await service.initialize(pet);
    await service.recordInteraction(
      pet.id,
      new Date(BASE_TIME.getTime() + 3 * 60 * 60 * 1000),
    );

    const beforeThreshold = await service.check(
      pet,
      new Date(BASE_TIME.getTime() + 6 * 60 * 60 * 1000),
    );
    const afterThreshold = await service.check(
      pet,
      new Date(BASE_TIME.getTime() + 7 * 60 * 60 * 1000),
    );

    expect(beforeThreshold).toEqual([]);
    expect(afterThreshold).toHaveLength(1);
    expect(afterThreshold[0].ruleId).toBe("inactivity");
  });

  it("asks the model for the pet wording and falls back on model failure", async () => {
    const pet = createInitialPet("Mochi", BASE_TIME, PET_ID);
    const trigger = {
      ruleId: "hunger_high" as const,
      reason: "饥饿度已经达到 80 或以上",
      cooldownMs: 6 * 60 * 60 * 1000,
      triggeredAt: BASE_TIME.toISOString(),
    };
    const llmClient = {
      generateText: jest.fn(async (input: { system: string }) => {
        expect(input.system).toContain("始终站在宠物视角");
        expect(input.system).toContain(trigger.reason);
        return "我想吃点好吃的啦！";
      }),
    };
    const generator = new LlmProactiveMessageGenerator(llmClient);

    await expect(
      generator.generate({ pet, trigger, now: BASE_TIME }),
    ).resolves.toBe("我想吃点好吃的啦！");

    llmClient.generateText.mockRejectedValueOnce(new Error("offline"));
    await expect(
      generator.generate({ pet, trigger, now: BASE_TIME }),
    ).resolves.toBe("我有点饿了，可以陪我吃点东西吗？");
  });
});

describe("proactive scheduler", () => {
  it("can start and stop one interval", () => {
    const callbacks: Array<() => void> = [];
    const clock: SchedulerClock = {
      setInterval: jest.fn((callback) => {
        callbacks.push(callback);
        return "timer-1";
      }),
      clearInterval: jest.fn(),
    };
    const scheduler = new ProactiveScheduler(
      async () => undefined,
      1_000,
      clock,
    );

    scheduler.start();
    scheduler.start();

    expect(scheduler.isRunning()).toBe(true);
    expect(clock.setInterval).toHaveBeenCalledTimes(1);
    expect(callbacks).toHaveLength(1);

    scheduler.stop();
    scheduler.stop();

    expect(scheduler.isRunning()).toBe(false);
    expect(clock.clearInterval).toHaveBeenCalledTimes(1);
    expect(clock.clearInterval).toHaveBeenCalledWith("timer-1");
  });

  it("skips a tick while a previous check is still running", async () => {
    let release: (() => void) | undefined;
    const task = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const scheduler = new ProactiveScheduler(task);

    const firstTick = scheduler.tick(BASE_TIME);
    await Promise.resolve();
    const secondTick = await scheduler.tick(BASE_TIME);

    expect(secondTick).toBe(false);
    expect(task).toHaveBeenCalledTimes(1);

    release?.();
    await expect(firstTick).resolves.toBe(true);
  });
});
